
ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS monthly_credits integer NULL CHECK (monthly_credits IS NULL OR monthly_credits >= 0);
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS source text NULL CHECK (source IS NULL OR source IN ('internal','stripe'));

CREATE TABLE public.platform_commercial_settings (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  trial_days integer NOT NULL DEFAULT 14 CHECK (trial_days BETWEEN 1 AND 90),
  trial_credits integer NULL CHECK (trial_credits IS NULL OR trial_credits >= 0),
  trial_plan_id uuid NULL REFERENCES public.plans(id),
  auto_trial_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.platform_commercial_settings TO authenticated;
GRANT ALL ON public.platform_commercial_settings TO service_role;
ALTER TABLE public.platform_commercial_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY pcs_platform_read ON public.platform_commercial_settings FOR SELECT TO authenticated USING (public.is_platform_admin());
INSERT INTO public.platform_commercial_settings(id) VALUES (true);

CREATE TABLE public.agency_trials (
  agency_id uuid PRIMARY KEY REFERENCES public.agencies(id),
  trial_start timestamptz NOT NULL,
  trial_end timestamptz NOT NULL,
  original_trial_end timestamptz NOT NULL,
  subscription_id uuid NULL REFERENCES public.subscriptions(id),
  credits_granted integer NOT NULL DEFAULT 0,
  credit_operation_id uuid NULL REFERENCES public.credit_operations(id),
  extensions jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (trial_end > trial_start)
);
GRANT SELECT ON public.agency_trials TO authenticated;
GRANT ALL ON public.agency_trials TO service_role;
ALTER TABLE public.agency_trials ENABLE ROW LEVEL SECURITY;
CREATE POLICY agency_trials_tenant_admin_read ON public.agency_trials FOR SELECT TO authenticated USING (public.is_agency_owner_or_admin(agency_id));

-- Interne Plan-Credits für die aktuelle Periode (idempotent pro Abo + Periodenbeginn)
CREATE OR REPLACE FUNCTION public._commercial_grant_period_credits(_sub_id uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s record; amt int;
BEGIN
  SELECT sb.*, p.monthly_credits INTO s FROM subscriptions sb LEFT JOIN plans p ON p.id=sb.plan_id AND p.status<>'draft' WHERE sb.id=_sub_id;
  IF s.id IS NULL OR s.status NOT IN ('active','past_due') OR s.current_period_start IS NULL OR s.current_period_end IS NULL OR s.current_period_end <= now() THEN RETURN NULL; END IF;
  amt := COALESCE(s.monthly_credits,0) * CASE WHEN s.billing_period='yearly' THEN 12 ELSE 1 END;
  IF amt <= 0 THEN RETURN NULL; END IF;
  RETURN public._credit_insert_grant(s.agency_id,'subscription','subscription',amt,s.current_period_end,'plan_period_credits',
    'plan:'||s.id||':'||to_char(s.current_period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS'),'grant','subscription',s.id::text,NULL);
END $$;

-- Trial starten (intern, einmalig pro Firma)
CREATE OR REPLACE FUNCTION public._commercial_start_trial(_agency_id uuid, _actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cfg record; t0 timestamptz := now(); t1 timestamptz; sid uuid; op uuid; u uuid; n int;
BEGIN
  SELECT * INTO cfg FROM platform_commercial_settings WHERE id;
  t1 := t0 + make_interval(days => cfg.trial_days);
  INSERT INTO agency_trials(agency_id,trial_start,trial_end,original_trial_end) VALUES (_agency_id,t0,t1,t1) ON CONFLICT (agency_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN jsonb_build_object('ok',false,'reason','trial_already_granted'); END IF;
  u := COALESCE(_actor, (SELECT user_id FROM platform_admins WHERE role='system_owner' ORDER BY created_at LIMIT 1));
  INSERT INTO subscriptions(user_id,agency_id,stripe_subscription_id,stripe_customer_id,product_id,price_id,status,
     current_period_start,current_period_end,trial_start,trial_end,plan_id,source,environment)
  VALUES (u,_agency_id,'immolia_trial:'||_agency_id,'none','immolia_trial','none','trialing',t0,t1,t0,t1,cfg.trial_plan_id,'internal','internal')
  RETURNING id INTO sid;
  IF COALESCE(cfg.trial_credits,0) > 0 THEN
    op := public._credit_insert_grant(_agency_id,'promotional','promotion',cfg.trial_credits,t1,'trial_credits','trial:'||_agency_id,'grant','trial',_agency_id::text,_actor);
  END IF;
  UPDATE agency_trials SET subscription_id=sid, credits_granted=COALESCE(cfg.trial_credits,0)*(op IS NOT NULL)::int, credit_operation_id=op WHERE agency_id=_agency_id;
  RETURN jsonb_build_object('ok',true,'trial_start',t0,'trial_end',t1,'subscription_id',sid,'credit_operation_id',op);
END $$;

CREATE OR REPLACE FUNCTION public.tg_agencies_auto_trial() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
  IF (SELECT auto_trial_enabled FROM platform_commercial_settings WHERE id) THEN
    PERFORM public._commercial_start_trial(NEW.id, auth.uid());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER agencies_auto_trial AFTER INSERT ON public.agencies FOR EACH ROW EXECUTE FUNCTION public.tg_agencies_auto_trial();

-- Effektiver Abo-Zustand
CREATE OR REPLACE FUNCTION public.commercial_subscription_state(_agency_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE s record; st text;
BEGIN
  IF NOT public.commercial_can_read(_agency_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM subscriptions WHERE agency_id=_agency_id ORDER BY created_at DESC LIMIT 1;
  st := CASE
    WHEN s.id IS NULL THEN CASE WHEN EXISTS (SELECT 1 FROM agency_trials WHERE agency_id=_agency_id) THEN 'post_trial' ELSE 'no_active_subscription' END
    WHEN s.status='trialing' AND s.trial_end > now() THEN 'trialing'
    WHEN s.status='trialing' THEN 'post_trial'
    WHEN s.status IN ('active','past_due') AND (s.current_period_end IS NULL OR s.current_period_end > now()) THEN s.status
    WHEN s.status='canceled' AND s.current_period_end > now() THEN 'canceled_until_period_end'
    WHEN s.status='unpaid' THEN 'unpaid'
    ELSE CASE WHEN EXISTS (SELECT 1 FROM agency_trials WHERE agency_id=_agency_id) AND NOT EXISTS
      (SELECT 1 FROM subscriptions x WHERE x.agency_id=_agency_id AND x.status IN ('active','past_due','canceled')) THEN 'post_trial' ELSE 'no_active_subscription' END
  END;
  RETURN jsonb_build_object('state',st,'subscription_id',s.id,'status',s.status,'plan_id',s.plan_id,'billing_period',s.billing_period,
    'current_period_start',s.current_period_start,'current_period_end',s.current_period_end,'cancel_at_period_end',s.cancel_at_period_end,
    'trial_end',s.trial_end,'source',s.source,
    'pay_as_you_use', st IN ('post_trial','no_active_subscription','unpaid'));
END $$;

-- Periodenwechsel (idempotent): nur interne Abos
CREATE OR REPLACE FUNCTION public.commercial_advance_period(_subscription_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s record; ns timestamptz; ne timestamptz; step interval; steps int := 0; op uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN PERFORM public.platform_assert_admin(); END IF;
  SELECT * INTO s FROM subscriptions WHERE id=_subscription_id FOR UPDATE;
  IF s.id IS NULL THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF COALESCE(s.source,'stripe') <> 'internal' THEN RETURN jsonb_build_object('ok',false,'reason','external_subscription'); END IF;
  IF s.status = 'trialing' THEN RETURN jsonb_build_object('ok',true,'changed',false,'reason','trial_no_renewal'); END IF;
  IF s.status NOT IN ('active','past_due') THEN RETURN jsonb_build_object('ok',true,'changed',false,'status',s.status); END IF;
  IF s.current_period_end > now() THEN
    op := public._commercial_grant_period_credits(s.id);
    RETURN jsonb_build_object('ok',true,'changed',false,'current_period_end',s.current_period_end,'credit_operation_id',op);
  END IF;
  IF s.cancel_at_period_end THEN
    UPDATE subscriptions SET status='canceled', updated_at=now() WHERE id=s.id;
    RETURN jsonb_build_object('ok',true,'changed',true,'status','canceled');
  END IF;
  step := CASE WHEN s.billing_period='yearly' THEN interval '1 year' ELSE interval '1 month' END;
  ns := s.current_period_start; ne := s.current_period_end;
  WHILE ne <= now() LOOP ns := ne; ne := ne + step; steps := steps+1; END LOOP;
  UPDATE subscriptions SET current_period_start=ns, current_period_end=ne, updated_at=now() WHERE id=s.id;
  op := public._commercial_grant_period_credits(s.id);
  RETURN jsonb_build_object('ok',true,'changed',true,'periods_advanced',steps,'current_period_start',ns,'current_period_end',ne,'credit_operation_id',op);
END $$;

CREATE OR REPLACE FUNCTION public.commercial_advance_due_periods() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r record; res jsonb := '[]'::jsonb;
BEGIN
  IF auth.role() <> 'service_role' THEN PERFORM public.platform_assert_admin(); END IF;
  FOR r IN SELECT id FROM subscriptions WHERE source='internal' AND status IN ('active','past_due') AND current_period_end <= now() LOOP
    res := res || jsonb_build_object('subscription_id',r.id) || public.commercial_advance_period(r.id);
  END LOOP;
  RETURN res;
END $$;

-- Plan zuweisen / wechseln (ohne Stripe); nie Daten/Module ändern
CREATE OR REPLACE FUNCTION public.platform_assign_plan(_agency_id uuid, _plan_id uuid, _billing_period text, _reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE nm text; s record; sid uuid; prev uuid; step interval; op uuid;
BEGIN
  PERFORM public.platform_assert_admin();
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF _billing_period NOT IN ('monthly','yearly') THEN RAISE EXCEPTION 'invalid_billing_period' USING ERRCODE='22023'; END IF;
  SELECT name INTO nm FROM agencies WHERE id=_agency_id; IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM plans WHERE id=_plan_id AND status='active') THEN RAISE EXCEPTION 'plan_not_active' USING ERRCODE='22023'; END IF;
  step := CASE WHEN _billing_period='yearly' THEN interval '1 year' ELSE interval '1 month' END;
  SELECT * INTO s FROM subscriptions WHERE agency_id=_agency_id AND source='internal' AND status IN ('active','past_due')
    AND current_period_end > now() ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF s.id IS NOT NULL THEN
    prev := s.plan_id;
    UPDATE subscriptions SET plan_id=_plan_id, billing_period=_billing_period, cancel_at_period_end=false, updated_at=now() WHERE id=s.id;
    sid := s.id;
  ELSE
    UPDATE subscriptions SET status='canceled', current_period_end=LEAST(COALESCE(current_period_end,now()),now()), updated_at=now()
      WHERE agency_id=_agency_id AND status='trialing';
    INSERT INTO subscriptions(user_id,agency_id,stripe_subscription_id,stripe_customer_id,product_id,price_id,status,current_period_start,current_period_end,plan_id,billing_period,source,environment)
    VALUES (auth.uid(),_agency_id,'immolia_internal:'||gen_random_uuid(),'none','immolia_plan','none','active',now(),now()+step,_plan_id,_billing_period,'internal','internal')
    RETURNING id INTO sid;
  END IF;
  op := public._commercial_grant_period_credits(sid);
  INSERT INTO platform_audit_logs(actor_user_id, action, target_type, target_id, target_label, metadata)
  VALUES (auth.uid(),'plan_assigned','agency',_agency_id,nm,jsonb_build_object('subscription_id',sid,'previous_plan',prev,'plan',_plan_id,'billing_period',_billing_period,'reason',_reason));
  RETURN jsonb_build_object('ok',true,'subscription_id',sid,'previous_plan_id',prev,'plan_id',_plan_id,'credit_operation_id',op);
END $$;

-- Kündigung zum Periodenende (Inhaber/Admin der aktiven Firma oder Plattform)
CREATE OR REPLACE FUNCTION public.commercial_set_cancel_at_period_end(_agency_id uuid, _cancel boolean, _reason text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE s record; plat boolean := public.is_platform_admin(); nm text;
BEGIN
  IF NOT (auth.role()='service_role' OR public.is_agency_owner_or_admin(_agency_id) OR plat) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM subscriptions WHERE agency_id=_agency_id AND source='internal' AND status IN ('active','past_due') ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
  IF s.id IS NULL THEN RETURN jsonb_build_object('ok',false,'reason','no_active_subscription'); END IF;
  UPDATE subscriptions SET cancel_at_period_end=COALESCE(_cancel,true), updated_at=now() WHERE id=s.id;
  IF plat AND NOT public.is_agency_owner_or_admin(_agency_id) THEN
    IF _reason IS NULL OR length(trim(_reason)) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
    SELECT name INTO nm FROM agencies WHERE id=_agency_id;
    INSERT INTO platform_audit_logs(actor_user_id, action, target_type, target_id, target_label, metadata)
    VALUES (auth.uid(),'subscription_cancel_set','agency',_agency_id,nm,jsonb_build_object('subscription_id',s.id,'cancel',_cancel,'reason',_reason));
  END IF;
  RETURN jsonb_build_object('ok',true,'subscription_id',s.id,'cancel_at_period_end',COALESCE(_cancel,true),'current_period_end',s.current_period_end);
END $$;

-- Trial kontrolliert verlängern
CREATE OR REPLACE FUNCTION public.platform_extend_trial(_agency_id uuid, _days integer, _reason text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE t record; ne timestamptz; nm text;
BEGIN
  PERFORM public.platform_assert_admin();
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF _days IS NULL OR _days NOT BETWEEN 1 AND 60 THEN RAISE EXCEPTION 'invalid_days' USING ERRCODE='22023'; END IF;
  SELECT * INTO t FROM agency_trials WHERE agency_id=_agency_id FOR UPDATE;
  IF t.agency_id IS NULL THEN RAISE EXCEPTION 'no_trial' USING ERRCODE='P0002'; END IF;
  ne := GREATEST(t.trial_end, now()) + make_interval(days => _days);
  UPDATE agency_trials SET trial_end=ne, extensions = extensions || jsonb_build_object('at',now(),'by',auth.uid(),'days',_days,'reason',_reason) WHERE agency_id=_agency_id;
  UPDATE subscriptions SET status='trialing', trial_end=ne, current_period_end=ne, updated_at=now() WHERE id=t.subscription_id;
  SELECT name INTO nm FROM agencies WHERE id=_agency_id;
  INSERT INTO platform_audit_logs(actor_user_id, action, target_type, target_id, target_label, metadata)
  VALUES (auth.uid(),'trial_extended','agency',_agency_id,nm,jsonb_build_object('days',_days,'previous_end',t.trial_end,'new_end',ne,'reason',_reason));
  RETURN jsonb_build_object('ok',true,'trial_end',ne);
END $$;

CREATE OR REPLACE FUNCTION public.platform_set_commercial_settings(_trial_days integer, _trial_credits integer, _trial_plan_id uuid, _auto_trial boolean, _reason text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE prev jsonb;
BEGIN
  PERFORM public.platform_assert_admin();
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  SELECT to_jsonb(c) INTO prev FROM platform_commercial_settings c WHERE id;
  UPDATE platform_commercial_settings SET trial_days=_trial_days, trial_credits=_trial_credits, trial_plan_id=_trial_plan_id,
    auto_trial_enabled=COALESCE(_auto_trial,true), updated_at=now() WHERE id;
  INSERT INTO platform_audit_logs(actor_user_id, action, target_type, target_id, target_label, metadata)
  VALUES (auth.uid(),'commercial_settings_changed','platform',NULL,'commercial_settings',jsonb_build_object('previous',prev,'trial_days',_trial_days,'trial_credits',_trial_credits,'trial_plan_id',_trial_plan_id,'auto_trial',_auto_trial,'reason',_reason));
END $$;

-- Grants
REVOKE ALL ON FUNCTION public._commercial_grant_period_credits(uuid), public._commercial_start_trial(uuid,uuid), public.tg_agencies_auto_trial() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._commercial_grant_period_credits(uuid), public._commercial_start_trial(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.commercial_subscription_state(uuid), public.commercial_advance_period(uuid), public.commercial_advance_due_periods(),
  public.platform_assign_plan(uuid,uuid,text,text), public.commercial_set_cancel_at_period_end(uuid,boolean,text),
  public.platform_extend_trial(uuid,integer,text), public.platform_set_commercial_settings(integer,integer,uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_subscription_state(uuid), public.commercial_advance_period(uuid), public.commercial_advance_due_periods(),
  public.platform_assign_plan(uuid,uuid,text,text), public.commercial_set_cancel_at_period_end(uuid,boolean,text),
  public.platform_extend_trial(uuid,integer,text), public.platform_set_commercial_settings(integer,integer,uuid,boolean,text) TO authenticated, service_role;
