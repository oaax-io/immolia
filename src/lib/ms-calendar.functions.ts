// Microsoft 365 Kalender – Server-Funktionen (persönlich, firmenbezogen).
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { GENERIC_APP_HOST } from "@/lib/workspaces";

export type MsCalendarState =
  | "not_connected" | "connecting" | "configuration_required" | "connected" | "syncing"
  | "reconnect_required" | "admin_approval_required" | "error" | "disconnected";

const PROJECT_HOST_SUFFIX = "4e795f2c-5909-4255-a6b0-36cc8098ec55.lovable.app";

type Ctx = { supabase: any; userId: string };

async function activeAgency(ctx: Ctx): Promise<string> {
  const { data: agencyId } = await ctx.supabase.rpc("current_agency_id");
  if (!agencyId) throw new Error("Keine aktive Firma ausgewählt.");
  const { data: member } = await ctx.supabase.rpc("is_agency_member", { _agency_id: agencyId });
  const { data: mod } = await ctx.supabase.rpc("agency_module_enabled_for", { _agency_id: agencyId, _module: "appointments" });
  if (!member || !mod) throw new Error("Kein Zugriff auf den Kalender dieser Firma.");
  return agencyId as string;
}

async function ownConnection(agencyId: string, userId: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("calendar_connections").select("*")
    .eq("agency_id", agencyId).eq("user_id", userId).eq("provider", "microsoft").maybeSingle();
  return { admin: supabaseAdmin, conn: data as any };
}

function mapState(conn: any, configured: boolean): MsCalendarState {
  if (!configured) return "configuration_required";
  if (!conn) return "not_connected";
  switch (conn.status) {
    case "connected": return conn.selected_calendar_id ? "connected" : "connecting";
    case "syncing": return "syncing";
    case "pending": case "connecting": return "connecting";
    case "needs_reauth": case "reconnect_required": case "membership_revoked": return "reconnect_required";
    case "admin_approval_required": return "admin_approval_required";
    case "disconnected": return "disconnected";
    default: return "error";
  }
}

export const getMsCalendarStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { msConfig } = await import("./ms-calendar.server");
    const agencyId = await activeAgency(context as Ctx);
    const { conn } = await ownConnection(agencyId, (context as Ctx).userId);
    let state = mapState(conn, !!msConfig());
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: ag } = await supabaseAdmin.from("agencies").select("name").eq("id", agencyId).maybeSingle();
    let pendingJob = false;
    if (conn) {
      const { count } = await supabaseAdmin.from("calendar_sync_jobs").select("id", { count: "exact", head: true })
        .eq("connection_id", conn.id).in("status", ["queued", "running"]);
      pendingJob = (count ?? 0) > 0;
      if (state === "connected" && pendingJob) state = "syncing";
    }
    const meta = (conn?.sync_metadata ?? {}) as Record<string, unknown>;
    // Synchronisationszustand getrennt von der Verbindung auswerten
    let lastJob: any = null; let lastSuccessAt: string | null = null; let runningJob = false;
    if (conn) {
      const { data: j } = await supabaseAdmin.from("calendar_sync_jobs").select("status, error_code, finished_at, job_type")
        .eq("connection_id", conn.id).in("status", ["succeeded", "failed"]).in("job_type", ["initial", "delta", "push_appointment", "delete_appointment", "ensure_subscription"])
        .order("finished_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      lastJob = j;
      const { count: r } = await supabaseAdmin.from("calendar_sync_jobs").select("id", { count: "exact", head: true }).eq("connection_id", conn.id).eq("status", "running");
      runningJob = (r ?? 0) > 0;
      lastSuccessAt = conn.last_synced_at ?? null;
    }
    const syncState: "never" | "running" | "ok" | "failed" | "retrying" =
      runningJob ? "running" : lastJob?.status === "failed" ? "failed"
      : conn?.last_error_code === "sync_failed" || conn?.last_error_code === "token_refresh_transient" ? "retrying"
      : lastSuccessAt ? "ok" : "never";
    return {
      syncState,
      lastFailedAt: lastJob?.status === "failed" ? lastJob.finished_at : null,
      liveUpdates: !!(conn?.subscription_id && conn?.subscription_expires_at && new Date(conn.subscription_expires_at) > new Date()),
      agencyName: (ag as any)?.name ?? null,
      pendingJob,
      pushToOutlook: meta.push_to_outlook !== false,
      showBusy: meta.show_busy !== false,
      state,
      account: conn?.account_display ?? null,
      calendarId: conn?.selected_calendar_id ?? null,
      calendarName: conn?.selected_calendar_name ?? null,
      lastSyncedAt: conn?.last_synced_at ?? null,
      lastErrorCode: conn?.last_error_code ?? null,
    };
  });

async function allowedReturnHost(agencyId: string): Promise<string> {
  const host = (getRequestHeader("x-forwarded-host") || getRequestHeader("host") || "").split(",")[0].trim().toLowerCase();
  if (host === GENERIC_APP_HOST || host.endsWith(PROJECT_HOST_SUFFIX)) return host;
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("tenant_domains").select("domain, verification_status, activated_at")
    .eq("agency_id", agencyId).eq("domain", host).maybeSingle();
  if (data && (data.activated_at || data.verification_status === "verified")) return host;
  return GENERIC_APP_HOST;
}

export const startMsConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ reconnect: z.boolean().optional(), returnTo: z.enum(["calendar", "settings"]).optional() }).parse(d ?? {}))
  .handler(async ({ context, data }) => {
    const s = await import("./ms-calendar.server");
    const cfg = s.msConfig();
    if (!cfg) return { state: "configuration_required" as const, url: null };
    const ctx = context as Ctx;
    const agencyId = await activeAgency(ctx);
    const returnHost = await allowedReturnHost(agencyId);
    const state = s.randomToken(32);
    const verifier = s.randomToken(48);
    const nonce = s.randomToken(24);
    const challenge = s.b64url((await import("node:crypto")).createHash("sha256").update(verifier).digest());
    const { admin, conn } = await ownConnection(agencyId, ctx.userId);
    await admin.from("calendar_oauth_attempts").delete().lt("expires_at", new Date().toISOString());
    const { error } = await admin.from("calendar_oauth_attempts").insert({
      state_hash: s.sha256(state), agency_id: agencyId, user_id: ctx.userId, provider: "microsoft",
      code_verifier_ct: s.encrypt(verifier, cfg.encKey), nonce_hash: s.sha256(nonce),
      return_host: returnHost, return_path: data.returnTo === "calendar" ? "/appointments" : "/settings/calendar",
    } as never);
    if (error) throw new Error("Verbindung konnte nicht gestartet werden.");
    if (conn && conn.status !== "connected") {
      await admin.from("calendar_connections").update({ status: "connecting" } as never).eq("id", conn.id);
    }
    return { state: "connecting" as const, url: s.buildAuthorizeUrl(cfg, state, challenge, nonce, data.reconnect ? "select_account" : undefined) };
  });

export const listMsCalendars = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const s = await import("./ms-calendar.server");
    const agencyId = await activeAgency(context as Ctx);
    const { admin, conn } = await ownConnection(agencyId, (context as Ctx).userId);
    if (!conn) throw new Error("Nicht verbunden.");
    const token = await s.getAccessToken(admin, conn.id);
    const r = await s.graphGet<{ value: any[] }>(token, "/me/calendars?$select=id,name,canEdit,isDefaultCalendar,owner&$top=100");
    return r.value.filter((c) => c.canEdit).map((c) => ({ id: String(c.id), name: String(c.name), isDefault: !!c.isDefaultCalendar }));
  });

export const saveMsCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ calendarId: z.string().min(1).max(512), pushToOutlook: z.boolean().optional(), showBusy: z.boolean().optional() }).parse(d))
  .handler(async ({ context, data }) => {
    const s = await import("./ms-calendar.server");
    const agencyId = await activeAgency(context as Ctx);
    const { admin, conn } = await ownConnection(agencyId, (context as Ctx).userId);
    if (!conn) throw new Error("Nicht verbunden.");
    const token = await s.getAccessToken(admin, conn.id);
    const cal = await s.graphGet<any>(token, `/me/calendars/${encodeURIComponent(data.calendarId)}?$select=id,name,canEdit`);
    if (!cal?.canEdit) throw new Error("Dieser Kalender ist nicht beschreibbar.");
    if (conn.selected_calendar_id && conn.selected_calendar_id !== cal.id) {
      // Kalenderwechsel: alte Zuordnungen lösen (Termine bleiben im alten Kalender und im CRM; keine Löschungen, keine Duplikate)
      await admin.from("calendar_sync_jobs").update({ status: "canceled", finished_at: new Date().toISOString() } as never).eq("connection_id", conn.id).eq("status", "queued");
      await admin.from("calendar_event_links").update({ appointment_id: null, deleted_at: new Date().toISOString(), conflict_state: null } as never).eq("connection_id", conn.id).is("deleted_at", null);
      await admin.from("calendar_busy_blocks").delete().eq("connection_id", conn.id);
    }
    const { error } = await admin.from("calendar_connections").update({
      selected_calendar_id: cal.id, selected_calendar_name: cal.name, status: "connected",
      sync_enabled: true, delta_link: null, last_error_code: null, updated_at: new Date().toISOString(),
      sync_direction: data.pushToOutlook === false ? "microsoft_to_immolia" : data.showBusy === false ? "immolia_to_microsoft" : "two_way",
      sync_metadata: { ...(conn.sync_metadata ?? {}), push_to_outlook: data.pushToOutlook !== false, show_busy: data.showBusy !== false },
    } as never).eq("id", conn.id);
    if (error) throw new Error("Auswahl konnte nicht gespeichert werden.");
    await admin.from("calendar_sync_jobs").upsert({ agency_id: agencyId, connection_id: conn.id, job_type: "initial",
      idempotency_key: `initial:${cal.id}:${Date.now()}` } as never, { onConflict: "connection_id,idempotency_key" });
    await admin.from("calendar_sync_jobs").insert({ agency_id: agencyId, connection_id: conn.id, job_type: "ensure_subscription",
      idempotency_key: `sub:save:${Date.now()}` } as never);
    return { ok: true };
  });

export const disconnectMs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const agencyId = await activeAgency(context as Ctx);
    const { admin, conn } = await ownConnection(agencyId, (context as Ctx).userId);
    if (!conn) return { ok: true };
    // 1) Sofort stoppen: laufende Jobs prüfen den Status vor jedem Graph-Schreibzugriff
    await admin.from("calendar_connections").update({ status: "disconnected", sync_enabled: false, updated_at: new Date().toISOString() } as never).eq("id", conn.id);
    await admin.from("calendar_sync_jobs").update({ status: "canceled", finished_at: new Date().toISOString() } as never)
      .eq("connection_id", conn.id).in("status", ["queued", "running"]);
    // 2) Microsoft-Subscription bestmöglich entfernen (solange Token noch vorhanden)
    if (conn.subscription_id) {
      try {
        const s = await import("./ms-calendar.server");
        const { removeSubscription } = await import("./ms-calendar-subscriptions.server");
        await removeSubscription(conn.subscription_id, await s.getAccessToken(admin, conn.id));
      } catch { /* best effort */ }
    }
    // 3) Tokens, OAuth-Zwischendaten und persönliche Belegungen löschen; CRM- und Outlook-Termine bleiben,
    //    minimale Zuordnungen (calendar_event_links) bleiben für duplikatfreie Wiederverbindung.
    await admin.from("calendar_connection_tokens").delete().eq("connection_id", conn.id);
    await admin.from("calendar_oauth_attempts").delete().eq("agency_id", agencyId).eq("user_id", (context as Ctx).userId);
    await admin.from("calendar_busy_blocks").delete().eq("connection_id", conn.id);
    await admin.from("calendar_connections").update({
      delta_link: null, subscription_id: null, subscription_expires_at: null, subscription_client_state_hash: null,
    } as never).eq("id", conn.id);
    return { ok: true };
  });

export const syncMsNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const agencyId = await activeAgency(context as Ctx);
    const { admin, conn } = await ownConnection(agencyId, (context as Ctx).userId);
    if (!conn || conn.status !== "connected" || !conn.selected_calendar_id) throw new Error("Keine aktive Verbindung.");
    const { count } = await admin.from("calendar_sync_jobs").select("id", { count: "exact", head: true })
      .eq("connection_id", conn.id).in("status", ["queued", "running"]);
    if ((count ?? 0) > 0) return { queued: false };
    await admin.from("calendar_sync_jobs").insert({ agency_id: agencyId, connection_id: conn.id, job_type: "delta",
      idempotency_key: `manual:${Date.now()}` } as never);
    return { queued: true };
  });

export const listMsConflicts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const agencyId = await activeAgency(context as Ctx);
    const { admin, conn } = await ownConnection(agencyId, (context as Ctx).userId);
    if (!conn) return [];
    const { data } = await admin.from("calendar_event_links").select("id, appointment_id, conflict_payload, conflict_at, last_synced_state")
      .eq("connection_id", conn.id).eq("conflict_state", "open").limit(50);
    const ids = (data ?? []).map((l: any) => l.appointment_id).filter(Boolean);
    const { data: appts } = ids.length ? await admin.from("appointments").select("id, title, starts_at, ends_at, location").in("id", ids).eq("agency_id", agencyId) : { data: [] as any[] };
    return (data ?? []).map((l: any) => {
      const a = (appts ?? []).find((x: any) => x.id === l.appointment_id);
      const r = (l.conflict_payload as any)?.remote ?? null;
      return { id: l.id as string, local: a ? { title: a.title, starts_at: a.starts_at, ends_at: a.ends_at, location: a.location } : null,
        remote: r ? { title: r.title, starts_at: r.starts_at, ends_at: r.ends_at, location: r.location } : null };
    }).filter((c) => c.local);
  });

export const resolveMsConflict = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ linkId: z.string().uuid(), keep: z.enum(["local", "remote"]) }).parse(d))
  .handler(async ({ context, data }) => {
    const agencyId = await activeAgency(context as Ctx);
    const { admin, conn } = await ownConnection(agencyId, (context as Ctx).userId);
    if (!conn) throw new Error("Nicht verbunden.");
    const { data: link } = await admin.from("calendar_event_links").select("id").eq("id", data.linkId).eq("connection_id", conn.id).eq("conflict_state", "open").maybeSingle();
    if (!link) throw new Error("Konflikt nicht gefunden.");
    await admin.from("calendar_sync_jobs").insert({ agency_id: agencyId, connection_id: conn.id, job_type: "resolve_conflict",
      link_id: data.linkId, idempotency_key: `resolve:${data.keep}:${data.linkId}:${Date.now()}` } as never);
    return { ok: true };
  });
