CREATE OR REPLACE FUNCTION public.tenant_billing_catalog()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_agency_id() IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;
  RETURN jsonb_build_object(
    'plans', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id',p.id,'key',p.key,'name',p.name,'description',p.description,'price_monthly',p.price_monthly,'price_yearly',p.price_yearly,
        'currency',p.currency,'monthly_credits',p.monthly_credits,'is_custom',p.is_custom,'checkout_available',p.stripe_price_key IS NOT NULL,
        'limits',COALESCE((SELECT jsonb_agg(jsonb_build_object('key',l.limit_key,'value',l.limit_value,'unlimited',l.is_unlimited,'policy',l.policy,'unit',l.unit) ORDER BY l.limit_key)
                  FROM plan_limits l WHERE l.plan_id=p.id),'[]'::jsonb)) ORDER BY p.sort_order)
      FROM plans p WHERE p.status='active' AND COALESCE(p.is_public,true)),'[]'::jsonb),
    'packages', COALESCE((SELECT jsonb_agg(jsonb_build_object('key',k.key,'name',k.name,'credits',k.credits,'price_amount',k.price_amount,'currency',k.currency) ORDER BY k.sort_order)
      FROM credit_packages k WHERE k.status='active'),'[]'::jsonb),
    'action_costs', COALESCE((SELECT jsonb_agg(jsonb_build_object('key',c.action_key,'name',c.name,'description',c.description,'category',c.category,'credit_cost',c.credit_cost) ORDER BY c.category,c.name)
      FROM credit_action_costs c WHERE c.active AND c.credit_cost > 0),'[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION public.tenant_billing_catalog() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_billing_catalog() TO authenticated;