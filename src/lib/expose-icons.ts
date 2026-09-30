/**
 * Ausstattungs-Icons für Exposés.
 *
 * Reine SVG-Pfade (24×24 Raster, Linien-Stil) – bewusst ohne Abhängigkeit zu
 * lucide-react, weil das Exposé als reines HTML/PDF ohne React gerendert wird.
 *
 * `matchExposeIcon` erkennt anhand von Schlagwörtern, welches Symbol zu einer
 * frei erfassten Ausstattung passt (Stammliste ist pro Firma konfigurierbar).
 */

export type ExposeIconKey =
  | "balcony" | "terrace" | "garden" | "view" | "elevator" | "parking" | "garage"
  | "fireplace" | "pool" | "sauna" | "cellar" | "attic" | "accessible" | "pets"
  | "newbuild" | "renovated" | "energy" | "solar" | "heatpump" | "airco"
  | "kitchen" | "bath" | "laundry" | "smarthome" | "security" | "internet"
  | "transport" | "school" | "shopping" | "quiet" | "furnished" | "storage"
  | "feature";

/** 24×24 Pfaddaten, stroke-basiert (fill: none). */
export const EXPOSE_ICON_PATHS: Record<ExposeIconKey, string> = {
  balcony: "M3 10h18M5 10v10M19 10v10M9 14v6M15 14v6M4 10l8-6 8 6",
  terrace: "M3 13h18M5 13v8M19 13v8M9 17h6M7 9l5-5 5 5",
  garden: "M12 20v-6M12 14c-3 0-5-2-5-5 3 0 5 2 5 5zM12 14c3 0 5-2 5-5-3 0-5 2-5 5zM4 20h16",
  view: "M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z M12 15a3 3 0 100-6 3 3 0 000 6z",
  elevator: "M5 3h14v18H5zM12 3v18M8 8l1.5-2L11 8M13 16l1.5 2L16 16",
  parking: "M6 3h12v18H6zM10 17V8h3a2.5 2.5 0 010 5h-3",
  garage: "M3 21V9l9-5 9 5v12M7 21v-7h10v7M7 17h10",
  fireplace: "M12 21c3 0 5-2 5-5 0-4-5-5-3-9-3 1-5 3-5 6 0-1-1-2-2-2 0 2-1 2-1 5 0 3 2 5 6 5z",
  pool: "M2 17c2 0 2 2 4 2s2-2 4-2 2 2 4 2 2-2 4-2 2 2 4 2M7 15V6a2 2 0 014 0v9M13 15V6a2 2 0 014 0v9M7 9h10",
  sauna: "M4 20h16V9H4zM8 5v2M12 4v3M16 5v2M8 13h8",
  cellar: "M4 21V8l8-5 8 5v13M9 21v-6h6v6M4 12h16",
  attic: "M3 21l9-16 9 16zM9 21v-5h6v5",
  accessible: "M12 5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM11 8v5h4l3 6M11 13a5 5 0 103 8",
  pets: "M6 12a2 2 0 100-4 2 2 0 000 4zM18 12a2 2 0 100-4 2 2 0 000 4zM9 7a2 2 0 100-4 2 2 0 000 4zM15 7a2 2 0 100-4 2 2 0 000 4zM12 21c-3 0-5-2-5-4s2-4 5-4 5 2 5 4-2 4-5 4z",
  newbuild: "M3 21h18M6 21V8l6-4 6 4v13M10 21v-5h4v5M9 11h6",
  renovated: "M14 6l4 4M3 21l4-1 11-11-3-3L4 17zM15 4l5 5",
  energy: "M13 2L4 14h7l-1 8 9-12h-7z",
  solar: "M4 16h16l-2-8H6zM10 8v8M14 8v8M4 20h16M12 2v3M5 5l2 2M19 5l-2 2",
  heatpump: "M4 5h16v14H4zM8 9v6M12 9v6M16 9v6M9 2v2M15 2v2",
  airco: "M3 7h18v6H3zM6 16v3M12 16v4M18 16v3M6 10h12",
  kitchen: "M4 3h16v18H4zM4 10h16M8 6h.01M12 6h.01M9 14h6v7H9z",
  bath: "M4 12h16v3a4 4 0 01-4 4H8a4 4 0 01-4-4zM7 12V6a2 2 0 014 0M7 21l-1 1M18 21l1 1",
  laundry: "M4 3h16v18H4zM8 6h.01M12 6h.01M12 18a5 5 0 100-9 5 5 0 000 9z",
  smarthome: "M3 11l9-7 9 7v9a1 1 0 01-1 1H4a1 1 0 01-1-1zM9 21v-6h6v6M12 10v.01",
  security: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM9 12l2 2 4-4",
  internet: "M2 9a15 15 0 0120 0M5 13a10 10 0 0114 0M8.5 16.5a5 5 0 017 0M12 20h.01",
  transport: "M4 16V6a2 2 0 012-2h12a2 2 0 012 2v10M4 16h16M4 16v3M20 16v3M7 19h10M8 8h8M7 13h.01M17 13h.01",
  school: "M12 3L2 8l10 5 10-5zM6 11v5c0 1.5 3 3 6 3s6-1.5 6-3v-5",
  shopping: "M6 7h12l-1 13H7zM9 7V5a3 3 0 016 0v2",
  quiet: "M11 5L6 9H3v6h3l5 4zM17 8a5 5 0 010 8M20 5a9 9 0 010 14",
  furnished: "M4 18v-5a3 3 0 013-3h10a3 3 0 013 3v5M4 18h16M6 18v2M18 18v2M6 10V7a2 2 0 012-2h8a2 2 0 012 2v3",
  storage: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
  feature: "M12 3l2.6 5.6 6.4.8-4.7 4.3 1.2 6.3L12 17l-5.5 3 1.2-6.3L3 9.4l6.4-.8z",
};

const RULES: Array<{ key: ExposeIconKey; words: string[] }> = [
  { key: "balcony", words: ["balkon", "loggia"] },
  { key: "terrace", words: ["terrasse", "sitzplatz", "dachterrasse", "pergola"] },
  { key: "garden", words: ["garten", "grünfläche", "gruenflaeche", "rasen", "umschwung"] },
  { key: "view", words: ["aussicht", "seesicht", "bergsicht", "panorama", "weitsicht"] },
  { key: "elevator", words: ["lift", "aufzug"] },
  { key: "garage", words: ["garage", "einstellhalle", "carport"] },
  { key: "parking", words: ["parkplatz", "parkiermöglichkeit", "aussenparkplatz", "stellplatz", "parking"] },
  { key: "fireplace", words: ["cheminée", "cheminee", "kamin", "ofen", "schwedenofen"] },
  { key: "pool", words: ["pool", "schwimmbad", "whirlpool", "jacuzzi"] },
  { key: "sauna", words: ["sauna", "dampfbad", "wellness"] },
  { key: "cellar", words: ["keller", "untergeschoss"] },
  { key: "attic", words: ["estrich", "dachboden", "galerie"] },
  { key: "accessible", words: ["rollstuhl", "hindernisfrei", "barrierefrei", "altersgerecht", "schwellenlos"] },
  { key: "pets", words: ["haustier", "tiere"] },
  { key: "newbuild", words: ["neubau", "erstbezug", "minergie"] },
  { key: "renovated", words: ["renoviert", "saniert", "modernisiert", "umgebaut"] },
  { key: "solar", words: ["solar", "photovoltaik", "pv-anlage"] },
  { key: "heatpump", words: ["wärmepumpe", "waermepumpe", "erdsonde", "fernwärme", "pellet", "heizung"] },
  { key: "energy", words: ["energie", "gebäudeausweis", "geak", "effizient"] },
  { key: "airco", words: ["klima", "lüftung", "komfortlüftung", "kühlung"] },
  { key: "kitchen", words: ["küche", "kueche", "kochinsel"] },
  { key: "bath", words: ["bad", "dusche", "badewanne", "nasszelle", "wc"] },
  { key: "laundry", words: ["waschturm", "waschmaschine", "waschküche", "tumbler"] },
  { key: "smarthome", words: ["smart", "hausautomation", "knx"] },
  { key: "security", words: ["alarm", "sicherheit", "video", "gegensprech"] },
  { key: "internet", words: ["glasfaser", "internet", "wlan", "fiber"] },
  { key: "transport", words: ["öv", "bahnhof", "bus", "autobahn", "verkehrsanbindung", "zentral"] },
  { key: "school", words: ["schule", "kindergarten", "kita"] },
  { key: "shopping", words: ["einkauf", "einkaufsmöglichkeit", "laden", "migros", "coop"] },
  { key: "quiet", words: ["ruhig", "ruhelage", "sonnig", "familienfreundlich"] },
  { key: "furnished", words: ["möbliert", "moebliert", "einbauschrank", "ankleide"] },
  { key: "storage", words: ["abstellraum", "reduit", "lager", "bastelraum", "veloraum"] },
];

/** Findet das passende Symbol zu einer frei erfassten Ausstattung. */
export function matchExposeIcon(label: string): ExposeIconKey {
  const s = (label ?? "").toLowerCase();
  for (const r of RULES) if (r.words.some((w) => s.includes(w))) return r.key;
  return "feature";
}

/** Inline-SVG für das PDF/HTML-Exposé (ohne React). */
export function exposeIconSvg(key: ExposeIconKey, color: string, size = 22): string {
  const d = EXPOSE_ICON_PATHS[key] ?? EXPOSE_ICON_PATHS.feature;
  return (
    `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="${color}" ` +
    `stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">` +
    d.split("M").filter(Boolean).map((seg) => `<path d="M${seg.trim()}"/>`).join("") +
    `</svg>`
  );
}
