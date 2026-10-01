/**
 * Immolia Template Foundation (Core Consolidation 1)
 *
 * Trennung:
 *  A) IMMOLIA_SYSTEM_TEMPLATES – generische, fachlich freigegebene Immolia-Defaults.
 *     Werden ausschliesslich beim Tenant-Provisioning (serverseitig, einmalig)
 *     angelegt – nie beim Öffnen einer Seite.
 *  B) Tenant-eigene Vorlagen – Zeilen in document_templates mit agency_id der Firma.
 *
 * Bewusst leer: Es existieren noch keine freigegebenen neutralen Immolia-Verträge.
 * ASIMO_TEMPLATES (document-templates.ts) sind ASIMO-Tenantinhalte und dürfen
 * hier NICHT eingetragen werden.
 */
export type SystemTemplateDef = {
  /** Stabiler Schlüssel, Idempotenz pro Firma */
  key: string;
  name: string;
  type: "mandate" | "mandate_partial" | "reservation" | "reservation_receipt" | "nda" | "contract" | "expose" | "other";
  category: string;
  description: string;
  content: string;
  /** Version für spätere, kontrollierte Aktualisierung */
  version: number;
};

export const IMMOLIA_SYSTEM_TEMPLATES: readonly SystemTemplateDef[] = [];
