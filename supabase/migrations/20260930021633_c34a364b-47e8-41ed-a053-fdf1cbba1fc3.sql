ALTER TABLE public.calendar_connections DROP CONSTRAINT IF EXISTS calendar_connections_status_check;
ALTER TABLE public.calendar_connections ADD CONSTRAINT calendar_connections_status_check CHECK (status IN (
 'pending','connecting','connected','syncing','needs_reauth','reconnect_required','admin_approval_required','paused','disconnected','membership_revoked','error'));
ALTER TABLE public.calendar_connection_tokens
  ADD COLUMN IF NOT EXISTS access_token_ct text NULL,
  ADD COLUMN IF NOT EXISTS refresh_token_ct text NULL,
  ADD COLUMN IF NOT EXISTS refresh_lock_until timestamptz NULL;
ALTER TABLE public.calendar_oauth_attempts
  ADD COLUMN IF NOT EXISTS code_verifier_ct text NULL,
  ADD COLUMN IF NOT EXISTS nonce_hash text NULL,
  ADD COLUMN IF NOT EXISTS return_path text NULL;

-- Verbindungsversuch einmalig verbrauchen (atomar)
CREATE OR REPLACE FUNCTION public.calendar_oauth_consume(_state_hash text)
RETURNS SETOF public.calendar_oauth_attempts LANGUAGE sql SECURITY DEFINER SET search_path=public AS $$
  UPDATE public.calendar_oauth_attempts SET used_at = now()
   WHERE state_hash = _state_hash AND used_at IS NULL AND expires_at > now()
  RETURNING *;
$$;
REVOKE ALL ON FUNCTION public.calendar_oauth_consume(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_oauth_consume(text) TO service_role;

-- Token-Erneuerung sperren (verhindert parallele Refreshes)
CREATE OR REPLACE FUNCTION public.calendar_token_try_lock(_connection_id uuid, _seconds int DEFAULT 30)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n int;
BEGIN
  UPDATE public.calendar_connection_tokens SET refresh_lock_until = now() + make_interval(secs => _seconds)
   WHERE connection_id = _connection_id AND (refresh_lock_until IS NULL OR refresh_lock_until < now());
  GET DIAGNOSTICS n = ROW_COUNT; RETURN n = 1;
END $$;
REVOKE ALL ON FUNCTION public.calendar_token_try_lock(uuid,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_token_try_lock(uuid,int) TO service_role;

-- Aktive Mitgliedschaft serverseitig prüfen (für Callback ohne Sitzung)
CREATE OR REPLACE FUNCTION public.calendar_membership_active(_agency_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.agency_is_active(_agency_id) AND EXISTS (
    SELECT 1 FROM public.agency_memberships m WHERE m.agency_id=_agency_id AND m.user_id=_user_id AND m.is_active)
    AND public.agency_module_enabled_for(_agency_id, 'appointments');
$$;
REVOKE ALL ON FUNCTION public.calendar_membership_active(uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calendar_membership_active(uuid,uuid) TO service_role;

DELETE FROM public.calendar_oauth_attempts WHERE expires_at < now() - interval '1 day';