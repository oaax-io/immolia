import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const InputSchema = z.object({
  propertyId: z.string().uuid(),
  unpublish: z.boolean().optional(),
  /** Automatischer Sync beim Speichern: ohne Verbindung still überspringen. */
  autoSync: z.boolean().optional(),
});

type ConnInfo = { id: string; provider_key: string; display_name: string; protocol: string; secret_ref: string };

/** Aktive Portal-Verbindung der aktiven Firma (RLS: nur eigene Firma). */
async function activeConnection(sb: any): Promise<{ agencyId: string | null; conn: ConnInfo | null }> {
  const { data: agencyId } = await sb.rpc("current_agency_id");
  if (!agencyId) return { agencyId: null, conn: null };
  const { data } = await sb
    .from("property_portal_connections")
    .select("id,provider_key,display_name,protocol,secret_ref")
    .eq("agency_id", agencyId)
    .eq("enabled", true)
    .order("created_at", { ascending: true })
    .limit(1);
  return { agencyId: agencyId as string, conn: (data?.[0] as ConnInfo) ?? null };
}

/** Für die UI: nur Anzeigename + Verfügbarkeit, nie Secrets. */
export const getPortalConnectionStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ available: boolean; displayName: string | null }> => {
    const { conn } = await activeConnection(context.supabase as any);
    return { available: !!conn, displayName: conn?.display_name ?? null };
  });

export const publishPropertyToPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(
    async ({ data, context }): Promise<{ ok: true; published: boolean; portalPropertyId: string | null; skipped?: boolean }> => {
      const sb = context.supabase as any;
      const { agencyId, conn } = await activeConnection(sb);
      if (!agencyId || !conn) {
        if (data.autoSync) return { ok: true, published: false, portalPropertyId: null, skipped: true };
        throw new Error("Für diese Firma ist kein Immobilienportal verbunden.");
      }
      if (conn.protocol !== "legacy_asimo_v1") throw new Error("Portal-Protokoll wird nicht unterstützt.");

      const { portalSecrets } = await import("@/lib/portal-connections.server");
      const { apiBaseUrl: baseUrl, inboundApiKey: inboundKey } = portalSecrets(conn.secret_ref);
      if (!baseUrl || !inboundKey) throw new Error("Portal-Anbindung ist serverseitig nicht konfiguriert.");

      // RLS: nur Objekte der aktiven Firma; zusätzlich explizit gegen die Verbindung prüfen.
      const { data: property, error } = await sb.from("properties").select("*").eq("id", data.propertyId).single();
      if (error || !property) throw new Error("Immobilie nicht gefunden.");
      if (property.agency_id !== agencyId) throw new Error("Immobilie gehört nicht zur aktiven Firma.");
      if (data.autoSync && !property.portal_published) {
        return { ok: true, published: false, portalPropertyId: null, skipped: true };
      }

      // Legacy-Wire-Protokoll (historisch ASIMO): Endpoint und Header-Namen bleiben unverändert.
      const endpoint = `${baseUrl.replace(/\/$/, "")}/api/public/asimo/properties`;
      const headers = { "Content-Type": "application/json", "x-asimo-key": inboundKey };

      if (data.unpublish) {
        const res = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({ source_app_id: property.id, action: "unpublish" }),
        });
        if (!res.ok) throw new Error(`Portal antwortete mit ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
        await sb.from("properties").update({ portal_published: false, portal_property_id: null }).eq("id", property.id);
        return { ok: true, published: false, portalPropertyId: null };
      }

      const statusMap: Record<string, string> = {
        available: "verfügbar",
        active: "verfügbar",
        reserved: "reserviert",
        sold: "verkauft",
        rented: "vermietet",
      };
      const portalStatus = statusMap[property.status as string];
      if (!portalStatus) throw new Error("Objekt muss zuerst aktiv geschaltet werden, bevor es veröffentlicht werden kann");

      const typeMap: Record<string, string> = {
        apartment: "Wohnung",
        house: "Haus",
        commercial: "Gewerbe",
        land: "Bauland",
        parking: "Parkplatz",
        mixed_use: "Mischnutzung",
        other: "Sonstiges",
      };

      const { data: media } = await sb
        .from("property_media")
        .select("file_url, file_type, is_cover, sort_order")
        .eq("property_id", property.id)
        .order("sort_order", { ascending: true });

      const supabaseUrl = (process.env["SUPABASE_URL"] ?? "").replace(/\/$/, "");
      const toUrl = (path?: string | null) => {
        if (!path) return null;
        if (path.startsWith("http")) return path;
        return `${supabaseUrl}/storage/v1/object/public/media/${path}`;
      };
      const imageRows = (media ?? []).filter((m: any) => {
        const t = (m.file_type ?? "").toLowerCase();
        return !!m.file_url && (!t || t === "image" || t.startsWith("image/"));
      });
      const images = imageRows.map((m: any) => toUrl(m.file_url)).filter(Boolean) as string[];
      const coverRow = imageRows.find((m: any) => m.is_cover);
      const coverImage = toUrl(coverRow?.file_url) ?? images[0] ?? toUrl(property.images?.[0]) ?? null;

      const description: string = property.description ?? "";
      const summary = description.length > 200 ? `${description.slice(0, 197).trimEnd()}…` : description;

      const payload = {
        source_app_id: property.id,
        action: "upsert",
        title: property.title,
        summary,
        description,
        price: property.price ?? property.rent ?? null,
        currency: "CHF",
        location: property.address ? `${property.address}, ${property.city ?? ""}`.replace(/,\s*$/, "") : property.city ?? null,
        country: property.country ?? "CH",
        property_type: typeMap[property.property_type as string] ?? "Sonstiges",
        rooms: property.rooms ?? null,
        living_area: property.living_area ?? property.area ?? null,
        status: portalStatus,
        cover_image: coverImage,
        images,
      };

      const res = await fetch(endpoint, { method: "POST", headers, body: JSON.stringify(payload) });
      const text = await res.text().catch(() => "");
      if (!res.ok) throw new Error(`Portal antwortete mit ${res.status}: ${text.slice(0, 200)}`);

      let portalId: string | null = null;
      try {
        const json = JSON.parse(text);
        const candidate = json?.id ?? json?.property_id ?? json?.data?.id ?? null;
        portalId =
          typeof candidate === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(candidate)
            ? candidate
            : null;
      } catch {
        portalId = null;
      }

      await sb
        .from("properties")
        .update({
          portal_published: true,
          portal_published_at: new Date().toISOString(),
          ...(portalId ? { portal_property_id: portalId } : {}),
        })
        .eq("id", property.id);

      return { ok: true, published: true, portalPropertyId: portalId };
    },
  );
