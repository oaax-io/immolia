// Microsoft Graph Change Notifications (Subscriptions). Nur serverseitig.
import { GRAPH, msConfig, randomToken, sha256 } from "./ms-calendar.server";

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

// Outlook-Events erlauben max. 10080 Min; wir nutzen ~6 Tage und erneuern < 24 h vor Ablauf.
const SUB_LIFETIME_MIN = 60 * 24 * 6;

export function notificationUrl(): string | null {
  const cfg = msConfig();
  if (!cfg) return null;
  return `${new URL(cfg.redirectUri).origin}/api/public/ms-calendar/notifications`;
}

export async function ensureSubscription(admin: Admin, conn: any, token: string) {
  const url = notificationUrl();
  if (!url) return;
  const expiration = new Date(Date.now() + SUB_LIFETIME_MIN * 60_000).toISOString();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const resource = `/me/calendars/${conn.selected_calendar_id}/events`;
  // Bestehende Subscription verlängern, sofern sie zum gewählten Kalender gehört
  if (conn.subscription_id && conn.sync_metadata?.subscription_resource === resource) {
    const r = await fetch(`${GRAPH}/subscriptions/${encodeURIComponent(conn.subscription_id)}`, {
      method: "PATCH", headers, body: JSON.stringify({ expirationDateTime: expiration }),
    });
    if (r.ok) {
      await admin.from("calendar_connections").update({ subscription_expires_at: expiration } as never).eq("id", conn.id);
      return;
    }
    if (r.status !== 404) throw new Error(`sub_renew_${r.status}`);
  } else if (conn.subscription_id) {
    await removeSubscription(conn.subscription_id, token);
  }
  const clientState = randomToken(24);
  const r = await fetch(`${GRAPH}/subscriptions`, {
    method: "POST", headers,
    body: JSON.stringify({ changeType: "created,updated,deleted", notificationUrl: url, lifecycleNotificationUrl: url,
      resource, expirationDateTime: expiration, clientState }),
  });
  if (!r.ok) throw new Error(`sub_create_${r.status}`);
  const sub = await r.json();
  await admin.from("calendar_connections").update({
    subscription_id: sub.id, subscription_expires_at: sub.expirationDateTime ?? expiration,
    subscription_client_state_hash: sha256(clientState),
    sync_metadata: { ...(conn.sync_metadata ?? {}), subscription_resource: resource },
  } as never).eq("id", conn.id);
}

/** Bestmöglich entfernen – Fehler werden bewusst ignoriert. */
export async function removeSubscription(subscriptionId: string, token: string) {
  try {
    await fetch(`${GRAPH}/subscriptions/${encodeURIComponent(subscriptionId)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
  } catch { /* best effort */ }
}
