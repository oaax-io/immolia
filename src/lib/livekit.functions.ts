import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";


/** Aktuelle Firma des Aufrufers (serverseitig, aus Mitgliedschaft). */
async function callerAgency(context: any): Promise<string> {
  const { data, error } = await context.supabase.rpc("current_agency_id");
  if (error || !data) throw new Error("Keine aktive Firmen-Mitgliedschaft");
  return data as string;
}

const saveSchema = z.object({
  ws_url: z.string().trim().min(1),
  api_key: z.string().trim().min(1),
  api_secret: z.string().trim().min(0),
  enabled: z.boolean(),
});

const tokenSchema = z.object({
  room: z.string().trim().min(3).max(120),
  displayName: z.string().trim().max(120).optional(),
});

/** Status (ohne Geheimnisse) – für alle angemeldeten Nutzer. */
export const getLivekitStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const agencyId = await callerAgency(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("livekit_settings")
      .select("ws_url, api_key, api_secret, enabled, updated_at")
      .eq("agency_id", agencyId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const row = data as any;
    return {
      enabled: !!row?.enabled,
      wsUrl: (row?.ws_url as string | null) ?? "",
      apiKey: (row?.api_key as string | null) ?? "",
      hasSecret: !!row?.api_secret,
      configured: !!(row?.enabled && row?.ws_url && row?.api_key && row?.api_secret),
      updatedAt: (row?.updated_at as string | null) ?? null,
    };
  });

/** Zugangsdaten speichern – nur Inhaber/Admin. */
export const saveLivekitSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => saveSchema.parse(data))
  .handler(async ({ data, context }) => {
    const { normalizeWsUrl } = await import("@/lib/livekit.server");
    const { data: allowed, error: roleError } = await (context as any).supabase.rpc(
      "is_owner_or_admin",
    );
    if (roleError) throw new Error(roleError.message);
    if (!allowed) throw new Error("Keine Berechtigung");
    const agencyId = await callerAgency(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: existing } = await supabaseAdmin
      .from("livekit_settings")
      .select("id, api_secret")
      .eq("agency_id", agencyId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const payload: Record<string, unknown> = {
      agency_id: agencyId,
      ws_url: normalizeWsUrl(data.ws_url),
      api_key: data.api_key,
      enabled: data.enabled,
    };
    if (data.api_secret) payload.api_secret = data.api_secret;

    if (existing?.id) {
      const { error } = await supabaseAdmin
        .from("livekit_settings")
        .update(payload as any)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await supabaseAdmin
        .from("livekit_settings")
        .insert(payload as any);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

/** Verbindungstest – prüft, ob ein Token erzeugt werden kann. */
export const testLivekitConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const agencyId = await callerAgency(context);
    const { createAccessToken } = await import("@/lib/livekit.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("livekit_settings")
      .select("ws_url, api_key, api_secret")
      .eq("agency_id", agencyId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const row = data as any;
    if (!row?.ws_url || !row?.api_key || !row?.api_secret) {
      return { ok: false, message: "Zugangsdaten unvollständig" };
    }
    try {
      await createAccessToken({
        apiKey: row.api_key,
        apiSecret: row.api_secret,
        identity: "connection-test",
        room: "connection-test",
        ttlSeconds: 60,
      });
    } catch (e: any) {
      return { ok: false, message: e?.message ?? "Token-Erstellung fehlgeschlagen" };
    }

    const httpUrl = String(row.ws_url).replace(/^ws/, "http");
    try {
      const res = await fetch(`${httpUrl}/rtc/validate`, { method: "GET" });
      if (res.status >= 500) {
        return { ok: false, message: `Server antwortete mit ${res.status}` };
      }
    } catch (e: any) {
      return { ok: false, message: `Server nicht erreichbar: ${e?.message ?? ""}` };
    }
    return { ok: true, message: "Verbindung erfolgreich" };
  });

/** Beitritts-Token für einen Raum. */
export const createLivekitToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((data) => tokenSchema.parse(data))
  .handler(async ({ data, context }) => {
    const agencyId = await callerAgency(context);
    const { createAccessToken } = await import("@/lib/livekit.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row } = await supabaseAdmin
      .from("livekit_settings")
      .select("ws_url, api_key, api_secret, enabled")
      .eq("agency_id", agencyId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const cfg = row as any;
    if (!cfg?.enabled || !cfg?.ws_url || !cfg?.api_key || !cfg?.api_secret) {
      throw new Error(
        "Video-Telefonie ist nicht konfiguriert. Bitte in den Einstellungen unter „Video“ hinterlegen.",
      );
    }

    const userId = (context as any).userId as string;
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("full_name, email")
      .eq("id", userId)
      .maybeSingle();

    const displayName =
      data.displayName ||
      (profile as any)?.full_name ||
      (profile as any)?.email ||
      "Teilnehmer";

    const token = await createAccessToken({
      apiKey: cfg.api_key,
      apiSecret: cfg.api_secret,
      identity: userId,
      name: displayName,
      room: data.room,
    });

    return { token, wsUrl: cfg.ws_url as string, displayName };
  });
