-- 5.6.1a Tenant-Isolation: Benachrichtigungen, Postfach, Feedback
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS agency_id uuid NULL REFERENCES public.agencies(id);
ALTER TABLE public.direct_messages ADD COLUMN IF NOT EXISTS agency_id uuid NULL REFERENCES public.agencies(id);
ALTER TABLE public.feedback ADD COLUMN IF NOT EXISTS agency_id uuid NULL REFERENCES public.agencies(id);
CREATE INDEX IF NOT EXISTS notifications_agency_user_idx ON public.notifications(agency_id, user_id);
CREATE INDEX IF NOT EXISTS direct_messages_agency_idx ON public.direct_messages(agency_id);
CREATE INDEX IF NOT EXISTS feedback_agency_idx ON public.feedback(agency_id);

-- Einzige aktive Mitgliedschaft eines Benutzers (sonst NULL)
CREATE OR REPLACE FUNCTION public._sole_agency_of(_uid uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN count(*) = 1 THEN min(agency_id::text)::uuid END
  FROM agency_memberships WHERE user_id = _uid AND is_active
$$;
REVOKE ALL ON FUNCTION public._sole_agency_of(uuid) FROM PUBLIC, anon, authenticated;

-- Firma setzen: aktive Firma des Auslösers, wenn Empfänger/Ersteller dort Mitglied ist; sonst dessen einzige Firma
CREATE OR REPLACE FUNCTION public.tg_scope_notification() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a uuid := public.current_agency_id();
BEGIN
  IF NEW.agency_id IS NULL THEN
    IF a IS NOT NULL AND EXISTS (SELECT 1 FROM agency_memberships WHERE agency_id = a AND user_id = NEW.user_id AND is_active) THEN
      NEW.agency_id := a;
    ELSE NEW.agency_id := public._sole_agency_of(NEW.user_id); END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.tg_scope_direct_message() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a uuid := public.current_agency_id();
BEGIN
  -- Nachrichten immer in der aktiven Firma des Absenders; Empfänger muss dort Mitglied sein
  IF a IS NULL OR NOT EXISTS (SELECT 1 FROM agency_memberships WHERE agency_id = a AND user_id = NEW.recipient_id AND is_active) THEN
    RAISE EXCEPTION 'recipient_not_in_workspace' USING ERRCODE = '42501';
  END IF;
  NEW.agency_id := a;
  RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION public.tg_scope_feedback() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.agency_id := coalesce(public.current_agency_id(), public._sole_agency_of(NEW.created_by));
  ELSE
    NEW.agency_id := OLD.agency_id; -- Firma nie nachträglich änderbar
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS scope_notification ON public.notifications;
CREATE TRIGGER scope_notification BEFORE INSERT ON public.notifications FOR EACH ROW EXECUTE FUNCTION public.tg_scope_notification();
DROP TRIGGER IF EXISTS scope_direct_message ON public.direct_messages;
CREATE TRIGGER scope_direct_message BEFORE INSERT ON public.direct_messages FOR EACH ROW EXECUTE FUNCTION public.tg_scope_direct_message();
DROP TRIGGER IF EXISTS scope_feedback ON public.feedback;
CREATE TRIGGER scope_feedback BEFORE INSERT OR UPDATE ON public.feedback FOR EACH ROW EXECUTE FUNCTION public.tg_scope_feedback();

-- Altdaten nur eindeutig zuordnen: Mitgliedschaft zum Zeitpunkt der Erstellung genau einer Firma
UPDATE public.notifications n SET agency_id = x.agency_id FROM (
  SELECT n2.id, min(m.agency_id::text)::uuid agency_id FROM public.notifications n2
  JOIN public.agency_memberships m ON m.user_id = n2.user_id AND m.created_at <= n2.created_at
  WHERE n2.agency_id IS NULL GROUP BY n2.id HAVING count(*) = 1) x WHERE n.id = x.id;
UPDATE public.feedback f SET agency_id = x.agency_id FROM (
  SELECT f2.id, min(m.agency_id::text)::uuid agency_id FROM public.feedback f2
  JOIN public.agency_memberships m ON m.user_id = f2.created_by AND m.created_at <= f2.created_at
  WHERE f2.agency_id IS NULL GROUP BY f2.id HAVING count(*) = 1) x WHERE f.id = x.id;
UPDATE public.direct_messages d SET agency_id = x.agency_id FROM (
  SELECT d2.id, min(ms.agency_id::text)::uuid agency_id FROM public.direct_messages d2
  JOIN public.agency_memberships ms ON ms.user_id = d2.sender_id AND ms.created_at <= d2.created_at
  JOIN public.agency_memberships mr ON mr.user_id = d2.recipient_id AND mr.agency_id = ms.agency_id AND mr.created_at <= d2.created_at
  WHERE d2.agency_id IS NULL GROUP BY d2.id HAVING count(*) = 1) x WHERE d.id = x.id;

-- RESTRICTIVE: in der Tenant-App nur Zeilen der aktiven Firma (auch für Plattformrollen)
CREATE POLICY sec561a_notifications_tenant ON public.notifications AS RESTRICTIVE FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id()) WITH CHECK (agency_id = public.current_agency_id());
CREATE POLICY sec561a_dm_tenant ON public.direct_messages AS RESTRICTIVE FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id()) WITH CHECK (agency_id = public.current_agency_id());
CREATE POLICY sec561a_feedback_tenant ON public.feedback AS RESTRICTIVE FOR ALL TO authenticated
  USING (agency_id = public.current_agency_id()) WITH CHECK (agency_id = public.current_agency_id());
CREATE POLICY sec561a_feedback_comments_tenant ON public.feedback_comments AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.feedback f WHERE f.id = feedback_id AND f.agency_id = public.current_agency_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.feedback f WHERE f.id = feedback_id AND f.agency_id = public.current_agency_id()));
CREATE POLICY sec561a_feedback_votes_tenant ON public.feedback_votes AS RESTRICTIVE FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.feedback f WHERE f.id = feedback_id AND f.agency_id = public.current_agency_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.feedback f WHERE f.id = feedback_id AND f.agency_id = public.current_agency_id()));

-- Plattform: zentrale Feedback-Verwaltung nur über explizite RPCs
CREATE OR REPLACE FUNCTION public.platform_list_feedback(_agency_id uuid DEFAULT NULL)
RETURNS TABLE(id uuid, agency_id uuid, agency_name text, author_name text, author_email text, type text, title text,
  description text, status text, priority text, created_at timestamptz, comments bigint, votes bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT f.id, f.agency_id, a.name, p.full_name, p.email, f.type::text, f.title, f.description,
    f.status::text, f.priority::text, f.created_at,
    (SELECT count(*) FROM feedback_comments c WHERE c.feedback_id = f.id),
    (SELECT count(*) FROM feedback_votes v WHERE v.feedback_id = f.id)
  FROM feedback f LEFT JOIN agencies a ON a.id = f.agency_id LEFT JOIN profiles p ON p.id = f.created_by
  WHERE _agency_id IS NULL OR f.agency_id = _agency_id ORDER BY f.created_at DESC;
END $$;
CREATE OR REPLACE FUNCTION public.platform_update_feedback(_id uuid, _status text DEFAULT NULL, _priority text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f feedback;
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
  SELECT * INTO f FROM feedback WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  UPDATE feedback SET status = coalesce(_status::feedback_status, status), priority = coalesce(_priority::feedback_priority, priority),
    resolved_at = CASE WHEN _status IN ('done','rejected') THEN now() WHEN _status IS NOT NULL THEN NULL ELSE resolved_at END,
    updated_at = now() WHERE id = _id;
  INSERT INTO platform_audit_logs (actor_user_id, action, target_type, target_id, target_label, metadata)
  VALUES (auth.uid(), 'feedback_updated', 'feedback', _id, f.title,
    jsonb_build_object('agency_id', f.agency_id, 'old_status', f.status, 'new_status', _status, 'old_priority', f.priority, 'new_priority', _priority));
END $$;
REVOKE ALL ON FUNCTION public.platform_list_feedback(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.platform_update_feedback(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_list_feedback(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_update_feedback(uuid, text, text) TO authenticated;