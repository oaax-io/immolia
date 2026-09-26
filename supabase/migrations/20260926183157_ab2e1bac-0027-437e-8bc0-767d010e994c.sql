
-- ===== Ledger erweitern (additiv) =====
ALTER TABLE public.credit_ledger ADD COLUMN IF NOT EXISTS operation_id uuid NULL;
ALTER TABLE public.credit_ledger ADD COLUMN IF NOT EXISTS lot_id uuid NULL REFERENCES public.credit_ledger(id);
CREATE INDEX IF NOT EXISTS credit_ledger_lot_idx ON public.credit_ledger(lot_id) WHERE lot_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS credit_ledger_op_idx ON public.credit_ledger(operation_id);
CREATE INDEX IF NOT EXISTS credit_ledger_refref_idx ON public.credit_ledger(reference_id) WHERE reference_type = 'refund_of_entry';
-- Regel: positive Zeilen sind Posten (lot_id NULL), negative Zeilen belasten genau einen Posten
ALTER TABLE public.credit_ledger ADD CONSTRAINT credit_ledger_lot_shape CHECK ((delta > 0 AND lot_id IS NULL) OR (delta < 0 AND lot_id IS NOT NULL)) NOT VALID;

-- ===== Operationen =====
CREATE TABLE public.credit_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agency_id uuid NOT NULL REFERENCES public.agencies(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('consume','grant','refund','adjustment')),
  action_key text,
  idempotency_key text CHECK (idempotency_key IS NULL OR length(idempotency_key) BETWEEN 1 AND 200),
  amount integer NOT NULL CHECK (amount > 0),
  refund_of uuid REFERENCES public.credit_operations(id),
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX credit_operations_consume_idem ON public.credit_operations(agency_id, action_key, idempotency_key) WHERE kind = 'consume';
CREATE UNIQUE INDEX credit_operations_grant_idem ON public.credit_operations(agency_id, idempotency_key) WHERE kind IN ('grant','adjustment') AND idempotency_key IS NOT NULL;
CREATE INDEX credit_operations_agency_idx ON public.credit_operations(agency_id, created_at DESC);
CREATE INDEX credit_operations_refund_idx ON public.credit_operations(refund_of) WHERE refund_of IS NOT NULL;
GRANT SELECT ON public.credit_operations TO authenticated; GRANT ALL ON public.credit_operations TO service_role;
ALTER TABLE public.credit_operations ENABLE ROW LEVEL SECURITY;
CREATE POLICY credit_operations_tenant_admin_read ON public.credit_operations FOR SELECT TO authenticated USING (public.is_agency_owner_or_admin(agency_id));
CREATE TRIGGER credit_operations_immutable BEFORE UPDATE OR DELETE ON public.credit_operations FOR EACH ROW EXECUTE FUNCTION public.credit_ledger_immutable();

-- ===== Interne Helfer (nicht aus der App aufrufbar) =====
CREATE OR REPLACE FUNCTION public._credit_default_order() RETURNS text[] LANGUAGE sql IMMUTABLE AS $$
  SELECT ARRAY['subscription','promotional','adjustment','purchased']::text[];
$$;

CREATE OR REPLACE FUNCTION public._credit_wallet(_agency_id uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w uuid;
BEGIN
  INSERT INTO credit_wallets(agency_id) VALUES (_agency_id) ON CONFLICT (agency_id) DO NOTHING;
  SELECT id INTO w FROM credit_wallets WHERE agency_id = _agency_id FOR UPDATE;  -- serialisiert alle Buchungen der Firma
  RETURN w;
END $$;

-- Posten mit Restbestand (nur gültige, nicht abgelaufene), in Verbrauchsreihenfolge
CREATE OR REPLACE FUNCTION public._credit_open_lots(_agency_id uuid)
RETURNS TABLE(lot_id uuid, bucket text, expires_at timestamptz, remaining integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT l.id, l.bucket, l.expires_at, (l.delta + COALESCE(SUM(c.delta), 0))::int AS remaining
  FROM credit_ledger l
  LEFT JOIN credit_ledger c ON c.lot_id = l.id
  LEFT JOIN credit_wallets w ON w.agency_id = l.agency_id
  WHERE l.agency_id = _agency_id AND l.delta > 0 AND (l.expires_at IS NULL OR l.expires_at > now())
  GROUP BY l.id, l.bucket, l.expires_at, l.created_at, w.consumption_order
  HAVING l.delta + COALESCE(SUM(c.delta), 0) > 0
  ORDER BY array_position(COALESCE(w.consumption_order, public._credit_default_order()), l.bucket) NULLS LAST,
           l.expires_at ASC NULLS LAST, l.created_at ASC, l.id;
$$;

CREATE OR REPLACE FUNCTION public._credit_available(_agency_id uuid) RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(SUM(remaining), 0)::int FROM public._credit_open_lots(_agency_id);
$$;

-- Belastung in Verbrauchsreihenfolge; setzt gesperrtes Wallet voraus
CREATE OR REPLACE FUNCTION public._credit_debit(_agency_id uuid, _wallet uuid, _op uuid, _amount integer, _source text, _action_key text, _actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_left int := _amount; v_take int; lot record; parts jsonb := '[]'::jsonb;
BEGIN
  FOR lot IN SELECT * FROM public._credit_open_lots(_agency_id) LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_left, lot.remaining);
    INSERT INTO credit_ledger(wallet_id, agency_id, source, bucket, delta, action_key, operation_id, lot_id, created_by)
    VALUES (_wallet, _agency_id, _source, lot.bucket, -v_take, _action_key, _op, lot.lot_id, _actor);
    parts := parts || jsonb_build_object('bucket', lot.bucket, 'amount', v_take);
    v_left := v_left - v_take;
  END LOOP;
  IF v_left > 0 THEN RAISE EXCEPTION 'insufficient_credits' USING ERRCODE = 'P0001'; END IF;  -- rollt alles zurück
  RETURN parts;
END $$;

CREATE OR REPLACE FUNCTION public._credit_insert_grant(_agency_id uuid, _bucket text, _source text, _amount integer, _expires_at timestamptz,
  _reason text, _idem text, _kind text, _ref_type text, _ref_id text, _actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE w uuid; op uuid;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount' USING ERRCODE='22023'; END IF;
  IF _bucket NOT IN ('subscription','promotional','purchased','adjustment') THEN RAISE EXCEPTION 'invalid_bucket' USING ERRCODE='22023'; END IF;
  IF _bucket = 'subscription' AND _expires_at IS NULL THEN RAISE EXCEPTION 'subscription_credits_need_expiry' USING ERRCODE='22023'; END IF;
  IF _expires_at IS NOT NULL AND _expires_at <= now() THEN RAISE EXCEPTION 'expiry_in_past' USING ERRCODE='22023'; END IF;
  w := public._credit_wallet(_agency_id);
  IF _idem IS NOT NULL THEN
    SELECT id INTO op FROM credit_operations WHERE agency_id=_agency_id AND idempotency_key=_idem AND kind IN ('grant','adjustment');
    IF op IS NOT NULL THEN RETURN op; END IF;
  END IF;
  INSERT INTO credit_operations(agency_id, kind, idempotency_key, amount, reason, created_by)
  VALUES (_agency_id, _kind, _idem, _amount, _reason, _actor) RETURNING id INTO op;
  INSERT INTO credit_ledger(wallet_id, agency_id, source, bucket, delta, expires_at, operation_id, reference_type, reference_id, created_by, metadata)
  VALUES (w, _agency_id, _source, _bucket, _amount, _expires_at, op, _ref_type, _ref_id, _actor, jsonb_build_object('reason', _reason));
  RETURN op;
END $$;

-- ===== Lesemodell =====
CREATE OR REPLACE FUNCTION public.credit_balance(_agency_id uuid DEFAULT NULL) RETURNS integer LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a uuid := COALESCE(_agency_id, public.current_agency_id());
BEGIN
  IF a IS NULL OR NOT (auth.role() = 'service_role' OR public.is_agency_member(a) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  RETURN public._credit_available(a);
END $$;

CREATE OR REPLACE FUNCTION public.credit_balance_breakdown(_agency_id uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a uuid := COALESCE(_agency_id, public.current_agency_id()); res jsonb;
BEGIN
  IF a IS NULL OR NOT (auth.role() = 'service_role' OR public.is_agency_owner_or_admin(a) OR public.is_platform_admin()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  WITH lots AS (
    SELECT l.id, l.bucket, l.expires_at, l.delta AS granted,
           -COALESCE((SELECT SUM(c.delta) FROM credit_ledger c WHERE c.lot_id = l.id), 0) AS used
    FROM credit_ledger l WHERE l.agency_id = a AND l.delta > 0
  ), b AS (
    SELECT bucket,
      SUM(granted)::int AS granted, SUM(used)::int AS consumed,
      SUM(CASE WHEN expires_at IS NULL OR expires_at > now() THEN granted - used ELSE 0 END)::int AS available,
      SUM(CASE WHEN expires_at IS NOT NULL AND expires_at <= now() THEN granted - used ELSE 0 END)::int AS expired,
      MIN(CASE WHEN (expires_at > now()) AND granted - used > 0 THEN expires_at END) AS next_expiry
    FROM lots GROUP BY bucket
  )
  SELECT jsonb_build_object(
    'agency_id', a,
    'available', COALESCE((SELECT SUM(available) FROM b), 0),
    'expired', COALESCE((SELECT SUM(expired) FROM b), 0),
    'total_granted', COALESCE((SELECT SUM(granted) FROM b), 0),
    'total_consumed', COALESCE((SELECT SUM(consumed) FROM b), 0),
    'buckets', COALESCE((SELECT jsonb_object_agg(bucket, jsonb_build_object('available', available, 'expired', expired, 'granted', granted, 'consumed', consumed, 'next_expiry', next_expiry)) FROM b), '{}'::jsonb),
    'recent', COALESCE((SELECT jsonb_agg(x) FROM (
        SELECT jsonb_build_object('at', created_at, 'source', source, 'bucket', bucket, 'delta', delta, 'action_key', action_key, 'expires_at', expires_at, 'operation_id', operation_id) x
        FROM credit_ledger WHERE agency_id = a ORDER BY created_at DESC, id LIMIT 20) r), '[]'::jsonb)
  ) INTO res;
  RETURN res;
END $$;

-- ===== Verbrauch (aktive Firma, Kosten nur aus dem Katalog) =====
CREATE OR REPLACE FUNCTION public.credit_can_consume(_action_key text) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE a uuid := public.current_agency_id(); v_cost int; v_avail int;
BEGIN
  IF auth.uid() IS NULL OR a IS NULL OR NOT public.agency_is_active(a) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  v_cost := public.credit_action_effective_cost(_action_key);
  v_avail := public._credit_available(a);
  RETURN jsonb_build_object('action_key', _action_key, 'cost', v_cost, 'available', v_avail, 'allowed', v_avail >= v_cost);
END $$;

CREATE OR REPLACE FUNCTION public.credit_consume(_action_key text, _idempotency_key text, _agency_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a uuid; w uuid; v_cost int; op uuid; parts jsonb; existing record;
BEGIN
  IF auth.role() = 'service_role' AND _agency_id IS NOT NULL THEN
    a := _agency_id;
  ELSE
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
    a := public.current_agency_id();
    IF _agency_id IS NOT NULL AND _agency_id IS DISTINCT FROM a THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  END IF;
  IF a IS NULL OR NOT public.agency_is_active(a) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _action_key IS NULL OR _action_key !~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$' THEN RAISE EXCEPTION 'invalid_action' USING ERRCODE='22023'; END IF;
  IF _idempotency_key IS NULL OR length(_idempotency_key) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE='22023'; END IF;

  v_cost := public.credit_action_effective_cost(_action_key);
  IF v_cost = 0 THEN
    RETURN jsonb_build_object('ok', true, 'charged', 0, 'operation_id', NULL, 'replayed', false);
  END IF;

  w := public._credit_wallet(a);  -- Sperre: parallele Aufrufe derselben Firma laufen nacheinander
  SELECT id, amount INTO existing FROM credit_operations
   WHERE agency_id = a AND kind = 'consume' AND action_key = _action_key AND idempotency_key = _idempotency_key;
  IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'charged', existing.amount, 'operation_id', existing.id, 'replayed', true);
  END IF;

  IF public._credit_available(a) < v_cost THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'insufficient_credits', 'cost', v_cost, 'available', public._credit_available(a));
  END IF;

  INSERT INTO credit_operations(agency_id, kind, action_key, idempotency_key, amount, created_by)
  VALUES (a, 'consume', _action_key, _idempotency_key, v_cost, auth.uid()) RETURNING id INTO op;
  parts := public._credit_debit(a, w, op, v_cost, 'consumption', _action_key, auth.uid());
  RETURN jsonb_build_object('ok', true, 'charged', v_cost, 'operation_id', op, 'parts', parts, 'replayed', false);
END $$;

-- ===== Gutschrift: nur Server (Stripe/Abo später) =====
CREATE OR REPLACE FUNCTION public.credit_grant(_agency_id uuid, _bucket text, _source text, _amount integer, _expires_at timestamptz,
  _reason text, _idempotency_key text, _reference_type text DEFAULT NULL, _reference_id text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  IF _source NOT IN ('subscription','purchase','promotion','bonus','adjustment') THEN RAISE EXCEPTION 'invalid_source' USING ERRCODE='22023'; END IF;
  RETURN public._credit_insert_grant(_agency_id, _bucket, _source, _amount, _expires_at, _reason, _idempotency_key, 'grant', _reference_type, _reference_id, NULL);
END $$;

-- ===== Rückerstattung einer Verbrauchs-Operation =====
CREATE OR REPLACE FUNCTION public._credit_refund(_operation_id uuid, _amount integer, _reason text, _actor uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE o record; w uuid; v_refunded int; v_left int; v_take int; e record; rop uuid;
BEGIN
  SELECT * INTO o FROM credit_operations WHERE id = _operation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF o.kind <> 'consume' THEN RAISE EXCEPTION 'not_refundable' USING ERRCODE='22023'; END IF;
  w := public._credit_wallet(o.agency_id);  -- Sperre gegen doppelte Rückerstattung
  SELECT COALESCE(SUM(amount), 0) INTO v_refunded FROM credit_operations WHERE refund_of = o.id;
  v_left := COALESCE(_amount, o.amount - v_refunded);
  IF v_left <= 0 OR v_refunded + v_left > o.amount THEN RAISE EXCEPTION 'already_refunded' USING ERRCODE='22023'; END IF;
  INSERT INTO credit_operations(agency_id, kind, action_key, amount, refund_of, reason, created_by)
  VALUES (o.agency_id, 'refund', o.action_key, v_left, o.id, _reason, _actor) RETURNING id INTO rop;
  -- zurück in die ursprünglichen Töpfe (zuletzt belastete zuerst), gleiche Ablaufregel wie der Ursprungsposten
  FOR e IN
    SELECT c.id, c.bucket, -c.delta AS charged, l.expires_at,
           COALESCE((SELECT SUM(r.delta) FROM credit_ledger r WHERE r.reference_type='refund_of_entry' AND r.reference_id = c.id::text), 0) AS back
    FROM credit_ledger c JOIN credit_ledger l ON l.id = c.lot_id
    WHERE c.operation_id = o.id AND c.delta < 0
    ORDER BY c.created_at DESC, array_position(public._credit_default_order(), c.bucket) DESC
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(v_left, e.charged - e.back);
    CONTINUE WHEN v_take <= 0;
    INSERT INTO credit_ledger(wallet_id, agency_id, source, bucket, delta, expires_at, action_key, operation_id, reference_type, reference_id, created_by, metadata)
    VALUES (w, o.agency_id, 'refund', e.bucket, v_take, e.expires_at, o.action_key, rop, 'refund_of_entry', e.id::text, _actor, jsonb_build_object('reason', _reason, 'refund_of', o.id));
    v_left := v_left - v_take;
  END LOOP;
  IF v_left > 0 THEN RAISE EXCEPTION 'already_refunded' USING ERRCODE='22023'; END IF;
  RETURN rop;
END $$;

CREATE OR REPLACE FUNCTION public.credit_refund(_operation_id uuid, _amount integer DEFAULT NULL, _reason text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
  RETURN public._credit_refund(_operation_id, _amount, COALESCE(_reason, 'system'), NULL);
END $$;

-- ===== Plattform: kontrollierte Korrektur / Rückerstattung (Audit) =====
CREATE OR REPLACE FUNCTION public.platform_credit_adjust(_agency_id uuid, _amount integer, _bucket text, _expires_at timestamptz, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE nm text; op uuid; w uuid;
BEGIN
  PERFORM public.platform_assert_admin();
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  SELECT name INTO nm FROM agencies WHERE id = _agency_id; IF NOT FOUND THEN RAISE EXCEPTION 'not_found' USING ERRCODE='P0002'; END IF;
  IF _amount IS NULL OR _amount = 0 THEN RAISE EXCEPTION 'invalid_amount' USING ERRCODE='22023'; END IF;
  IF _amount > 0 THEN
    op := public._credit_insert_grant(_agency_id, COALESCE(_bucket,'adjustment'), 'adjustment', _amount, _expires_at, _reason, NULL, 'adjustment', NULL, NULL, auth.uid());
  ELSE
    w := public._credit_wallet(_agency_id);
    INSERT INTO credit_operations(agency_id, kind, amount, reason, created_by) VALUES (_agency_id, 'adjustment', -_amount, _reason, auth.uid()) RETURNING id INTO op;
    PERFORM public._credit_debit(_agency_id, w, op, -_amount, 'adjustment', NULL, auth.uid());
  END IF;
  INSERT INTO platform_audit_logs(actor_user_id, action, target_type, target_id, target_label, metadata)
  VALUES (auth.uid(), 'credits_adjusted', 'agency', _agency_id, nm,
    jsonb_build_object('agency_id', _agency_id, 'operation_id', op, 'amount', _amount, 'bucket', _bucket, 'expires_at', _expires_at, 'reason', _reason));
  RETURN op;
END $$;

CREATE OR REPLACE FUNCTION public.platform_credit_refund(_operation_id uuid, _amount integer, _reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rop uuid; a uuid; nm text;
BEGIN
  PERFORM public.platform_assert_admin();
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN RAISE EXCEPTION 'reason_required' USING ERRCODE='22023'; END IF;
  rop := public._credit_refund(_operation_id, _amount, _reason, auth.uid());
  SELECT o.agency_id, g.name INTO a, nm FROM credit_operations o JOIN agencies g ON g.id = o.agency_id WHERE o.id = rop;
  INSERT INTO platform_audit_logs(actor_user_id, action, target_type, target_id, target_label, metadata)
  VALUES (auth.uid(), 'credits_refunded', 'agency', a, nm,
    jsonb_build_object('agency_id', a, 'operation_id', rop, 'refund_of', _operation_id, 'amount', (SELECT amount FROM credit_operations WHERE id = rop), 'reason', _reason));
  RETURN rop;
END $$;

-- ===== Rechte =====
DO $$ DECLARE f text; BEGIN
  FOREACH f IN ARRAY ARRAY['_credit_default_order()','_credit_wallet(uuid)','_credit_open_lots(uuid)','_credit_available(uuid)',
    '_credit_debit(uuid,uuid,uuid,integer,text,text,uuid)','_credit_insert_grant(uuid,text,text,integer,timestamptz,text,text,text,text,text,uuid)',
    '_credit_refund(uuid,integer,text,uuid)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['credit_balance(uuid)','credit_balance_breakdown(uuid)','credit_can_consume(text)','credit_consume(text,text,uuid)',
    'platform_credit_adjust(uuid,integer,text,timestamptz,text)','platform_credit_refund(uuid,integer,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO authenticated, service_role', f);
  END LOOP;
  FOREACH f IN ARRAY ARRAY['credit_grant(uuid,text,text,integer,timestamptz,text,text,text,text)','credit_refund(uuid,integer,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;

-- ===== M5: subscriptions lesen nur aktive Firma, keine Plattform-Ausnahme =====
CREATE POLICY sec52_subscriptions_select ON public.subscriptions AS RESTRICTIVE FOR SELECT TO authenticated
  USING (agency_id IS NOT NULL AND public.is_agency_member(agency_id));
