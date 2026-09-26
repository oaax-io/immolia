ALTER TABLE public.plans ADD COLUMN IF NOT EXISTS stripe_price_key text NULL;
CREATE UNIQUE INDEX IF NOT EXISTS plans_stripe_price_key_uq ON public.plans(stripe_price_key) WHERE stripe_price_key IS NOT NULL;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS past_due_since timestamptz NULL;
ALTER TABLE public.platform_commercial_settings ADD COLUMN IF NOT EXISTS past_due_grace_days integer NULL DEFAULT 14;
UPDATE public.platform_commercial_settings SET past_due_grace_days = 14 WHERE past_due_grace_days IS NULL;

CREATE TABLE public.stripe_customers (
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  environment text NOT NULL CHECK (environment IN ('sandbox','live')),
  stripe_customer_id text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (agency_id, environment)
);
GRANT ALL ON public.stripe_customers TO service_role;
ALTER TABLE public.stripe_customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.stripe_customers FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE public.stripe_webhook_events (
  event_id text PRIMARY KEY,
  environment text NOT NULL,
  event_type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.stripe_webhook_events TO service_role;
ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON public.stripe_webhook_events FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Abo aus Stripe übernehmen (nur service_role). Plan über stripe_price_key, nie aus dem Browser.
CREATE OR REPLACE FUNCTION public.stripe_sync_subscription(
  _agency_id uuid, _user_id uuid, _stripe_subscription_id text, _stripe_customer_id text,
  _product_id text, _price_key text, _status text, _period_start timestamptz, _period_end timestamptz,
  _cancel_at_period_end boolean, _environment text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid; sid uuid; prev text;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT id INTO pid FROM plans WHERE stripe_price_key = _price_key;
  SELECT status INTO prev FROM subscriptions WHERE stripe_subscription_id = _stripe_subscription_id;
  INSERT INTO subscriptions(user_id, agency_id, stripe_subscription_id, stripe_customer_id, product_id, price_id, status,
    current_period_start, current_period_end, cancel_at_period_end, environment, plan_id, billing_period, source, past_due_since, updated_at)
  VALUES (_user_id, _agency_id, _stripe_subscription_id, _stripe_customer_id, COALESCE(_product_id,''), COALESCE(_price_key,''), _status,
    _period_start, _period_end, COALESCE(_cancel_at_period_end,false), _environment, pid, 'monthly', 'stripe',
    CASE WHEN _status='past_due' THEN now() END, now())
  ON CONFLICT (stripe_subscription_id) DO UPDATE SET
    status = EXCLUDED.status, product_id = EXCLUDED.product_id, price_id = EXCLUDED.price_id,
    plan_id = COALESCE(EXCLUDED.plan_id, subscriptions.plan_id),
    current_period_start = EXCLUDED.current_period_start, current_period_end = EXCLUDED.current_period_end,
    cancel_at_period_end = EXCLUDED.cancel_at_period_end,
    agency_id = COALESCE(subscriptions.agency_id, EXCLUDED.agency_id),
    past_due_since = CASE WHEN EXCLUDED.status='past_due' THEN COALESCE(subscriptions.past_due_since, now()) ELSE NULL END,
    updated_at = now()
  RETURNING id INTO sid;
  -- Plan-Credits nur für bezahlte Perioden; idempotent pro Periodenbeginn
  IF _status = 'active' THEN PERFORM public._commercial_grant_period_credits(sid); END IF;
  RETURN sid;
END $$;
REVOKE ALL ON FUNCTION public.stripe_sync_subscription(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,boolean,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_sync_subscription(uuid,uuid,text,text,text,text,text,timestamptz,timestamptz,boolean,text) TO service_role;

-- Credit-Kauf gutschreiben (nur service_role, idempotent pro Checkout-Session, Topf purchased, kein Ablauf)
CREATE OR REPLACE FUNCTION public.stripe_grant_credit_purchase(_agency_id uuid, _package_key text, _session_id text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE amt int;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT credits INTO amt FROM credit_packages WHERE key = _package_key AND status = 'active';
  IF amt IS NULL OR amt <= 0 THEN RAISE EXCEPTION 'unknown_package' USING ERRCODE='22023'; END IF;
  RETURN public._credit_insert_grant(_agency_id, 'purchased', 'purchase', amt, NULL, 'stripe_credit_purchase',
    'stripe:checkout:'||_session_id, 'grant', 'stripe_checkout', _session_id, NULL);
END $$;
REVOKE ALL ON FUNCTION public.stripe_grant_credit_purchase(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stripe_grant_credit_purchase(uuid,text,text) TO service_role;

-- Grace: past_due länger als Frist → wie unpaid (Pay-as-you-use), nie Sperre
CREATE OR REPLACE FUNCTION public.commercial_subscription_state(_agency_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s record; st text; grace int;
BEGIN
  IF NOT public.commercial_can_read(_agency_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT COALESCE(past_due_grace_days,14) INTO grace FROM platform_commercial_settings WHERE id=1;
  grace := COALESCE(grace,14);
  SELECT * INTO s FROM subscriptions WHERE agency_id=_agency_id
   ORDER BY (CASE WHEN status IN ('active','past_due') AND (current_period_end IS NULL OR current_period_end > now()) THEN 0
                  WHEN status='canceled' AND current_period_end > now() THEN 1
                  WHEN status='trialing' AND trial_end > now() THEN 2
                  WHEN status='unpaid' THEN 3 ELSE 9 END), created_at DESC LIMIT 1;
  st := CASE
    WHEN s.id IS NULL THEN 'no_active_subscription'
    WHEN s.status='past_due' AND s.past_due_since IS NOT NULL AND s.past_due_since + make_interval(days => grace) < now() THEN 'unpaid'
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
    'trial_end',s.trial_end,'source',s.source,'past_due_since',s.past_due_since,'grace_days',grace,
    'pay_as_you_use', st IN ('post_trial','no_active_subscription','unpaid'));
END $function$;