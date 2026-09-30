import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { withMeteredUsage } from "./metered-usage.server";

const Schema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(4000).optional().default(""),
  context: z.string().max(300).optional(),
  requestId: z.string().uuid().optional(),
});

export const improveTaskText = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Schema.parse(data))
  .handler(async ({ data, context }): Promise<{ title: string; description: string }> =>
    withMeteredUsage(context.supabase, "ai_assistant_usage", data.requestId ?? crypto.randomUUID(), () => run(data), { type: "ai_task_text" }));

async function run(data: z.infer<typeof Schema>): Promise<{ title: string; description: string }> {
  const apiKey = process.env["LOVABLE_API_KEY"];
  if (!apiKey) throw new Error("KI ist nicht konfiguriert.");
  const prompt = `Du hilfst einem Schweizer Immobilienmakler, eine Aufgabe in seinem CRM klar zu formulieren. Schreibe in Schweizer Hochdeutsch (kein ß).
Titel: ${data.title}
Beschreibung: ${data.description || "(leer)"}
Bezug: ${data.context || "keiner"}
Gib einen prägnanten Titel (max. 70 Zeichen, beginnt mit Verb oder Nomen) und eine kurze, strukturierte Beschreibung (1 Satz Ziel, danach 2–5 Stichpunkte mit "- " als nächste Schritte). Erfinde keine Namen, Daten oder Beträge. Antworte ausschliesslich als JSON: {"title":"...","description":"..."}`;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": apiKey },
    body: JSON.stringify({ model: "openai/gpt-5-mini", input: prompt, store: false }),
  });
  if (!res.ok) throw new Error(res.status === 429 ? "KI-Limit erreicht – bitte später erneut versuchen." : `KI-Fehler (${res.status}).`);
  const json = await res.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }>; output_text?: string };
  const text = json.output_text ?? json.output?.flatMap((i) => i.content ?? []).find((i) => i.type === "output_text")?.text ?? "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("Die KI hat keinen Text zurückgegeben.");
  const parsed = JSON.parse(match[0]) as { title?: string; description?: string };
  return { title: (parsed.title || data.title).trim(), description: (parsed.description || "").trim() };
}
