import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withMeteredUsage } from "./metered-usage.server";

const InputSchema = z.object({
  propertyId: z.string().uuid(),
  requestId: z.string().min(8).max(100).regex(/^[A-Za-z0-9_-]+$/).optional(),
});

const MarketSectionsSchema = z.object({
  location: z.object({ summary: z.string(), score: z.number().min(1).max(10), highlights: z.array(z.string()) }),
  purchase_price: z.object({
    price_per_sqm_min: z.number().nullable(), price_per_sqm_max: z.number().nullable(),
    estimated_value_min: z.number().nullable(), estimated_value_max: z.number().nullable(),
    currency: z.enum(["CHF", "EUR"]), comparison: z.enum(["below_market", "at_market", "above_market", "unknown"]), comment: z.string(),
  }),
  rental: z.object({
    rent_per_sqm_min: z.number().nullable(), rent_per_sqm_max: z.number().nullable(),
    monthly_rent_min: z.number().nullable(), monthly_rent_max: z.number().nullable(),
    gross_yield_min: z.number().nullable(), gross_yield_max: z.number().nullable(), comment: z.string(),
  }),
  trend: z.object({ direction: z.enum(["rising", "stable", "declining", "mixed"]), outlook: z.string() }),
  opportunities: z.array(z.string()), risks: z.array(z.string()),
  recommendation: z.object({ verdict: z.enum(["strong_buy", "buy", "hold", "caution", "avoid"]), summary: z.string() }),
});

const marketJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["location", "purchase_price", "rental", "trend", "opportunities", "risks", "recommendation"],
  properties: {
    location: { type: "object", additionalProperties: false, required: ["summary", "score", "highlights"], properties: { summary: { type: "string" }, score: { type: "number", minimum: 1, maximum: 10 }, highlights: { type: "array", items: { type: "string" } } } },
    purchase_price: { type: "object", additionalProperties: false, required: ["price_per_sqm_min", "price_per_sqm_max", "estimated_value_min", "estimated_value_max", "currency", "comparison", "comment"], properties: { price_per_sqm_min: { type: ["number", "null"] }, price_per_sqm_max: { type: ["number", "null"] }, estimated_value_min: { type: ["number", "null"] }, estimated_value_max: { type: ["number", "null"] }, currency: { type: "string", enum: ["CHF", "EUR"] }, comparison: { type: "string", enum: ["below_market", "at_market", "above_market", "unknown"] }, comment: { type: "string" } } },
    rental: { type: "object", additionalProperties: false, required: ["rent_per_sqm_min", "rent_per_sqm_max", "monthly_rent_min", "monthly_rent_max", "gross_yield_min", "gross_yield_max", "comment"], properties: { rent_per_sqm_min: { type: ["number", "null"] }, rent_per_sqm_max: { type: ["number", "null"] }, monthly_rent_min: { type: ["number", "null"] }, monthly_rent_max: { type: ["number", "null"] }, gross_yield_min: { type: ["number", "null"] }, gross_yield_max: { type: ["number", "null"] }, comment: { type: "string" } } },
    trend: { type: "object", additionalProperties: false, required: ["direction", "outlook"], properties: { direction: { type: "string", enum: ["rising", "stable", "declining", "mixed"] }, outlook: { type: "string" } } },
    opportunities: { type: "array", items: { type: "string" } }, risks: { type: "array", items: { type: "string" } },
    recommendation: { type: "object", additionalProperties: false, required: ["verdict", "summary"], properties: { verdict: { type: "string", enum: ["strong_buy", "buy", "hold", "caution", "avoid"] }, summary: { type: "string" } } },
  },
} as const;

async function readResponseText(response: Response): Promise<string> {
  if (!response.body) throw new Error("Die KI hat keine Antwort geliefert.");
  const reader = response.body.getReader();
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
        const event = JSON.parse(payload);
        if (event.type === "response.output_text.delta" && typeof event.delta === "string") text += event.delta;
        if (event.type === "response.failed") throw new Error(event.response?.error?.message ?? "KI-Analyse fehlgeschlagen.");
      } catch (error) {
        if (error instanceof SyntaxError) continue;
        throw error;
      }
    }
  }
  if (!text.trim()) throw new Error("Die KI hat keine auswertbare Analyse geliefert.");
  return text.trim();
}

export const generatePropertyMarketAnalysis = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((value: unknown) => InputSchema.parse(value))
  .handler(async ({ data, context }) => withMeteredUsage(
    context.supabase,
    "market_analyses",
    data.requestId ?? crypto.randomUUID(),
    async () => {
      const { data: property, error } = await context.supabase.from("properties").select("*").eq("id", data.propertyId).single();
      if (error || !property) throw new Error("Immobilie nicht gefunden oder kein Zugriff.");
      const apiKey = process.env["LOVABLE_API_KEY"];
      if (!apiKey) throw new Error("KI ist nicht konfiguriert.");
      const facts = {
        titel: property.title, typ: property.property_type, vermarktung: property.listing_type,
        adresse: [property.address, property.postal_code, property.city, property.country].filter(Boolean).join(", "),
        wohnflaeche_m2: property.living_area, grundstueck_m2: property.plot_area,
        zimmer: property.rooms, badezimmer: property.bathrooms, baujahr: property.year_built,
        renovationsjahr: property.renovated_at, zustand: property.condition, energieklasse: property.energy_class,
        kaufpreis: property.price, monatsmiete: property.rent, bruttorendite: property.gross_yield,
        nettorendite: property.net_yield, zielmiete: property.rent_target,
        ausstattung: property.features, beschreibung: property.description?.slice(0, 1800),
      };
      const prompt = `Erstelle eine vorsichtige Markt- und Potenzialanalyse für eine Schweizer Immobilie. Bewerte Verkauf und Vermietung getrennt. Verwende nur die gelieferten Fakten und allgemeines Marktverständnis; behaupte keine Live-Transaktionsdaten. Fehlende, nicht seriös schätzbare Zahlen müssen null sein. Alle Texte auf Deutsch (Schweiz, kein ß), kurz und maklertauglich. Antworte ausschliesslich im verlangten JSON-Schema.\n\nObjektdaten:\n${JSON.stringify(facts, null, 2)}`;
      const response = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey, "X-Lovable-AIG-SDK": "fetch" },
        body: JSON.stringify({
          model: "openai/gpt-6-astra", input: prompt, stream: true, store: false,
          reasoning: { effort: "low", summary: "auto" }, include: ["reasoning.encrypted_content"],
          text: { format: { type: "json_schema", name: "property_market_analysis", strict: true, schema: marketJsonSchema } },
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { message?: string; error?: { message?: string } } | null;
        const message = body?.message ?? body?.error?.message;
        if (response.status === 402) throw new Error(message ?? "KI-Guthaben aufgebraucht.");
        if (response.status === 403) throw new Error(message ?? "KI-Zugriff ist derzeit nicht verfügbar.");
        if (response.status === 429) throw new Error(message ?? "Zu viele KI-Anfragen. Bitte später erneut versuchen.");
        throw new Error(message ?? `KI-Analyse fehlgeschlagen (${response.status}).`);
      }
      const sections = MarketSectionsSchema.parse(JSON.parse(await readResponseText(response)));
      const { data: agencyId, error: agencyError } = await context.supabase.rpc("current_agency_id");
      if (agencyError || !agencyId) throw new Error("Keine aktive Firma ausgewählt.");
      const { data: saved, error: saveError } = await context.supabase.from("property_market_analyses").insert({
        property_id: property.id, agency_id: agencyId, created_by: context.userId,
        sections, model: "openai/gpt-6-astra",
      }).select("id, property_id, created_at, sections").single();
      if (saveError || !saved) throw new Error("Die Analyse konnte nicht gespeichert werden.");
      return saved;
    },
    { type: "property_market_analysis", id: data.propertyId },
  ));