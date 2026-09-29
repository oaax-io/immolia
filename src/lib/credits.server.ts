/**
 * Phase 5.8B – zentraler Ablauf für kostenpflichtige Aktionen (nur Server).
 * reserve (als Benutzer: Firma/Kosten bestimmt die Datenbank) → execute → finalize,
 * bei Fehler → release. Finalize/Release laufen nur mit Server-Rechten.
 */
export type InsufficientCredits = { ok: false; reason: "INSUFFICIENT_CREDITS"; required: number; available: number };

export async function withCreditReservation<T>(
  userSupabase: any,
  actionKey: string,
  idempotencyKey: string,
  execute: () => Promise<T>,
  reference?: { type?: string; id?: string },
): Promise<{ ok: true; result: T; charged: number } | InsufficientCredits> {
  const { data: rsv, error } = await userSupabase.rpc("credit_reserve", {
    _action_key: actionKey,
    _idempotency_key: idempotencyKey,
    _reference_type: reference?.type ?? null,
    _reference_id: reference?.id ?? null,
  });
  if (error) throw new Error("Credit-Reservierung nicht möglich");
  if (!rsv?.ok) {
    if (rsv?.reason === "INSUFFICIENT_CREDITS") {
      return { ok: false, reason: "INSUFFICIENT_CREDITS", required: rsv.required, available: rsv.available };
    }
    throw new Error("Aktion bereits abgeschlossen oder freigegeben");
  }
  if (rsv.free) return { ok: true, result: await execute(), charged: 0 };

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const admin = supabaseAdmin as any;
  let result: T;
  try {
    result = await execute();
  } catch (e) {
    // Vor/ohne Leistung: vollständig freigeben. Teilleistung: später action-spezifische settlement_policy.
    await admin.rpc("credit_reservation_release", { _reservation_id: rsv.reservation_id, _reason: "execution_failed" });
    throw e;
  }
  await admin.rpc("credit_reservation_finalize", { _reservation_id: rsv.reservation_id });
  return { ok: true, result, charged: rsv.amount };
}
