CREATE OR REPLACE FUNCTION public.stripe_sync_subscription(
  _agency_id uuid, _user_id uuid, _stripe_subscription_id text, _stripe_customer_id text,
  _product_id text, _price_key text, _status text, _period_start timestamptz, _period_end timestamptz,
  _cancel_at_period_end boolean, _environment text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pid uuid; sid uuid; uid uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT id INTO pid FROM plans WHERE stripe_price_key = _price_key;
  uid := _user_id;
  IF uid IS NULL THEN SELECT user_id INTO uid FROM subscriptions WHERE stripe_subscription_id=_stripe_subscription_id; END IF;
  IF uid IS NULL THEN SELECT user_id INTO uid FROM agency_memberships WHERE agency_id=_agency_id AND is_active AND role='owner' ORDER BY created_at LIMIT 1; END IF;
  IF uid IS NULL THEN SELECT user_id INTO uid FROM platform_admins WHERE is_system_owner ORDER BY created_at LIMIT 1; END IF;
  INSERT INTO subscriptions(user_id, agency_id, stripe_subscription_id, stripe_customer_id, product_id, price_id, status,
    current_period_start, current_period_end, cancel_at_period_end, environment, plan_id, billing_period, source, past_due_since, updated_at)
  VALUES (uid, _agency_id, _stripe_subscription_id, _stripe_customer_id, COALESCE(_product_id,''), COALESCE(_price_key,''), _status,
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
  IF _status = 'active' THEN PERFORM public._commercial_grant_period_credits(sid); END IF;
  RETURN sid;
END $$;