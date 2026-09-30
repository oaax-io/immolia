ALTER TABLE public.calendar_busy_blocks ADD COLUMN IF NOT EXISTS web_link text NULL;
ALTER TABLE public.calendar_assignment_suggestions ADD COLUMN IF NOT EXISTS matched_on text NULL;

CREATE TABLE public.calendar_event_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  connection_id uuid NOT NULL REFERENCES public.calendar_connections(id) ON DELETE CASCADE,
  provider_event_id text NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('automatic','manual','confirmed_suggestion')),
  reason text NOT NULL,
  matched_on text NULL,
  removed_at timestamptz NULL,
  removed_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, provider_event_id, client_id)
);
GRANT SELECT ON public.calendar_event_clients TO authenticated;
GRANT ALL ON public.calendar_event_clients TO service_role;
ALTER TABLE public.calendar_event_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY cal_evclients_select_owner ON public.calendar_event_clients FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() AND agency_id = public.current_agency_id() AND public.is_agency_member(agency_id)
         AND public.agency_module_enabled_for(agency_id,'appointments'));
CREATE TRIGGER trg_cal_evclients_updated BEFORE UPDATE ON public.calendar_event_clients
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
CREATE INDEX IF NOT EXISTS idx_cal_evclients_client ON public.calendar_event_clients(client_id) WHERE removed_at IS NULL;

CREATE OR REPLACE FUNCTION public.calendar_norm_phone(_p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN _p IS NULL THEN NULL
    WHEN btrim(_p) LIKE '+%' AND length(regexp_replace(_p,'\D','','g')) BETWEEN 8 AND 15 THEN '+'||regexp_replace(_p,'\D','','g')
    WHEN regexp_replace(_p,'[\s\-/().]','','g') LIKE '00%' AND length(regexp_replace(_p,'\D','','g')) BETWEEN 10 AND 17
      THEN '+'||substr(regexp_replace(_p,'\D','','g'),3)
    ELSE NULL END
$$;

-- Kernlogik der Erkennung (nur Server/Worker)
CREATE OR REPLACE FUNCTION public.calendar_match_event(_connection_id uuid, _provider_event_id text, _phones text[] DEFAULT '{}')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _c record; _b record; _excluded text[]; _e text; _ids uuid[]; _auto uuid[] := '{}'; _sugg_keep uuid[] := '{}'; _r record;
BEGIN
  SELECT * INTO _c FROM calendar_connections WHERE id=_connection_id;
  IF _c IS NULL THEN RETURN; END IF;
  SELECT * INTO _b FROM calendar_busy_blocks WHERE connection_id=_connection_id AND provider_event_id=_provider_event_id;
  IF _b IS NULL OR COALESCE(_b.is_private,false) THEN
    -- Private/fehlende Termine: automatische Beziehungen und offene Vorschläge entfernen, manuelle bleiben
    DELETE FROM calendar_event_clients WHERE connection_id=_connection_id AND provider_event_id=_provider_event_id AND source='automatic' AND removed_at IS NULL;
    DELETE FROM calendar_assignment_suggestions WHERE connection_id=_connection_id AND provider_event_id=_provider_event_id AND status='open';
    RETURN;
  END IF;
  -- Eigene und Team-Adressen ausschliessen
  SELECT array_agg(DISTINCT x) INTO _excluded FROM (
    SELECT lower(btrim(p.email)) x FROM agency_memberships m JOIN profiles p ON p.id=m.user_id WHERE m.agency_id=_c.agency_id AND m.is_active AND p.email IS NOT NULL
    UNION SELECT lower(btrim(u.email)) FROM agency_memberships m JOIN auth.users u ON u.id=m.user_id WHERE m.agency_id=_c.agency_id AND m.is_active AND u.email IS NOT NULL
    UNION SELECT lower(btrim(_c.account_display)) WHERE _c.account_display LIKE '%@%'
  ) s;
  _excluded := COALESCE(_excluded,'{}');

  FOREACH _e IN ARRAY COALESCE(_b.attendee_emails,'{}') LOOP
    _e := lower(btrim(_e));
    CONTINUE WHEN _e = '' OR _e = ANY(_excluded);
    SELECT array_agg(id) INTO _ids FROM clients WHERE agency_id=_c.agency_id AND lower(btrim(email))=_e;
    IF _ids IS NULL THEN CONTINUE; END IF;
    IF array_length(_ids,1)=1 THEN
      _auto := _auto || _ids[1];
      INSERT INTO calendar_event_clients(agency_id, owner_user_id, connection_id, provider_event_id, client_id, source, reason, matched_on)
      VALUES (_c.agency_id, _c.user_id, _connection_id, _provider_event_id, _ids[1], 'automatic', 'email_unique', _e)
      ON CONFLICT (connection_id, provider_event_id, client_id) DO NOTHING; -- manuelle/entfernte bleiben unangetastet
    ELSE
      _sugg_keep := _sugg_keep || _ids;
      INSERT INTO calendar_assignment_suggestions(agency_id, owner_user_id, connection_id, provider_event_id, client_id, reason, matched_on)
      SELECT _c.agency_id, _c.user_id, _connection_id, _provider_event_id, x, 'email_ambiguous', _e FROM unnest(_ids) x
      ON CONFLICT (connection_id, provider_event_id, client_id) DO NOTHING;
    END IF;
  END LOOP;

  -- Automatische Beziehungen, die nicht mehr passen, neu bewerten (manuelle/entfernte bleiben)
  DELETE FROM calendar_event_clients WHERE connection_id=_connection_id AND provider_event_id=_provider_event_id
    AND source='automatic' AND removed_at IS NULL AND NOT (client_id = ANY(_auto));

  -- Weitere Merkmale nur als Vorschlag
  FOR _r IN
    SELECT cl.id, 'phone'::text reason, calendar_norm_phone(cl.phone) mv FROM clients cl
      WHERE cl.agency_id=_c.agency_id AND calendar_norm_phone(cl.phone) = ANY(COALESCE(_phones,'{}'))
    UNION ALL
    SELECT cl.id, 'name', cl.full_name FROM clients cl
      WHERE cl.agency_id=_c.agency_id AND length(btrim(cl.full_name))>=5 AND position(' ' in btrim(cl.full_name))>0
        AND _b.subject IS NOT NULL AND position(lower(btrim(cl.full_name)) in lower(_b.subject))>0
    UNION ALL
    SELECT cl.id, 'company', cl.company_name FROM clients cl
      WHERE cl.agency_id=_c.agency_id AND length(btrim(COALESCE(cl.company_name,'')))>=4
        AND _b.subject IS NOT NULL AND position(lower(btrim(cl.company_name)) in lower(_b.subject))>0
  LOOP
    CONTINUE WHEN EXISTS (SELECT 1 FROM calendar_event_clients WHERE connection_id=_connection_id AND provider_event_id=_provider_event_id AND client_id=_r.id);
    _sugg_keep := _sugg_keep || _r.id;
    INSERT INTO calendar_assignment_suggestions(agency_id, owner_user_id, connection_id, provider_event_id, client_id, reason, matched_on)
    VALUES (_c.agency_id, _c.user_id, _connection_id, _provider_event_id, _r.id, _r.reason, _r.mv)
    ON CONFLICT (connection_id, provider_event_id, client_id) DO NOTHING;
  END LOOP;

  -- Offene Vorschläge ohne aktuelles Merkmal entfernen; abgelehnte bleiben gespeichert (keine Wiederanzeige)
  DELETE FROM calendar_assignment_suggestions WHERE connection_id=_connection_id AND provider_event_id=_provider_event_id
    AND status='open' AND NOT (client_id = ANY(_sugg_keep));
END $$;
REVOKE ALL ON FUNCTION public.calendar_match_event(uuid,text,text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_match_event(uuid,text,text[]) TO service_role;

-- Manuell verknüpfen / Vorschlag bestätigen / Verknüpfung entfernen / Vorschlag ablehnen (nur Eigentümer, aktive Firma)
CREATE OR REPLACE FUNCTION public.calendar_link_client(_provider_event_id text, _client_id uuid, _suggestion_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ag uuid := public.current_agency_id(); _conn record; _id uuid; _src text := 'manual';
BEGIN
  IF auth.uid() IS NULL OR _ag IS NULL OR NOT public.is_agency_member(_ag) OR NOT public.agency_module_enabled_for(_ag,'appointments') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO _conn FROM calendar_connections WHERE agency_id=_ag AND user_id=auth.uid() AND provider='microsoft' AND status <> 'disconnected' LIMIT 1;
  IF _conn IS NULL THEN RAISE EXCEPTION 'no_connection'; END IF;
  IF NOT EXISTS (SELECT 1 FROM calendar_busy_blocks WHERE connection_id=_conn.id AND provider_event_id=_provider_event_id) THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM clients WHERE id=_client_id AND agency_id=_ag) THEN RAISE EXCEPTION 'client_other_agency'; END IF;
  IF _suggestion_id IS NOT NULL THEN
    UPDATE calendar_assignment_suggestions SET status='confirmed'
      WHERE id=_suggestion_id AND connection_id=_conn.id AND provider_event_id=_provider_event_id AND client_id=_client_id;
    IF FOUND THEN _src := 'confirmed_suggestion'; END IF;
  END IF;
  INSERT INTO calendar_event_clients(agency_id, owner_user_id, connection_id, provider_event_id, client_id, source, reason)
  VALUES (_ag, auth.uid(), _conn.id, _provider_event_id, _client_id, _src, _src)
  ON CONFLICT (connection_id, provider_event_id, client_id) DO UPDATE
    SET source=EXCLUDED.source, reason=EXCLUDED.reason, removed_at=NULL, removed_by=NULL
  RETURNING id INTO _id;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.calendar_unlink_client(_link_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE calendar_event_clients SET removed_at=now(), removed_by=auth.uid()
  WHERE id=_link_id AND owner_user_id=auth.uid() AND agency_id=public.current_agency_id() AND public.is_agency_member(agency_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
END $$;

CREATE OR REPLACE FUNCTION public.calendar_dismiss_suggestion(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE calendar_assignment_suggestions SET status='dismissed'
  WHERE id=_id AND owner_user_id=auth.uid() AND agency_id=public.current_agency_id() AND public.is_agency_member(agency_id);
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
END $$;

-- Korrektur Aktiv-Feld der Mitgliedschaft
CREATE OR REPLACE FUNCTION public.calendar_assign_event(
  _provider_event_id text, _client_id uuid, _responsible uuid[], _visibility text, _shared_with uuid[], _source text DEFAULT 'manual')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _ag uuid := public.current_agency_id(); _conn record; _blk record; _id uuid; _u uuid;
BEGIN
  IF auth.uid() IS NULL OR _ag IS NULL OR NOT public.is_agency_member(_ag) OR NOT public.agency_module_enabled_for(_ag,'appointments') THEN
    RAISE EXCEPTION 'forbidden'; END IF;
  IF _visibility NOT IN ('personal','shared') OR _source NOT IN ('manual','confirmed_suggestion') THEN RAISE EXCEPTION 'invalid_input'; END IF;
  SELECT * INTO _conn FROM calendar_connections WHERE agency_id=_ag AND user_id=auth.uid() AND provider='microsoft' AND status <> 'disconnected' LIMIT 1;
  IF _conn IS NULL THEN RAISE EXCEPTION 'no_connection'; END IF;
  SELECT * INTO _blk FROM calendar_busy_blocks WHERE connection_id=_conn.id AND provider_event_id=_provider_event_id;
  IF _blk IS NULL THEN RAISE EXCEPTION 'event_not_found'; END IF;
  IF _client_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients WHERE id=_client_id AND agency_id=_ag) THEN RAISE EXCEPTION 'client_other_agency'; END IF;
  _responsible := COALESCE(_responsible,'{}'); _shared_with := COALESCE(_shared_with,'{}');
  IF EXISTS (SELECT 1 FROM unnest(_responsible) r WHERE r <> auth.uid()) AND _visibility <> 'shared' THEN RAISE EXCEPTION 'assignment_requires_share'; END IF;
  IF _visibility='shared' AND COALESCE(_blk.is_private,false) THEN RAISE EXCEPTION 'private_event_not_shareable'; END IF;
  IF _visibility='personal' THEN _shared_with := '{}'; END IF;
  _shared_with := ARRAY(SELECT DISTINCT x FROM unnest(_shared_with || _responsible) x WHERE x <> auth.uid());
  FOREACH _u IN ARRAY (_shared_with || _responsible) LOOP
    IF NOT EXISTS (SELECT 1 FROM agency_memberships m WHERE m.agency_id=_ag AND m.user_id=_u AND m.is_active) THEN
      RAISE EXCEPTION 'user_other_agency'; END IF;
  END LOOP;
  INSERT INTO calendar_event_assignments(agency_id, owner_user_id, connection_id, provider_event_id, client_id, responsible_user_ids, visibility, shared_with_user_ids, assignment_source)
  VALUES (_ag, auth.uid(), _conn.id, _provider_event_id, _client_id, _responsible, _visibility, _shared_with, _source)
  ON CONFLICT (connection_id, provider_event_id) DO UPDATE SET client_id=EXCLUDED.client_id, responsible_user_ids=EXCLUDED.responsible_user_ids,
    visibility=EXCLUDED.visibility, shared_with_user_ids=EXCLUDED.shared_with_user_ids, assignment_source=EXCLUDED.assignment_source
  RETURNING id INTO _id;
  IF _client_id IS NOT NULL THEN PERFORM public.calendar_link_client(_provider_event_id, _client_id, NULL); END IF;
  RETURN _id;
END $$;

-- Freigegebene Termine: Kundenfilter auch über Verknüpfungen
CREATE OR REPLACE FUNCTION public.calendar_shared_events(_from timestamptz, _to timestamptz, _client_id uuid DEFAULT NULL)
RETURNS TABLE(assignment_id uuid, owner_user_id uuid, provider_event_id text, subject text, location text, starts_at timestamptz, ends_at timestamptz,
  is_all_day boolean, is_cancelled boolean, client_id uuid, responsible_user_ids uuid[], visibility text, is_own boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.owner_user_id, a.provider_event_id, b.subject, b.location,
    b.starts_at, b.ends_at, b.is_all_day, COALESCE(b.is_cancelled,false), COALESCE(_client_id, a.client_id), a.responsible_user_ids, a.visibility,
    a.owner_user_id = auth.uid()
  FROM calendar_event_assignments a
  JOIN calendar_busy_blocks b ON b.connection_id=a.connection_id AND b.provider_event_id=a.provider_event_id
  JOIN calendar_connections c ON c.id=a.connection_id AND c.status <> 'disconnected'
  WHERE a.agency_id = public.current_agency_id() AND public.is_agency_member(a.agency_id)
    AND public.agency_module_enabled_for(a.agency_id,'appointments')
    AND b.starts_at < _to AND b.ends_at > _from
    AND (_client_id IS NULL OR a.client_id=_client_id OR EXISTS (SELECT 1 FROM calendar_event_clients ec
         WHERE ec.connection_id=a.connection_id AND ec.provider_event_id=a.provider_event_id AND ec.client_id=_client_id AND ec.removed_at IS NULL))
    AND (a.owner_user_id = auth.uid()
         OR (a.visibility='shared' AND NOT COALESCE(b.is_private,false) AND auth.uid() = ANY(a.shared_with_user_ids)));
$$;

-- Zentrale Kunden-Terminliste (RLS des Aufrufers gilt; Outlook-Teile nur Eigentümer bzw. Freigabe)
CREATE OR REPLACE FUNCTION public.client_calendar_items(_client_id uuid)
RETURNS TABLE(kind text, item_id uuid, link_id uuid, provider_event_id text, title text, starts_at timestamptz, ends_at timestamptz,
  status text, origin text, responsible text[], reason text, source text, web_link text, is_own boolean)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  SELECT 'appointment', a.id, NULL::uuid, NULL::text, a.title, a.starts_at, a.ends_at, a.status::text, 'immolia',
    ARRAY(SELECT p.full_name FROM profiles p WHERE p.id = ANY(ARRAY[a.assigned_to] || COALESCE(a.extra_assignee_ids,'{}')) AND p.full_name IS NOT NULL),
    'manual', 'manual', NULL::text, true
  FROM appointments a WHERE a.client_id=_client_id
  UNION ALL
  SELECT 'outlook', b.id, ec.id, b.provider_event_id, COALESCE(b.subject,'Outlook-Termin'), b.starts_at, b.ends_at,
    CASE WHEN COALESCE(b.is_cancelled,false) THEN 'cancelled' ELSE 'scheduled' END, 'microsoft',
    ARRAY(SELECT p.full_name FROM profiles p WHERE p.id = ANY(COALESCE((SELECT x.responsible_user_ids FROM calendar_event_assignments x
      WHERE x.connection_id=b.connection_id AND x.provider_event_id=b.provider_event_id),'{}') || ARRAY[b.user_id]) AND p.full_name IS NOT NULL),
    ec.reason, ec.source, b.web_link, true
  FROM calendar_event_clients ec
  JOIN calendar_busy_blocks b ON b.connection_id=ec.connection_id AND b.provider_event_id=ec.provider_event_id
  WHERE ec.client_id=_client_id AND ec.removed_at IS NULL
  UNION ALL
  SELECT 'suggestion', s.id, NULL, b.provider_event_id, COALESCE(b.subject,'Outlook-Termin'), b.starts_at, b.ends_at,
    CASE WHEN COALESCE(b.is_cancelled,false) THEN 'cancelled' ELSE 'scheduled' END, 'microsoft', '{}'::text[],
    s.reason, 'suggestion', b.web_link, true
  FROM calendar_assignment_suggestions s
  JOIN calendar_busy_blocks b ON b.connection_id=s.connection_id AND b.provider_event_id=s.provider_event_id
  WHERE s.client_id=_client_id AND s.status='open' AND COALESCE(b.is_private,false)=false
  UNION ALL
  SELECT 'shared', se.assignment_id, NULL, NULL, se.subject, se.starts_at, se.ends_at,
    CASE WHEN se.is_cancelled THEN 'cancelled' ELSE 'scheduled' END, 'microsoft',
    ARRAY(SELECT p.full_name FROM profiles p WHERE p.id = ANY(se.responsible_user_ids) AND p.full_name IS NOT NULL),
    'shared', 'shared', NULL, false
  FROM public.calendar_shared_events('-infinity'::timestamptz, 'infinity'::timestamptz, _client_id) se
  WHERE NOT se.is_own
$$;

REVOKE ALL ON FUNCTION public.calendar_link_client(text,uuid,uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_unlink_client(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.client_calendar_items(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_link_client(text,uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_unlink_client(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.client_calendar_items(uuid) TO authenticated;

-- Bestand einmalig nachprüfen (ohne Telefon aus Beschreibungen, keine Benachrichtigungen)
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT connection_id, provider_event_id FROM public.calendar_busy_blocks LOOP
    PERFORM public.calendar_match_event(r.connection_id, r.provider_event_id, '{}');
  END LOOP;
END $$;