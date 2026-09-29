/**
 * Phase 5.8C – zentraler Ablauf für gezählte Aktionen (nur Server).
 * Firma = current_agency_id() des angemeldeten Benutzers (nie aus dem Browser).
 * reserve (Kontingent zählt sofort, Mehrverbrauch-Credits reserviert) → Leistung → settle(ok) | settle(fail).
 * Ohne Kontingent für den Schlüssel = unbegrenzt/kostenlos (nichts wird erfunden).
 */
export class CommercialBlockedError extends Error {
  constructor(public code: string, public required?: number, public available?: number) {
    super(
      code === "INSUFFICIENT_CREDITS"
        ? `Dein inkludiertes Kontingent ist ausgeschöpft. Für diese Aktion benötigst du ${required ?? ""} Credits (verfügbar: ${available ?? 0}).`
        : "Diese Aktion ist derzeit nicht verfügbar.",
    );
  }
}

export async function withMeteredUsage<T>(
  userSupabase: any,
  usageKey: string,
  idempotencyKey: string,
  execute: () => Promise<T>,
  reference?: { type?: string; id?: string },
): Promise<T> {
  const { data: agencyId, error: aErr } = await userSupabase.rpc("current_agency_id");
  if (aErr || !agencyId) throw new Error("Keine aktive Firma ausgewählt");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as any;

  const { data: r, error } = await admin.rpc("commercial_usage_reserve", {
    _usage_key: usageKey,
    _quantity: 1,
    _idempotency_key: idempotencyKey,
    _reference_type: reference?.type ?? null,
    _reference_id: reference?.id ?? null,
    _agency_id: agencyId,
  });
  if (error) throw new Error("Nutzung konnte nicht geprüft werden");
  if (!r?.ok) {
    if (r?.voided) throw new Error("Diese Anfrage wurde bereits abgebrochen. Bitte erneut starten.");
    throw new CommercialBlockedError(r?.decision === "INSUFFICIENT_CREDITS" ? "INSUFFICIENT_CREDITS" : r?.decision ?? "NOT_AVAILABLE", r?.required, r?.available);
  }

  let result: T;
  try {
    result = await execute();
  } catch (e) {
    if (!r.replayed) await admin.rpc("commercial_usage_settle", { _usage_event_id: r.usage_event_id, _success: false, _reason: "execution_failed" });
    throw e;
  }
  if (!r.replayed) await admin.rpc("commercial_usage_settle", { _usage_event_id: r.usage_event_id, _success: true });
  return result;
}
