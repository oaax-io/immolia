import type { Tables } from "@/integrations/supabase/types";

type Client = Tables<"clients">;
type Property = Tables<"properties">;

/**
 * Matching nach marktüblichem 3-Stufen-Prinzip:
 * 1. Harte K.O.-Filter (Kauf/Miete, Verfügbarkeit, Preis max. +10 % über Budget)
 * 2. Relevanz-Score 0–100 % (Budget 35, Lage 30, Objekttyp 20, Raumprogramm 15)
 * 3. Finanzampel separat (Tragbarkeit/Belehnung aus Selbstauskunft) – fliesst NICHT in den Score.
 */

/** Vereinfachte finanzielle Tragfähigkeit eines Kunden (inkl. Ehepartner/Mitantragsteller). */
export interface FinancialCapacity {
  grossIncomeYearly: number;
  equity: number;
  hasPartner: boolean;
}

export type CheckStatus = "ok" | "partial" | "miss" | "na";
export interface MatchCheck {
  key: "budget" | "location" | "type" | "space";
  label: string;
  detail: string;
  status: CheckStatus;
}

export interface Affordability {
  ratio: number | null; // Tragbarkeit in %
  ltv: number | null; // Belehnung in %
  status: "ok" | "warn" | "fail";
  hasPartner: boolean;
}

export interface ScoreBreakdown {
  score: number;
  reasons: string[];
  misses: string[];
  checks: MatchCheck[];
  knockout: string | null;
  affordability: Affordability | null;
  isInvestment: boolean;
}

export interface PropertyMatch extends ScoreBreakdown {
  property: Property;
}
export interface ClientMatch extends ScoreBreakdown {
  client: Client;
}

export interface MatchOptions {
  /** Kunde/Suchprofil sucht Anlageobjekte (Rendite wird angezeigt). */
  investor?: boolean;
  /** Bekannte Orte → PLZ (aus dem Bestand), für regionale Teiltreffer. */
  cityPostalIndex?: Map<string, string[]>;
}

export const BUDGET_TOLERANCE = 0.1;
export const AVAILABLE_STATUSES = new Set(["available", "active", "preparation", "draft"]);
const INVESTMENT_TYPES = new Set(["mixed_use", "commercial"]);

const W = { budget: 35, location: 30, type: 20, space: 15 } as const;

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+(zh|lu|be|ag|sg|zg|sz|bs|bl|so|tg|gr|ti|vd|ge|vs|fr|ne)$/i, "").trim();

const chf = (n: number) => `CHF ${Math.round(n).toLocaleString("de-CH")}`;

/** Grobe PLZ-Region (erste 2 Ziffern) – reicht für «gleiche Region» als Teiltreffer. */
const plzRegion = (plz?: string | null) => (plz && /^\d{4}$/.test(plz.trim()) ? plz.trim().slice(0, 2) : null);

/** Baut aus dem Objektbestand einen Index Ort → PLZ. */
export function buildCityPostalIndex(properties: Property[]): Map<string, string[]> {
  const idx = new Map<string, string[]>();
  for (const p of properties) {
    if (!p.city || !p.postal_code) continue;
    const k = norm(p.city);
    const arr = idx.get(k) ?? [];
    if (!arr.includes(p.postal_code)) arr.push(p.postal_code);
    idx.set(k, arr);
  }
  return idx;
}

export function isInvestmentProperty(p: Property) {
  return INVESTMENT_TYPES.has(p.property_type as string) || (p.gross_yield != null && Number(p.gross_yield) > 0);
}

function derivedBudgetMax(capacity?: FinancialCapacity | null) {
  if (!capacity || capacity.grossIncomeYearly <= 0) return null;
  const maxMortgage = (capacity.grossIncomeYearly * 0.33) / 0.07;
  const fromMortgage = maxMortgage / 0.8;
  const fromEquity = capacity.equity > 0 ? capacity.equity / 0.2 : fromMortgage;
  return Math.min(fromMortgage, fromEquity);
}

export function computeAffordability(value: number, capacity?: FinancialCapacity | null, isRent = false): Affordability | null {
  if (!capacity || isRent || !(value > 0)) return null;
  const ratio = capacity.grossIncomeYearly > 0 ? ((Math.max(0, value - capacity.equity) * 0.07) / capacity.grossIncomeYearly) * 100 : null;
  const ltv = capacity.equity > 0 ? Math.max(0, ((value - capacity.equity) / value) * 100) : null;
  if (ratio == null && ltv == null) return null;
  const fail = (ratio != null && ratio > 38) || (ltv != null && ltv > 80);
  const warn = ratio != null && ratio > 33;
  return { ratio, ltv, status: fail ? "fail" : warn ? "warn" : "ok", hasPartner: capacity.hasPartner };
}

export function scoreMatch(
  client: Client,
  property: Property,
  capacity?: FinancialCapacity | null,
  opts: MatchOptions = {},
): ScoreBreakdown {
  const isRent = property.listing_type === "rent";
  const value = isRent
    ? property.rent != null ? Number(property.rent) : null
    : property.price != null ? Number(property.price) : null;
  const investor = !!opts.investor || client.client_type === "investor";
  const isInvestment = investor || isInvestmentProperty(property);
  const empty: ScoreBreakdown = { score: 0, reasons: [], misses: [], checks: [], knockout: null, affordability: null, isInvestment };

  // ---- Stufe 1: K.O.
  if (!AVAILABLE_STATUSES.has(property.status as string)) return { ...empty, knockout: "Objekt nicht verfügbar" };
  if (client.preferred_listing && property.listing_type !== client.preferred_listing)
    return { ...empty, knockout: "Kauf/Miete passt nicht" };

  const bMin = client.budget_min != null ? Number(client.budget_min) : null;
  const bMax = client.budget_max != null ? Number(client.budget_max) : isRent ? null : derivedBudgetMax(capacity);
  if (value != null && bMax != null && value > bMax * (1 + BUDGET_TOLERANCE))
    return { ...empty, knockout: "Mehr als 10 % über Budget" };

  // ---- Stufe 2: Relevanz
  const checks: MatchCheck[] = [];

  // Budget
  if (value == null || (bMin == null && bMax == null)) {
    checks.push({ key: "budget", label: "Budget", detail: value == null ? "Kein Preis" : "Kein Budget hinterlegt", status: "na" });
  } else if ((bMax == null || value <= bMax) && (bMin == null || value >= bMin * 0.9)) {
    checks.push({ key: "budget", label: "Budget", detail: `${chf(value)}${bMax ? ` (bis ${chf(bMax)})` : ""}`, status: "ok" });
  } else if (bMax != null && value > bMax) {
    checks.push({ key: "budget", label: "Budget", detail: `Leicht über Budget (+${Math.round((value / bMax - 1) * 100)} %)`, status: "partial" });
  } else {
    checks.push({ key: "budget", label: "Budget", detail: `Unter Mindestbudget`, status: "partial" });
  }

  // Lage
  const wanted = (client.preferred_cities ?? []).map(norm).filter(Boolean);
  if (!wanted.length || !property.city) {
    checks.push({ key: "location", label: "Lage", detail: wanted.length ? "Ort fehlt beim Objekt" : "Keine Wunschregion", status: "na" });
  } else if (wanted.includes(norm(property.city))) {
    checks.push({ key: "location", label: "Lage", detail: `${property.city} (Wunschort)`, status: "ok" });
  } else {
    const region = plzRegion(property.postal_code);
    const wantedRegions = new Set(
      wanted.flatMap((w) => (opts.cityPostalIndex?.get(w) ?? []).map(plzRegion).filter(Boolean) as string[]),
    );
    if (region && wantedRegions.has(region)) {
      checks.push({ key: "location", label: "Lage", detail: `${property.city} (gleiche Region)`, status: "partial" });
    } else {
      checks.push({ key: "location", label: "Lage", detail: `${property.city} ausserhalb Wunschregion`, status: "miss" });
    }
  }

  // Objekttyp
  if (!client.preferred_types?.length) {
    checks.push({ key: "type", label: "Objekttyp", detail: "Kein Typ hinterlegt", status: "na" });
  } else {
    const ok = client.preferred_types.includes(property.property_type);
    checks.push({ key: "type", label: "Objekttyp", detail: ok ? "Passt" : "Anderer Objekttyp", status: ok ? "ok" : "miss" });
  }

  // Raumprogramm (Zimmer + Fläche)
  const rooms = property.rooms != null ? Number(property.rooms) : null;
  const area = property.area != null ? Number(property.area) : null;
  const rMin = client.rooms_min != null ? Number(client.rooms_min) : null;
  const aMin = client.area_min != null ? Number(client.area_min) : null;
  const aMax = client.area_max != null ? Number(client.area_max) : null;
  const parts: { ok: boolean; near: boolean }[] = [];
  if (rMin != null && rooms != null) parts.push({ ok: rooms >= rMin, near: rooms >= rMin - 0.5 });
  if ((aMin != null || aMax != null) && area != null) {
    const ok = (aMin == null || area >= aMin) && (aMax == null || area <= aMax);
    parts.push({ ok, near: (aMin == null || area >= aMin * 0.9) && (aMax == null || area <= aMax * 1.1) });
  }
  const spaceDetail = [rooms != null ? `${rooms} Zi` : null, area != null ? `${area} m²` : null].filter(Boolean).join(", ") || "Keine Angaben";
  if (!parts.length) checks.push({ key: "space", label: "Zimmer & Fläche", detail: spaceDetail, status: "na" });
  else if (parts.every((p) => p.ok)) checks.push({ key: "space", label: "Zimmer & Fläche", detail: spaceDetail, status: "ok" });
  else if (parts.every((p) => p.near)) checks.push({ key: "space", label: "Zimmer & Fläche", detail: `${spaceDetail} (knapp)`, status: "partial" });
  else checks.push({ key: "space", label: "Zimmer & Fläche", detail: `${spaceDetail} (zu klein)`, status: "miss" });

  let total = 0;
  let earned = 0;
  for (const c of checks) {
    if (c.status === "na") continue;
    total += W[c.key];
    earned += c.status === "ok" ? W[c.key] : c.status === "partial" ? W[c.key] * 0.5 : 0;
  }
  const score = total === 0 ? 0 : Math.round((earned / total) * 100);

  // ---- Stufe 3: Finanzampel
  const affordability = value != null ? computeAffordability(value, capacity, isRent) : null;

  const reasons = checks.filter((c) => c.status === "ok").map((c) => `${c.label}: ${c.detail}`);
  if (affordability?.ratio != null) reasons.push(`Tragbarkeit ${affordability.ratio.toFixed(0)}%`);
  const misses = checks.filter((c) => c.status === "miss" || c.status === "partial").map((c) => `${c.label}: ${c.detail}`);

  return { score, reasons, misses, checks, knockout: null, affordability, isInvestment };
}

/** Kunde → Objekte. K.O.-Treffer und schwache Treffer werden ausgefiltert. */
export function matchClientToProperties(
  client: Client,
  properties: Property[],
  minScore = 40,
  capacity?: FinancialCapacity | null,
  opts: MatchOptions = {},
): PropertyMatch[] {
  const idx = opts.cityPostalIndex ?? buildCityPostalIndex(properties);
  const out: PropertyMatch[] = [];
  for (const p of properties) {
    const r = scoreMatch(client, p, capacity, { ...opts, cityPostalIndex: idx });
    if (!r.knockout && r.score >= minScore) out.push({ property: p, ...r });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Objekt → Kunden (Käufer, Mieter, Investoren). */
export function matchPropertyToClients(
  property: Property,
  clients: Client[],
  minScore = 40,
  capacityByClientId?: Map<string, FinancialCapacity>,
  opts: MatchOptions = {},
): ClientMatch[] {
  const out: ClientMatch[] = [];
  for (const c of clients) {
    if (c.client_type !== "buyer" && c.client_type !== "tenant" && c.client_type !== "investor") continue;
    const r = scoreMatch(c, property, capacityByClientId?.get(c.id) ?? null, opts);
    if (!r.knockout && r.score >= minScore) out.push({ client: c, ...r });
  }
  return out.sort((a, b) => b.score - a.score);
}
