import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { type StripeEnv, verifyWebhook } from "@/lib/stripe.server";

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  }
  return _supabase;
}

function resolvePriceId(item: any): string {
  return item?.price?.lookup_key || item?.price?.metadata?.lovable_external_id || item?.price?.id;
}

/**
 * Serverseitige, vertrauenswürdige Firmen-Zuordnung eines Stripe-Events.
 * Metadaten-agencyId wird nur akzeptiert, wenn der zahlende Benutzer dort
 * aktiver Inhaber/Admin ist. Sonst: seine einzige aktive Mitgliedschaft.
 */
async function resolveAgencyId(userId: string | undefined, claimedAgencyId?: string): Promise<string | null> {
  if (!userId) return null;
  const { data } = await (getSupabase() as any)
    .from("agency_memberships")
    .select("agency_id, role")
    .eq("user_id", userId)
    .eq("is_active", true);
  const rows = (data ?? []) as Array<{ agency_id: string; role: string }>;
  if (claimedAgencyId) {
    const ok = rows.some((r) => r.agency_id === claimedAgencyId && (r.role === "owner" || r.role === "admin"));
    if (ok) return claimedAgencyId;
    console.error("Stripe metadata agencyId rejected (no owner/admin membership)");
  }
  return rows.length === 1 ? rows[0].agency_id : null;
}

async function handleSubscriptionCreated(subscription: any, env: StripeEnv) {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    console.error("No userId in subscription metadata");
    return;
  }
  const agencyId = await resolveAgencyId(userId, subscription.metadata?.agencyId);
  const item = subscription.items?.data?.[0];
  const priceId = resolvePriceId(item);
  const productId = item?.price?.product;
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

  // Bestehende Zeile lesen, um neu vs. update zu unterscheiden
  const { data: prev } = await (getSupabase() as any)
    .from("subscriptions")
    .select("status")
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env)
    .maybeSingle();

  await (getSupabase() as any).from("subscriptions").upsert(
    {
      user_id: userId,
      agency_id: agencyId,
      stripe_subscription_id: subscription.id,
      stripe_customer_id: subscription.customer,
      product_id: productId,
      price_id: priceId,
      status: subscription.status,
      current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: subscription.cancel_at_period_end || false,
      environment: env,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" },
  );

  // Nur einmal benachrichtigen — beim ersten Aktivieren
  if (!prev && (subscription.status === "active" || subscription.status === "trialing")) {
    await notifySubscriptionActivated(agencyId, userId);
  }
}


async function handleSubscriptionUpdated(subscription: any, env: StripeEnv) {
  const item = subscription.items?.data?.[0];
  const priceId = resolvePriceId(item);
  const productId = item?.price?.product;
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

  // Vorherigen Status lesen, um nur bei Statuswechsel zu benachrichtigen
  const { data: prev } = await (getSupabase() as any)
    .from("subscriptions")
    .select("status, user_id, agency_id")
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env)
    .maybeSingle();

  await (getSupabase() as any)
    .from("subscriptions")
    .update({
      status: subscription.status,
      product_id: productId,
      price_id: priceId,
      current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      cancel_at_period_end: subscription.cancel_at_period_end || false,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env);

  // Benachrichtigung bei Eintritt in past_due / unpaid
  const dunningStatuses = new Set(["past_due", "unpaid"]);
  if (dunningStatuses.has(subscription.status) && !dunningStatuses.has(prev?.status ?? "")) {
    await notifyPaymentFailed(prev?.agency_id ?? null, prev?.user_id ?? null);
  }
  // Benachrichtigung wenn Zahlung wieder erfolgreich
  if (subscription.status === "active" && dunningStatuses.has(prev?.status ?? "")) {
    await notifyPaymentRecovered(prev?.agency_id ?? null, prev?.user_id ?? null);
  }
}

async function notifyPaymentFailed(agencyId: string | null, ownerUserId: string | null) {
  const sb = getSupabase() as any;
  const recipients = new Set<string>();

  // Inhaber der Agentur
  if (agencyId) {
    const { data: owners } = await sb
      .from("agency_memberships")
      .select("user_id")
      .eq("agency_id", agencyId)
      .eq("is_active", true)
      .eq("role", "owner");
    for (const o of owners ?? []) recipients.add(o.user_id);
  }
  if (ownerUserId) recipients.add(ownerUserId);

  // Superadmins (Systemowner)
  const { data: sas } = await sb
    .from("platform_admins")
    .select("user_id");
  for (const s of sas ?? []) recipients.add(s.user_id);

  for (const uid of recipients) {
    await sb.rpc("create_notification", {
      _user_id: uid,
      _type: "task",
      _title: "Immolia-Zahlung fehlgeschlagen",
      _message: "Die monatliche Abrechnung konnte nicht eingezogen werden. Bitte Zahlungsmethode aktualisieren.",
      _link: "/settings?tab=subscription",
      _related_type: "subscription",
      _related_id: null,
    });
  }
}

async function notifyPaymentRecovered(agencyId: string | null, ownerUserId: string | null) {
  await notifyOwners(agencyId, ownerUserId, false, {
    title: "Zahlung erfolgreich",
    message: "Deine Immolia-Zahlung wurde erfolgreich eingezogen. Vielen Dank.",
  });
}

async function notifySubscriptionActivated(agencyId: string | null, ownerUserId: string | null) {
  await notifyOwners(agencyId, ownerUserId, true, {
    title: "Immolia-Abonnement aktiviert",
    message: "Willkommen! Dein Abonnement ist jetzt aktiv und wird monatlich automatisch verlängert.",
  });
}

async function notifySubscriptionCanceled(agencyId: string | null, ownerUserId: string | null) {
  await notifyOwners(agencyId, ownerUserId, true, {
    title: "Abonnement gekündigt",
    message: "Dein Immolia-Abonnement wurde gekündigt. Du kannst jederzeit ein neues Abo abschliessen.",
  });
}

async function notifyOwners(
  agencyId: string | null,
  ownerUserId: string | null,
  includeSuperadmins: boolean,
  payload: { title: string; message: string },
) {
  const sb = getSupabase() as any;
  const recipients = new Set<string>();
  if (agencyId) {
    const { data: owners } = await sb
      .from("agency_memberships")
      .select("user_id")
      .eq("agency_id", agencyId)
      .eq("is_active", true)
      .eq("role", "owner");
    for (const o of owners ?? []) recipients.add(o.user_id);
  }
  if (ownerUserId) recipients.add(ownerUserId);
  if (includeSuperadmins) {
    const { data: sas } = await sb.from("platform_admins").select("user_id");
    for (const s of sas ?? []) recipients.add(s.user_id);
  }
  for (const uid of recipients) {
    await sb.rpc("create_notification", {
      _user_id: uid,
      _type: "task",
      _title: payload.title,
      _message: payload.message,
      _link: "/settings?tab=subscription",
      _related_type: "subscription",
      _related_id: null,
    });
  }
}

async function handleSubscriptionDeleted(subscription: any, env: StripeEnv) {
  const { data: prev } = await (getSupabase() as any)
    .from("subscriptions")
    .select("agency_id, user_id, status")
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env)
    .maybeSingle();

  await (getSupabase() as any)
    .from("subscriptions")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env);

  if (prev && prev.status !== "canceled") {
    await notifySubscriptionCanceled(prev.agency_id ?? null, prev.user_id ?? null);
  }
}


/** Firma eines Stripe-Kunden: nur aus der serverseitigen Zuordnung, nie aus dem Browser. */
async function agencyForCustomer(customerId: string | undefined, env: StripeEnv): Promise<string | null> {
  if (!customerId) return null;
  const { data } = await (getSupabase() as any)
    .from("stripe_customers")
    .select("agency_id")
    .eq("stripe_customer_id", customerId)
    .eq("environment", env)
    .maybeSingle();
  return data?.agency_id ?? null;
}

/** Immolia-Abo (Firmen-Kunde) → stripe_sync_subscription. Liefert false für Alt-Abos. */
async function syncImmoliaSubscription(subscription: any, env: StripeEnv): Promise<boolean> {
  const agencyId = await agencyForCustomer(subscription.customer, env);
  if (!agencyId) return false;
  const item = subscription.items?.data?.[0];
  const ps = item?.current_period_start ?? subscription.current_period_start;
  const pe = item?.current_period_end ?? subscription.current_period_end;
  const userId = subscription.metadata?.userId ?? null;
  const { error } = await (getSupabase() as any).rpc("stripe_sync_subscription", {
    _agency_id: agencyId,
    _user_id: userId,
    _stripe_subscription_id: subscription.id,
    _stripe_customer_id: subscription.customer,
    _product_id: typeof item?.price?.product === "string" ? item.price.product : item?.price?.product?.id ?? "",
    _price_key: resolvePriceId(item),
    _status: subscription.status,
    _period_start: ps ? new Date(ps * 1000).toISOString() : null,
    _period_end: pe ? new Date(pe * 1000).toISOString() : null,
    _cancel_at_period_end: !!subscription.cancel_at_period_end,
    _environment: env,
  });
  if (error) throw error;
  return true;
}

async function handleCheckoutCompleted(session: any, env: StripeEnv) {
  if (session.metadata?.kind !== "credit_topup") return;
  // Nur bestätigte Zahlung; asynchrone Methoden kommen über async_payment_succeeded
  if (session.payment_status !== "paid") return;
  const agencyId = await agencyForCustomer(session.customer, env);
  if (!agencyId || agencyId !== session.metadata?.agencyId) {
    console.error("Credit top-up: customer/agency mismatch", session.id);
    return;
  }
  const { error } = await (getSupabase() as any).rpc("stripe_grant_credit_purchase", {
    _agency_id: agencyId,
    _package_key: String(session.metadata?.packageKey ?? ""),
    _session_id: session.id,
  });
  if (error) throw error;
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = (await verifyWebhook(req, env)) as any;
  const sb = getSupabase() as any;
  if (event.id) {
    const { data: seen } = await sb.from("stripe_webhook_events").select("event_id").eq("event_id", event.id).maybeSingle();
    if (seen) return;
  }
  await dispatch(event, env);
  if (event.id) {
    await sb.from("stripe_webhook_events").upsert(
      { event_id: event.id, environment: env, event_type: event.type },
      { onConflict: "event_id", ignoreDuplicates: true },
    );
  }
}

async function dispatch(event: any, env: StripeEnv) {
  const obj = event.data.object;
  if (event.type.startsWith("customer.subscription.") && (await syncImmoliaSubscription(obj, env))) {
    if (event.type === "customer.subscription.deleted") {
      await (getSupabase() as any).from("subscriptions").update({ status: "canceled", updated_at: new Date().toISOString() })
        .eq("stripe_subscription_id", obj.id).eq("environment", env);
    }
    return;
  }
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
      await handleCheckoutCompleted(obj, env);
      break;
    case "invoice.paid":
    case "invoice.payment_failed": {
      // Abo-Status neu laden → Periode/Plan-Credits (idempotent) bzw. past_due
      const subId = obj.parent?.subscription_details?.subscription ?? obj.subscription;
      if (subId) {
        const { createStripeClient } = await import("@/lib/stripe.server");
        const sub = await createStripeClient(env).subscriptions.retrieve(String(subId));
        await syncImmoliaSubscription(sub, env);
      }
      break;
    }
    case "customer.subscription.created":
      await handleSubscriptionCreated(event.data.object, env);
      break;
    case "customer.subscription.updated":
      await handleSubscriptionUpdated(event.data.object, env);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object, env);
      break;
    default:
      console.log("Unhandled event:", event.type);
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          console.error("Webhook invalid env:", rawEnv);
          return Response.json({ received: true, ignored: "invalid env" });
        }
        try {
          await handleWebhook(request, rawEnv);
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
