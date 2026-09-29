ALTER TABLE public.credit_action_costs ADD COLUMN IF NOT EXISTS settlement_policy text NULL;

CREATE TABLE public.credit_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  action_key text NOT NULL,
  idempotency_key text NOT NULL,
  amount integer NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','finalized','released','expired')),
  operation_id uuid NOT NULL REFERENCES public.credit_operations(id),
  release_operation_id uuid NULL REFERENCES public.credit_operations(id),
  reference_type text NULL,
  reference_id text NULL,
  release_reason text NULL,
  expires_at timestamptz NOT NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agency_id, action_key, idempotency_key)
);
CREATE INDEX credit_reservations_open_idx ON public.credit_reservations(expires_at) WHERE status='reserved';
GRANT SELECT ON public.credit_reservations TO authenticated;
GRANT ALL ON public.credit_reservations TO service_role;
ALTER TABLE public.credit_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY credit_reservations_owner_read ON public.credit_reservations FOR SELECT TO authenticated
  USING (public.is_agency_owner_or_admin(agency_id));

CREATE OR REPLACE FUNCTION public.credit_reserve(_action_key text, _idempotency_key text, _reference_type text DEFAULT NULL, _reference_id text DEFAULT NULL, _agency_id uuid DEFAULT NULL, _ttl_seconds integer DEFAULT 900)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a uuid; w uuid; v_cost int; v_avail int; op uuid; parts jsonb; ex record; rid uuid;
BEGIN
  IF auth.role() = 'service_role' AND _agency_id IS NOT NULL THEN a := _agency_id;
  ELSE
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
    a := public.current_agency_id();
    IF _agency_id IS NOT NULL AND _agency_id IS DISTINCT FROM a THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  END IF;
  IF a IS NULL OR NOT public.agency_is_active(a) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _action_key IS NULL OR _action_key !~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$' THEN RAISE EXCEPTION 'invalid_action' USING ERRCODE='22023'; END IF;
  IF _idempotency_key IS NULL OR length(_idempotency_key) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE='22023'; END IF;
  IF _ttl_seconds IS NULL OR _ttl_seconds NOT BETWEEN 30 AND 3600 THEN _ttl_seconds := 900; END IF;

  v_cost := public.credit_action_effective_cost(_action_key);
  IF v_cost = 0 THEN RETURN jsonb_build_object('ok',true,'free',true,'reservation_id',NULL,'amount',0); END IF;

  w := public._credit_wallet(a);  -- Sperre pro Firma
  SELECT * INTO ex FROM credit_reservations WHERE agency_id=a AND action_key=_action_key AND idempotency_key=_idempotency_key;
  IF ex.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', ex.status IN ('reserved','finalized'), 'replayed',true,'reservation_id',ex.id,'status',ex.status,'amount',ex.amount);
  END IF;
  v_avail := public._credit_available(a);
  IF v_avail < v_cost THEN
    RETURN jsonb_build_object('ok',false,'reason','INSUFFICIENT_CREDITS','required',v_cost,'available',v_avail);
  END IF;
  INSERT INTO credit_operations(agency_id, kind, action_key, idempotency_key, amount, created_by, reason)
  VALUES (a,'consume',_action_key,'rsv:'||_idempotency_key,v_cost,auth.uid(),'reservation') RETURNING id INTO op;
  parts := public._credit_debit(a, w, op, v_cost, 'consumption', _action_key, auth.uid());
  INSERT INTO credit_reservations(agency_id,action_key,idempotency_key,amount,operation_id,reference_type,reference_id,expires_at,created_by)
  VALUES (a,_action_key,_idempotency_key,v_cost,op,left(_reference_type,60),left(_reference_id,200),now()+make_interval(secs=>_ttl_seconds),auth.uid())
  RETURNING id INTO rid;
  RETURN jsonb_build_object('ok',true,'replayed',false,'reservation_id',rid,'status','reserved','amount',v_cost,'parts',parts);
END $$;

CREATE OR REPLACE FUNCTION public.credit_reservation_finalize(_reservation_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM credit_reservations WHERE id=_reservation_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  PERFORM public._credit_wallet(r.agency_id);
  SELECT * INTO r FROM credit_reservations WHERE id=_reservation_id FOR UPDATE;
  IF r.status = 'finalized' THEN RETURN jsonb_build_object('ok',true,'replayed',true,'status','finalized'); END IF;
  IF r.status <> 'reserved' THEN RETURN jsonb_build_object('ok',false,'status',r.status,'reason','not_reserved'); END IF;
  UPDATE credit_reservations SET status='finalized', updated_at=now() WHERE id=r.id;
  RETURN jsonb_build_object('ok',true,'replayed',false,'status','finalized','amount',r.amount);
END $$;

CREATE OR REPLACE FUNCTION public._credit_reservation_release(_reservation_id uuid, _reason text, _new_status text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; rop uuid;
BEGIN
  SELECT * INTO r FROM credit_reservations WHERE id=_reservation_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  PERFORM public._credit_wallet(r.agency_id);
  SELECT * INTO r FROM credit_reservations WHERE id=_reservation_id FOR UPDATE;
  IF r.status IN ('released','expired') THEN RETURN jsonb_build_object('ok',true,'replayed',true,'status',r.status); END IF;
  IF r.status <> 'reserved' THEN RETURN jsonb_build_object('ok',false,'status',r.status,'reason','already_finalized'); END IF;
  rop := public._credit_refund(r.operation_id, NULL, left(COALESCE(_reason,'reservation_release'),200), NULL);
  UPDATE credit_reservations SET status=_new_status, release_operation_id=rop, release_reason=left(_reason,200), updated_at=now() WHERE id=r.id;
  RETURN jsonb_build_object('ok',true,'replayed',false,'status',_new_status,'released',r.amount);
END $$;

CREATE OR REPLACE FUNCTION public.credit_reservation_release(_reservation_id uuid, _reason text DEFAULT 'execution_failed')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  RETURN public._credit_reservation_release(_reservation_id, _reason, 'released');
END $$;

CREATE OR REPLACE FUNCTION public.credit_reservations_expire()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; n int := 0;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_platform_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  FOR r IN SELECT id FROM credit_reservations WHERE status='reserved' AND expires_at < now() ORDER BY expires_at LIMIT 500 LOOP
    PERFORM public._credit_reservation_release(r.id, 'reservation_expired', 'expired'); n := n+1;
  END LOOP;
  RETURN n;
END $$;

REVOKE ALL ON FUNCTION public._credit_reservation_release(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credit_reservation_finalize(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credit_reservation_release(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.credit_reservations_expire() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.credit_reserve(text,text,text,text,uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credit_reserve(text,text,text,text,uuid,integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.credit_reservation_finalize(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.credit_reservation_release(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.credit_reservations_expire() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._credit_reservation_release(uuid,text,text) TO service_role;