/**
 * Zentrales Regelwerk pro Objektart: Unterarten, sichtbare Felder und
 * typische Ausstattung. Wird vom Erfassungs-Assistenten und der
 * Detailseite gemeinsam verwendet (eine Quelle, kein Duplikat).
 */
export type StructureKind = "single" | "building" | "unit_in_building";

export type SubTypeOption = {
  v: string;
  label: string;
  desc?: string;
  group?: string;
  /** Erzwingt eine Gebäudestruktur, wenn gewählt. */
  structure?: StructureKind;
};

export type AreaField =
  | "living_area" | "usable_area" | "plot_area" | "rooms" | "bathrooms"
  | "year_built" | "renovated_at" | "building_volume" | "hall_height"
  | "floor_load" | "zone" | "utilization_ratio" | "development_status"
  | "parking_spaces" | "ev_charging" | "unit_count_residential" | "unit_count_commercial";

export type TypeConfig = {
  subTypeTitle: string;
  subTypes: SubTypeOption[];
  /** Fixe Struktur: Schritt-Auswahl entfällt. */
  fixedStructure?: StructureKind;
  areaFields: AreaField[];
  /** Wohn-Merkmale (Balkon, Lift …) & Heizung anzeigen. */
  residentialEquipment: boolean;
  heating: boolean;
  /** Typische Zusatz-Merkmale als Schnellauswahl. */
  quickFeatures: string[];
  /** Ertrags-/Renditefelder im Preis-Schritt. */
  yieldFields: boolean;
  /** Einheiten-Schritt immer anzeigen. */
  units: boolean;
  areaLabel?: string;
};

const LIVING: AreaField[] = ["living_area", "usable_area", "plot_area", "rooms", "bathrooms", "year_built", "renovated_at"];

export const PROPERTY_TYPE_CONFIG: Record<string, TypeConfig> = {
  house: {
    subTypeTitle: "Welche Art von Haus?",
    fixedStructure: "single",
    subTypes: [
      { v: "detached", label: "Freistehendes EFH" },
      { v: "semi_detached", label: "Doppelhaushälfte" },
      { v: "terraced_end", label: "Reiheneckhaus" },
      { v: "terraced_mid", label: "Reihenmittelhaus" },
      { v: "villa", label: "Villa / Anwesen" },
      { v: "farmhouse", label: "Bauernhaus / Rustico" },
      { v: "chalet", label: "Chalet / Ferienhaus" },
    ],
    areaFields: [...LIVING, "building_volume", "parking_spaces"],
    residentialEquipment: true, heating: true, yieldFields: false, units: false,
    quickFeatures: ["Cheminée", "Wintergarten", "Sauna", "Pool", "Photovoltaik", "Wärmepumpe"],
  },
  apartment: {
    subTypeTitle: "Welche Art von Wohnung?",
    subTypes: [
      { v: "floor_apartment", label: "Etagenwohnung" },
      { v: "attic", label: "Attika / Penthouse" },
      { v: "maisonette", label: "Maisonette / Duplex" },
      { v: "garden_apartment", label: "Gartenwohnung" },
      { v: "studio", label: "Studio / Loft" },
    ],
    areaFields: ["living_area", "usable_area", "rooms", "bathrooms", "year_built", "renovated_at", "parking_spaces"],
    residentialEquipment: true, heating: true, yieldFields: false, units: false,
    quickFeatures: ["Cheminée", "Reduit", "Waschturm", "Bastelraum", "Stockwerkeigentum"],
  },
  mixed_use: {
    subTypeTitle: "Welche Art von Liegenschaft?",
    fixedStructure: "building",
    subTypes: [
      { v: "mfh", label: "Mehrfamilienhaus", desc: "Reine Wohnnutzung" },
      { v: "residential_commercial", label: "Wohn- & Geschäftshaus", desc: "Wohnungen + Ladenlokale/Büros" },
      { v: "commercial_building", label: "Geschäftshaus", desc: "Überwiegend Gewerbe" },
      { v: "estate", label: "Areal / Überbauung", desc: "Mehrere Gebäude" },
    ],
    areaFields: ["unit_count_residential", "unit_count_commercial", "living_area", "usable_area", "plot_area", "building_volume", "year_built", "renovated_at", "parking_spaces"],
    residentialEquipment: true, heating: true, yieldFields: true, units: true,
    quickFeatures: ["Lift", "Waschküche", "Veloraum", "Einstellhalle", "Photovoltaik"],
  },
  commercial: {
    subTypeTitle: "Um welches Gewerbe handelt es sich?",
    subTypes: [
      { v: "office", label: "Büro", group: "Büro & Praxis" },
      { v: "practice", label: "Praxis / Kanzlei", group: "Büro & Praxis" },
      { v: "coworking", label: "Co-Working", group: "Büro & Praxis" },
      { v: "hotel", label: "Hotel / Pension", group: "Gastro & Hotellerie" },
      { v: "restaurant", label: "Restaurant / Bar / Café", group: "Gastro & Hotellerie" },
      { v: "shop", label: "Ladenlokal", group: "Handel" },
      { v: "shopping_center", label: "Einkaufszentrum", group: "Handel", structure: "building" },
      { v: "showroom", label: "Showroom / Fachmarkt", group: "Handel" },
      { v: "warehouse", label: "Lager / Logistik", group: "Industrie" },
      { v: "workshop", label: "Werkstatt / Atelier", group: "Industrie" },
      { v: "production", label: "Produktion / Industrie", group: "Industrie" },
      { v: "gas_station", label: "Tankstelle / Waschanlage", group: "Spezial" },
      { v: "leisure", label: "Freizeit / Sport", group: "Spezial" },
    ],
    areaFields: ["usable_area", "plot_area", "hall_height", "floor_load", "building_volume", "year_built", "renovated_at", "parking_spaces"],
    residentialEquipment: false, heating: true, yieldFields: true, units: false,
    areaLabel: "Nutzfläche",
    quickFeatures: ["Schaufenster", "Starkstrom", "Gastro-Abluft", "Warenlift", "Anlieferungsrampe", "Klimaanlage", "Ausgebaut", "Rohbau", "Kundenparkplätze"],
  },
  land: {
    subTypeTitle: "Was für ein Grundstück?",
    fixedStructure: "single",
    subTypes: [
      { v: "building_land", label: "Bauland (Wohnen)" },
      { v: "commercial_land", label: "Gewerbe- / Industrieland" },
      { v: "mixed_zone", label: "Mischzone" },
      { v: "meadow", label: "Wiese / Garten" },
      { v: "agricultural", label: "Landwirtschaft" },
      { v: "demolition", label: "Mit Abbruchobjekt", desc: "Bestehendes Gebäude wird abgerissen" },
      { v: "forest", label: "Wald" },
    ],
    areaFields: ["plot_area", "zone", "utilization_ratio", "development_status"],
    residentialEquipment: false, heating: false, yieldFields: false, units: false,
    quickFeatures: ["Wasser", "Abwasser", "Strom", "Glasfaser", "Altlastenfrei", "Hanglage", "Seesicht", "Baubewilligung vorhanden"],
  },
  parking: {
    subTypeTitle: "Wo befindet sich der Parkplatz?",
    subTypes: [
      { v: "underground", label: "Tiefgarage / Einstellhalle", structure: "unit_in_building" },
      { v: "garage_box", label: "Einzelgarage / Box" },
      { v: "outdoor", label: "Aussenparkplatz" },
      { v: "carport", label: "Carport" },
      { v: "in_mfh", label: "In Mehrfamilienhaus", structure: "unit_in_building" },
      { v: "in_house", label: "Bei Einfamilienhaus" },
      { v: "commercial_parking", label: "Gewerbe / Parkhaus" },
      { v: "motorbike", label: "Motorradplatz" },
    ],
    areaFields: ["usable_area", "parking_spaces", "ev_charging"],
    residentialEquipment: false, heating: false, yieldFields: false, units: false,
    areaLabel: "Fläche",
    quickFeatures: ["Elektrisches Tor", "Funkfernbedienung", "Stromanschluss", "Videoüberwachung", "Überdacht", "Breiter Platz"],
  },
  other: {
    subTypeTitle: "Struktur",
    subTypes: [],
    areaFields: [...LIVING],
    residentialEquipment: true, heating: true, yieldFields: false, units: false,
    quickFeatures: [],
  },
};

export function typeConfig(type: string | null | undefined): TypeConfig {
  return PROPERTY_TYPE_CONFIG[type ?? ""] ?? PROPERTY_TYPE_CONFIG.other;
}

export function subTypeLabel(type: string | null | undefined, sub: string | null | undefined): string | null {
  if (!sub) return null;
  return typeConfig(type).subTypes.find((s) => s.v === sub)?.label ?? sub;
}

export const EV_CHARGING_OPTIONS = [
  { v: "none", label: "Keine" },
  { v: "prepared", label: "Vorbereitet" },
  { v: "installed", label: "Vorhanden" },
];

export const DEVELOPMENT_OPTIONS = [
  { v: "full", label: "Voll erschlossen" },
  { v: "partial", label: "Teilerschlossen" },
  { v: "none", label: "Nicht erschlossen" },
];

export const UNIT_TYPE_OPTIONS = [
  { v: "apartment", label: "Wohnung" },
  { v: "shop", label: "Ladenlokal" },
  { v: "office", label: "Büro / Praxis" },
  { v: "commercial", label: "Gewerbe" },
  { v: "storage", label: "Lager" },
  { v: "parking", label: "Parkplatz" },
];

/** Einheitentyp → gültiger property_type-Enumwert. */
export function unitPropertyType(unitType: string): string {
  if (unitType === "apartment" || unitType === "parking") return unitType;
  return "commercial";
}

export const AREA_FIELD_LABELS: Record<AreaField, string> = {
  living_area: "Wohnfläche (m²)",
  usable_area: "Nutzfläche (m²)",
  plot_area: "Grundstücksfläche (m²)",
  rooms: "Zimmer",
  bathrooms: "Nasszellen",
  year_built: "Baujahr",
  renovated_at: "Renoviert",
  building_volume: "Kubatur (m³)",
  hall_height: "Deckenhöhe (m)",
  floor_load: "Bodenbelastung (kg/m²)",
  zone: "Bauzone",
  utilization_ratio: "Ausnützungsziffer",
  development_status: "Erschliessung",
  parking_spaces: "Anzahl Parkplätze",
  ev_charging: "E-Ladestation",
  unit_count_residential: "Wohneinheiten",
  unit_count_commercial: "Gewerbeeinheiten",
};
