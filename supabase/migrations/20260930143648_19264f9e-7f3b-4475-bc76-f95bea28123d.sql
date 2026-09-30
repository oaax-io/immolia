ALTER TABLE public.calendar_busy_blocks
  ADD COLUMN IF NOT EXISTS subject text NULL,
  ADD COLUMN IF NOT EXISTS location text NULL,
  ADD COLUMN IF NOT EXISTS attendee_emails text[] NULL,
  ADD COLUMN IF NOT EXISTS is_private boolean NULL,
  ADD COLUMN IF NOT EXISTS is_cancelled boolean NULL,
  ADD COLUMN IF NOT EXISTS is_organizer boolean NULL;

CREATE TABLE public.calendar_event_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  connection_id uuid NOT NULL REFERENCES public.calendar_connections(id) ON DELETE CASCADE,
  provider_event_id text NOT NULL,
  client_id uuid NULL REFERENCES public.clients(id) ON DELETE SET NULL,
  responsible_user_ids uuid[] NOT NULL DEFAULT '{}',
  visibility text NOT NULL DEFAULT 'personal' CHECK (visibility IN ('personal','shared')),
  shared_with_user_ids uuid[] NOT NULL DEFAULT '{}',
  assignment_source text NOT NULL DEFAULT 'manual' CHECK (assignment_source IN ('automatic','manual','confirmed_suggestion')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, provider_event_id)
);
GRANT SELECT ON public.calendar_event_assignments TO authenticated;
GRANT ALL ON public.calendar_event_assignments TO service_role;
ALTER TABLE public.calendar_event_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY cal_assign_select_owner ON public.calendar_event_assignments FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() AND agency_id = public.current_agency_id() AND public.is_agency_member(agency_id)
         AND public.agency_module_enabled_for(agency_id,'appointments'));

CREATE TABLE public.calendar_assignment_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL,
  connection_id uuid NOT NULL REFERENCES public.calendar_connections(id) ON DELETE CASCADE,
  provider_event_id text NOT NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  reason text NOT NULL DEFAULT 'attendee_email',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','confirmed','dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, provider_event_id, client_id)
);
GRANT SELECT ON public.calendar_assignment_suggestions TO authenticated;
GRANT ALL ON public.calendar_assignment_suggestions TO service_role;
ALTER TABLE public.calendar_assignment_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY cal_sugg_select_owner ON public.calendar_assignment_suggestions FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() AND agency_id = public.current_agency_id() AND public.is_agency_member(agency_id)
         AND public.agency_module_enabled_for(agency_id,'appointments'));

CREATE TRIGGER trg_cal_assign_updated BEFORE UPDATE ON public.calendar_event_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Zuordnen/Freigeben: nur Verbindungseigentümer, aktive Firma, gleiche Firma für Kunde und Personen
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
  -- Zuweisung an andere erfordert bewusste Freigabe
  IF EXISTS (SELECT 1 FROM unnest(_responsible) r WHERE r <> auth.uid()) AND _visibility <> 'shared' THEN RAISE EXCEPTION 'assignment_requires_share'; END IF;
  IF _visibility='shared' AND COALESCE(_blk.is_private,false) THEN RAISE EXCEPTION 'private_event_not_shareable'; END IF;
  IF _visibility='personal' THEN _shared_with := '{}'; END IF;
  -- Verantwortliche anderer Personen sind automatisch freigegeben
  _shared_with := ARRAY(SELECT DISTINCT x FROM unnest(_shared_with || _responsible) x WHERE x <> auth.uid());
  FOREACH _u IN ARRAY (_shared_with || _responsible) LOOP
    IF NOT EXISTS (SELECT 1 FROM agency_memberships m WHERE m.agency_id=_ag AND m.user_id=_u AND m.status='active') THEN
      RAISE EXCEPTION 'user_other_agency'; END IF;
  END LOOP;
  INSERT INTO calendar_event_assignments(agency_id, owner_user_id, connection_id, provider_event_id, client_id, responsible_user_ids, visibility, shared_with_user_ids, assignment_source)
  VALUES (_ag, auth.uid(), _conn.id, _provider_event_id, _client_id, _responsible, _visibility, _shared_with, _source)
  ON CONFLICT (connection_id, provider_event_id) DO UPDATE SET client_id=EXCLUDED.client_id, responsible_user_ids=EXCLUDED.responsible_user_ids,
    visibility=EXCLUDED.visibility, shared_with_user_ids=EXCLUDED.shared_with_user_ids, assignment_source=EXCLUDED.assignment_source
  RETURNING id INTO _id;
  IF _source='confirmed_suggestion' AND _client_id IS NOT NULL THEN
    UPDATE calendar_assignment_suggestions SET status='confirmed' WHERE connection_id=_conn.id AND provider_event_id=_provider_event_id AND client_id=_client_id;
  END IF;
  RETURN _id;
END $$;

CREATE OR REPLACE FUNCTION public.calendar_dismiss_suggestion(_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE calendar_assignment_suggestions SET status='dismissed'
  WHERE id=_id AND owner_user_id=auth.uid() AND agency_id=public.current_agency_id();
$$;

-- Freigegebene Outlook-Termine: sichere Projektion ohne Teilnehmer/Beschreibung
CREATE OR REPLACE FUNCTION public.calendar_shared_events(_from timestamptz, _to timestamptz, _client_id uuid DEFAULT NULL)
RETURNS TABLE(assignment_id uuid, owner_user_id uuid, provider_event_id text, subject text, location text, starts_at timestamptz, ends_at timestamptz,
  is_all_day boolean, is_cancelled boolean, client_id uuid, responsible_user_ids uuid[], visibility text, is_own boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT a.id, a.owner_user_id, a.provider_event_id,
    CASE WHEN COALESCE(b.is_private,false) AND a.owner_user_id<>auth.uid() THEN 'Privat' ELSE b.subject END,
    CASE WHEN a.owner_user_id=auth.uid() THEN b.location ELSE b.location END,
    b.starts_at, b.ends_at, b.is_all_day, COALESCE(b.is_cancelled,false), a.client_id, a.responsible_user_ids, a.visibility,
    a.owner_user_id = auth.uid()
  FROM calendar_event_assignments a
  JOIN calendar_busy_blocks b ON b.connection_id=a.connection_id AND b.provider_event_id=a.provider_event_id
  JOIN calendar_connections c ON c.id=a.connection_id AND c.status <> 'disconnected'
  WHERE a.agency_id = public.current_agency_id() AND public.is_agency_member(a.agency_id)
    AND public.agency_module_enabled_for(a.agency_id,'appointments')
    AND b.starts_at < _to AND b.ends_at > _from
    AND (_client_id IS NULL OR a.client_id=_client_id)
    AND (a.owner_user_id = auth.uid()
         OR (a.visibility='shared' AND NOT COALESCE(b.is_private,false) AND auth.uid() = ANY(a.shared_with_user_ids)));
$$;

REVOKE ALL ON FUNCTION public.calendar_assign_event(text,uuid,uuid[],text,uuid[],text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_dismiss_suggestion(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calendar_shared_events(timestamptz,timestamptz,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendar_assign_event(text,uuid,uuid[],text,uuid[],text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_dismiss_suggestion(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_shared_events(timestamptz,timestamptz,uuid) TO authenticated;