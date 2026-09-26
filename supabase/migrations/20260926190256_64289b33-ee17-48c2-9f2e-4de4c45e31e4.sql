
-- 1) Limitmodell erweitern (plan_limits = Allowance-Quelle)
ALTER TABLE public.plan_limits
  ADD COLUMN IF NOT EXISTS policy text NULL,
  ADD COLUMN IF NOT EXISTS period text NULL,
  ADD COLUMN IF NOT EXISTS overage_credit_cost integer NULL,
  ADD COLUMN IF NOT EXISTS unit text NULL;
ALTER TABLE public.plan_limits ADD CONSTRAINT plan_limits_policy_check CHECK (policy IS NULL OR policy IN ('unlimited','included','metered','hard_limit'));
ALTER TABLE public.plan_limits ADD CONSTRAINT plan_limits_period_check CHECK (period IS NULL OR period IN ('one_time','monthly','subscription_period','none'));
ALTER TABLE public.plan_limits ADD CONSTRAINT plan_limits_overage_check CHECK (overage_credit_cost IS NULL OR overage_credit_cost >= 0);
ALTER TABLE public.plan_limits ADD CONSTRAINT plan_limits_policy_shape CHECK (policy IS NULL OR (policy = 'unlimited') = is_unlimited);
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS trial_days integer NULL CHECK (trial_days IS NULL OR trial_days BETWEEN 0 AND 365);

-- 2) Messbare Nutzungsarten
CREATE TABLE public.usage_meters (
  key text PRIMARY KEY CHECK (key ~ '^[a-z0-9_]{2,63}$'),
  name text NOT NULL,
  unit text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('counted','gauge','core_unlimited')),
  default_period text NOT NULL DEFAULT 'none' CHECK (default_period IN ('one_time','monthly','subscription_period','none')),
  recurring boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.usage_meters TO authenticated;
GRANT ALL ON public.usage_meters TO service_role;
ALTER TABLE public.usage_meters ENABLE ROW LEVEL SECURITY;
CREATE POLICY usage_meters_read ON public.usage_meters FOR SELECT TO authenticated USING (true);
INSERT INTO public.usage_meters(key,name,unit,kind,default_period,recurring) VALUES
  ('properties','Immobilien','count','core_unlimited','none',false),
  ('leads','Leads','count','core_unlimited','none',false),
  ('clients','Kunden','count','core_unlimited','none',false),
  ('users','Benutzer','user','gauge','subscription_period',true),
  ('storage_gb','Speicher','gb','gauge','subscription_period',true),
  ('domains','Eigene Domains','domain','gauge','subscription_period',true),
  ('financing_requests','Finanzierungsanfragen','request','counted','subscription_period',false);

-- Kerndaten nie limitierbar
CREATE OR REPLACE FUNCTION public.commercial_guard_core_limits() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
  IF NEW.limit_key IN ('properties','leads','clients','max_properties','max_leads','max_clients') AND NOT NEW.is_unlimited THEN
    RAISE EXCEPTION 'core_data_unlimited' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER plan_limits_core_guard BEFORE INSERT OR UPDATE ON public.plan_limits FOR EACH ROW EXECUTE FUNCTION public.commercial_guard_core_limits();
CREATE TRIGGER addon_limit_core_guard BEFORE INSERT OR UPDATE ON public.addon_limit_increments FOR EACH ROW EXECUTE FUNCTION public.commercial_guard_core_limits();

-- 3) Nutzungsjournal
CREATE TABLE public.usage_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id),
  usage_key text NOT NULL REFERENCES public.usage_meters(key),
  period_key text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  included_quantity integer NOT NULL DEFAULT 0 CHECK (included_quantity >= 0),
  overage_quantity integer NOT NULL DEFAULT 0 CHECK (overage_quantity >= 0),
  credit_cost integer NOT NULL DEFAULT 0 CHECK (credit_cost >= 0),
  decision text NOT NULL,
  credit_operation_id uuid NULL REFERENCES public.credit_operations(id),
  reference_type text NULL,
  reference_id text NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 1 AND 200),
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (included_quantity + overage_quantity = quantity)
);
CREATE UNIQUE INDEX usage_events_idem ON public.usage_events(agency_id, usage_key, idempotency_key);
CREATE INDEX usage_events_period ON public.usage_events(agency_id, usage_key, period_key);
GRANT SELECT ON public.usage_events TO authenticated;
GRANT ALL ON public.usage_events TO service_role;
ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY usage_events_tenant_admin_read ON public.usage_events FOR SELECT TO authenticated USING (public.is_agency_owner_or_admin(agency_id));
CREATE TRIGGER usage_events_immutable BEFORE UPDATE OR DELETE ON public.usage_events FOR EACH ROW EXECUTE FUNCTION public.credit_ledger_immutable();

-- 4) Wiederkehrende Credit-Ressourcen
CREATE TABLE public.recurring_credit_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id),
  resource_key text NOT NULL REFERENCES public.usage_meters(key),
  quantity integer NOT NULL CHECK (quantity > 0),
  credit_cost_per_period integer NULL CHECK (credit_cost_per_period IS NULL OR credit_cost_per_period >= 0),
  period text NOT NULL DEFAULT 'subscription_period' CHECK (period IN ('monthly','subscription_period')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  reason text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at IS NULL OR ends_at > starts_at)
);
CREATE INDEX recurring_credit_resources_agency ON public.recurring_credit_resources(agency_id, status);
GRANT SELECT ON public.recurring_credit_resources TO authenticated;
GRANT ALL ON public.recurring_credit_resources TO service_role;
ALTER TABLE public.recurring_credit_resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY recurring_resources_tenant_admin_read ON public.recurring_credit_resources FOR SELECT TO authenticated USING (public.is_agency_owner_or_admin(agency_id));
CREATE TRIGGER recurring_credit_resources_touch BEFORE UPDATE ON public.recurring_credit_resources FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

CREATE TABLE public.recurring_credit_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id uuid NOT NULL REFERENCES public.recurring_credit_resources(id),
  agency_id uuid NOT NULL REFERENCES public.agencies(id),
  period_key text NOT NULL,
  amount integer NOT NULL CHECK (amount >= 0),
  status text NOT NULL CHECK (status IN ('paid','free','insufficient_credits','cost_not_set')),
  credit_operation_id uuid NULL REFERENCES public.credit_operations(id),
  attempts integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resource_id, period_key)
);
GRANT SELECT ON public.recurring_credit_charges TO authenticated;
GRANT ALL ON public.recurring_credit_charges TO service_role;
ALTER TABLE public.recurring_credit_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY recurring_charges_tenant_admin_read ON public.recurring_credit_charges FOR SELECT TO authenticated USING (public.is_agency_owner_or_admin(agency_id));
CREATE TRIGGER recurring_credit_charges_touch BEFORE UPDATE ON public.recurring_credit_charges FOR EACH ROW EXECUTE FUNCTION public.commercial_touch_updated_at();

-- 5) Hilfsfunktionen
CREATE OR REPLACE FUNCTION public.commercial_period_key(_agency_id uuid, _period text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE _period
    WHEN 'one_time' THEN 'once'
    WHEN 'none' THEN 'none'
    WHEN 'subscription_period' THEN COALESCE(
      (SELECT 'sub:' || to_char(s.current_period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI') FROM subscriptions s
        WHERE s.agency_id=_agency_id AND s.plan_id = public.agency_active_plan_id(_agency_id) AND s.current_period_start IS NOT NULL
        ORDER BY s.created_at DESC LIMIT 1),
      'm:' || to_char(now() AT TIME ZONE 'Europe/Zurich','YYYY-MM'))
    ELSE 'm:' || to_char(now() AT TIME ZONE 'Europe/Zurich','YYYY-MM') END;
$$;

-- Aktueller Stand (serverseitig ermittelt, nie aus dem Frontend)
CREATE OR REPLACE FUNCTION public.commercial_usage_current(_agency_id uuid, _key text, _period text) RETURNS bigint
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE k text; r bigint;
BEGIN
  SELECT kind INTO k FROM usage_meters WHERE key=_key;
  IF k = 'counted' THEN
    SELECT COALESCE(SUM(quantity),0) INTO r FROM usage_events
     WHERE agency_id=_agency_id AND usage_key=_key AND period_key=public.commercial_period_key(_agency_id, COALESCE(_period,'none'));
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

-- Effektives Limit inkl. Regel
CREATE OR REPLACE FUNCTION public.agency_effective_limit(_agency_id uuid, _key text)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE pl record; add_sum bigint := 0; add_unl boolean := false; m record; pol text;
BEGIN
  IF NOT public.commercial_can_read(_agency_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO m FROM usage_meters WHERE key=_key;
  IF m.kind = 'core_unlimited' THEN
    RETURN jsonb_build_object('key',_key,'defined',true,'unlimited',true,'value',NULL,'policy','unlimited','core',true);
  END IF;
  SELECT limit_value, is_unlimited, policy, period, overage_credit_cost, unit INTO pl FROM public.plan_limits
   WHERE plan_id = public.agency_active_plan_id(_agency_id) AND limit_key = _key;
  SELECT COALESCE(SUM(i.increment_per_unit * aa.quantity), 0), COALESCE(bool_or(i.is_unlimited), false)
    INTO add_sum, add_unl
    FROM public.agency_addons aa
    JOIN public.addons a ON a.id = aa.addon_id AND a.status <> 'draft'
    JOIN public.addon_limit_increments i ON i.addon_id = aa.addon_id AND i.limit_key = _key
   WHERE aa.agency_id = _agency_id AND aa.status = 'active' AND aa.starts_at <= now() AND (aa.ends_at IS NULL OR aa.ends_at > now());
  IF pl IS NULL AND NOT add_unl AND add_sum = 0 THEN
    RETURN jsonb_build_object('key', _key, 'defined', false, 'unlimited', false, 'value', NULL, 'policy', NULL);
  END IF;
  IF COALESCE(pl.is_unlimited, false) OR add_unl THEN
    RETURN jsonb_build_object('key', _key, 'defined', true, 'unlimited', true, 'value', NULL, 'policy', 'unlimited');
  END IF;
  pol := COALESCE(pl.policy, 'included');
  RETURN jsonb_build_object('key', _key, 'defined', true, 'unlimited', false,
    'value', COALESCE(pl.limit_value, 0) + add_sum, 'plan_value', pl.limit_value, 'addon_value', add_sum,
    'policy', pol, 'period', COALESCE(pl.period, m.default_period, 'none'),
    'overage_credit_cost', pl.overage_credit_cost, 'unit', COALESCE(pl.unit, m.unit));
END $function$;

-- Agency-Auflösung (wie credit_consume)
CREATE OR REPLACE FUNCTION public._commercial_resolve_agency(_agency_id uuid) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE a uuid;
BEGIN
  IF auth.role() = 'service_role' AND _agency_id IS NOT NULL THEN RETURN _agency_id; END IF;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  a := public.current_agency_id();
  IF a IS NULL OR (_agency_id IS NOT NULL AND _agency_id IS DISTINCT FROM a) OR NOT public.is_agency_member(a) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  RETURN a;
END $$;

-- 6) Zentrale Decision Engine (intern, ohne Berechtigungsprüfung)
CREATE OR REPLACE FUNCTION public._commercial_usage_decision(a uuid, _key text, _qty integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE m record; lim jsonb; used bigint; incl bigint; rem bigint; inc_part int; over int; unit_cost int; cost int; bal int; per text;
BEGIN
  IF _qty IS NULL OR _qty <= 0 THEN RAISE EXCEPTION 'invalid_quantity' USING ERRCODE='22023'; END IF;
  SELECT * INTO m FROM usage_meters WHERE key=_key;
  IF m.key IS NULL THEN RETURN jsonb_build_object('decision','NOT_AVAILABLE','reason','unknown_usage_key','usage_key',_key); END IF;
  IF NOT public.agency_is_active(a) THEN RETURN jsonb_build_object('decision','NOT_AVAILABLE','reason','agency_inactive','usage_key',_key); END IF;
  IF m.kind = 'core_unlimited' THEN RETURN jsonb_build_object('decision','ALLOWED_UNLIMITED','usage_key',_key,'reason','core_data'); END IF;
  lim := public.agency_effective_limit(a, _key);
  IF NOT (lim->>'defined')::boolean THEN
    RETURN jsonb_build_object('decision','ALLOWED_UNLIMITED','usage_key',_key,'reason','no_allowance_defined');
  END IF;
  IF (lim->>'unlimited')::boolean THEN RETURN jsonb_build_object('decision','ALLOWED_UNLIMITED','usage_key',_key); END IF;
  per := lim->>'period';
  used := public.commercial_usage_current(a, _key, per);
  incl := (lim->>'value')::bigint;
  rem := GREATEST(incl - used, 0);
  inc_part := LEAST(_qty, rem)::int;
  over := _qty - inc_part;
  bal := public._credit_available(a);
  IF over = 0 THEN
    RETURN jsonb_build_object('decision','ALLOWED_INCLUDED','usage_key',_key,'requested',_qty,'used',used,'included',incl,
      'included_remaining',rem,'included_quantity',inc_part,'overage_quantity',0,'credit_cost',0,'credit_balance',bal,'period_key',public.commercial_period_key(a,per));
  END IF;
  IF lim->>'policy' = 'hard_limit' THEN
    RETURN jsonb_build_object('decision','HARD_BLOCKED','usage_key',_key,'requested',_qty,'used',used,'included',incl,'included_remaining',rem,'overage_quantity',over);
  END IF;
  IF lim->>'policy' <> 'metered' THEN
    RETURN jsonb_build_object('decision','NOT_AVAILABLE','reason','no_overage_rule','usage_key',_key,'requested',_qty,'used',used,'included',incl,'included_remaining',rem,'overage_quantity',over);
  END IF;
  unit_cost := (lim->>'overage_credit_cost')::int;
  IF unit_cost IS NULL THEN
    RETURN jsonb_build_object('decision','NOT_AVAILABLE','reason','overage_cost_not_set','usage_key',_key,'included_remaining',rem,'overage_quantity',over);
  END IF;
  cost := over * unit_cost;
  RETURN jsonb_build_object('decision', CASE WHEN bal >= cost THEN 'ALLOWED_CREDIT_OVERAGE' ELSE 'INSUFFICIENT_CREDITS' END,
    'usage_key',_key,'requested',_qty,'used',used,'included',incl,'included_remaining',rem,'included_quantity',inc_part,
    'overage_quantity',over,'credit_cost_per_unit',unit_cost,'credit_cost',cost,'credit_balance',bal,
    'recurring', m.recurring,'period_key',public.commercial_period_key(a,per));
END $$;

CREATE OR REPLACE FUNCTION public.commercial_usage_decision(_usage_key text, _requested_quantity integer DEFAULT 1, _agency_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  RETURN public._commercial_usage_decision(public._commercial_resolve_agency(_agency_id), _usage_key, _requested_quantity);
END $$;

-- 7) Nutzung buchen (nur zählbare Nutzung; Teil-Inklusive + Teil-Overage)
CREATE OR REPLACE FUNCTION public.commercial_usage_record(_usage_key text, _quantity integer, _idempotency_key text,
  _reference_type text DEFAULT NULL, _reference_id text DEFAULT NULL, _agency_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE a uuid; w uuid; d jsonb; ex record; op uuid; cost int; kind text; ev uuid;
BEGIN
  a := public._commercial_resolve_agency(_agency_id);
  IF _idempotency_key IS NULL OR length(_idempotency_key) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE='22023'; END IF;
  SELECT um.kind INTO kind FROM usage_meters um WHERE key=_usage_key;
  IF kind IS NULL THEN RAISE EXCEPTION 'unknown_usage_key' USING ERRCODE='22023'; END IF;
  IF kind <> 'counted' THEN RAISE EXCEPTION 'not_counted_usage' USING ERRCODE='22023'; END IF;
  w := public._credit_wallet(a);  -- serialisiert pro Firma
  SELECT * INTO ex FROM usage_events WHERE agency_id=a AND usage_key=_usage_key AND idempotency_key=_idempotency_key;
  IF ex.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok',true,'replayed',true,'usage_event_id',ex.id,'decision',ex.decision,'included_quantity',ex.included_quantity,'overage_quantity',ex.overage_quantity,'credit_cost',ex.credit_cost);
  END IF;
  d := public._commercial_usage_decision(a, _usage_key, _quantity);
  IF d->>'decision' NOT IN ('ALLOWED_UNLIMITED','ALLOWED_INCLUDED','ALLOWED_CREDIT_OVERAGE') THEN
    RETURN jsonb_build_object('ok',false) || d;
  END IF;
  cost := COALESCE((d->>'credit_cost')::int, 0);
  IF cost > 0 THEN
    INSERT INTO credit_operations(agency_id, kind, action_key, idempotency_key, amount, created_by, reason)
    VALUES (a,'consume','usage.'||_usage_key,_idempotency_key,cost,auth.uid(),'usage_overage') RETURNING id INTO op;
    PERFORM public._credit_debit(a, w, op, cost, 'consumption', 'usage.'||_usage_key, auth.uid());
  END IF;
  INSERT INTO usage_events(agency_id,usage_key,period_key,quantity,included_quantity,overage_quantity,credit_cost,decision,credit_operation_id,reference_type,reference_id,idempotency_key,created_by)
  VALUES (a,_usage_key, COALESCE(d->>'period_key', public.commercial_period_key(a,'none')), _quantity,
    CASE WHEN d->>'decision'='ALLOWED_UNLIMITED' THEN _quantity ELSE (d->>'included_quantity')::int END,
    CASE WHEN d->>'decision'='ALLOWED_UNLIMITED' THEN 0 ELSE (d->>'overage_quantity')::int END,
    cost, d->>'decision', op, _reference_type, _reference_id, _idempotency_key, auth.uid()) RETURNING id INTO ev;
  RETURN jsonb_build_object('ok',true,'replayed',false,'usage_event_id',ev,'credit_operation_id',op) || d;
END $$;

-- 8) Wiederkehrende Ressourcen: anlegen/beenden (Server oder Plattform mit Audit)
CREATE OR REPLACE FUNCTION public.platform_set_recurring_resource(_agency_id uuid, _resource_key text, _quantity integer,
  _credit_cost_per_period integer, _period text, _starts_at timestamptz, _ends_at timestamptz, _reason text, _resource_id uuid DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE rid uuid; nm text;
BEGIN
  IF auth.role() <> 'service_role' THEN PERFORM public.platform_assert_admin(); END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF NOT EXISTS (SELECT 1 FROM usage_meters WHERE key=_resource_key AND recurring) THEN RAISE EXCEPTION 'not_recurring_resource' USING ERRCODE='22023'; END IF;
  SELECT name INTO nm FROM agencies WHERE id=_agency_id; IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF _resource_id IS NULL THEN
    INSERT INTO recurring_credit_resources(agency_id,resource_key,quantity,credit_cost_per_period,period,starts_at,ends_at,reason,created_by)
    VALUES (_agency_id,_resource_key,_quantity,_credit_cost_per_period,COALESCE(_period,'subscription_period'),COALESCE(_starts_at,now()),_ends_at,_reason,auth.uid())
    RETURNING id INTO rid;
  ELSE
    UPDATE recurring_credit_resources SET quantity=_quantity, credit_cost_per_period=_credit_cost_per_period,
      period=COALESCE(_period,period), ends_at=_ends_at,
      status=CASE WHEN _ends_at IS NOT NULL AND _ends_at <= now() THEN 'ended' ELSE 'active' END, reason=_reason
     WHERE id=_resource_id AND agency_id=_agency_id RETURNING id INTO rid;
    IF rid IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  END IF;
  IF auth.uid() IS NOT NULL THEN
    INSERT INTO platform_audit_logs(actor_user_id, action, target_type, target_id, target_label, metadata)
    VALUES (auth.uid(),'recurring_resource_set','agency',_agency_id,nm,jsonb_build_object('resource_id',rid,'key',_resource_key,'quantity',_quantity,'cost',_credit_cost_per_period,'reason',_reason));
  END IF;
  RETURN rid;
END $$;

-- Periodische Abbuchung (idempotent pro Ressource + Periode); nie Daten löschen
CREATE OR REPLACE FUNCTION public.commercial_recurring_charge(_resource_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; pk text; w uuid; amt int; ex record; op uuid; st text;
BEGIN
  IF auth.role() <> 'service_role' THEN PERFORM public.platform_assert_admin(); END IF;
  SELECT * INTO r FROM recurring_credit_resources WHERE id=_resource_id;
  IF r.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF r.status <> 'active' OR r.starts_at > now() OR (r.ends_at IS NOT NULL AND r.ends_at <= now()) THEN
    RETURN jsonb_build_object('ok',false,'reason','resource_not_active');
  END IF;
  pk := public.commercial_period_key(r.agency_id, r.period);
  w := public._credit_wallet(r.agency_id);
  SELECT * INTO ex FROM recurring_credit_charges WHERE resource_id=r.id AND period_key=pk;
  IF ex.id IS NOT NULL AND ex.status IN ('paid','free') THEN
    RETURN jsonb_build_object('ok',true,'replayed',true,'status',ex.status,'amount',ex.amount,'period_key',pk);
  END IF;
  IF r.credit_cost_per_period IS NULL THEN st := 'cost_not_set'; amt := 0;
  ELSE
    amt := r.credit_cost_per_period * r.quantity;
    IF amt = 0 THEN st := 'free';
    ELSIF public._credit_available(r.agency_id) >= amt THEN
      INSERT INTO credit_operations(agency_id, kind, action_key, idempotency_key, amount, reason)
      VALUES (r.agency_id,'consume','recurring.'||r.resource_key,'recurring:'||r.id||':'||pk,amt,'recurring_charge') RETURNING id INTO op;
      PERFORM public._credit_debit(r.agency_id, w, op, amt, 'consumption', 'recurring.'||r.resource_key, NULL);
      st := 'paid';
    ELSE st := 'insufficient_credits'; END IF;
  END IF;
  INSERT INTO recurring_credit_charges(resource_id,agency_id,period_key,amount,status,credit_operation_id)
  VALUES (r.id,r.agency_id,pk,amt,st,op)
  ON CONFLICT (resource_id, period_key) DO UPDATE SET status=EXCLUDED.status, amount=EXCLUDED.amount,
    credit_operation_id=EXCLUDED.credit_operation_id, attempts=recurring_credit_charges.attempts+1;
  RETURN jsonb_build_object('ok', st IN ('paid','free'), 'replayed', false, 'status', st, 'amount', amt, 'period_key', pk, 'credit_operation_id', op);
END $$;

CREATE OR REPLACE FUNCTION public.commercial_recurring_charge_due() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; res jsonb := '[]'::jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN PERFORM public.platform_assert_admin(); END IF;
  FOR r IN SELECT id FROM recurring_credit_resources WHERE status='active' AND starts_at<=now() AND (ends_at IS NULL OR ends_at>now()) LOOP
    res := res || jsonb_build_object('resource_id', r.id) || public.commercial_recurring_charge(r.id);
  END LOOP;
  RETURN res;
END $$;

-- Allowance pflegen (Plattform, Audit)
CREATE OR REPLACE FUNCTION public.platform_set_plan_allowance(_plan_id uuid, _key text, _policy text, _included bigint,
  _period text, _overage_credit_cost integer, _unit text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE nm text; prev jsonb;
BEGIN
  PERFORM public.platform_assert_admin();
  SELECT name INTO nm FROM plans WHERE id=_plan_id; IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM usage_meters WHERE key=_key AND kind<>'core_unlimited') THEN RAISE EXCEPTION 'invalid_key' USING ERRCODE='22023'; END IF;
  SELECT to_jsonb(pl) - 'plan_id' INTO prev FROM plan_limits pl WHERE plan_id=_plan_id AND limit_key=_key;
  INSERT INTO plan_limits(plan_id,limit_key,limit_value,is_unlimited,policy,period,overage_credit_cost,unit)
  VALUES (_plan_id,_key, CASE WHEN _policy='unlimited' THEN NULL ELSE _included END, _policy='unlimited', _policy, _period, _overage_credit_cost, _unit)
  ON CONFLICT (plan_id,limit_key) DO UPDATE SET limit_value=EXCLUDED.limit_value, is_unlimited=EXCLUDED.is_unlimited,
    policy=EXCLUDED.policy, period=EXCLUDED.period, overage_credit_cost=EXCLUDED.overage_credit_cost, unit=EXCLUDED.unit;
  INSERT INTO platform_audit_logs(actor_user_id, action, target_type, target_id, target_label, metadata)
  VALUES (auth.uid(),'allowance_changed','plan',_plan_id,nm,jsonb_build_object('key',_key,'previous',prev,'policy',_policy,'included',_included,'period',_period,'overage_credit_cost',_overage_credit_cost));
END $$;

-- 9) Gesamtzustand erweitern
CREATE OR REPLACE FUNCTION public.agency_commercial_state(_agency_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _pid uuid; res jsonb; sub record;
BEGIN
  IF NOT (auth.role() = 'service_role' OR public.is_agency_owner_or_admin(_agency_id) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  _pid := public.agency_active_plan_id(_agency_id);
  SELECT * INTO sub FROM subscriptions s WHERE s.agency_id=_agency_id ORDER BY s.created_at DESC LIMIT 1;
  SELECT jsonb_build_object(
    'agency_id', _agency_id,
    'agency_active', public.agency_is_active(_agency_id),
    'commercial_enforced', false,
    'plan', (SELECT jsonb_build_object('id', p.id, 'key', p.key, 'name', p.name, 'status', p.status, 'trial_days', p.trial_days) FROM plans p WHERE p.id = _pid),
    'subscription', CASE WHEN sub.id IS NULL THEN NULL ELSE jsonb_build_object('status', sub.status, 'billing_period', sub.billing_period, 'trial_end', sub.trial_end,
                       'current_period_end', sub.current_period_end, 'cancel_at_period_end', sub.cancel_at_period_end) END,
    'trial', jsonb_build_object(
       'status', CASE WHEN sub.id IS NULL THEN 'none'
                      WHEN sub.status='trialing' AND (sub.trial_end IS NULL OR sub.trial_end > now()) THEN 'active'
                      WHEN sub.trial_end IS NOT NULL AND sub.trial_end <= now() THEN 'ended' ELSE 'none' END,
       'trial_end', sub.trial_end),
    'access_mode', CASE WHEN _pid IS NOT NULL THEN 'plan'
                        WHEN sub.trial_end IS NOT NULL AND sub.trial_end <= now() THEN 'post_trial_basic'
                        ELSE 'legacy_unrestricted' END,
    'credit_balance', public._credit_available(_agency_id),
    'entitlements', COALESCE((SELECT jsonb_agg(DISTINCT k ORDER BY k) FROM (
        SELECT pe.entitlement_key k FROM plan_entitlements pe WHERE pe.plan_id = _pid AND pe.enabled
        UNION SELECT ae.entitlement_key FROM agency_addons aa JOIN addons a ON a.id=aa.addon_id AND a.status<>'draft'
          JOIN addon_entitlements ae ON ae.addon_id=aa.addon_id
          WHERE aa.agency_id=_agency_id AND aa.status='active' AND aa.starts_at<=now() AND (aa.ends_at IS NULL OR aa.ends_at>now())) x), '[]'::jsonb),
    'limits', COALESCE((SELECT jsonb_agg(public.agency_effective_limit(_agency_id, k) ORDER BY k) FROM (
        SELECT limit_key k FROM plan_limits WHERE plan_limits.plan_id = _pid
        UNION SELECT i.limit_key FROM agency_addons aa JOIN addon_limit_increments i ON i.addon_id=aa.addon_id
          WHERE aa.agency_id=_agency_id AND aa.status='active') y), '[]'::jsonb),
    'allowances', COALESCE((SELECT jsonb_agg(public.agency_effective_limit(_agency_id, um.key)
          || jsonb_build_object('used', CASE WHEN um.kind='core_unlimited' THEN NULL ELSE
               public.commercial_usage_current(_agency_id, um.key, COALESCE(public.agency_effective_limit(_agency_id, um.key)->>'period', um.default_period)) END)
          ORDER BY um.key) FROM usage_meters um), '[]'::jsonb),
    'usage_overages', COALESCE((SELECT jsonb_agg(jsonb_build_object('usage_key',usage_key,'period_key',period_key,'quantity',q,'overage',o,'credits',c))
        FROM (SELECT usage_key, period_key, SUM(quantity) q, SUM(overage_quantity) o, SUM(credit_cost) c FROM usage_events
              WHERE agency_id=_agency_id GROUP BY usage_key, period_key ORDER BY period_key DESC LIMIT 24) u), '[]'::jsonb),
    'recurring_resources', COALESCE((SELECT jsonb_agg(jsonb_build_object('id',r.id,'key',r.resource_key,'quantity',r.quantity,
        'credit_cost_per_period',r.credit_cost_per_period,'period',r.period,'status',r.status,'starts_at',r.starts_at,'ends_at',r.ends_at,
        'last_charge',(SELECT jsonb_build_object('period_key',c.period_key,'status',c.status,'amount',c.amount) FROM recurring_credit_charges c WHERE c.resource_id=r.id ORDER BY c.created_at DESC LIMIT 1)))
        FROM recurring_credit_resources r WHERE r.agency_id=_agency_id), '[]'::jsonb),
    'addons', COALESCE((SELECT jsonb_agg(jsonb_build_object('key', a.key, 'name', a.name, 'quantity', aa.quantity, 'status', aa.status, 'ends_at', aa.ends_at))
        FROM agency_addons aa JOIN addons a ON a.id = aa.addon_id WHERE aa.agency_id = _agency_id), '[]'::jsonb),
    'credits', COALESCE((SELECT jsonb_object_agg(bucket, total) FROM (
        SELECT bucket, SUM(delta) total FROM credit_ledger
        WHERE agency_id = _agency_id AND (expires_at IS NULL OR expires_at > now()) GROUP BY bucket) c), '{}'::jsonb)
  ) INTO res;
  RETURN res;
END $function$;

-- 10) Grants
REVOKE ALL ON FUNCTION public._commercial_usage_decision(uuid,text,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._commercial_resolve_agency(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commercial_usage_current(uuid,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commercial_period_key(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commercial_guard_core_limits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._commercial_usage_decision(uuid,text,integer), public._commercial_resolve_agency(uuid),
  public.commercial_usage_current(uuid,text,text), public.commercial_period_key(uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.commercial_usage_decision(text,integer,uuid), public.commercial_usage_record(text,integer,text,text,text,uuid),
  public.platform_set_recurring_resource(uuid,text,integer,integer,text,timestamptz,timestamptz,text,uuid),
  public.commercial_recurring_charge(uuid), public.commercial_recurring_charge_due(),
  public.platform_set_plan_allowance(uuid,text,text,bigint,text,integer,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_usage_decision(text,integer,uuid), public.commercial_usage_record(text,integer,text,text,text,uuid),
  public.platform_set_recurring_resource(uuid,text,integer,integer,text,timestamptz,timestamptz,text,uuid),
  public.commercial_recurring_charge(uuid), public.commercial_recurring_charge_due(),
  public.platform_set_plan_allowance(uuid,text,text,bigint,text,integer,text) TO authenticated, service_role;
