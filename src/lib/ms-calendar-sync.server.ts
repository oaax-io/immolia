// Microsoft-Kalender-Synchronisation (Hintergrund-Worker). Nur serverseitig.
import { createHash } from "node:crypto";
import { GRAPH, getAccessToken, MsTokenError } from "./ms-calendar.server";

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];
const ORIGIN_PROP = "String {6f1c3a52-6d2b-4a53-9a55-5f1e2b8c7d10} Name ImmoliaOriginAgency";
const WINDOW_BACK_DAYS = 30;
const WINDOW_FWD_DAYS = 365;
const WINDOW_RENEW_DAYS = 7;

// Schreibschutz: vor jedem Graph-Schreibzugriff prüfen, ob die Verbindung noch aktiv ist (Trennen während laufendem Job).
const writeGuard = new Map<string, { admin: Admin; connId: string }>();
class ConnectionStopped extends Error { constructor() { super("connection_stopped"); } }

export class RetryLater extends Error { constructor(public seconds: number, msg: string) { super(msg); } }

async function graph(token: string, method: string, url: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const g = method !== "GET" ? writeGuard.get(token) : undefined;
  if (g) {
    const { data } = await g.admin.from("calendar_connections").select("status, sync_enabled").eq("id", g.connId).maybeSingle();
    if (!data || (data as any).status !== "connected" || !(data as any).sync_enabled) throw new ConnectionStopped();
  }
  const res = await fetch(url.startsWith("http") ? url : `${GRAPH}${url}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Prefer: 'IdType="ImmutableId", outlook.timezone="UTC"',
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 429 || res.status === 503 || res.status === 504) {
    throw new RetryLater(Number(res.headers.get("Retry-After") ?? 30) || 30, `graph_${res.status}`);
  }
  return res;
}

const localHash = (a: any) => createHash("sha256").update([a.title, a.starts_at && new Date(a.starts_at).toISOString(), a.ends_at && new Date(a.ends_at).toISOString(), a.location ?? "", a.status].join("|")).digest("hex");
const utc = (d: string) => (d.endsWith("Z") || /[+-]\d\d:\d\d$/.test(d) ? d : `${d}Z`);

function eventBody(a: any, agencyId: string, txId?: string) {
  const start = new Date(a.starts_at);
  const end = a.ends_at ? new Date(a.ends_at) : new Date(start.getTime() + 3600_000);
  const cancelled = a.status === "cancelled";
  return {
    subject: `${cancelled ? "Abgesagt: " : ""}${a.title}`,
    start: { dateTime: start.toISOString().replace("Z", ""), timeZone: "UTC" },
    end: { dateTime: end.toISOString().replace("Z", ""), timeZone: "UTC" },
    location: { displayName: a.location ?? "" },
    // Bewusst keine Notizen, Kunden- oder Finanzierungsdaten
    body: { contentType: "text", content: "Termin aus Immolia" },
    showAs: cancelled ? "free" : "busy",
    isReminderOn: !cancelled,
    ...(txId ? { transactionId: txId } : {}),
    singleValueExtendedProperties: [{ id: ORIGIN_PROP, value: agencyId }],
  };
}

async function canSync(admin: Admin, conn: any, a: any) {
  if (!a || a.agency_id !== conn.agency_id) return false;
  const involved = a.owner_id === conn.user_id || a.assigned_to === conn.user_id || (a.extra_assignee_ids ?? []).includes(conn.user_id);
  if (!involved) return false;
  const { data } = await admin.rpc("calendar_membership_active", { _agency_id: conn.agency_id, _user_id: conn.user_id });
  return !!data;
}

async function pushAppointment(admin: Admin, conn: any, token: string, appointmentId: string) {
  const { data: a } = await admin.from("appointments").select("*").eq("id", appointmentId).maybeSingle();
  const { data: link } = await admin.from("calendar_event_links").select("*").eq("connection_id", conn.id).eq("appointment_id", appointmentId).maybeSingle();
  if (!(await canSync(admin, conn, a))) {
    // Nicht (mehr) berechtigt → vorhandenes Abbild entfernen, CRM bleibt unberührt
    if (link && !link.deleted_at) {
      await graph(token, "DELETE", `/me/events/${encodeURIComponent(link.provider_event_id)}`);
      await admin.from("calendar_event_links").update({ deleted_at: new Date().toISOString(), appointment_id: null } as never).eq("id", link.id);
    }
    return;
  }
  if (!a) return;
  const h = localHash(a);
  if (link && link.last_local_hash === h && !link.deleted_at) return; // unverändert (auch Echo eigener Übernahmen)
  if (link?.conflict_state === "open") return;
  if (link && !link.deleted_at) {
    const cur = await graph(token, "GET", `/me/events/${encodeURIComponent(link.provider_event_id)}?$select=id,changeKey`);
    if (cur.ok) {
      const ev = await cur.json();
      if (link.last_remote_change_key && ev.changeKey !== link.last_remote_change_key) {
        await admin.from("calendar_event_links").update({ conflict_state: "open", conflict_at: new Date().toISOString(),
          conflict_payload: { reason: "both_changed" } } as never).eq("id", link.id);
        return;
      }
      const res = await graph(token, "PATCH", `/me/events/${encodeURIComponent(link.provider_event_id)}`, eventBody(a, conn.agency_id));
      if (!res.ok) throw new Error(`patch_${res.status}`);
      const upd = await res.json();
      await admin.from("calendar_event_links").update({ last_local_hash: h, last_remote_change_key: upd.changeKey,
        last_synced_at: new Date().toISOString(), last_synced_state: snapshot(a) } as never).eq("id", link.id);
      return;
    }
    if (cur.status !== 404) throw new Error(`get_${cur.status}`);
    // In Outlook gelöscht → gleiche Regel wie beim Delta: Termin nicht neu anlegen
    return;
  }
  // Neuanlage mit stabiler transactionId (verhindert Duplikate bei Wiederholung)
  const txId = createHash("sha256").update(`${conn.id}:${a.id}`).digest("hex").slice(0, 36);
  const res = await graph(token, "POST", `/me/calendars/${encodeURIComponent(conn.selected_calendar_id)}/events`, eventBody(a, conn.agency_id, txId));
  if (!res.ok) throw new Error(`create_${res.status}`);
  const ev = await res.json();
  await admin.from("calendar_event_links").upsert({
    agency_id: conn.agency_id, connection_id: conn.id, appointment_id: a.id, provider_event_id: ev.id, ical_uid: ev.iCalUId,
    origin: "immolia", origin_agency_id: conn.agency_id, change_key: ev.changeKey, last_remote_change_key: ev.changeKey,
    last_local_hash: h, transaction_id: txId, last_synced_at: new Date().toISOString(), last_synced_state: snapshot(a), deleted_at: null,
  } as never, { onConflict: "connection_id,provider_event_id" });
}

const snapshot = (a: any) => ({ title: a.title, starts_at: a.starts_at, ends_at: a.ends_at, location: a.location, status: a.status });

async function deleteRemote(admin: Admin, token: string, linkId: string) {
  const { data: link } = await admin.from("calendar_event_links").select("*").eq("id", linkId).maybeSingle();
  if (!link || link.deleted_at || link.origin !== "immolia") return; // fremde Outlook-Termine nie löschen
  const res = await graph(token, "DELETE", `/me/events/${encodeURIComponent(link.provider_event_id)}`);
  if (!res.ok && res.status !== 404) throw new Error(`delete_${res.status}`);
  await admin.from("calendar_event_links").update({ deleted_at: new Date().toISOString() } as never).eq("id", link.id);
}

async function deltaSync(admin: Admin, conn: any, token: string, initial: boolean) {
  const meta = (conn.sync_metadata ?? {}) as Record<string, any>;
  const showBusy = meta.show_busy !== false;
  let windowStart = meta.window_start ? new Date(meta.window_start) : null;
  let url: string | null = conn.delta_link;
  if (!url || !windowStart || Date.now() - windowStart.getTime() > (WINDOW_BACK_DAYS + WINDOW_RENEW_DAYS) * 86400_000) {
    // (Neu-)Abgleich mit fortgeschriebenem Fenster; Zuordnungen verhindern Duplikate
    windowStart = new Date(Date.now() - WINDOW_BACK_DAYS * 86400_000);
    const end = new Date(Date.now() + WINDOW_FWD_DAYS * 86400_000);
    url = `${GRAPH}/me/calendars/${encodeURIComponent(conn.selected_calendar_id)}/calendarView/delta?startDateTime=${windowStart.toISOString()}&endDateTime=${end.toISOString()}`;
    initial = true;
  }
  const seenBusy = new Set<string>();
  let deltaLink: string | null = null;
  for (let page = 0; url && page < 200; page++) {
    const res = await graph(token, "GET", url, undefined, { Prefer: 'IdType="ImmutableId", outlook.timezone="UTC", odata.maxpagesize=100' });
    if (res.status === 410 || res.status === 400) {
      const txt = await res.text();
      if (res.status === 410 || /syncStateNotFound|resyncRequired|SyncStateInvalid/i.test(txt)) {
        await admin.from("calendar_connections").update({ delta_link: null } as never).eq("id", conn.id);
        throw new RetryLater(1, "delta_reset");
      }
      throw new Error(`delta_${res.status}`);
    }
    if (!res.ok) throw new Error(`delta_${res.status}`);
    const j = await res.json();
    for (const ev of j.value ?? []) await applyRemote(admin, conn, token, ev, showBusy, seenBusy);
    url = j["@odata.nextLink"] ?? null;
    deltaLink = j["@odata.deltaLink"] ?? deltaLink;
  }
  if (initial) {
    // Busy-Blöcke, die im neuen Vollabgleich nicht mehr vorkommen, entfernen (keine CRM-Daten betroffen)
    const { data: blocks } = await admin.from("calendar_busy_blocks").select("id, provider_event_id").eq("connection_id", conn.id);
    const stale = (blocks ?? []).filter((b: any) => !seenBusy.has(b.provider_event_id)).map((b: any) => b.id);
    if (stale.length) await admin.from("calendar_busy_blocks").delete().in("id", stale);
    // Eigene Termine im Fenster einmalig exportieren (Trigger-unabhängig)
    const { data: appts } = await admin.from("appointments").select("id")
      .eq("agency_id", conn.agency_id).gte("starts_at", windowStart.toISOString())
      .or(`owner_id.eq.${conn.user_id},assigned_to.eq.${conn.user_id},extra_assignee_ids.cs.{${conn.user_id}}`).limit(1000);
    if (meta.push_to_outlook !== false) for (const a of appts ?? []) await pushAppointment(admin, conn, token, a.id);
  }
  await admin.from("calendar_connections").update({
    delta_link: deltaLink, sync_metadata: { ...meta, window_start: windowStart.toISOString() },
    last_synced_at: new Date().toISOString(), last_error_code: null, status: "connected",
  } as never).eq("id", conn.id);
}

async function applyRemote(admin: Admin, conn: any, token: string, ev: any, showBusy: boolean, seen: Set<string>) {
  const { data: link } = await admin.from("calendar_event_links").select("*").eq("connection_id", conn.id).eq("provider_event_id", ev.id).maybeSingle();
  if (ev["@removed"]) {
    await admin.from("calendar_busy_blocks").delete().eq("connection_id", conn.id).eq("provider_event_id", ev.id);
    // Nur echte Löschungen verarbeiten, nicht "ausserhalb des Fensters"
    if (ev["@removed"].reason !== "deleted" || !link || link.origin !== "immolia" || link.deleted_at) return;
    const cur = await graph(token, "GET", `/me/events/${encodeURIComponent(ev.id)}?$select=id`);
    if (cur.status !== 404) return;
    await admin.from("calendar_event_links").update({ deleted_at: new Date().toISOString() } as never).eq("id", link.id);
    if (link.appointment_id) {
      await admin.from("appointments").update({ status: "cancelled" } as never).eq("id", link.appointment_id).eq("agency_id", conn.agency_id);
      const { data: a } = await admin.from("appointments").select("*").eq("id", link.appointment_id ?? "").maybeSingle();
      if (a) await admin.from("calendar_event_links").update({ last_local_hash: localHash(a) } as never).eq("id", link.id);
      await admin.from("activity_logs").insert({ agency_id: conn.agency_id, actor_id: conn.user_id, related_type: "appointment",
        related_id: link.appointment_id, action: "calendar_cancelled_in_outlook", metadata: { source: "microsoft_365" } } as never).then(() => undefined, () => undefined);
    }
    return;
  }
  // Immolia-Exporte anderer Firmen ignorieren
  const originAgency = (ev.singleValueExtendedProperties ?? []).find((p: any) => p.id?.toLowerCase() === ORIGIN_PROP.toLowerCase())?.value;
  if (originAgency && originAgency !== conn.agency_id) return;

  if (link && link.origin === "immolia") {
    if (link.deleted_at || ev.changeKey === link.last_remote_change_key || link.conflict_state === "open") return;
    const { data: a } = await admin.from("appointments").select("*").eq("id", link.appointment_id ?? "").maybeSingle();
    if (!a) return;
    const remote = {
      title: String(ev.subject ?? "").replace(/^Abgesagt: /, ""),
      starts_at: utc(ev.start.dateTime), ends_at: utc(ev.end.dateTime), location: ev.location?.displayName || null,
    };
    if (localHash(a) !== link.last_local_hash) {
      await admin.from("calendar_event_links").update({ conflict_state: "open", conflict_at: new Date().toISOString(),
        conflict_payload: { reason: "both_changed", remote } } as never).eq("id", link.id);
      return;
    }
    if (ev.attendees?.length && ev.isOrganizer === false) return; // fremde Besprechung: nie zurückschreiben
    await admin.from("appointments").update(remote as never).eq("id", a.id).eq("agency_id", conn.agency_id);
    const next = { ...a, ...remote };
    await admin.from("calendar_event_links").update({ last_local_hash: localHash(next), last_remote_change_key: ev.changeKey,
      change_key: ev.changeKey, last_synced_at: new Date().toISOString(), last_synced_state: snapshot(next) } as never).eq("id", link.id);
    return;
  }
  // Fremder Outlook-Termin → nur Belegung (keine Inhalte)
  if (!showBusy || ev.isCancelled || ev.showAs === "free") {
    await admin.from("calendar_busy_blocks").delete().eq("connection_id", conn.id).eq("provider_event_id", ev.id);
    return;
  }
  if (!ev.start?.dateTime) return;
  seen.add(ev.id);
  await admin.from("calendar_busy_blocks").upsert({
    agency_id: conn.agency_id, user_id: conn.user_id, connection_id: conn.id, provider_event_id: ev.id,
    starts_at: utc(ev.start.dateTime), ends_at: utc(ev.end.dateTime), is_all_day: !!ev.isAllDay, show_as: ev.showAs ?? "busy",
    updated_at: new Date().toISOString(),
  } as never, { onConflict: "connection_id,provider_event_id" });
}

async function resolveConflict(admin: Admin, conn: any, token: string, linkId: string, keep: "local" | "remote") {
  const { data: link } = await admin.from("calendar_event_links").select("*").eq("id", linkId).eq("connection_id", conn.id).maybeSingle();
  if (!link || link.conflict_state !== "open") return;
  const cur = await graph(token, "GET", `/me/events/${encodeURIComponent(link.provider_event_id)}?$select=id,changeKey,subject,start,end,location`);
  if (!cur.ok) throw new Error(`get_${cur.status}`);
  const ev = await cur.json();
  const { data: a } = await admin.from("appointments").select("*").eq("id", link.appointment_id ?? "").maybeSingle();
  if (!a) return;
  if (keep === "local") {
    const res = await graph(token, "PATCH", `/me/events/${encodeURIComponent(link.provider_event_id)}`, eventBody(a, conn.agency_id));
    if (!res.ok) throw new Error(`patch_${res.status}`);
    const upd = await res.json();
    await admin.from("calendar_event_links").update({ conflict_state: "resolved_local", conflict_payload: null, last_local_hash: localHash(a),
      last_remote_change_key: upd.changeKey, last_synced_at: new Date().toISOString() } as never).eq("id", link.id);
  } else {
    const remote = { title: String(ev.subject ?? "").replace(/^Abgesagt: /, ""), starts_at: utc(ev.start.dateTime), ends_at: utc(ev.end.dateTime), location: ev.location?.displayName || null };
    const next = { ...a, ...remote };
    await admin.from("calendar_event_links").update({ conflict_state: "resolved_remote", conflict_payload: null, last_local_hash: localHash(next),
      last_remote_change_key: ev.changeKey, last_synced_at: new Date().toISOString() } as never).eq("id", link.id);
    await admin.from("appointments").update(remote as never).eq("id", a.id).eq("agency_id", conn.agency_id);
  }
}

const sanitize = (e: unknown) => (e instanceof Error ? e.message : "unknown").replace(/[^a-z0-9_:.-]/gi, "").slice(0, 80);

export async function runCalendarWorker(admin: Admin, budgetMs = 45_000) {
  const started = Date.now();
  let processed = 0;
  while (Date.now() - started < budgetMs) {
    const { data: jobs } = await admin.rpc("calendar_jobs_claim", { _limit: 5 });
    if (!jobs?.length) break;
    await Promise.all((jobs as any[]).map(async (job) => {
      const finish = (patch: Record<string, unknown>) => admin.from("calendar_sync_jobs").update({ finished_at: new Date().toISOString(), ...patch } as never).eq("id", job.id);
      try {
        const { data: conn } = await admin.from("calendar_connections").select("*").eq("id", job.connection_id).maybeSingle();
        if (!conn || !conn.sync_enabled || conn.status !== "connected" || !conn.selected_calendar_id) { await finish({ status: "canceled" }); return; }
        const { data: ok } = await admin.rpc("calendar_membership_active", { _agency_id: conn.agency_id, _user_id: conn.user_id });
        if (!ok) { await finish({ status: "canceled", error_code: "membership_inactive" }); return; }
        const token = await getAccessToken(admin, conn.id);
        writeGuard.set(token, { admin, connId: conn.id });
        if (job.job_type === "ensure_subscription") {
          const { ensureSubscription } = await import("./ms-calendar-subscriptions.server");
          await ensureSubscription(admin, conn, token);
        } else if (job.job_type === "initial" || job.job_type === "delta") await deltaSync(admin, conn, token, job.job_type === "initial");
        else if (job.job_type === "push_appointment" && job.appointment_id) await pushAppointment(admin, conn, token, job.appointment_id);
        else if (job.job_type === "delete_appointment" && job.link_id) await deleteRemote(admin, token, job.link_id);
        else if (job.job_type === "resolve_conflict" && job.link_id) await resolveConflict(admin, conn, token, job.link_id, (String(job.idempotency_key ?? "").startsWith("resolve:remote") ? "remote" : "local"));
        await finish({ status: "succeeded", error_code: null });
      } catch (e) {
        if (e instanceof ConnectionStopped) { await finish({ status: "canceled", error_code: "connection_stopped" }); processed++; return; }
        const transient = e instanceof RetryLater || (e instanceof MsTokenError && e.code === "transient");
        const final = e instanceof MsTokenError && (e.code === "invalid_grant" || e.code === "admin_consent");
        const delay = e instanceof RetryLater ? e.seconds : Math.min(3600, 30 * 2 ** job.attempts);
        if (!final && job.attempts < job.max_attempts) {
          await admin.from("calendar_sync_jobs").update({ status: "queued", run_after: new Date(Date.now() + delay * 1000).toISOString(),
            error_code: transient ? "transient" : "retry", error_detail_sanitized: sanitize(e), ...(e instanceof RetryLater && e.message === "delta_reset" ? { attempts: job.attempts - 1 } : {}) } as never).eq("id", job.id);
        } else {
          await finish({ status: "failed", error_code: final ? (e as MsTokenError).code : "failed", error_detail_sanitized: sanitize(e) });
          if (!final) await admin.from("calendar_connections").update({ last_error_code: "sync_failed", last_error_at: new Date().toISOString() } as never).eq("id", job.connection_id);
        }
      }
      processed++;
    }));
  }
  return { processed };
}
