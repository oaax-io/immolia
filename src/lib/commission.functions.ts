// ---------------------------------------------------------------------------
// Provisions-Modul – Etappe 1: serverseitige Buchungslogik (keine UI).
//
// Diese Datei enthält die drei Buchungsfunktionen, die aus der UI (Etappe 2/3)
// per Button aufgerufen werden:
//
//   1. bookReservationFee({ reservationId })   -> bucht eine Reservationsgebühr
//   2. bookClosingCommission({ propertyId })   -> bucht die Abschlussprovision
//   3. bookCancellationFee({ mandateId })      -> bucht die Rücktrittsentschädigung
//
// Grundprinzip: Provision wird NICHT mehr live berechnet und verworfen, sondern
// als Ledger-Eintrag in `commission_records` persistiert. Die Aufteilung auf
// Mitarbeitende wird als unveränderliche Momentaufnahme in
// `commission_record_splits` festgehalten (inkl. Snapshot des persönlichen
// Auszahlungssatzes `profiles.commission_payout_rate`), damit spätere Änderungen
// an Splits oder Sätzen alte Buchungen nicht rückwirkend verfälschen.
//
// Alle Funktionen sind idempotent: ein zweiter Aufruf für dasselbe Ereignis
// erzeugt kein Duplikat, sondern wirft einen klaren Fehler.
// ---------------------------------------------------------------------------

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// ---------- Typen ----------

export type CommissionRecordType =
  | "commission"
  | "reservation_fee"
  | "cancellation_fee"
  | "referral_fee"
  | "adjustment";

export interface CommissionSplitRow {
  id: string;
  user_id: string;
  role: string;
  split_percent: number;
  gross_share: number;
  payout_rate: number;
  payout_amount: number;
}

export interface CommissionRecordResult {
  id: string;
  property_id: string;
  mandate_id: string | null;
  reservation_id: string | null;
  client_id: string | null;
  record_type: CommissionRecordType;
  status: string;
  gross_amount: number;
  currency: string;
  credited_reservation_record_id: string | null;
  booked_at: string;
  description: string | null;
  splits: CommissionSplitRow[];
}

// ---------- Helpers ----------

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Aktive Mandats-Status (ein Mandat gilt als "laufend"). */
const ACTIVE_MANDATE_STATUS = ["active", "signed", "sent"];

/**
 * Ermittelt die zu verwendende Split-Vorlage für ein Objekt.
 * Reihenfolge:
 *   1. Einträge in `mandate_commission_splits` für die property_id
 *   2. Fallback: 100 % an `properties.assigned_to` (Rolle 'listing_agent')
 * Gibt [] zurück, wenn weder Vorlage noch assigned_to existiert – dann wird
 * der Ledger-Eintrag ohne Splits gebucht (kann später ergänzt werden).
 */
async function resolveSplitTemplate(
  sb: any,
  propertyId: string,
  assignedTo: string | null,
): Promise<Array<{ user_id: string; role: string; split_percent: number }>> {
  const { data: planned } = await sb
    .from("mandate_commission_splits")
    .select("user_id, role, split_percent")
    .eq("property_id", propertyId);

  if (planned?.length) {
    return planned.map((p: any) => ({
      user_id: p.user_id as string,
      role: (p.role as string) ?? "other",
      split_percent: Number(p.split_percent) || 0,
    }));
  }

  if (assignedTo) {
    return [{ user_id: assignedTo, role: "listing_agent", split_percent: 100 }];
  }

  return [];
}

/**
 * Erstellt die Split-Snapshots zu einem Ledger-Eintrag.
 * `payout_rate` wird aus `profiles.commission_payout_rate` gelesen (Default 50).
 */
async function createRecordSplits(
  sb: any,
  recordId: string,
  grossAmount: number,
  template: Array<{ user_id: string; role: string; split_percent: number }>,
): Promise<CommissionSplitRow[]> {
  if (!template.length) return [];

  const userIds = [...new Set(template.map((t) => t.user_id))];
  const { data: profiles } = await sb
    .from("profiles")
    .select("id, commission_payout_rate")
    .in("id", userIds);

  const rateById = new Map<string, number>(
    (profiles ?? []).map((p: any) => [
      p.id as string,
      p.commission_payout_rate == null ? 50 : Number(p.commission_payout_rate),
    ]),
  );

  const rows = template.map((t) => {
    const payoutRate = rateById.get(t.user_id) ?? 50;
    const grossShare = round2((grossAmount * t.split_percent) / 100);
    return {
      commission_record_id: recordId,
      user_id: t.user_id,
      role: t.role,
      split_percent: t.split_percent,
      gross_share: grossShare,
      payout_rate: payoutRate,
      payout_amount: round2((grossShare * payoutRate) / 100),
    };
  });

  // Ohne RETURNING einfügen: Nicht-Admins dürfen Anteile von Kollegen anlegen (tenant_insert),
  // aber nur eigene lesen (tenant_select). insert().select() scheitert sonst mit einem RLS-Fehler.
  const { error } = await sb.from("commission_record_splits").insert(rows);
  if (error) throw new Error(`Splits konnten nicht gespeichert werden: ${error.message}`);

  // Danach nur die für diese Person sichtbaren Anteile zurückgeben (RLS).
  const { data: visible } = await sb
    .from("commission_record_splits")
    .select("id, user_id, role, split_percent, gross_share, payout_rate, payout_amount")
    .eq("commission_record_id", recordId);
  return (visible ?? []) as CommissionSplitRow[];
}

/** Ledger-Eintrag anlegen und mit Splits zurückgeben. */
async function insertRecord(
  sb: any,
  payload: Record<string, unknown>,
  template: Array<{ user_id: string; role: string; split_percent: number }>,
): Promise<CommissionRecordResult> {
  const { data: record, error } = await sb
    .from("commission_records")
    .insert(payload)
    .select("*")
    .single();

  if (error || !record) {
    throw new Error(`Provisionsbuchung fehlgeschlagen: ${error?.message ?? "unbekannter Fehler"}`);
  }

  const splits = await createRecordSplits(
    sb,
    record.id as string,
    Number(record.gross_amount) || 0,
    template,
  );

  return { ...(record as any), gross_amount: Number(record.gross_amount), splits };
}

// ---------------------------------------------------------------------------
// 1) Reservationsgebühr buchen
// ---------------------------------------------------------------------------

export const bookReservationFee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ reservationId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<CommissionRecordResult> => {
    const sb = context.supabase as any;

    const { data: reservation, error } = await sb
      .from("reservations")
      .select("id, property_id, client_id, reservation_fee")
      .eq("id", data.reservationId)
      .maybeSingle();

    if (error || !reservation) throw new Error("Reservation nicht gefunden.");

    const fee = Number(reservation.reservation_fee) || 0;
    if (fee <= 0) throw new Error("Für diese Reservation ist keine Reservationsgebühr hinterlegt.");

    // Idempotenz: pro Reservation nur eine Gebührenbuchung.
    const { data: existing } = await sb
      .from("commission_records")
      .select("id")
      .eq("reservation_id", reservation.id)
      .eq("record_type", "reservation_fee")
      .maybeSingle();
    if (existing) throw new Error("Die Reservationsgebühr wurde für diese Reservation bereits gebucht.");

    const { data: property } = await sb
      .from("properties")
      .select("id, assigned_to")
      .eq("id", reservation.property_id)
      .maybeSingle();

    const template = await resolveSplitTemplate(sb, reservation.property_id, property?.assigned_to ?? null);

    return insertRecord(
      sb,
      {
        property_id: reservation.property_id,
        reservation_id: reservation.id,
        client_id: reservation.client_id ?? null,
        record_type: "reservation_fee",
        status: "booked",
        gross_amount: round2(fee),
        currency: "CHF",
        description: "Reservationsgebühr",
        created_by: context.userId,
      },
      template,
    );
  });

// ---------------------------------------------------------------------------
// 2) Deal erfassen oder bearbeiten (Verkauf / Vermietung)
//
// Ersetzt die frühere Funktion `bookClosingCommission`: statt nur eines
// Betrags wird der komplette Abschluss erfasst (Verkaufspreis, Käufer,
// Finanzierung, abschliessende Person, Aufteilung, Abschlussdatum).
// Existiert bereits eine Abschlussbuchung für das Objekt, wird sie
// aktualisiert – rückwirkende Korrekturen sind ausdrücklich erwünscht.
// ---------------------------------------------------------------------------

const splitSchema = z.object({
  user_id: z.string().uuid(),
  role: z.string().min(1),
  split_percent: z.number(),
});

export const saveDeal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        propertyId: z.string().uuid(),
        clientId: z.string().uuid().nullable().optional(),
        salePrice: z.number(),
        commissionModel: z.enum(["percent", "fixed"]),
        commissionValue: z.number(),
        finalCommissionAmount: z.number().positive().optional(),
        financingAmount: z.number().nullable().optional(),
        financingDossierId: z.string().uuid().nullable().optional(),
        closedBy: z.string().uuid().nullable().optional(),
        splits: z.array(splitSchema).default([]),
        bookedAt: z.string().optional(),
        notes: z.string().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<CommissionRecordResult> => {
    const sb = context.supabase as any;

    const { data: property, error } = await sb
      .from("properties")
      .select("id, price, assigned_to")
      .eq("id", data.propertyId)
      .maybeSingle();
    if (error || !property) throw new Error("Immobilie nicht gefunden.");

    // 1) Bruttoprovision bestimmen.
    let gross = data.finalCommissionAmount ?? 0;
    if (!gross) {
      gross =
        data.commissionModel === "percent"
          ? (data.salePrice * data.commissionValue) / 100
          : data.commissionValue;
    }
    gross = round2(gross);
    if (gross <= 0) throw new Error("Die Provision konnte nicht ermittelt werden (Betrag ist 0).");

    // Aktives Mandat für die Verknüpfung suchen.
    const { data: mandates } = await sb
      .from("mandates")
      .select("id, status, client_id")
      .eq("property_id", property.id)
      .order("created_at", { ascending: false });
    const mandate =
      (mandates ?? []).find((m: any) => ACTIVE_MANDATE_STATUS.includes(String(m.status))) ??
      (mandates ?? [])[0] ??
      null;

    // Bereits gebuchte Reservationsgebühr desselben Objekts verlinken.
    const { data: reservationFeeRecord } = await sb
      .from("commission_records")
      .select("id")
      .eq("property_id", property.id)
      .eq("record_type", "reservation_fee")
      .neq("status", "void")
      .order("booked_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Vom Aufrufer gelieferte Aufteilung (UI ist die Quelle der Wahrheit);
    // ohne Angabe greift der bisherige Fallback.
    let template = data.splits
      .filter((s) => s.user_id)
      .map((s) => ({ user_id: s.user_id, role: s.role || "other", split_percent: Number(s.split_percent) || 0 }));
    if (!template.length) {
      template = await resolveSplitTemplate(sb, property.id, property.assigned_to ?? null);
    }

    const bookedAt = data.bookedAt ? new Date(data.bookedAt).toISOString() : new Date().toISOString();

    const payload: Record<string, unknown> = {
      property_id: property.id,
      mandate_id: mandate?.id ?? null,
      client_id: data.clientId ?? mandate?.client_id ?? null,
      record_type: "commission",
      status: "booked",
      gross_amount: gross,
      currency: "CHF",
      sale_price: data.salePrice ? round2(data.salePrice) : null,
      financing_amount: data.financingAmount != null ? round2(data.financingAmount) : null,
      financing_dossier_id: data.financingDossierId ?? null,
      closed_by: data.closedBy ?? null,
      credited_reservation_record_id: reservationFeeRecord?.id ?? null,
      booked_at: bookedAt,
      description: data.notes?.trim() || "Abschlussprovision",
    };

    // 2) Existierende Abschlussbuchung? -> aktualisieren, sonst neu anlegen.
    const { data: existing } = await sb
      .from("commission_records")
      .select("id")
      .eq("property_id", property.id)
      .eq("record_type", "commission")
      .neq("status", "void")
      .maybeSingle();

    if (!existing) {
      return insertRecord(sb, { ...payload, created_by: context.userId }, template);
    }

    const { data: record, error: updErr } = await sb
      .from("commission_records")
      .update(payload)
      .eq("id", existing.id)
      .select("*")
      .single();
    if (updErr || !record) {
      throw new Error(`Deal konnte nicht aktualisiert werden: ${updErr?.message ?? "unbekannter Fehler"}`);
    }

    const { error: delErr } = await sb
      .from("commission_record_splits")
      .delete()
      .eq("commission_record_id", existing.id);
    if (delErr) throw new Error(`Alte Aufteilung konnte nicht entfernt werden: ${delErr.message}`);

    const splits = await createRecordSplits(sb, existing.id as string, gross, template);
    return { ...(record as any), gross_amount: Number(record.gross_amount), splits };
  });


// ---------------------------------------------------------------------------
// 3) Rücktritts-/Kündigungsentschädigung buchen (fixer CHF-Betrag am Mandat)
// ---------------------------------------------------------------------------

export const bookCancellationFee = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ mandateId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }): Promise<CommissionRecordResult> => {
    const sb = context.supabase as any;

    const { data: mandate, error } = await sb
      .from("mandates")
      .select("id, property_id, client_id, cancellation_fee")
      .eq("id", data.mandateId)
      .maybeSingle();
    if (error || !mandate) throw new Error("Mandat nicht gefunden.");

    const fee = Number(mandate.cancellation_fee) || 0;
    if (fee <= 0) throw new Error("Im Mandat ist keine Rücktrittsentschädigung hinterlegt.");
    if (!mandate.property_id) throw new Error("Das Mandat ist keinem Objekt zugeordnet.");

    // Idempotenz: pro Mandat nur eine Entschädigungsbuchung.
    const { data: existing } = await sb
      .from("commission_records")
      .select("id")
      .eq("mandate_id", mandate.id)
      .eq("record_type", "cancellation_fee")
      .maybeSingle();
    if (existing) throw new Error("Die Rücktrittsentschädigung wurde für dieses Mandat bereits gebucht.");

    const { data: property } = await sb
      .from("properties")
      .select("id, assigned_to")
      .eq("id", mandate.property_id)
      .maybeSingle();

    const template = await resolveSplitTemplate(sb, mandate.property_id, property?.assigned_to ?? null);

    return insertRecord(
      sb,
      {
        property_id: mandate.property_id,
        mandate_id: mandate.id,
        client_id: mandate.client_id ?? null,
        record_type: "cancellation_fee",
        status: "booked",
        gross_amount: round2(fee),
        currency: "CHF",
        description: "Rücktritts-/Kündigungsentschädigung",
        created_by: context.userId,
      },
      template,
    );
  });
