-- 5.6.2 Manual & Invoice Billing: gleiche subscriptions-Tabelle, provider-neutral erweitert
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS billing_source text NULL,
  ADD COLUMN IF NOT EXISTS contract_price numeric(12,2) NULL,
  ADD COLUMN IF NOT EXISTS contract_currency text NULL,
  ADD COLUMN IF NOT EXISTS auto_renew boolean NULL,
  ADD COLUMN IF NOT EXISTS paid_until timestamptz NULL,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS last_payment_amount numeric(12,2) NULL,
  ADD COLUMN IF NOT EXISTS invoice_number text NULL,
  ADD COLUMN IF NOT EXISTS invoice_date date NULL,
  ADD COLUMN IF NOT EXISTS payment_due_date date NULL,
  ADD COLUMN IF NOT EXISTS credit_period text NULL;

ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_billing_source_check
  CHECK (billing_source IS NULL OR billing_source IN ('stripe','invoice','bank_transfer','manual','complimentary'));
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_credit_period_check
  CHECK (credit_period IS NULL OR credit_period IN ('monthly','billing'));
-- billing_period: 'custom' ergänzen (Erweiterung, bestehende Werte bleiben gültig)
ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_billing_period_check;
ALTER TABLE public.subscriptions ADD CONSTRAINT subscriptions_billing_period_check
  CHECK (billing_period IS NULL OR billing_period IN ('monthly','yearly','custom'));
-- Stripe-IDs sind bei manuellen Abos leer
ALTER TABLE public.subscriptions ALTER COLUMN stripe_subscription_id DROP NOT NULL;
ALTER TABLE public.subscriptions ALTER COLUMN stripe_customer_id DROP NOT NULL;
ALTER TABLE public.subscriptions ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE public.subscriptions ALTER COLUMN price_id DROP NOT NULL;

UPDATE public.subscriptions SET billing_source='stripe' WHERE source='stripe' AND billing_source IS NULL;

-- Interne Notizen nur für die Plattform (keine Browser-Rechte)
CREATE TABLE public.subscription_admin_notes (
  subscription_id uuid PRIMARY KEY REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  note text NOT NULL,
  updated_by uuid NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.subscription_admin_notes TO service_role;
ALTER TABLE public.subscription_admin_notes ENABLE ROW LEVEL SECURITY;

-- Credit-Periode getrennt von Abrechnungsperiode: aktueller Monat innerhalb der Abo-Periode
CREATE OR REPLACE FUNCTION public._commercial_credit_window(_start timestamptz, _end timestamptz, _at timestamptz DEFAULT now())
RETURNS TABLE(cs timestamptz, ce timestamptz) LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE k int := 0;
BEGIN
  IF _start IS NULL OR _end IS NULL OR _at < _start OR _at >= _end THEN RETURN; END IF;
  WHILE _start + make_interval(months => k+1) <= _at LOOP k := k+1; END LOOP;
  cs := _start + make_interval(months => k);
  ce := LEAST(cs + interval '1 month', _end);
  RETURN NEXT;
END $$;
REVOKE ALL ON FUNCTION public._commercial_credit_window(timestamptz,timestamptz,timestamptz) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public._commercial_grant_period_credits(_sub_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s record; amt int; w record;
BEGIN
  SELECT sb.*, p.monthly_credits INTO s FROM subscriptions sb LEFT JOIN plans p ON p.id=sb.plan_id AND p.status<>'draft' WHERE sb.id=_sub_id;
  IF s.id IS NULL OR s.status NOT IN ('active','past_due') OR s.current_period_start IS NULL OR s.current_period_end IS NULL OR s.current_period_end <= now() THEN RETURN NULL; END IF;
  -- Manuelle Abos: Credits erst bei bestätigtem/aktivem Abo
  IF s.billing_source IN ('invoice','bank_transfer','manual','complimentary') AND s.status <> 'active' THEN RETURN NULL; END IF;
  IF COALESCE(s.monthly_credits,0) <= 0 THEN RETURN NULL; END IF;
  IF COALESCE(s.credit_period,'monthly') = 'billing' THEN
    amt := s.monthly_credits * CASE WHEN s.billing_period='yearly' THEN 12 ELSE 1 END;
    RETURN public._credit_insert_grant(s.agency_id,'subscription','subscription',amt,s.current_period_end,'plan_period_credits',
      'plan:'||s.id||':'||to_char(s.current_period_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS'),'grant','subscription',s.id::text,NULL);
  END IF;
  SELECT * INTO w FROM public._commercial_credit_window(s.current_period_start, s.current_period_end, now());
  IF w.cs IS NULL THEN RETURN NULL; END IF;
  -- Ein Grant pro Abo + Credit-Periodenbeginn (bei Monatsabo identisch mit bisherigem Schlüssel)
  RETURN public._credit_insert_grant(s.agency_id,'subscription','subscription',s.monthly_credits,w.ce,'plan_period_credits',
    'plan:'||s.id||':'||to_char(w.cs AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS'),'grant','subscription',s.id::text,NULL);
END $function$;

CREATE OR REPLACE FUNCTION public.commercial_advance_period(_subscription_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s record; ns timestamptz; ne timestamptz; step interval; steps int := 0; op uuid; newst text;
BEGIN
  IF NOT (auth.role() = 'service_role' OR session_user = 'postgres') THEN PERFORM public.platform_assert_admin(); END IF;
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
  -- Manuelle Verträge ohne automatische Verlängerung laufen aus (keine Daten gelöscht)
  IF s.billing_source IS NOT NULL AND NOT COALESCE(s.auto_renew,false) THEN
    UPDATE subscriptions SET status='expired', updated_at=now() WHERE id=s.id;
    RETURN jsonb_build_object('ok',true,'changed',true,'status','expired');
  END IF;
  step := CASE WHEN s.billing_period='yearly' THEN interval '1 year'
               WHEN s.billing_period='custom' THEN (s.current_period_end - s.current_period_start)
               ELSE interval '1 month' END;
  ns := s.current_period_start; ne := s.current_period_end;
  WHILE ne <= now() LOOP ns := ne; ne := ne + step; steps := steps+1; END LOOP;
  -- Verlängerung erzeugt Zahlungsbedarf, nie eine vorgetäuschte Zahlung
  newst := CASE WHEN s.billing_source IN ('invoice','bank_transfer','manual') THEN 'past_due' ELSE s.status END;
  UPDATE subscriptions SET current_period_start=ns, current_period_end=ne, status=newst,
    past_due_since = CASE WHEN newst='past_due' THEN COALESCE(past_due_since, now()) ELSE past_due_since END,
    updated_at=now() WHERE id=s.id;
  op := public._commercial_grant_period_credits(s.id);
  RETURN jsonb_build_object('ok',true,'changed',true,'periods_advanced',steps,'status',newst,'current_period_start',ns,'current_period_end',ne,'credit_operation_id',op);
END $function$;

CREATE OR REPLACE FUNCTION public.commercial_advance_due_periods()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r record; res jsonb := '[]'::jsonb;
BEGIN
  IF NOT (auth.role() = 'service_role' OR session_user = 'postgres') THEN PERFORM public.platform_assert_admin(); END IF;
  -- auch laufende Perioden: monatliche Credits bei Jahresabrechnung (idempotent)
  FOR r IN SELECT id FROM subscriptions WHERE source='internal' AND status IN ('active','past_due') LOOP
    res := res || jsonb_build_array(jsonb_build_object('subscription_id',r.id) || public.commercial_advance_period(r.id));
  END LOOP;
  RETURN res;
END $function$;

CREATE OR REPLACE FUNCTION public.commercial_subscription_state(_agency_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE s record; st text; grace int;
BEGIN
  IF NOT public.commercial_can_read(_agency_id) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT COALESCE(past_due_grace_days,14) INTO grace FROM platform_commercial_settings LIMIT 1;
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
      AND NOT EXISTS (SELECT 1 FROM subscriptions x WHERE x.agency_id=_agency_id AND COALESCE(x.stripe_subscription_id,'') NOT LIKE 'immolia_trial:%'
                        AND x.status IN ('active','past_due','canceled','expired'))
      THEN 'post_trial'
    ELSE 'no_active_subscription' END;
  RETURN jsonb_build_object('state',st,'subscription_id',s.id,'status',s.status,'plan_id',s.plan_id,'billing_period',s.billing_period,
    'current_period_start',s.current_period_start,'current_period_end',s.current_period_end,'cancel_at_period_end',s.cancel_at_period_end,
    'trial_end',s.trial_end,'source',s.source,'past_due_since',s.past_due_since,'grace_days',grace,
    'billing_source',s.billing_source,'contract_price',s.contract_price,'contract_currency',s.contract_currency,
    'paid_until',s.paid_until,'auto_renew',s.auto_renew,'invoice_number',s.invoice_number,'payment_due_date',s.payment_due_date,
    'pay_as_you_use', st IN ('post_trial','no_active_subscription','unpaid'));
END $function$;

-- Stripe-Sync kennzeichnet Zahlungsweg
CREATE OR REPLACE FUNCTION public.stripe_sync_subscription(_agency_id uuid, _user_id uuid, _stripe_subscription_id text, _stripe_customer_id text, _product_id text, _price_key text, _status text, _period_start timestamp with time zone, _period_end timestamp with time zone, _cancel_at_period_end boolean, _environment text)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE pid uuid; sid uuid; uid uuid;
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  SELECT id INTO pid FROM plans WHERE stripe_price_key = _price_key;
  uid := _user_id;
  IF uid IS NULL THEN SELECT user_id INTO uid FROM subscriptions WHERE stripe_subscription_id=_stripe_subscription_id; END IF;
  IF uid IS NULL THEN SELECT user_id INTO uid FROM agency_memberships WHERE agency_id=_agency_id AND is_active AND role='owner' ORDER BY created_at LIMIT 1; END IF;
  IF uid IS NULL THEN SELECT user_id INTO uid FROM platform_admins WHERE is_system_owner ORDER BY created_at LIMIT 1; END IF;
  INSERT INTO subscriptions(user_id, agency_id, stripe_subscription_id, stripe_customer_id, product_id, price_id, status,
    current_period_start, current_period_end, cancel_at_period_end, environment, plan_id, billing_period, source, billing_source, past_due_since, updated_at)
  VALUES (uid, _agency_id, _stripe_subscription_id, _stripe_customer_id, COALESCE(_product_id,''), COALESCE(_price_key,''), _status,
    _period_start, _period_end, COALESCE(_cancel_at_period_end,false), _environment, pid, 'monthly', 'stripe', 'stripe',
    CASE WHEN _status='past_due' THEN now() END, now())
  ON CONFLICT (stripe_subscription_id) DO UPDATE SET
    status = EXCLUDED.status, product_id = EXCLUDED.product_id, price_id = EXCLUDED.price_id,
    plan_id = COALESCE(EXCLUDED.plan_id, subscriptions.plan_id),
    current_period_start = EXCLUDED.current_period_start, current_period_end = EXCLUDED.current_period_end,
    cancel_at_period_end = EXCLUDED.cancel_at_period_end,
    agency_id = COALESCE(subscriptions.agency_id, EXCLUDED.agency_id),
    billing_source = 'stripe',
    past_due_since = CASE WHEN EXCLUDED.status='past_due' THEN COALESCE(subscriptions.past_due_since, now()) ELSE NULL END,
    updated_at = now()
  RETURNING id INTO sid;
  IF _status = 'active' THEN PERFORM public._commercial_grant_period_credits(sid); END IF;
  RETURN sid;
END $function$;

-- Plattform: Abrechnung einer Firma lesen
CREATE OR REPLACE FUNCTION public.platform_get_agency_billing(_agency_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.platform_assert_admin();
  RETURN jsonb_build_object(
    'credits', public._credit_available(_agency_id),
    'subscriptions', COALESCE((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.created_at DESC) FROM (
      SELECT s.id, s.status, s.source, s.billing_source, s.billing_period, s.current_period_start, s.current_period_end,
        s.cancel_at_period_end, s.contract_price, s.contract_currency, s.auto_renew, s.paid_until, s.paid_at, s.last_payment_amount,
        s.invoice_number, s.invoice_date, s.payment_due_date, s.past_due_since, s.trial_end, s.environment, s.created_at,
        s.stripe_subscription_id IS NOT NULL AND s.source='stripe' AS is_stripe,
        s.plan_id, p.name AS plan_name, n.note AS internal_note
      FROM subscriptions s LEFT JOIN plans p ON p.id=s.plan_id LEFT JOIN subscription_admin_notes n ON n.subscription_id=s.id
      WHERE s.agency_id=_agency_id ORDER BY s.created_at DESC LIMIT 10) x), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public._manual_active_conflict(_agency_id uuid, _start timestamptz, _except uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM subscriptions s WHERE s.agency_id=_agency_id AND s.id IS DISTINCT FROM _except
    AND COALESCE(s.stripe_subscription_id,'') NOT LIKE 'immolia_trial:%'
    AND s.status IN ('active','past_due','trialing','incomplete')
    AND COALESCE(s.current_period_end,'infinity'::timestamptz) > _start);
$$;
REVOKE ALL ON FUNCTION public._manual_active_conflict(uuid,timestamptz,uuid) FROM public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.platform_create_manual_subscription(
  _agency_id uuid, _plan_id uuid, _billing_source text, _billing_period text,
  _start timestamptz, _end timestamptz, _status text, _price numeric, _currency text,
  _auto_renew boolean, _note text, _invoice_number text, _invoice_date date, _payment_due_date date, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nm text; sid uuid; op uuid; st text; pr numeric;
BEGIN
  PERFORM public.platform_assert_admin();
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  IF _billing_source NOT IN ('invoice','bank_transfer','manual','complimentary') THEN RAISE EXCEPTION 'invalid_billing_source' USING ERRCODE='22023'; END IF;
  IF _billing_period NOT IN ('monthly','yearly','custom') THEN RAISE EXCEPTION 'invalid_billing_period' USING ERRCODE='22023'; END IF;
  IF _start IS NULL OR _end IS NULL OR _end <= _start THEN RAISE EXCEPTION 'invalid_period' USING ERRCODE='22023'; END IF;
  SELECT name INTO nm FROM agencies WHERE id=_agency_id; IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF NOT EXISTS (SELECT 1 FROM plans WHERE id=_plan_id AND status IN ('active','draft')) THEN RAISE EXCEPTION 'plan_not_found' USING ERRCODE='22023'; END IF;
  st := CASE WHEN _billing_source='complimentary' THEN 'active' ELSE COALESCE(_status,'past_due') END;
  IF st NOT IN ('active','past_due') THEN RAISE EXCEPTION 'invalid_status' USING ERRCODE='22023'; END IF;
  pr := CASE WHEN _billing_source='complimentary' THEN 0 ELSE _price END;
  IF pr IS NULL OR pr < 0 THEN RAISE EXCEPTION 'price_required' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('manual_sub:'||_agency_id));
  IF public._manual_active_conflict(_agency_id, _start, NULL) THEN RAISE EXCEPTION 'active_subscription_exists' USING ERRCODE='23505'; END IF;
  -- laufendes Trial endet mit Vertragsbeginn
  UPDATE subscriptions SET status='canceled', current_period_end=LEAST(COALESCE(current_period_end,now()),GREATEST(_start,now())), updated_at=now()
    WHERE agency_id=_agency_id AND status='trialing';
  INSERT INTO subscriptions(user_id,agency_id,status,current_period_start,current_period_end,plan_id,billing_period,source,environment,
    billing_source,contract_price,contract_currency,auto_renew,paid_until,invoice_number,invoice_date,payment_due_date,credit_period,past_due_since)
  VALUES (auth.uid(),_agency_id,st,_start,_end,_plan_id,_billing_period,'internal','internal',
    _billing_source,pr,upper(COALESCE(NULLIF(trim(_currency),''),'CHF')),COALESCE(_auto_renew,false),
    CASE WHEN st='active' THEN _end END, NULLIF(trim(_invoice_number),''),_invoice_date,_payment_due_date,'monthly',
    CASE WHEN st='past_due' THEN now() END)
  RETURNING id INTO sid;
  IF _note IS NOT NULL AND length(trim(_note))>0 THEN
    INSERT INTO subscription_admin_notes(subscription_id,note,updated_by) VALUES (sid,trim(_note),auth.uid());
  END IF;
  op := public._commercial_grant_period_credits(sid);
  INSERT INTO platform_audit_logs(actor_user_id, action, target_type, target_id, target_label, metadata)
  VALUES (auth.uid(),'manual_subscription_created','agency',_agency_id,nm,jsonb_build_object('subscription_id',sid,'plan',_plan_id,
    'billing_source',_billing_source,'billing_period',_billing_period,'start',_start,'end',_end,'status',st,'price',pr,
    'currency',upper(COALESCE(NULLIF(trim(_currency),''),'CHF')),'auto_renew',COALESCE(_auto_renew,false),'reason',_reason));
  RETURN jsonb_build_object('ok',true,'subscription_id',sid,'status',st,'credit_operation_id',op);
END $$;

CREATE OR REPLACE FUNCTION public.platform_update_manual_subscription(
  _subscription_id uuid, _plan_id uuid, _billing_source text, _billing_period text, _end timestamptz,
  _price numeric, _currency text, _auto_renew boolean, _note text,
  _invoice_number text, _invoice_date date, _payment_due_date date, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; nm text; op uuid;
BEGIN
  PERFORM public.platform_assert_admin();
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  SELECT * INTO s FROM subscriptions WHERE id=_subscription_id FOR UPDATE;
  IF s.id IS NULL OR s.source <> 'internal' OR s.billing_source IS NULL OR s.billing_source='stripe' THEN RAISE EXCEPTION 'not_manual_subscription' USING ERRCODE='22023'; END IF;
  IF _billing_source IS NOT NULL AND _billing_source NOT IN ('invoice','bank_transfer','manual','complimentary') THEN RAISE EXCEPTION 'invalid_billing_source' USING ERRCODE='22023'; END IF;
  IF _billing_period IS NOT NULL AND _billing_period NOT IN ('monthly','yearly','custom') THEN RAISE EXCEPTION 'invalid_billing_period' USING ERRCODE='22023'; END IF;
  IF _end IS NOT NULL AND _end <= s.current_period_start THEN RAISE EXCEPTION 'invalid_period' USING ERRCODE='22023'; END IF;
  IF _price IS NOT NULL AND _price < 0 THEN RAISE EXCEPTION 'invalid_price' USING ERRCODE='22023'; END IF;
  IF _plan_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plans WHERE id=_plan_id AND status IN ('active','draft')) THEN RAISE EXCEPTION 'plan_not_found' USING ERRCODE='22023'; END IF;
  UPDATE subscriptions SET
    plan_id=COALESCE(_plan_id,plan_id), billing_source=COALESCE(_billing_source,billing_source),
    billing_period=COALESCE(_billing_period,billing_period), current_period_end=COALESCE(_end,current_period_end),
    contract_price=CASE WHEN COALESCE(_billing_source,billing_source)='complimentary' THEN 0 ELSE COALESCE(_price,contract_price) END,
    contract_currency=COALESCE(upper(NULLIF(trim(_currency),'')),contract_currency), auto_renew=COALESCE(_auto_renew,auto_renew),
    invoice_number=COALESCE(NULLIF(trim(_invoice_number),''),invoice_number), invoice_date=COALESCE(_invoice_date,invoice_date),
    payment_due_date=COALESCE(_payment_due_date,payment_due_date),
    status=CASE WHEN COALESCE(_billing_source,billing_source)='complimentary' AND status IN ('past_due','expired') THEN 'active' ELSE status END,
    past_due_since=CASE WHEN COALESCE(_billing_source,billing_source)='complimentary' THEN NULL ELSE past_due_since END,
    updated_at=now()
  WHERE id=s.id;
  IF _note IS NOT NULL THEN
    INSERT INTO subscription_admin_notes(subscription_id,note,updated_by,updated_at) VALUES (s.id,trim(_note),auth.uid(),now())
    ON CONFLICT (subscription_id) DO UPDATE SET note=EXCLUDED.note, updated_by=EXCLUDED.updated_by, updated_at=now();
  END IF;
  op := public._commercial_grant_period_credits(s.id);
  SELECT name INTO nm FROM agencies WHERE id=s.agency_id;
  INSERT INTO platform_audit_logs(actor_user_id, action, target_type, target_id, target_label, metadata)
  VALUES (auth.uid(),'manual_subscription_updated','agency',s.agency_id,nm,jsonb_build_object('subscription_id',s.id,
    'before',jsonb_build_object('plan',s.plan_id,'billing_source',s.billing_source,'billing_period',s.billing_period,'end',s.current_period_end,'price',s.contract_price,'auto_renew',s.auto_renew),
    'after',jsonb_build_object('plan',_plan_id,'billing_source',_billing_source,'billing_period',_billing_period,'end',_end,'price',_price,'auto_renew',_auto_renew),
    'note_changed',_note IS NOT NULL,'reason',_reason));
  RETURN jsonb_build_object('ok',true,'subscription_id',s.id,'credit_operation_id',op);
END $$;

CREATE OR REPLACE FUNCTION public.platform_record_manual_payment(
  _subscription_id uuid, _amount numeric, _paid_at timestamptz, _invoice_number text, _paid_until timestamptz, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; nm text; op uuid; pu timestamptz;
BEGIN
  PERFORM public.platform_assert_admin();
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'amount_required' USING ERRCODE='22023'; END IF;
  SELECT * INTO s FROM subscriptions WHERE id=_subscription_id FOR UPDATE;
  IF s.id IS NULL OR s.source <> 'internal' OR s.billing_source NOT IN ('invoice','bank_transfer','manual') THEN RAISE EXCEPTION 'not_manual_payment_subscription' USING ERRCODE='22023'; END IF;
  IF s.status NOT IN ('active','past_due','unpaid') THEN RAISE EXCEPTION 'subscription_not_open' USING ERRCODE='22023'; END IF;
  pu := COALESCE(_paid_until, s.current_period_end);
  IF pu <= s.current_period_start THEN RAISE EXCEPTION 'invalid_paid_until' USING ERRCODE='22023'; END IF;
  UPDATE subscriptions SET status='active', past_due_since=NULL, paid_at=COALESCE(_paid_at,now()), last_payment_amount=_amount,
    paid_until=pu, current_period_end=GREATEST(current_period_end,pu),
    invoice_number=COALESCE(NULLIF(trim(_invoice_number),''),invoice_number), updated_at=now()
  WHERE id=s.id;
  op := public._commercial_grant_period_credits(s.id);
  SELECT name INTO nm FROM agencies WHERE id=s.agency_id;
  INSERT INTO platform_audit_logs(actor_user_id, action, target_type, target_id, target_label, metadata)
  VALUES (auth.uid(),'manual_payment_recorded','agency',s.agency_id,nm,jsonb_build_object('subscription_id',s.id,'amount',_amount,
    'currency',s.contract_currency,'billing_source',s.billing_source,'paid_at',COALESCE(_paid_at,now()),'paid_until',pu,
    'invoice_number',COALESCE(NULLIF(trim(_invoice_number),''),s.invoice_number),'reason',_reason));
  RETURN jsonb_build_object('ok',true,'subscription_id',s.id,'paid_until',pu,'credit_operation_id',op);
END $$;

CREATE OR REPLACE FUNCTION public.platform_cancel_manual_subscription(_subscription_id uuid, _immediate boolean, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s record; nm text;
BEGIN
  PERFORM public.platform_assert_admin();
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  SELECT * INTO s FROM subscriptions WHERE id=_subscription_id FOR UPDATE;
  IF s.id IS NULL OR s.source <> 'internal' OR s.billing_source IS NULL OR s.billing_source='stripe' THEN RAISE EXCEPTION 'not_manual_subscription' USING ERRCODE='22023'; END IF;
  IF COALESCE(_immediate,false) THEN
    UPDATE subscriptions SET status='canceled', current_period_end=LEAST(current_period_end,now()), cancel_at_period_end=false, updated_at=now() WHERE id=s.id;
  ELSE
    UPDATE subscriptions SET cancel_at_period_end=true, auto_renew=false, updated_at=now() WHERE id=s.id;
  END IF;
  SELECT name INTO nm FROM agencies WHERE id=s.agency_id;
  INSERT INTO platform_audit_logs(actor_user_id, action, target_type, target_id, target_label, metadata)
  VALUES (auth.uid(),'manual_subscription_canceled','agency',s.agency_id,nm,jsonb_build_object('subscription_id',s.id,'immediate',COALESCE(_immediate,false),'reason',_reason));
  RETURN jsonb_build_object('ok',true,'subscription_id',s.id,'immediate',COALESCE(_immediate,false));
END $$;

REVOKE ALL ON FUNCTION public.platform_get_agency_billing(uuid) FROM public, anon;
REVOKE ALL ON FUNCTION public.platform_create_manual_subscription(uuid,uuid,text,text,timestamptz,timestamptz,text,numeric,text,boolean,text,text,date,date,text) FROM public, anon;
REVOKE ALL ON FUNCTION public.platform_update_manual_subscription(uuid,uuid,text,text,timestamptz,numeric,text,boolean,text,text,date,date,text) FROM public, anon;
REVOKE ALL ON FUNCTION public.platform_record_manual_payment(uuid,numeric,timestamptz,text,timestamptz,text) FROM public, anon;
REVOKE ALL ON FUNCTION public.platform_cancel_manual_subscription(uuid,boolean,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.platform_get_agency_billing(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_create_manual_subscription(uuid,uuid,text,text,timestamptz,timestamptz,text,numeric,text,boolean,text,text,date,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_update_manual_subscription(uuid,uuid,text,text,timestamptz,numeric,text,boolean,text,text,date,date,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_record_manual_payment(uuid,numeric,timestamptz,text,timestamptz,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.platform_cancel_manual_subscription(uuid,boolean,text) TO authenticated;

-- Täglicher Lauf: Periodenwechsel, Ablauf, monatliche Plan-Credits (idempotent)
SELECT cron.schedule('immolia-commercial-advance-daily', '15 2 * * *', $$SELECT public.commercial_advance_due_periods();$$);