/**
 * Zentrale Module Registry (Phase 4.5) – einzige Quelle für Modul-Metadaten.
 * DB-Spiegel: public.platform_module_keys() / platform_core_module_keys() – bei Änderungen beide anpassen.
 */
export type ModuleCategory = "Basis" | "CRM" | "Verkauf" | "Finanzierung" | "Organisation" | "Hilfe";
export type ModuleDef = { key: string; label: string; description: string; category: ModuleCategory; is_core: boolean; default_enabled?: boolean };

export const MODULE_REGISTRY: ModuleDef[] = [
  { key: "dashboard", label: "Dashboard", description: "Startseite nach der Anmeldung", category: "Basis", is_core: true },
  { key: "leads", label: "Leads", description: "Anfragen erfassen und qualifizieren", category: "CRM", is_core: false },
  { key: "clients", label: "Kunden", description: "Kundenstamm und Kontakte", category: "CRM", is_core: false },
  { key: "properties", label: "Immobilien", description: "Objekte, Flächen, Kennzahlen, Marktanalysen", category: "CRM", is_core: false },
  { key: "appointments", label: "Termine", description: "Besichtigungen und Meetings", category: "Organisation", is_core: false },
  { key: "tasks", label: "Aufgaben", description: "Aufgaben und Erinnerungen", category: "Organisation", is_core: false },
  { key: "documents", label: "Dokumente", description: "Dokumentencenter und erzeugte Dokumente", category: "Organisation", is_core: false },
  { key: "employees", label: "Mitarbeitende", description: "Team und Rollen verwalten", category: "Organisation", is_core: false },
  { key: "company_settings", label: "Firmeneinstellungen", description: "Firmendaten und Adresse", category: "Organisation", is_core: false },
  { key: "matching", label: "Matching", description: "Suchprofile mit Objekten abgleichen", category: "Verkauf", is_core: false },
  { key: "exposes", label: "Exposés", description: "Exposés und öffentliches Portal", category: "Verkauf", is_core: false },
  { key: "reservations", label: "Reservationen", description: "Reservationsvereinbarungen", category: "Verkauf", is_core: false },
  { key: "mandates", label: "Mandate", description: "Maklermandate und Provisionsaufteilung", category: "Verkauf", is_core: false },
  { key: "ndas", label: "Vertraulichkeitsvereinbarungen", description: "NDAs für Interessenten", category: "Verkauf", is_core: false },
  { key: "financing", label: "Finanzierung", description: "Finanzierungsdossiers, Hypothekenrechner, Bank-Links", category: "Finanzierung", is_core: false },
  { key: "checklists", label: "Checklisten", description: "Checklisten und Vorlagen", category: "Organisation", is_core: false },
  { key: "media", label: "Medien", description: "Bilder und Medien zu Objekten", category: "Verkauf", is_core: false },
  { key: "docs", label: "Hilfe", description: "Hilfe und Anleitungen", category: "Hilfe", is_core: false },
  { key: "analytics", label: "Auswertungen", description: "Kennzahlen und Berichte", category: "Organisation", is_core: false },
  { key: "feedback", label: "Feedback", description: "Ideen und Fehler melden", category: "Hilfe", is_core: false },
];

export const MODULE_BY_KEY: Record<string, ModuleDef> = Object.fromEntries(MODULE_REGISTRY.map((m) => [m.key, m]));
export const MODULE_KEYS = MODULE_REGISTRY.map((m) => m.key);
export const CORE_MODULE_KEYS = MODULE_REGISTRY.filter((m) => m.is_core).map((m) => m.key);
export const MODULE_LABEL: Record<string, string> = Object.fromEntries(MODULE_REGISTRY.map((m) => [m.key, m.label]));
/** Vorauswahl im Assistenten «Neues Unternehmen» (kein Kernmodul-Status). */
/** Immolia-Core-Startpaket = Registry-Module mit default_enabled !== false (DB-Spiegel: platform_default_module_keys()). */
export const DEFAULT_MODULES = MODULE_REGISTRY.filter((m) => m.default_enabled !== false).map((m) => m.key);

export type ModuleState = "active" | "entitled" | "locked";
export function moduleState(row: { is_entitled: boolean; is_enabled: boolean } | undefined): ModuleState {
  if (!row || !row.is_entitled) return "locked";
  return row.is_enabled ? "active" : "entitled";
}
export const MODULE_STATE_LABEL: Record<ModuleState, string> = { active: "Aktiv", entitled: "Freigeschaltet, ausgeschaltet", locked: "Gesperrt" };
