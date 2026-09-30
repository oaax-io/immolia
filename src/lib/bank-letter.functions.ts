/**
 * KI-Begleitnachricht für die Bankeinreichung eines Finanzierungsdossiers.
 * Liest das Dossier ausschliesslich mit den Rechten des angemeldeten Benutzers (RLS)
 * und zählt die Nutzung über das bestehende Kontingent für KI-Aktionen.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withMeteredUsage } from "./metered-usage.server";

const Schema = z.object({
  dossierId: z.string().uuid(),
  hint: z.string().max(500).optional().default(""),
  requestId: z.string().uuid().optional(),
});

const chf = (n: number | null | undefined) =>
  typeof n === "number" ? `CHF ${new Intl.NumberFormat("de-CH").format(Math.round(n))}` : "unbekannt";

export const generateBankCoverLetter = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Schema.parse(data))
  .handler(async ({ data, context }): Promise<{ text: string }> =>
    withMeteredUsage(
      context.supabase,
      "ai_assistant_usage",
      data.requestId ?? crypto.randomUUID(),
      () => run(data, context.supabase),
      { type: "ai_bank_letter", id: data.dossierId },
    ));

async function run(data: z.infer<typeof Schema>, supabase: any): Promise<{ text: string }> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("KI ist nicht konfiguriert.");

  const { data: d, error } = await supabase
    .from("financing_dossiers")
    .select(
      "bank_name, bank_contact, financing_type, purchase_price, purchase_additional_costs, own_funds_total, " +
      "new_total_mortgage, gross_income_yearly, affordability_ratio, loan_to_value_ratio, property_snapshot, " +
      "clients ( first_name, last_name )",
    )
    .eq("id", data.dossierId)
    .maybeSingle();
  if (error || !d) throw new Error("Dossier konnte nicht gelesen werden.");

  const snap = (d.property_snapshot ?? {}) as Record<string, any>;
  const objekt = [snap.street, snap.zip, snap.city].filter(Boolean).join(", ") || "Liegenschaft gemäss Dossier";
  const client = d.clients
    ? `${d.clients.first_name ?? ""} ${d.clients.last_name ?? ""}`.trim()
    : "Kundschaft gemäss Dossier";

  const prompt = `Du schreibst als Schweizer Immobilien-/Finanzierungsberater eine kurze, professionelle Begleitnachricht an eine Bank zu einem Finanzierungsdossier. Schweizer Hochdeutsch, kein ß, höfliche Sie-Form, sachlich, max. 180 Wörter.

Bank: ${d.bank_name || "unbekannt"}
Ansprechperson: ${d.bank_contact || "unbekannt"}
Kundschaft: ${client}
Objekt: ${objekt}
Finanzierungsart: ${d.financing_type ?? "unbekannt"}
Kaufpreis: ${chf(d.purchase_price)}
Nebenkosten: ${chf(d.purchase_additional_costs)}
Eigenmittel: ${chf(d.own_funds_total)}
Hypothek neu: ${chf(d.new_total_mortgage)}
Bruttoeinkommen p.a.: ${chf(d.gross_income_yearly)}
Tragbarkeit: ${d.affordability_ratio != null ? `${d.affordability_ratio}%` : "unbekannt"}
Belehnung: ${d.loan_to_value_ratio != null ? `${d.loan_to_value_ratio}%` : "unbekannt"}
Zusatzhinweis des Beraters: ${data.hint || "keiner"}

Regeln: Erfinde keine Zahlen, Namen oder Fristen. Felder mit "unbekannt" weglassen statt raten. Beginne mit einer Anrede (falls Ansprechperson unbekannt: "Guten Tag"), nenne Zweck, Objekt und die wichtigsten bekannten Eckwerte, weise auf die beigelegten vollständigen Unterlagen hin und schliesse mit einer Bitte um Prüfung und Rückmeldung sowie "Freundliche Grüsse". Gib ausschliesslich den Nachrichtentext zurück, ohne Betreffzeile und ohne Markdown.`;

  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model: "openai/gpt-6-astra",
      input: prompt,
      store: false,
      stream: true,
      reasoning: { effort: "low" },
    }),
  });
  if (!res.ok || !res.body) {
    if (res.status === 429) throw new Error("KI-Limit erreicht – bitte später erneut versuchen.");
    if (res.status === 402) throw new Error("KI-Guthaben aufgebraucht – bitte Credits aufladen.");
    throw new Error(`KI-Fehler (${res.status}).`);
  }
  // SSE-Stream lesen und Textdeltas zusammensetzen
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const ev = JSON.parse(payload);
        if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") text += ev.delta;
        if (ev.type === "response.failed" || ev.type === "error") throw new Error("Die KI konnte keinen Text erstellen.");
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("Die KI")) throw e;
      }
    }
  }
  if (!text.trim()) throw new Error("Die KI hat keinen Text zurückgegeben.");
  return { text: text.trim() };
}
