ALTER TABLE public.calendar_connections ADD COLUMN IF NOT EXISTS subscription_client_state_hash text NULL;
ALTER TABLE public.calendar_sync_jobs DROP CONSTRAINT IF EXISTS calendar_sync_jobs_job_type_check;
ALTER TABLE public.calendar_sync_jobs ADD CONSTRAINT calendar_sync_jobs_job_type_check
  CHECK (job_type IN ('initial','delta','push_appointment','delete_appointment','renew_subscription','resolve_conflict','ensure_subscription'));
CREATE INDEX IF NOT EXISTS calendar_connections_subscription ON public.calendar_connections(subscription_id) WHERE subscription_id IS NOT NULL;

-- Backstop: Subscriptions erneuern (<24h Restlaufzeit oder fehlend) + Delta nur, wenn >60 Min ohne Abgleich
CREATE OR REPLACE FUNCTION public.calendar_periodic()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.calendar_sync_jobs(agency_id, connection_id, job_type, idempotency_key)
  SELECT c.agency_id, c.id, 'ensure_subscription', 'sub:' || to_char(date_trunc('hour', now()), 'YYYYMMDDHH24')
    FROM public.calendar_connections c
   WHERE c.status='connected' AND c.sync_enabled AND c.selected_calendar_id IS NOT NULL
     AND (c.subscription_id IS NULL OR c.subscription_expires_at IS NULL OR c.subscription_expires_at < now() + interval '24 hours')
  ON CONFLICT (connection_id, idempotency_key) DO NOTHING;
  INSERT INTO public.calendar_sync_jobs(agency_id, connection_id, job_type, idempotency_key)
  SELECT c.agency_id, c.id, 'delta', 'periodic:' || to_char(date_trunc('minute', now()), 'YYYYMMDDHH24MI')
    FROM public.calendar_connections c
   WHERE c.status='connected' AND c.sync_enabled AND c.selected_calendar_id IS NOT NULL
     AND (c.last_synced_at IS NULL OR c.last_synced_at < now() - interval '60 minutes' OR c.subscription_id IS NULL)
     AND NOT EXISTS (SELECT 1 FROM public.calendar_sync_jobs j WHERE j.connection_id=c.id AND j.status IN ('queued','running') AND j.job_type IN ('initial','delta'))
  ON CONFLICT (connection_id, idempotency_key) DO NOTHING;
  -- alte erledigte Jobs und abgelaufene OAuth-Versuche aufräumen
  DELETE FROM public.calendar_sync_jobs WHERE status IN ('succeeded','canceled') AND finished_at < now() - interval '14 days';
  DELETE FROM public.calendar_oauth_attempts WHERE expires_at < now() - interval '1 day';
  PERFORM public.calendar_kick_worker();
END $$;
REVOKE ALL ON FUNCTION public.calendar_periodic() FROM PUBLIC, anon, authenticated;

-- Plattform-Monitoring (nur bereinigte Betriebsdaten, keine Inhalte/Tokens)
CREATE OR REPLACE FUNCTION public.platform_calendar_health()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_platform_admin() THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN jsonb_build_object(
    'connections', (SELECT coalesce(jsonb_object_agg(status, n), '{}') FROM (SELECT status, count(*) n FROM calendar_connections GROUP BY status) s),
    'subscriptions_expiring_24h', (SELECT count(*) FROM calendar_connections WHERE status='connected' AND subscription_expires_at < now() + interval '24 hours'),
    'jobs', (SELECT coalesce(jsonb_object_agg(status, n), '{}') FROM (SELECT status, count(*) n FROM calendar_sync_jobs GROUP BY status) s),
    'recent_failures', (SELECT coalesce(jsonb_agg(f), '[]') FROM (
       SELECT j.agency_id, j.job_type, j.error_code, j.error_detail_sanitized, j.attempts, j.finished_at
         FROM calendar_sync_jobs j WHERE j.status='failed' ORDER BY j.finished_at DESC NULLS LAST LIMIT 50) f)
  );
END $$;
REVOKE ALL ON FUNCTION public.platform_calendar_health() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.platform_calendar_health() TO authenticated;