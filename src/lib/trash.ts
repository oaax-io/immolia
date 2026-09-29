import { supabase } from "@/integrations/supabase/client";

/** Tabellen, die über den Papierkorb wiederhergestellt werden können. */
export const TRASH_TABLES = [
  "properties",
  "clients",
  "leads",
  "tasks",
  "appointments",
  "documents",
  "mandates",
  "reservations",
  "checklists",
  "nda_agreements",
  "financing_dossiers",
  "property_media",
  "generated_documents",
  "client_financial_items",
  "matches",
] as const;

export type TrashTable = (typeof TRASH_TABLES)[number];

export const TRASH_LABELS: Record<TrashTable, string> = {
  properties: "Immobilie",
  clients: "Kunde",
  leads: "Lead",
  tasks: "Aufgabe",
  appointments: "Termin",
  documents: "Dokument",
  mandates: "Mandat",
  reservations: "Reservation",
  checklists: "Checkliste",
  nda_agreements: "NDA",
  financing_dossiers: "Finanzierung",
  property_media: "Medien",
  generated_documents: "Generiertes Dokument",
  client_financial_items: "Finanzposition",
  matches: "Matching",
};

export function guessLabel(row: Record<string, any>): string {
  const first =
    row.title ||
    row.name ||
    row.file_name ||
    row.subject ||
    [row.first_name, row.last_name].filter(Boolean).join(" ") ||
    row.address ||
    row.reference ||
    row.email;
  return (first as string) || "Eintrag";
}

export function guessSubtitle(row: Record<string, any>): string | null {
  return (row.reference || row.city || row.status || row.email || null) as string | null;
}

/**
 * Verschiebt Datensätze atomar in den Papierkorb (Server-Funktion trash_delete):
 * Snapshot schreiben und Original löschen in EINER Transaktion. Schlägt die Sicherung
 * fehl, bleibt das Original vollständig erhalten. Kein Fallback auf einfaches Löschen.
 */
export async function deleteToTrash(table: TrashTable, ids: string | string[]) {
  const list = (Array.isArray(ids) ? ids : [ids]).filter(Boolean);
  if (!list.length) return;
  const { error } = await supabase.rpc("trash_delete" as any, { _table: table, _ids: list });
  if (error) throw error;
}

export async function restoreFromTrash(id: string) {
  const { error } = await supabase.rpc("trash_restore" as any, { _id: id });
  if (error) throw error;
}

export async function purgeTrashItem(id: string) {
  const { error } = await supabase.from("trash_items").delete().eq("id", id);
  if (error) throw error;
}
