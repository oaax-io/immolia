import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Tenant-Bestimmung (fail closed): Der Mandant ergibt sich ausschliesslich aus
 * der serverseitigen Konfiguration PORTAL_TARGET_AGENCY_ID – nie aus dem Payload
 * und nie aus einem hartcodierten Default. Fehlt sie, ist sie ungültig oder ist
 * die Firma nicht aktiv, wird der Request abgelehnt (keine CRM-Mutation).
 */
const UUID_RE_TENANT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolvePortalTenant(sb: any, configured: string | undefined): Promise<string | null> {
  const agencyId = (configured ?? "").trim();
  if (!agencyId || !UUID_RE_TENANT.test(agencyId)) return null;
  const { data } = await sb.from("agencies").select("id,status").eq("id", agencyId).maybeSingle();
  if (!data?.id || data.status !== "active") return null;
  return data.id as string;
}

type Body = {
  id: string;
  entity: "lead" | "appointment" | "selfdisclosure";
  entity_id: string;
  action: string;
  created_at: string;
  data: Record<string, any>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validBody(b: any): b is Body {
  return (
    !!b &&
    typeof b.id === "string" &&
    UUID_RE.test(b.id) &&
    (b.entity === "lead" || b.entity === "appointment" || b.entity === "selfdisclosure") &&
    typeof b.entity_id === "string" &&
    typeof b.action === "string" &&
    !!b.data &&
    typeof b.data === "object"
  );
}

function verifySignature(raw: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", secret).update(raw, "utf8").digest("hex");
  const a = Buffer.from(header.trim().toLowerCase(), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function fmt(label: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  if (Array.isArray(value)) return value.length ? `${label}: ${value.join(", ")}\n` : "";
  if (typeof value === "object") return `${label}: ${JSON.stringify(value, null, 2)}\n`;
  return `${label}: ${String(value)}\n`;
}

async function createLead(
  sb: any,
  args: { agencyId: string; data: Record<string, any>; internalNotes: string; extra?: Record<string, any> },
): Promise<string> {
  const d = args.data;
  const { data: lead, error } = await sb
    .from("leads")
    .insert({
      ...(args.extra ?? {}),
      agency_id: args.agencyId,
      full_name: d.name ?? "Unbekannt",
      email: d.email ?? null,
      phone: d.phone ?? null,
      source: "ASIMO Portal",
      status: "new",
      entity_type: "person",
      internal_notes: args.internalNotes,
    })
    .select("id")
    .single();
  if (error) throw error;
  return lead.id as string;
}

async function handleLead(sb: any, agencyId: string, body: Body) {
  const d = body.data;
  const notes =
    `Betreff: ${d.subject ?? "-"}\n\n${d.message ?? ""}` +
    (d.property_id ? `\n\nPortal-Objekt-ID: ${d.property_id}` : "") +
    (d.internal_note ? `\n\nPortal-Notiz: ${d.internal_note}` : "");
  const leadId = await createLead(sb, { agencyId, data: d, internalNotes: notes });
  return { lead_id: leadId };
}

async function handleAppointment(sb: any, agencyId: string, body: Body) {
  const d = body.data;
  const slots: string[] = Array.isArray(d.slots) ? d.slots.filter(Boolean) : [];
  const channel = String(d.channel ?? "");
  const notes =
    `Betreff: Terminanfrage: ${d.topic ?? "-"}\n\n${d.message ?? ""}` +
    `\nKanal: ${channel}` +
    `\nWunschtermine: ${slots.join(", ")}` +
    (d.internal_note ? `\n\nPortal-Notiz: ${d.internal_note}` : "");

  const leadId = await createLead(sb, { agencyId, data: d, internalNotes: notes });

  const startsAt = slots[0] ? new Date(slots[0]) : new Date();
  const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
  const type = channel === "office" ? "meeting" : channel === "phone" ? "call" : "other";

  const { data: appt, error } = await sb
    .from("appointments")
    .insert({
      agency_id: agencyId,
      lead_id: leadId,
      title: `Terminanfrage (Portal): ${d.topic ?? ""}`.trim(),
      appointment_type: type,
      status: "scheduled",
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      is_online: channel === "video",
      notes: `Terminanfrage aus Portal — alle Wunschtermine: ${slots.join(", ") || "keine angegeben"}\nKanal: ${channel}${d.message ? `\n\n${d.message}` : ""}`,
    })
    .select("id")
    .single();
  if (error) throw error;

  return { lead_id: leadId, appointment_id: appt.id as string };
}

async function handleSelfDisclosure(sb: any, agencyId: string, body: Body) {
  const d = body.data;
  const summary =
    "Betreff: Selbstauskunft / Finanzierungsanfrage\n\n" +
    "— Person —\n" +
    fmt("Name", d.name) +
    fmt("E-Mail", d.email) +
    fmt("Telefon", d.phone) +
    fmt("Geburtsdatum", d.birthdate) +
    fmt("Zivilstand", d.civil_status) +
    fmt("Anstellung", d.employment) +
    fmt("Arbeitgeber", d.employer) +
    "\n— Einkommen —\n" +
    fmt("Einkommen", d.income) +
    fmt("Bonus", d.bonus) +
    fmt("Einkommen Partner", d.partner_income) +
    fmt("Weitere Einkünfte", d.other_income) +
    "\n— Verpflichtungen —\n" +
    fmt("Leasing", d.leasing) +
    fmt("Kredite", d.loans) +
    fmt("Alimente", d.alimony) +
    "\n— Eigenmittel —\n" +
    fmt("Barmittel", d.equity_cash) +
    fmt("Säule 2", d.equity_pillar2) +
    fmt("Säule 3a", d.equity_pillar3) +
    fmt("Weitere", d.equity_other) +
    "\n— Objektwunsch —\n" +
    fmt("Kaufpreis", d.price) +
    fmt("Objekttyp", d.property_type) +
    fmt("Ort", d.location) +
    fmt("Nutzung", d.usage) +
    "\n— Analyse —\n" +
    fmt("Resultat", d.analysis) +
    fmt("Referenz", d.reference) +
    fmt("Portal-Status", d.status) +
    (d.internal_note ? `\nPortal-Notiz: ${d.internal_note}\n` : "");

  const price = typeof d.price === "number" ? d.price : d.price ? Number(d.price) : null;
  const leadId = await createLead(sb, {
    agencyId,
    data: d,
    internalNotes: summary,
    extra: {
      budget_max: price && !Number.isNaN(price) ? price : null,
      preferred_location: d.location ?? null,
      portal_self_disclosure: d,
    },
  });
  return { lead_id: leadId };
}

export const Route = createFileRoute("/api/public/portal-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apiKeyEnv = process.env["PORTAL_TARGET_API_KEY"];
        const secret = process.env["PORTAL_SIGNING_SECRET"];
        if (!apiKeyEnv || !secret) {
          console.error("Portal webhook: env vars missing");
          return new Response("Not configured", { status: 500 });
        }

        const raw = await request.text();
        const providedKey = request.headers.get("x-api-key") ?? "";
        const keyBuf = Buffer.from(providedKey, "utf8");
        const envBuf = Buffer.from(apiKeyEnv, "utf8");
        const keyOk = keyBuf.length === envBuf.length && timingSafeEqual(keyBuf, envBuf);
        const sigOk = verifySignature(raw, request.headers.get("x-asimo-signature"), secret);
        if (!keyOk || !sigOk) return new Response("Unauthorized", { status: 401 });

        let body: unknown;
        try {
          body = JSON.parse(raw);
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        if (!validBody(body)) return new Response("Invalid payload", { status: 400 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const sb = supabaseAdmin as any;

        const agencyId = await resolvePortalTenant(sb, process.env["PORTAL_TARGET_AGENCY_ID"]);
        if (!agencyId) {
          console.error("Portal webhook: PORTAL_TARGET_AGENCY_ID missing/invalid/inactive – rejected");
          return new Response("Portal tenant not configured", { status: 503 });
        }

        const { error: logError } = await sb
          .from("portal_event_log")
          .insert({ portal_event_id: body.id, entity: body.entity, action: body.action });
        if (logError) {
          if (logError.code === "23505") {
            return Response.json({ ok: true, duplicate: true });
          }
          console.error("Portal webhook log insert failed:", logError);
          return new Response("Log error", { status: 500 });
        }

        try {
          let created: Record<string, string> = {};
          if (body.entity === "lead") created = await handleLead(sb, agencyId, body);
          else if (body.entity === "appointment") created = await handleAppointment(sb, agencyId, body);
          else created = await handleSelfDisclosure(sb, agencyId, body);

          await sb
            .from("portal_event_log")
            .update({
              created_lead_id: created.lead_id ?? null,
              created_appointment_id: created.appointment_id ?? null,
            })
            .eq("portal_event_id", body.id);

          return Response.json({ ok: true, entity: body.entity, created });
        } catch (e) {
          console.error("Portal webhook processing error:", e);
          // Log-Eintrag entfernen, damit ein Retry des Portals verarbeitet wird
          await sb.from("portal_event_log").delete().eq("portal_event_id", body.id);
          return new Response("Processing error", { status: 500 });
        }
      },
    },
  },
});
