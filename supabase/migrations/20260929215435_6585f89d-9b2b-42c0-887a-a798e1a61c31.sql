-- lovable-cron-fallback-reviewed: time-based TTL expiry of abandoned reservations; no event fires when a server action dies without settle
CREATE OR REPLACE FUNCTION public.credit_reservations_expire()
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r record; n int := 0; res jsonb; is_server boolean; is_plat boolean;
BEGIN
  is_server := COALESCE(auth.role(),'') = 'service_role' OR (auth.uid() IS NULL AND session_user IN ('postgres','supabase_admin'));
  is_plat := NOT is_server AND public.is_platform_admin();
  IF NOT is_server AND NOT is_plat THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  FOR r IN SELECT id FROM credit_reservations WHERE status='reserved' AND expires_at < now() ORDER BY expires_at LIMIT 500 LOOP
    -- _credit_reservation_release sperrt Wallet + Zeile und prüft den Status erneut (Finalize gewinnt, falls zuerst)
    res := public._credit_reservation_release(r.id, 'reservation_expired', 'expired');
    IF COALESCE((res->>'ok')::boolean,false) AND NOT COALESCE((res->>'replayed')::boolean,false) THEN
      INSERT INTO usage_event_voids(usage_event_id, reason)
        SELECT id,'reservation_expired' FROM usage_events WHERE reservation_id=r.id ON CONFLICT DO NOTHING;
      n := n+1;
    END IF;
  END LOOP;
  IF is_plat THEN
    INSERT INTO platform_audit_logs(actor_user_id, action, target_type, target_label, metadata)
    VALUES (auth.uid(), 'credit_reservations_expire', 'credit_reservations', 'Manueller Reservierungs-Cleanup', jsonb_build_object('expired', n));
  END IF;
  RETURN n;
END $function$;
REVOKE ALL ON FUNCTION public.credit_reservations_expire() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credit_reservations_expire() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._credit_reservation_release(uuid,text,text) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  PERFORM cron.unschedule('immolia-credit-reservations-expire') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='immolia-credit-reservations-expire');
  PERFORM cron.schedule('immolia-credit-reservations-expire', '*/15 * * * *', 'SELECT public.credit_reservations_expire();');
END $$;