import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withMeteredUsage } from "./metered-usage.server";

const RequestId = z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/).optional();

const InputSchema = z.object({
  property: z.record(z.string(), z.any()),
  tone: z.enum(["sachlich", "emotional", "premium"]).default("sachlich"),
  extra: z.string().max(2000).optional(),
  requestId: RequestId,
});

export const generatePropertyDescription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => InputSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ text: string }> =>
    withMeteredUsage(context.supabase, "ai_expose_generations", data.requestId ?? crypto.randomUUID(), () => runDescription(data), { type: "ai_property_description" }));

async function runDescription(data: z.infer<typeof InputSchema>): Promise<{ text: string }> {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("KI ist nicht konfiguriert (LOVABLE_API_KEY fehlt).");

    const p = data.property;
    const facts = Object.entries(p)
      .filter(([, v]) => v !== null && v !== undefined && v !== "" && !(Array.isArray(v) && v.length === 0))
      .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(", ") : String(v)}`)
      .join("\n");

    const prompt = `Du bist ein erfahrener Schweizer Immobilienmakler. Schreibe einen ansprechenden Exposé-Beschreibungstext auf Deutsch (Schweizer Rechtschreibung, kein "ß").

Stil: ${data.tone}.
Regeln:
- 150-250 Wörter, 3-4 kurze Absätze (Einleitung, Objekt & Ausstattung, Lage, Abschluss).
- Nur vorhandene Angaben verwenden, nichts erfinden, keine Preisversprechen.
- Keine Aufzählungszeichen, keine Überschriften, nur Fliesstext.
- Gib ausschliesslich den fertigen Text zurück.

Objektdaten:
${facts}
${data.extra ? `\nZusätzliche Hinweise des Maklers:\n${data.extra}` : ""}`;

    const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Lovable-API-Key": apiKey,
        "X-Lovable-AIG-SDK": "fetch",
      },
      body: JSON.stringify({
        model: "openai/gpt-5.6-sol",
        input: prompt,
        stream: true,
        store: false,
        reasoning: { effort: "low", summary: "auto" },
      }),
    });

    if (!res.ok || !res.body) {
      if (res.status === 429) throw new Error("KI-Limit erreicht – bitte später erneut versuchen.");
      if (res.status === 402) throw new Error("KI-Guthaben aufgebraucht.");
      throw new Error(`KI-Fehler (${res.status}): ${await res.text().catch(() => "")}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload);
          if (evt.type === "response.output_text.delta" && typeof evt.delta === "string") text += evt.delta;
          if (evt.type === "response.completed" && !text && evt.response?.output_text) {
            text = Array.isArray(evt.response.output_text) ? evt.response.output_text.join("") : String(evt.response.output_text);
          }
        } catch {
          /* ignore keep-alive fragments */
        }
      }
    }

    if (!text.trim()) throw new Error("Die KI hat keinen Text zurückgegeben. Bitte erneut versuchen.");
    return { text: text.trim() };
}

const LocationInputSchema = z.object({
  address: z.string().max(300).optional(),
  postal_code: z.string().max(30).optional(),
  city: z.string().max(120).optional(),
  country: z.string().max(80).optional(),
  property_type: z.string().max(80).optional(),
  extra: z.string().max(1000).optional(),
  requestId: RequestId,
});

export const generateLocationDescription = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => LocationInputSchema.parse(data))
  .handler(async ({ data, context }): Promise<{ text: string }> =>
    withMeteredUsage(context.supabase, "ai_assistant_usage", data.requestId ?? crypto.randomUUID(), () => runLocation(data), { type: "ai_location_description" }));

async function runLocation(data: z.infer<typeof LocationInputSchema>): Promise<{ text: string }> {
    const apiKey = process.env["LOVABLE_API_KEY"];
    if (!apiKey) throw new Error("KI ist nicht konfiguriert.");
    const prompt = `Du bist ein Schweizer Immobilienmakler. Formuliere eine prägnante Lagebeschreibung in Schweizer Hochdeutsch (kein ß) für ein Exposé.
Adresse: ${[data.address, data.postal_code, data.city, data.country].filter(Boolean).join(", ")}
Objektart: ${data.property_type ?? "nicht angegeben"}
Hinweise: ${data.extra ?? "keine"}
Schreibe 80–130 Wörter in zwei kurzen Absätzen. Beschreibe nur plausible allgemeine Lagequalitäten. Erfinde keine exakten Gehzeiten, Distanzen, Einrichtungen oder Verkehrslinien. Gib ausschliesslich den fertigen Text zurück.`;
    const response = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
      body: JSON.stringify({ model: "openai/gpt-5-mini", input: prompt, store: false }),
    });
    if (!response.ok) throw new Error(response.status === 429 ? "KI-Limit erreicht – bitte später erneut versuchen." : `KI-Fehler (${response.status}).`);
    const json = await response.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; output_text?: string };
    const text = json.output_text ?? json.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text ?? "";
    if (!text.trim()) throw new Error("Die KI hat keinen Text zurückgegeben.");
    return { text: text.trim() };
  }
