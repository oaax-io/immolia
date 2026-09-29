REVOKE EXECUTE ON FUNCTION public.commercial_usage_reserve(text,integer,text,text,text,uuid) FROM authenticated;

CREATE OR REPLACE FUNCTION public.credit_reservations_expire()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; n int := 0;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_platform_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  FOR r IN SELECT id FROM credit_reservations WHERE status='reserved' AND expires_at < now() ORDER BY expires_at LIMIT 500 LOOP
    PERFORM public._credit_reservation_release(r.id, 'reservation_expired', 'expired');
    UPDATE usage_events SET voided_at=COALESCE(voided_at, now()) WHERE reservation_id=r.id;
    n := n+1;
  END LOOP;
  RETURN n;
END $$;