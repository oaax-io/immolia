/** Phase 5.8D – zentrale Credit-UX (Zustände, Bezeichnungen). Rechnet nie Preise selbst: Kosten kommen vom Server. */
export type CreditUxState = "healthy" | "low" | "insufficient";

/** Ab diesem Guthaben gilt es als „niedrig" (zentral, eine Stelle). */
export const LOW_BALANCE_THRESHOLD = 50;

export function creditUxState(balance: number | null | undefined, required = 0): CreditUxState {
  const b = Number(balance ?? 0);
  if (required > 0 && b < required) return "insufficient";
  if (b < Math.max(LOW_BALANCE_THRESHOLD, required * 2)) return "low";
  return "healthy";
}

export const USAGE_LABELS: Record<string, { plural: string; action: string }> = {
  ai_expose_generations: { plural: "KI-Exposé-Texte", action: "Exposé-Text erstellt" },
  market_analyses: { plural: "Marktanalysen", action: "Marktanalyse erstellt" },
  financing_requests: { plural: "Finanzierungsanfragen", action: "Finanzierungsanfrage erstellt" },
  ai_assistant_usage: { plural: "KI-Assistent", action: "KI-Assistent verwendet" },
  ai_image_generations: { plural: "KI-Bilder", action: "KI-Bild erstellt" },
  storage_gb: { plural: "Speicher", action: "Zusätzlicher Speicher" },
  users: { plural: "Benutzer", action: "Zusätzlicher Benutzer" },
};

/** Menschlich lesbare Bezeichnung eines Journal-/Aktionsschlüssels. */
export function actionLabel(key?: string | null, catalogName?: string): string {
  if (catalogName) return catalogName;
  if (!key) return "Verbrauch";
  const k = key.startsWith("usage.") ? key.slice(6) : key.startsWith("recurring.") ? key.slice(10) : key;
  return USAGE_LABELS[k]?.action ?? "Kostenpflichtige Aktion";
}
