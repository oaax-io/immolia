-- 5.9 Härtung: Abrechnungs-/Credit-Tabellen sind für Browser-Rollen nur lesbar (RLS entscheidet weiterhin, welche Zeilen)
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON
  public.plans, public.plan_limits, public.plan_entitlements, public.subscriptions, public.usage_meters,
  public.usage_events, public.usage_event_voids, public.credit_wallets, public.credit_ledger, public.credit_operations,
  public.credit_reservations, public.credit_packages, public.credit_action_costs, public.recurring_credit_resources,
  public.recurring_credit_charges, public.agency_addons, public.addons, public.stripe_customers, public.stripe_webhook_events,
  public.subscription_admin_notes, public.agency_trials, public.platform_commercial_settings
FROM anon, authenticated;
REVOKE SELECT ON
  public.plans, public.plan_limits, public.plan_entitlements, public.subscriptions,
  public.usage_events, public.usage_event_voids, public.credit_wallets, public.credit_ledger, public.credit_operations,
  public.credit_reservations, public.credit_packages, public.credit_action_costs, public.recurring_credit_resources,
  public.recurring_credit_charges, public.agency_addons, public.addons, public.stripe_customers, public.stripe_webhook_events,
  public.subscription_admin_notes, public.agency_trials, public.platform_commercial_settings
FROM anon;