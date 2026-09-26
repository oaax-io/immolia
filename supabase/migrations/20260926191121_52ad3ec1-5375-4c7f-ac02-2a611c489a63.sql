
CREATE OR REPLACE FUNCTION public._commercial_start_trial(_agency_id uuid, _actor uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cfg record; t0 timestamptz := now(); t1 timestamptz; sid uuid; op uuid; u uuid; n int;
BEGIN
  SELECT * INTO cfg FROM platform_commercial_settings WHERE id;
  t1 := t0 + make_interval(days => cfg.trial_days);
  INSERT INTO agency_trials(agency_id,trial_start,trial_end,original_trial_end) VALUES (_agency_id,t0,t1,t1) ON CONFLICT (agency_id) DO NOTHING;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN RETURN jsonb_build_object('ok',false,'reason','trial_already_granted'); END IF;
  u := COALESCE(_actor, (SELECT user_id FROM platform_admins WHERE is_system_owner ORDER BY created_at LIMIT 1));
  INSERT INTO subscriptions(user_id,agency_id,stripe_subscription_id,stripe_customer_id,product_id,price_id,status,
     current_period_start,current_period_end,trial_start,trial_end,plan_id,source,environment)
  VALUES (u,_agency_id,'immolia_trial:'||_agency_id,'none','immolia_trial','none','trialing',t0,t1,t0,t1,cfg.trial_plan_id,'internal','internal')
  RETURNING id INTO sid;
  IF COALESCE(cfg.trial_credits,0) > 0 THEN
    op := public._credit_insert_grant(_agency_id,'promotional','promotion',cfg.trial_credits,t1,'trial_credits','trial:'||_agency_id,'grant','trial',_agency_id::text,_actor);
  END IF;
  UPDATE agency_trials SET subscription_id=sid, credits_granted=CASE WHEN op IS NULL THEN 0 ELSE cfg.trial_credits END, credit_operation_id=op WHERE agency_id=_agency_id;
  RETURN jsonb_build_object('ok',true,'trial_start',t0,'trial_end',t1,'subscription_id',sid,'credit_operation_id',op);
END $$;
REVOKE ALL ON FUNCTION public._commercial_start_trial(uuid,uuid) FROM PUBLIC, anon, authenticated;
