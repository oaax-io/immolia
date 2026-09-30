-- Microsoft 365 Kalenderintegration – Datenfundament (V1, keine Verbindung aktiv)
CREATE TABLE public.calendar_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'microsoft' CHECK (provider IN ('microsoft')),
  ms_tenant_id text NULL,
  ms_user_id text NULL,
  account_display text NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','connected','needs_reauth','paused','disconnected','membership_revoked','error')),
  selected_calendar_id text NULL,
  selected_calendar_name text NULL,
  sync_direction text NOT NULL DEFAULT 'two_way' CHECK (sync_direction IN ('two_way','immolia_to_microsoft','microsoft_to_immolia')),
  sync_enabled boolean NOT NULL DEFAULT false,
  last_synced_at timestamptz NULL,
  last_error_code text NULL,
  last_error_at timestamptz NULL,
  delta_link text NULL,
  subscription_id text NULL,
  subscription_expires_at timestamptz NULL,
  sync_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, user_id, provider)
);
GRANT SELECT ON public.calendar_connections TO authenticated;
GRANT ALL ON public.calendar_connections TO service_role;
ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY cal_conn_select_own ON public.calendar_connections FOR SELECT TO authenticated
USING (user_id = auth.uid() AND agency_id = public.current_agency_id() AND public.is_agency_member(agency_id)
       AND public.agency_module_enabled_for(agency_id, 'appointments'));

-- Tokens: nur service_role, verschlüsselt (pgp_sym_encrypt, Schlüssel als Server-Secret)
CREATE TABLE public.calendar_connection_tokens (
  connection_id uuid PRIMARY KEY REFERENCES public.calendar_connections(id) ON DELETE CASCADE,
  access_token_enc bytea NULL,
  refresh_token_enc bytea NULL,
  access_token_expires_at timestamptz NULL,
  scopes text[] NULL,
  key_version smallint NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.calendar_connection_tokens FROM anon, authenticated;
GRANT ALL ON public.calendar_connection_tokens TO service_role;
ALTER TABLE public.calendar_connection_tokens ENABLE ROW LEVEL SECURITY;

-- Einmalige, kurzlebige OAuth-Versuche (nur Hash des state gespeichert)
CREATE TABLE public.calendar_oauth_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'microsoft',
  code_verifier_enc bytea NULL,
  return_host text NULL,
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.calendar_oauth_attempts FROM anon, authenticated;
GRANT ALL ON public.calendar_oauth_attempts TO service_role;
ALTER TABLE public.calendar_oauth_attempts ENABLE ROW LEVEL SECURITY;

-- Zuordnung Immolia-Termin <-> Microsoft-Termin inkl. Herkunft
CREATE TABLE public.calendar_event_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.calendar_connections(id) ON DELETE CASCADE,
  appointment_id uuid NULL REFERENCES public.appointments(id) ON DELETE SET NULL,
  provider_event_id text NOT NULL,
  ical_uid text NULL,
  origin text NOT NULL CHECK (origin IN ('immolia','microsoft')),
  origin_agency_id uuid NULL,
  change_key text NULL,
  last_synced_at timestamptz NULL,
  deleted_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, provider_event_id)
);
CREATE UNIQUE INDEX calendar_event_links_conn_appt ON public.calendar_event_links(connection_id, appointment_id) WHERE appointment_id IS NOT NULL;
GRANT SELECT ON public.calendar_event_links TO authenticated;
GRANT ALL ON public.calendar_event_links TO service_role;
ALTER TABLE public.calendar_event_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY cal_links_select_own ON public.calendar_event_links FOR SELECT TO authenticated
USING (agency_id = public.current_agency_id() AND EXISTS (
  SELECT 1 FROM public.calendar_connections c WHERE c.id = connection_id AND c.user_id = auth.uid() AND c.agency_id = calendar_event_links.agency_id));

-- Sync-Jobs mit Wiederholungen und bereinigtem Fehlerprotokoll
CREATE TABLE public.calendar_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  connection_id uuid NOT NULL REFERENCES public.calendar_connections(id) ON DELETE CASCADE,
  job_type text NOT NULL CHECK (job_type IN ('initial','delta','push_appointment','delete_appointment','renew_subscription')),
  appointment_id uuid NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','canceled')),
  attempts int NOT NULL DEFAULT 0,
  max_attempts int NOT NULL DEFAULT 5,
  run_after timestamptz NOT NULL DEFAULT now(),
  idempotency_key text NULL,
  error_code text NULL,
  error_detail_sanitized text NULL,
  started_at timestamptz NULL,
  finished_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, idempotency_key)
);
CREATE INDEX calendar_sync_jobs_due ON public.calendar_sync_jobs(status, run_after);
GRANT SELECT ON public.calendar_sync_jobs TO authenticated;
GRANT ALL ON public.calendar_sync_jobs TO service_role;
ALTER TABLE public.calendar_sync_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY cal_jobs_select_own ON public.calendar_sync_jobs FOR SELECT TO authenticated
USING (agency_id = public.current_agency_id() AND EXISTS (
  SELECT 1 FROM public.calendar_connections c WHERE c.id = connection_id AND c.user_id = auth.uid()));

-- Mitglied entfernt/deaktiviert -> Sync in dieser Firma stoppen
CREATE OR REPLACE FUNCTION public.calendar_stop_on_membership_end()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _agency uuid; _user uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN _agency := OLD.agency_id; _user := OLD.user_id;
  ELSIF NEW.is_active = false AND OLD.is_active = true THEN _agency := NEW.agency_id; _user := NEW.user_id;
  ELSE RETURN NEW; END IF;
  UPDATE public.calendar_connections SET status='membership_revoked', sync_enabled=false, updated_at=now()
   WHERE agency_id=_agency AND user_id=_user;
  DELETE FROM public.calendar_connection_tokens t USING public.calendar_connections c
   WHERE t.connection_id=c.id AND c.agency_id=_agency AND c.user_id=_user;
  UPDATE public.calendar_sync_jobs j SET status='canceled', finished_at=now()
   FROM public.calendar_connections c WHERE j.connection_id=c.id AND c.agency_id=_agency AND c.user_id=_user AND j.status IN ('queued','running');
  RETURN COALESCE(NEW, OLD);
END $$;
REVOKE ALL ON FUNCTION public.calendar_stop_on_membership_end() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER agency_memberships_calendar_stop AFTER UPDATE OF is_active OR DELETE ON public.agency_memberships
FOR EACH ROW EXECUTE FUNCTION public.calendar_stop_on_membership_end();