-- lovable-cron-fallback-reviewed: one consolidated 15-min backstop to pull Outlook-side changes (Microsoft polling) and re-arm backoff retries; app-side changes wake the worker immediately via trigger
CREATE EXTENSION IF NOT EXISTS pg_net;

ALTER TABLE public.calendar_event_links
  ADD COLUMN IF NOT EXISTS last_local_hash text NULL,
  ADD COLUMN IF NOT EXISTS last_remote_change_key text NULL,
  ADD COLUMN IF NOT EXISTS last_synced_state jsonb NULL,
  ADD COLUMN IF NOT EXISTS conflict_state text NULL CHECK (conflict_state IN ('open','resolved_local','resolved_remote')),
  ADD COLUMN IF NOT EXISTS conflict_payload jsonb NULL,
  ADD COLUMN IF NOT EXISTS conflict_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS transaction_id text NULL;
ALTER TABLE public.calendar_sync_jobs ADD COLUMN IF NOT EXISTS link_id uuid NULL;
ALTER TABLE public.calendar_sync_jobs DROP CONSTRAINT IF EXISTS calendar_sync_jobs_job_type_check;
ALTER TABLE public.calendar_sync_jobs ADD CONSTRAINT calendar_sync_jobs_job_type_check
  CHECK (job_type IN ('initial','delta','push_appointment','delete_appointment','renew_subscription','resolve_conflict'));

CREATE TABLE public.calendar_busy_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  connection_id uuid NOT NULL REFERENCES public.calendar_connections(id) ON DELETE CASCADE,
  provider_event_id text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_all_day boolean NOT NULL DEFAULT false,
  show_as text NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (connection_id, provider_event_id)
);
CREATE INDEX calendar_busy_blocks_range ON public.calendar_busy_blocks(agency_id, starts_at);
GRANT SELECT ON public.calendar_busy_blocks TO authenticated;
GRANT ALL ON public.calendar_busy_blocks TO service_role;
ALTER TABLE public.calendar_busy_blocks ENABLE ROW LEVEL SECURITY;
CREATE POLICY cal_busy_select_agency ON public.calendar_busy_blocks FOR SELECT TO authenticated
USING (agency_id = public.current_agency_id() AND public.is_agency_member(agency_id)
       AND public.agency_module_enabled_for(agency_id, 'appointments'));

CREATE TABLE public.calendar_worker_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(32), 'hex'),
  worker_url text NOT NULL DEFAULT 'https://asimos.lovable.app/api/public/ms-calendar/worker'
);
REVOKE ALL ON public.calendar_worker_config FROM anon, authenticated;
GRANT ALL ON public.calendar_worker_config TO service_role;
ALTER TABLE public.calendar_worker_config ENABLE ROW LEVEL SECURITY;
INSERT INTO public.calendar_worker_config(id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.calendar_enqueue_appointment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a record; l record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    FOR l IN SELECT id, agency_id, connection_id FROM public.calendar_event_links
             WHERE appointment_id = OLD.id AND origin = 'immolia' AND deleted_at IS NULL LOOP
      INSERT INTO public.calendar_sync_jobs(agency_id, connection_id, job_type, link_id, idempotency_key)
      VALUES (l.agency_id, l.connection_id, 'delete_appointment', l.id, 'del:' || l.id)
      ON CONFLICT (connection_id, idempotency_key) DO NOTHING;
    END LOOP;
    RETURN OLD;
  END IF;
  a := NEW;
  INSERT INTO public.calendar_sync_jobs(agency_id, connection_id, job_type, appointment_id, idempotency_key)
  SELECT c.agency_id, c.id, 'push_appointment', a.id, 'push:' || a.id || ':' || extract(epoch from clock_timestamp())
    FROM public.calendar_connections c
   WHERE c.agency_id = a.agency_id AND c.status = 'connected' AND c.sync_enabled
     AND coalesce((c.sync_metadata->>'push_to_outlook')::boolean, true)
     AND (c.user_id = a.owner_id OR c.user_id = a.assigned_to OR c.user_id = ANY(coalesce(a.extra_assignee_ids, '{}')))
     AND NOT EXISTS (SELECT 1 FROM public.calendar_sync_jobs j WHERE j.connection_id = c.id
                     AND j.appointment_id = a.id AND j.job_type = 'push_appointment' AND j.status = 'queued');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.calendar_enqueue_appointment() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER appointments_calendar_enqueue AFTER INSERT OR UPDATE OF title, starts_at, ends_at, location, status, owner_id, assigned_to, extra_assignee_ids
  ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.calendar_enqueue_appointment();
CREATE TRIGGER appointments_calendar_enqueue_del BEFORE DELETE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.calendar_enqueue_appointment();

CREATE OR REPLACE FUNCTION public.calendar_jobs_claim(_limit int DEFAULT 10)
RETURNS SETOF public.calendar_sync_jobs LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.calendar_sync_jobs SET status='queued', run_after=now()
   WHERE status='running' AND started_at < now() - interval '10 minutes';
  RETURN QUERY
  WITH pick AS (
    SELECT DISTINCT ON (j.connection_id) j.id
      FROM public.calendar_sync_jobs j
     WHERE j.status='queued' AND j.run_after <= now()
       AND NOT EXISTS (SELECT 1 FROM public.calendar_sync_jobs r WHERE r.connection_id=j.connection_id AND r.status='running')
     ORDER BY j.connection_id, (j.job_type IN ('initial','delta')) DESC, j.created_at
     LIMIT _limit
  )
  UPDATE public.calendar_sync_jobs s SET status='running', started_at=now(), attempts=s.attempts+1
    FROM pick WHERE s.id=pick.id AND s.status='queued'
  RETURNING s.*;
END $$;
REVOKE ALL ON FUNCTION public.calendar_jobs_claim(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_jobs_claim(int) TO service_role;

CREATE OR REPLACE FUNCTION public.calendar_kick_worker()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cfg record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.calendar_sync_jobs WHERE status='queued' AND run_after <= now()) THEN RETURN; END IF;
  SELECT * INTO cfg FROM public.calendar_worker_config WHERE id=1;
  PERFORM net.http_post(url := cfg.worker_url, headers := jsonb_build_object('Content-Type','application/json','x-worker-token', cfg.token), body := '{}'::jsonb, timeout_milliseconds := 55000);
END $$;
REVOKE ALL ON FUNCTION public.calendar_kick_worker() FROM PUBLIC, anon, authenticated;

-- Wake-on-enqueue
CREATE OR REPLACE FUNCTION public.calendar_jobs_wake()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN PERFORM public.calendar_kick_worker(); RETURN NULL; END $$;
REVOKE ALL ON FUNCTION public.calendar_jobs_wake() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER calendar_sync_jobs_wake AFTER INSERT ON public.calendar_sync_jobs
  FOR EACH STATEMENT EXECUTE FUNCTION public.calendar_jobs_wake();

-- 15-Min-Backstop: Outlook-Änderungen abholen + fällige Wiederholungen anstossen
CREATE OR REPLACE FUNCTION public.calendar_periodic()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.calendar_sync_jobs(agency_id, connection_id, job_type, idempotency_key)
  SELECT c.agency_id, c.id, 'delta', 'periodic:' || to_char(date_trunc('minute', now()), 'YYYYMMDDHH24MI')
    FROM public.calendar_connections c
   WHERE c.status='connected' AND c.sync_enabled AND c.selected_calendar_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.calendar_sync_jobs j WHERE j.connection_id=c.id AND j.status IN ('queued','running') AND j.job_type IN ('initial','delta'))
  ON CONFLICT (connection_id, idempotency_key) DO NOTHING;
  PERFORM public.calendar_kick_worker();
END $$;
REVOKE ALL ON FUNCTION public.calendar_periodic() FROM PUBLIC, anon, authenticated;
SELECT cron.schedule('immolia-calendar-periodic', '*/15 * * * *', 'SELECT public.calendar_periodic();');