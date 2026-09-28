CREATE OR REPLACE FUNCTION public.agency_active_plan_id(_agency_id uuid)
 RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT s.plan_id FROM public.subscriptions s
  JOIN public.plans p ON p.id = s.plan_id AND p.status <> 'draft'
  WHERE s.agency_id = _agency_id AND s.plan_id IS NOT NULL
    AND ((s.status IN ('active','trialing') AND (s.current_period_end IS NULL OR s.current_period_end > now()))
      OR (s.status = 'past_due' AND (s.current_period_end IS NULL OR s.current_period_end > now())
          AND (s.past_due_since IS NULL OR s.past_due_since + make_interval(days => COALESCE((SELECT past_due_grace_days FROM public.platform_commercial_settings LIMIT 1),14)) >= now()))
      OR (s.status = 'canceled' AND s.current_period_end > now()))
  ORDER BY s.created_at DESC LIMIT 1;
$function$;