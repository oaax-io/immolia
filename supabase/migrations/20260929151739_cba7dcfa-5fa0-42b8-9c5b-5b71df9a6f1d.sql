INSERT INTO public.usage_meters(key,name,unit,kind,recurring,default_period) VALUES
 ('ai_expose_generations','KI-Exposés','generation','counted',false,'monthly'),
 ('market_analyses','Marktanalysen','analysis','counted',false,'monthly'),
 ('ai_assistant_usage','KI-Assistent','request','counted',false,'monthly'),
 ('ai_image_generations','KI-Bilder','image','counted',false,'monthly')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.commercial_period_key(_agency_id uuid, _period text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE s record; w record;
BEGIN
  IF _period = 'one_time' THEN RETURN 'once'; END IF;
  IF _period = 'none' THEN RETURN 'none'; END IF;
  SELECT sub.id, sub.current_period_start, sub.current_period_end INTO s FROM subscriptions sub
   WHERE sub.agency_id=_agency_id AND sub.plan_id = public.agency_active_plan_id(_agency_id)
     AND sub.current_period_start IS NOT NULL AND (sub.current_period_end IS NULL OR sub.current_period_end > now())
   ORDER BY sub.created_at DESC LIMIT 1;
  IF _period = 'subscription_period' AND s.id IS NOT NULL THEN
    RETURN 'sub:' || s.id || ':' || floor(extract(epoch FROM s.current_period_start)*1000)::bigint;
  END IF;
  IF _period = 'monthly' AND s.id IS NOT NULL AND s.current_period_end IS NOT NULL THEN
    SELECT * INTO w FROM public._commercial_credit_window(s.current_period_start, s.current_period_end, now());
    IF w.cs IS NOT NULL THEN
      RETURN 'cm:' || s.id || ':' || floor(extract(epoch FROM w.cs)*1000)::bigint;
    END IF;
  END IF;
  RETURN 'm:' || to_char(now() AT TIME ZONE 'Europe/Zurich','YYYY-MM');
END $$;

CREATE OR REPLACE FUNCTION public._commercial_usage_decision(a uuid, _key text, _qty integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE m record; lim jsonb; used bigint; incl bigint; rem bigint; inc_part int; over int; unit_cost int; cost int; bal int; per text; utype text; pk text;
BEGIN
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'invalid_quantity' USING ERRCODE='22023'; END IF;
  SELECT * INTO m FROM usage_meters WHERE key=_key;
  IF m.key IS NULL THEN RETURN jsonb_build_object('decision','NOT_AVAILABLE','result','not_available','reason','unknown_usage_key','usage_key',_key); END IF;
  IF NOT public.agency_is_active(a) THEN RETURN jsonb_build_object('decision','NOT_AVAILABLE','result','not_available','reason','agency_inactive','usage_key',_key); END IF;
  IF m.kind = 'core_unlimited' THEN RETURN jsonb_build_object('decision','ALLOWED_UNLIMITED','result','free','usage_type','unlimited','usage_key',_key,'reason','core_data','credit_cost',0); END IF;
  utype := CASE WHEN m.kind='gauge' THEN 'recurring_resource_overage' ELSE 'included_usage' END;
  lim := public.agency_effective_limit(a, _key);
  IF NOT (lim->>'defined')::boolean THEN
    RETURN jsonb_build_object('decision','ALLOWED_UNLIMITED','result','free','usage_type',utype,'usage_key',_key,'reason','no_allowance_defined','credit_cost',0);
  END IF;
  IF (lim->>'unlimited')::boolean THEN RETURN jsonb_build_object('decision','ALLOWED_UNLIMITED','result','free','usage_type',utype,'usage_key',_key,'credit_cost',0); END IF;
  per := COALESCE(lim->>'period', m.default_period);
  pk := public.commercial_period_key(a, per);
  used := public.commercial_usage_current(a, _key, per);
  incl := (lim->>'value')::bigint;
  IF m.kind = 'counted' AND incl = 0 AND lim->>'policy' = 'metered' THEN utype := 'metered_action'; END IF;
  rem := GREATEST(incl - used, 0);
  -- Gauge: _qty = zusätzliche Menge (z. B. neuer Upload); Überschuss betrifft Gesamtbelegung, nicht jede Aktion erneut
  inc_part := LEAST(_qty, rem)::int;
  over := _qty - inc_part;
  bal := public._credit_available(a);
  IF over = 0 THEN
    RETURN jsonb_build_object('decision','ALLOWED_INCLUDED','result','included','usage_type',utype,'usage_key',_key,'requested',_qty,'used',used,'included',incl,
      'included_remaining',rem,'included_quantity',inc_part,'overage_quantity',0,'credit_cost',0,'credit_balance',bal,'period_key',pk);
  END IF;
  IF lim->>'policy' = 'hard_limit' THEN
    RETURN jsonb_build_object('decision','HARD_BLOCKED','result','hard_blocked','usage_type',utype,'usage_key',_key,'requested',_qty,'used',used,'included',incl,'included_remaining',rem,'overage_quantity',over,'period_key',pk);
  END IF;
  IF lim->>'policy' <> 'metered' THEN
    RETURN jsonb_build_object('decision','NOT_AVAILABLE','result','not_available','reason','no_overage_rule','usage_type',utype,'usage_key',_key,'requested',_qty,'used',used,'included',incl,'included_remaining',rem,'overage_quantity',over,'period_key',pk);
  END IF;
  unit_cost := (lim->>'overage_credit_cost')::int;
  IF m.kind = 'gauge' THEN
    over := GREATEST(used + _qty - incl, 0)::int;
    IF unit_cost IS NULL THEN
      RETURN jsonb_build_object('decision','RECURRING_OVERAGE','result','credit_required','usage_type',utype,'usage_key',_key,'requested',_qty,'used',used,'included',incl,
        'overage_quantity',over,'reason','commercial_configuration_required','allowed',true,'credit_cost_per_period',NULL,'credit_balance',bal,'period_key',pk);
    END IF;
    cost := over * unit_cost;
    RETURN jsonb_build_object('decision', CASE WHEN bal >= cost THEN 'RECURRING_OVERAGE' ELSE 'INSUFFICIENT_CREDITS' END,
      'result', CASE WHEN bal >= cost THEN 'credit_required' ELSE 'insufficient_credits' END,
      'usage_type',utype,'usage_key',_key,'requested',_qty,'used',used,'included',incl,'overage_quantity',over,
      'credit_cost_per_unit',unit_cost,'credit_cost_per_period',cost,'credit_cost',0,'allowed', bal >= cost,'credit_balance',bal,'recurring',true,'period_key',pk);
  END IF;
  IF unit_cost IS NULL THEN
    RETURN jsonb_build_object('decision','NOT_AVAILABLE','result','not_available','reason','overage_cost_not_set','usage_type',utype,'usage_key',_key,'included_remaining',rem,'overage_quantity',over,'period_key',pk);
  END IF;
  cost := over * unit_cost;
  RETURN jsonb_build_object('decision', CASE WHEN bal >= cost THEN 'ALLOWED_CREDIT_OVERAGE' ELSE 'INSUFFICIENT_CREDITS' END,
    'result', CASE WHEN bal >= cost THEN 'credit_required' ELSE 'insufficient_credits' END,
    'usage_type',utype,'usage_key',_key,'requested',_qty,'used',used,'included',incl,'included_remaining',rem,'included_quantity',inc_part,
    'overage_quantity',over,'credit_cost_per_unit',unit_cost,'credit_cost',cost,'credit_balance',bal,'recurring',false,'period_key',pk);
END $$;