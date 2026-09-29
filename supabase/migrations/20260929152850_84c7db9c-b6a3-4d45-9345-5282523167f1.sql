CREATE TABLE public.usage_event_voids(
  usage_event_id uuid PRIMARY KEY REFERENCES public.usage_events(id),
  reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.usage_event_voids TO service_role;
ALTER TABLE public.usage_event_voids ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service only" ON public.usage_event_voids FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.commercial_usage_current(_agency_id uuid, _key text, _period text)
RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE k text; r bigint;
BEGIN
  SELECT kind INTO k FROM usage_meters WHERE key=_key;
  IF k = 'counted' THEN
    SELECT COALESCE(SUM(e.quantity),0) INTO r FROM usage_events e
     WHERE e.agency_id=_agency_id AND e.usage_key=_key
       AND NOT EXISTS (SELECT 1 FROM usage_event_voids v WHERE v.usage_event_id=e.id)
       AND e.period_key=public.commercial_period_key(_agency_id, COALESCE(_period,'none'));
  ELSIF _key = 'users' THEN
    SELECT count(*) INTO r FROM agency_memberships WHERE agency_id=_agency_id AND is_active;
  ELSIF _key = 'storage_gb' THEN
    SELECT CEIL(COALESCE(SUM((o.metadata->>'size')::numeric),0) / 1073741824.0)::bigint INTO r
      FROM storage_object_tenants t JOIN storage.objects o ON o.bucket_id=t.bucket_id AND o.name=t.object_name
     WHERE t.agency_id=_agency_id;
  ELSIF _key = 'domains' THEN
    SELECT count(*) INTO r FROM tenant_domains WHERE agency_id=_agency_id AND domain_type='custom';
  ELSE r := 0; END IF;
  RETURN COALESCE(r,0);
END $$;

CREATE OR REPLACE FUNCTION public.commercial_usage_settle(_usage_event_id uuid, _success boolean, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e record; res jsonb := '{}'::jsonb; voided boolean;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO e FROM usage_events WHERE id=_usage_event_id;
  IF e.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  PERFORM public._credit_wallet(e.agency_id);
  voided := EXISTS (SELECT 1 FROM usage_event_voids WHERE usage_event_id=e.id);
  IF _success THEN
    IF voided THEN RETURN jsonb_build_object('ok',false,'reason','already_voided'); END IF;
    IF e.reservation_id IS NOT NULL THEN res := public.credit_reservation_finalize(e.reservation_id); END IF;
    RETURN jsonb_build_object('ok',true,'status','finalized','reservation',res);
  END IF;
  IF e.reservation_id IS NOT NULL THEN
    res := public._credit_reservation_release(e.reservation_id, COALESCE(_reason,'execution_failed'), 'released');
    IF NOT COALESCE((res->>'ok')::boolean,false) AND NOT voided THEN RETURN jsonb_build_object('ok',false,'reason','already_finalized','reservation',res); END IF;
  END IF;
  INSERT INTO usage_event_voids(usage_event_id, reason) VALUES (e.id, left(_reason,200)) ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok',true,'status','voided','reservation',res);
END $$;

CREATE OR REPLACE FUNCTION public.commercial_usage_reserve(_usage_key text, _quantity integer, _idempotency_key text, _reference_type text DEFAULT NULL, _reference_id text DEFAULT NULL, _agency_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a uuid; w uuid; d jsonb; ex record; op uuid; cost int; ev uuid; rid uuid; kind text; exv boolean;
BEGIN
  a := public._commercial_resolve_agency(_agency_id);
  IF _idempotency_key IS NULL OR length(_idempotency_key) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE='22023'; END IF;
  SELECT um.kind INTO kind FROM usage_meters um WHERE key=_usage_key;
  IF kind IS NULL OR kind <> 'counted' THEN RAISE EXCEPTION 'not_counted_usage' USING ERRCODE='22023'; END IF;
  w := public._credit_wallet(a);
  SELECT * INTO ex FROM usage_events WHERE agency_id=a AND usage_key=_usage_key AND idempotency_key=_idempotency_key;
  IF ex.id IS NOT NULL THEN
    exv := EXISTS (SELECT 1 FROM usage_event_voids WHERE usage_event_id=ex.id);
    RETURN jsonb_build_object('ok', NOT exv,'replayed',true,'usage_event_id',ex.id,'reservation_id',ex.reservation_id,'credit_cost',ex.credit_cost,'voided',exv);
  END IF;
  d := public._commercial_usage_decision(a, _usage_key, _quantity);
  IF d->>'decision' NOT IN ('ALLOWED_UNLIMITED','ALLOWED_INCLUDED','ALLOWED_CREDIT_OVERAGE') THEN
    RETURN jsonb_build_object('ok',false,'decision',d->>'decision','result',d->>'result','reason',COALESCE(d->>'reason',d->>'result'),
      'required',d->'credit_cost','available',d->'credit_balance');
  END IF;
  cost := COALESCE((d->>'credit_cost')::int,0);
  IF cost > 0 THEN
    INSERT INTO credit_operations(agency_id, kind, action_key, idempotency_key, amount, created_by, reason)
    VALUES (a,'consume','usage.'||_usage_key,'ursv:'||_idempotency_key,cost,auth.uid(),'usage_overage_reservation') RETURNING id INTO op;
    PERFORM public._credit_debit(a, w, op, cost, 'consumption', 'usage.'||_usage_key, auth.uid());
    INSERT INTO credit_reservations(agency_id,action_key,idempotency_key,amount,operation_id,reference_type,reference_id,expires_at,created_by)
    VALUES (a,'usage.'||_usage_key,_idempotency_key,cost,op,left(_reference_type,60),left(_reference_id,200),now()+interval '15 minutes',auth.uid()) RETURNING id INTO rid;
  END IF;
  INSERT INTO usage_events(agency_id,usage_key,period_key,quantity,included_quantity,overage_quantity,credit_cost,decision,credit_operation_id,reservation_id,reference_type,reference_id,idempotency_key,created_by)
  VALUES (a,_usage_key,COALESCE(d->>'period_key','none'),_quantity,
    CASE WHEN d->>'decision'='ALLOWED_UNLIMITED' THEN _quantity ELSE (d->>'included_quantity')::int END,
    CASE WHEN d->>'decision'='ALLOWED_UNLIMITED' THEN 0 ELSE (d->>'overage_quantity')::int END,
    cost,d->>'decision',op,rid,left(_reference_type,60),left(_reference_id,200),_idempotency_key,auth.uid()) RETURNING id INTO ev;
  RETURN jsonb_build_object('ok',true,'replayed',false,'usage_event_id',ev,'reservation_id',rid,'credit_cost',cost,'result',d->>'result');
END $$;

CREATE OR REPLACE FUNCTION public.credit_reservations_expire()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; n int := 0;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_platform_admin() THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  FOR r IN SELECT id FROM credit_reservations WHERE status='reserved' AND expires_at < now() ORDER BY expires_at LIMIT 500 LOOP
    PERFORM public._credit_reservation_release(r.id, 'reservation_expired', 'expired');
    INSERT INTO usage_event_voids(usage_event_id, reason) SELECT id,'reservation_expired' FROM usage_events WHERE reservation_id=r.id ON CONFLICT DO NOTHING;
    n := n+1;
  END LOOP;
  RETURN n;
END $$;