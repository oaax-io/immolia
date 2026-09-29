import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";

type Result<T> = T | { error: string };
const KEY_RE = /^[a-zA-Z0-9_-]+$/;

/** Firma immer serverseitig: aktive Firma des Aufrufers, nur Inhaber/Admin. */
async function resolveBillingAgency(supabase: any): Promise<string> {
  const { data: agencyId } = await supabase.rpc("current_agency_id");
  if (!agencyId) throw new Error("Keine aktive Firma ausgewählt");
  const { data: ok } = await supabase.rpc("is_agency_owner_or_admin", { _agency_id: agencyId });
  if (!ok) throw new Error("Nur Inhaber oder Admin können die Abrechnung verwalten");
  return agencyId as string;
}

/** Genau ein Stripe-Kunde pro Firma und Umgebung, gespeichert nur serverseitig. */
async function getOrCreateAgencyCustomer(
  stripe: ReturnType<typeof createStripeClient>,
  agencyId: string,
  env: StripeEnv,
  email?: string,
): Promise<string> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as any;
  const { data: row } = await admin
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("agency_id", agencyId)
    .eq("environment", env)
    .maybeSingle();
  if (row?.stripe_customer_id) return row.stripe_customer_id;

  const { data: agency } = await admin.from("agencies").select("name").eq("id", agencyId).maybeSingle();
  const created = await stripe.customers.create(
    {
      ...(email && { email }),
      ...(agency?.name && { name: agency.name }),
      metadata: { agencyId },
    },
    { idempotencyKey: `agency-customer:${agencyId}:${env}` },
  );
  const { error } = await admin
    .from("stripe_customers")
    .insert({ agency_id: agencyId, environment: env, stripe_customer_id: created.id });
  if (error) {
    // Gleichzeitiger Aufruf: vorhandenen Eintrag verwenden
    const { data: again } = await admin
      .from("stripe_customers")
      .select("stripe_customer_id")
      .eq("agency_id", agencyId)
      .eq("environment", env)
      .maybeSingle();
    if (again?.stripe_customer_id) return again.stripe_customer_id;
    throw error;
  }
  return created.id;
}

export const createPlanCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { planKey: string; returnUrl: string; environment: StripeEnv }) => {
    if (!KEY_RE.test(d.planKey)) throw new Error("Invalid plan");
    if (d.environment !== "sandbox" && d.environment !== "live") throw new Error("Invalid env");
    return d;
  })
  .handler(async ({ data, context }): Promise<Result<{ clientSecret: string }>> => {
    try {
      const supabase = context.supabase as any;
      const agencyId = await resolveBillingAgency(supabase);
      // Katalog ist nur für die Plattform lesbar: Preis serverseitig nach Firmenprüfung lesen
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: plan } = await (supabaseAdmin as any)
        .from("plans")
        .select("stripe_price_key, status, is_custom")
        .eq("key", data.planKey)
        .maybeSingle();
      if (!plan?.stripe_price_key || plan.status !== "active" || plan.is_custom) {
        return { error: "Dieser Plan kann nicht online abgeschlossen werden" };
      }
      // Keine doppelte Subscription
      const { data: existing } = await (supabaseAdmin as any)
        .from("subscriptions")
        .select("id")
        .eq("agency_id", agencyId)
        .eq("environment", data.environment)
        .eq("source", "stripe")
        .in("status", ["active", "trialing", "past_due", "incomplete"])
        .limit(1);
      if (existing?.length) {
        return { error: "Diese Firma hat bereits ein Abo. Planwechsel bitte über «Abo verwalten»." };
      }
      // Kein Stripe-Abo parallel zu einem laufenden manuellen Vertrag
      const { data: manual } = await (supabaseAdmin as any)
        .from("subscriptions")
        .select("id")
        .eq("agency_id", agencyId)
        .eq("source", "internal")
        .not("billing_source", "is", null)
        .in("status", ["active", "past_due"])
        .gt("current_period_end", new Date().toISOString())
        .limit(1);
      if (manual?.length) {
        return { error: "Dieses Abonnement wird direkt mit Immolia abgerechnet. Bitte wende dich an Immolia für Änderungen." };
      }

      const stripe = createStripeClient(data.environment);
      const prices = await stripe.prices.list({ lookup_keys: [plan.stripe_price_key] });
      if (!prices.data.length) return { error: "Preis nicht gefunden" };
      const { data: u } = await supabase.auth.getUser();
      const customer = await getOrCreateAgencyCustomer(stripe, agencyId, data.environment, u?.user?.email);
      const meta = { agencyId, userId: context.userId, kind: "subscription" };
      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: prices.data[0].id, quantity: 1 }],
        mode: "subscription",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer,
        metadata: meta,
        subscription_data: { metadata: meta },
      });
      return { clientSecret: session.client_secret ?? "" };
    } catch (e) {
      return { error: e instanceof Error && !(e as any).type ? e.message : getStripeErrorMessage(e) };
    }
  });

export const createCreditTopupCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { packageKey: string; returnUrl: string; environment: StripeEnv }) => {
    if (!KEY_RE.test(d.packageKey)) throw new Error("Invalid package");
    if (d.environment !== "sandbox" && d.environment !== "live") throw new Error("Invalid env");
    return d;
  })
  .handler(async ({ data, context }): Promise<Result<{ clientSecret: string }>> => {
    try {
      const supabase = context.supabase as any;
      const agencyId = await resolveBillingAgency(supabase);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: pkg } = await (supabaseAdmin as any)
        .from("credit_packages")
        .select("key, name, stripe_price_id, status")
        .eq("key", data.packageKey)
        .maybeSingle();
      if (!pkg?.stripe_price_id || pkg.status !== "active") return { error: "Paket nicht verfügbar" };

      const stripe = createStripeClient(data.environment);
      const prices = await stripe.prices.list({ lookup_keys: [pkg.stripe_price_id] });
      if (!prices.data.length) return { error: "Preis nicht gefunden" };
      const { data: u } = await supabase.auth.getUser();
      const customer = await getOrCreateAgencyCustomer(stripe, agencyId, data.environment, u?.user?.email);
      // Eigener Einmal-Checkout: ändert das Abo nie
      const session = await stripe.checkout.sessions.create({
        line_items: [{ price: prices.data[0].id, quantity: 1 }],
        mode: "payment",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        customer,
        payment_intent_data: { description: pkg.name },
        metadata: { agencyId, userId: context.userId, kind: "credit_topup", packageKey: pkg.key },
      });
      return { clientSecret: session.client_secret ?? "" };
    } catch (e) {
      return { error: e instanceof Error && !(e as any).type ? e.message : getStripeErrorMessage(e) };
    }
  });

export const createAgencyPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { returnUrl?: string; environment: StripeEnv }) => {
    if (d.environment !== "sandbox" && d.environment !== "live") throw new Error("Invalid env");
    return d;
  })
  .handler(async ({ data, context }): Promise<Result<{ url: string }>> => {
    try {
      const agencyId = await resolveBillingAgency(context.supabase as any);
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: row } = await (supabaseAdmin as any)
        .from("stripe_customers")
        .select("stripe_customer_id")
        .eq("agency_id", agencyId)
        .eq("environment", data.environment)
        .maybeSingle();
      if (!row?.stripe_customer_id) return { error: "Noch keine Zahlungsdaten für diese Firma" };
      const stripe = createStripeClient(data.environment);
      const portal = await stripe.billingPortal.sessions.create({
        customer: row.stripe_customer_id,
        ...(data.returnUrl && { return_url: data.returnUrl }),
      });
      return { url: portal.url };
    } catch (e) {
      return { error: e instanceof Error && !(e as any).type ? e.message : getStripeErrorMessage(e) };
    }
  });
