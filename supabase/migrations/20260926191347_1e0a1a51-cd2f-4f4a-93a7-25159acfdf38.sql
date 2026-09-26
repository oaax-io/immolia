
CREATE OR REPLACE FUNCTION public.commercial_period_key(_agency_id uuid, _period text) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT CASE _period
    WHEN 'one_time' THEN 'once'
    WHEN 'none' THEN 'none'
    WHEN 'subscription_period' THEN COALESCE(
      (SELECT 'sub:' || s.id || ':' || floor(extract(epoch FROM s.current_period_start)*1000)::bigint FROM subscriptions s
        WHERE s.agency_id=_agency_id AND s.plan_id = public.agency_active_plan_id(_agency_id) AND s.current_period_start IS NOT NULL
          AND (s.current_period_end IS NULL OR s.current_period_end > now())
        ORDER BY s.created_at DESC LIMIT 1),
      'm:' || to_char(now() AT TIME ZONE 'Europe/Zurich','YYYY-MM'))
    ELSE 'm:' || to_char(now() AT TIME ZONE 'Europe/Zurich','YYYY-MM') END;
$$;
REVOKE ALL ON FUNCTION public.commercial_period_key(uuid,text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.commercial_subscription_state(_agency_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE s record; st text;
BEGIN
  IF NOT public.commercial_can_read(_agency_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM subscriptions WHERE agency_id=_agency_id
   ORDER BY (CASE WHEN status IN ('active','past_due') AND (current_period_end IS NULL OR current_period_end > now()) THEN 0
                  WHEN status='canceled' AND current_period_end > now() THEN 1
                  WHEN status='trialing' AND trial_end > now() THEN 2
                  WHEN status='unpaid' THEN 3 ELSE 9 END), created_at DESC LIMIT 1;
  st := CASE
    WHEN s.id IS NULL THEN 'no_active_subscription'
    WHEN s.status IN ('active','past_due') AND (s.current_period_end IS NULL OR s.current_period_end > now()) THEN s.status
    WHEN s.status='canceled' AND s.current_period_end > now() THEN 'canceled_until_period_end'
    WHEN s.status='trialing' AND s.trial_end > now() THEN 'trialing'
    WHEN s.status='unpaid' THEN 'unpaid'
    WHEN EXISTS (SELECT 1 FROM agency_trials WHERE agency_id=_agency_id)
      AND NOT EXISTS (SELECT 1 FROM subscriptions x WHERE x.agency_id=_agency_id AND x.status IN ('active','past_due','canceled') AND COALESCE(x.source,'stripe')<>'internal' OR (x.agency_id=_agency_id AND x.source='internal' AND x.stripe_subscription_id NOT LIKE 'immolia_trial:%'))
      THEN 'post_trial'
    ELSE 'no_active_subscription' END;
  RETURN jsonb_build_object('state',st,'subscription_id',s.id,'status',s.status,'plan_id',s.plan_id,'billing_period',s.billing_period,
    'current_period_start',s.current_period_start,'current_period_end',s.current_period_end,'cancel_at_period_end',s.cancel_at_period_end,
    'trial_end',s.trial_end,'source',s.source,
    'pay_as_you_use', st IN ('post_trial','no_active_subscription','unpaid'));
END $$;
