// Document template variable substitution for mandates, reservations, NDAs and other documents.
// All available data sources auto-resolve from CRM (clients, properties, owners, relationships,
// reservations, mandates, financing, company profile, bank accounts).

import { formatCurrency, formatDate } from "@/lib/format";

export type TemplateContext = {
  client?: {
    full_name?: string | null;
    salutation?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    postal_code?: string | null;
    city?: string | null;
    country?: string | null;
    birth_date?: string | null;
    nationality?: string | null;
  } | null;
  // Second party (Mitkäufer, Ehepartner, Mitunterzeichner)
  partner?: {
    full_name?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    postal_code?: string | null;
    city?: string | null;
    relationship?: string | null;
  } | null;
  property?: {
    title?: string | null;
    address?: string | null;
    postal_code?: string | null;
    city?: string | null;
    country?: string | null;
    price?: number | string | null;
    rent?: number | string | null;
    rooms?: number | string | null;
    living_area?: number | string | null;
    plot_area?: number | string | null;
    property_type?: string | null;
    year_built?: number | string | null;
  } | null;
  owner?: {
    full_name?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    postal_code?: string | null;
    city?: string | null;
  } | null;
  mandate?: {
    commission_model?: string | null;
    commission_value?: number | string | null;
    valid_from?: string | null;
    valid_until?: string | null;
    type?: string | null;
  } | null;
  reservation?: {
    reservation_fee?: number | string | null;
    valid_until?: string | null;
    payment_deadline?: string | null;
  } | null;
  nda?: {
    type?: string | null;
    valid_from?: string | null;
    valid_until?: string | null;
    purpose?: string | null;
    penalty_amount?: number | string | null;
  } | null;
  financing?: {
    bank_name?: string | null;
    bank_contact?: string | null;
    budget?: number | string | null;
    equity?: number | string | null;
    income?: number | string | null;
    approval_status?: string | null;
  } | null;
  company?: {
    name?: string | null;
    legal_name?: string | null;
    address?: string | null;
    postal_code?: string | null;
    city?: string | null;
    country?: string | null;
    phone?: string | null;
    email?: string | null;
    website?: string | null;
    uid_number?: string | null;
    commercial_register?: string | null;
    default_signatory_name?: string | null;
    default_signatory_role?: string | null;
    default_place?: string | null;
  } | null;
  bank?: {
    label?: string | null;
    bank_name?: string | null;
    account_holder?: string | null;
    iban?: string | null;
    bic?: string | null;
    purpose?: string | null;
  } | null;
  brand?: {
    company_name?: string | null;
    company_address?: string | null;
    company_email?: string | null;
    company_website?: string | null;
    logo_url?: string | null;
    primary_color?: string | null;
    secondary_color?: string | null;
    font_family?: string | null;
    header_html?: string | null;
    footer_html?: string | null;
  } | null;
  checks?: Record<string, boolean>;
  today?: string;
  place?: string;
};

// Neutraler Fallback ohne Tenant-Branding (keine ASIMO-Werte)
export const DEFAULT_BRAND = {
  company_name: "",
  company_address: "",
  company_email: "",
  company_website: "",
  logo_url: "",
  primary_color: "#324642",
  secondary_color: "#6A9387",
  font_family: "Helvetica Neue, Arial, sans-serif",
  header_html: "",
  footer_html: "",
} as const;

// Brand top-level aliases (so templates can write {{logo_url}} instead of {{brand.logo_url}})
const BRAND_ALIASES: Record<string, keyof NonNullable<TemplateContext["brand"]>> = {
  logo_url: "logo_url",
  primary_color: "primary_color",
  secondary_color: "secondary_color",
  font_family: "font_family",
};

// Flat aliases — short, friendly names that map onto nested context paths.
// Lets non-technical users write {{client_name}}, {{property_address}}, {{company_name}} etc.
const FLAT_ALIASES: Record<string, string> = {
  // Client
  client_name: "client.full_name",
  client_address: "client.address",
  client_postal_code: "client.postal_code",
  client_city: "client.city",
  client_email: "client.email",
  client_phone: "client.phone",
  client_salutation: "client.salutation",
  // Partner
  partner_name: "partner.full_name",
  partner_address: "partner.address",
  // Property
  property_title: "property.title",
  property_address: "property.address",
  property_postal_code: "property.postal_code",
  property_city: "property.city",
  property_price: "property.price",
  property_rent: "property.rent",
  property_rooms: "property.rooms",
  property_living_area: "property.living_area",
  property_plot_area: "property.plot_area",
  property_year_built: "property.year_built",
  // Owner
  owner_name: "owner.full_name",
  owner_address: "owner.address",
  // Mandate / Reservation / NDA
  commission_value: "mandate.commission_value",
  commission_model: "mandate.commission_model",
  valid_from: "mandate.valid_from",
  valid_until: "mandate.valid_until",
  reservation_fee: "reservation.reservation_fee",
  payment_deadline: "reservation.payment_deadline",
  // Company / Brand
  company_name: "company.name",
  company_legal_name: "company.legal_name",
  company_address: "company.address",
  company_postal_code: "company.postal_code",
  company_city: "company.city",
  company_email: "company.email",
  company_phone: "company.phone",
  company_website: "company.website",
  company_uid: "company.uid_number",
  signatory_name: "company.default_signatory_name",
  signatory_role: "company.default_signatory_role",
  place: "place",
  date: "today",
  // Bank
  bank_name: "bank.bank_name",
  bank_iban: "bank.iban",
  bank_bic: "bank.bic",
  bank_holder: "bank.account_holder",
};


export const AVAILABLE_VARIABLES = [
  // Kurz-Aliase (empfohlen)
  { key: "client_name", label: "★ Kundenname", group: "Kurz" },
  { key: "client_address", label: "★ Kundenadresse", group: "Kurz" },
  { key: "property_title", label: "★ Objektbezeichnung", group: "Kurz" },
  { key: "property_address", label: "★ Objektadresse", group: "Kurz" },
  { key: "property_price", label: "★ Verkaufspreis", group: "Kurz" },
  { key: "company_name", label: "★ Firmenname", group: "Kurz" },
  { key: "company_address", label: "★ Firmenadresse", group: "Kurz" },
  { key: "commission_value", label: "★ Provision", group: "Kurz" },
  { key: "valid_from", label: "★ Gültig ab", group: "Kurz" },
  { key: "valid_until", label: "★ Gültig bis", group: "Kurz" },
  { key: "signatory_name", label: "★ Unterzeichner", group: "Kurz" },
  { key: "place", label: "★ Ort", group: "Kurz" },
  { key: "date", label: "★ Datum", group: "Kurz" },
  // Client
  { key: "client.full_name", label: "Kunde – Name", group: "Kunde" },
  { key: "client.salutation", label: "Kunde – Anrede", group: "Kunde" },
  { key: "client.address", label: "Kunde – Adresse", group: "Kunde" },
  { key: "client.postal_code", label: "Kunde – PLZ", group: "Kunde" },
  { key: "client.city", label: "Kunde – Ort", group: "Kunde" },
  { key: "client.email", label: "Kunde – E-Mail", group: "Kunde" },
  { key: "client.phone", label: "Kunde – Telefon", group: "Kunde" },
  { key: "client.birth_date", label: "Kunde – Geburtsdatum", group: "Kunde" },
  { key: "client.nationality", label: "Kunde – Nationalität", group: "Kunde" },
  // Partner
  { key: "partner.full_name", label: "Mitunterzeichner – Name", group: "Mitunterzeichner" },
  { key: "partner.address", label: "Mitunterzeichner – Adresse", group: "Mitunterzeichner" },
  { key: "partner.postal_code", label: "Mitunterzeichner – PLZ", group: "Mitunterzeichner" },
  { key: "partner.city", label: "Mitunterzeichner – Ort", group: "Mitunterzeichner" },
  { key: "partner.email", label: "Mitunterzeichner – E-Mail", group: "Mitunterzeichner" },
  { key: "partner.relationship", label: "Mitunterzeichner – Beziehung", group: "Mitunterzeichner" },
  // Property
  { key: "property.title", label: "Objekt – Titel", group: "Objekt" },
  { key: "property.address", label: "Objekt – Adresse", group: "Objekt" },
  { key: "property.postal_code", label: "Objekt – PLZ", group: "Objekt" },
  { key: "property.city", label: "Objekt – Ort", group: "Objekt" },
  { key: "property.price", label: "Objekt – Verkaufspreis", group: "Objekt" },
  { key: "property.rent", label: "Objekt – Mietpreis", group: "Objekt" },
  { key: "property.rooms", label: "Objekt – Zimmer", group: "Objekt" },
  { key: "property.living_area", label: "Objekt – Wohnfläche", group: "Objekt" },
  { key: "property.plot_area", label: "Objekt – Grundstücksfläche", group: "Objekt" },
  { key: "property.property_type", label: "Objekt – Typ", group: "Objekt" },
  { key: "property.year_built", label: "Objekt – Baujahr", group: "Objekt" },
  // Owner
  { key: "owner.full_name", label: "Eigentümer – Name", group: "Eigentümer" },
  { key: "owner.address", label: "Eigentümer – Adresse", group: "Eigentümer" },
  { key: "owner.postal_code", label: "Eigentümer – PLZ", group: "Eigentümer" },
  { key: "owner.city", label: "Eigentümer – Ort", group: "Eigentümer" },
  { key: "owner.email", label: "Eigentümer – E-Mail", group: "Eigentümer" },
  { key: "owner.phone", label: "Eigentümer – Telefon", group: "Eigentümer" },
  // Mandate
  { key: "mandate.commission_value", label: "Mandat – Provisionswert", group: "Mandat" },
  { key: "mandate.commission_model", label: "Mandat – Provisionsmodell", group: "Mandat" },
  { key: "mandate.valid_from", label: "Mandat – Gültig ab", group: "Mandat" },
  { key: "mandate.valid_until", label: "Mandat – Gültig bis", group: "Mandat" },
  { key: "mandate.type", label: "Mandat – Typ", group: "Mandat" },
  // Reservation
  { key: "reservation.reservation_fee", label: "Reservation – Gebühr", group: "Reservation" },
  { key: "reservation.valid_until", label: "Reservation – Gültig bis", group: "Reservation" },
  { key: "reservation.payment_deadline", label: "Reservation – Zahlungsfrist", group: "Reservation" },
  // NDA
  { key: "nda.type", label: "NDA – Typ", group: "NDA" },
  { key: "nda.valid_from", label: "NDA – Gültig ab", group: "NDA" },
  { key: "nda.valid_until", label: "NDA – Gültig bis", group: "NDA" },
  { key: "nda.purpose", label: "NDA – Zweck", group: "NDA" },
  { key: "nda.penalty_amount", label: "NDA – Konventionalstrafe", group: "NDA" },
  // Financing
  { key: "financing.bank_name", label: "Finanzierung – Bank", group: "Finanzierung" },
  { key: "financing.bank_contact", label: "Finanzierung – Kontakt", group: "Finanzierung" },
  { key: "financing.budget", label: "Finanzierung – Budget", group: "Finanzierung" },
  { key: "financing.equity", label: "Finanzierung – Eigenkapital", group: "Finanzierung" },
  // Company
  { key: "company.name", label: "Firma – Name", group: "Firma" },
  { key: "company.legal_name", label: "Firma – Rechtlicher Name", group: "Firma" },
  { key: "company.address", label: "Firma – Adresse", group: "Firma" },
  { key: "company.postal_code", label: "Firma – PLZ", group: "Firma" },
  { key: "company.city", label: "Firma – Ort", group: "Firma" },
  { key: "company.phone", label: "Firma – Telefon", group: "Firma" },
  { key: "company.email", label: "Firma – E-Mail", group: "Firma" },
  { key: "company.website", label: "Firma – Webseite", group: "Firma" },
  { key: "company.uid_number", label: "Firma – UID-Nummer", group: "Firma" },
  { key: "company.default_signatory_name", label: "Firma – Unterzeichner Name", group: "Firma" },
  { key: "company.default_signatory_role", label: "Firma – Unterzeichner Funktion", group: "Firma" },
  // Bank
  { key: "bank.label", label: "Bank – Bezeichnung", group: "Bankkonto" },
  { key: "bank.bank_name", label: "Bank – Name", group: "Bankkonto" },
  { key: "bank.account_holder", label: "Bank – Inhaber", group: "Bankkonto" },
  { key: "bank.iban", label: "Bank – IBAN", group: "Bankkonto" },
  { key: "bank.bic", label: "Bank – BIC", group: "Bankkonto" },
  // Misc
  { key: "today", label: "Heutiges Datum", group: "Allgemein" },
  { key: "place", label: "Ort", group: "Allgemein" },
] as const;

const NUMERIC_KEYS = new Set([
  "property.price",
  "property.rent",
  "mandate.commission_value",
  "reservation.reservation_fee",
  "financing.budget",
  "financing.equity",
  "financing.income",
  "nda.penalty_amount",
]);
const DATE_KEYS = new Set([
  "mandate.valid_from",
  "mandate.valid_until",
  "reservation.valid_until",
  "reservation.payment_deadline",
  "nda.valid_from",
  "nda.valid_until",
  "client.birth_date",
  "today",
]);

function splitName(full: string): { first: string; last: string } {
  const t = (full ?? "").trim().replace(/\s+/g, " ");
  if (!t) return { first: "", last: "" };
  const parts = t.split(" ");
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

function getValue(ctx: TemplateContext, path: string): string {
  // Checkbox helpers
  if (path.startsWith("check.")) {
    const key = path.slice("check.".length);
    const map = (ctx as TemplateContext & { checks?: Record<string, boolean> }).checks ?? {};
    return map[key] ? "☑" : "☐";
  }

  // Commission model display helpers (used to show/hide blocks in templates)
  // {{commission.show_percent}} → "" if percent selected, otherwise "display:none"
  // {{commission.show_flat}}    → "" if flat (Pauschal) selected, otherwise "display:none"
  if (path === "commission.show_percent" || path === "commission.show_flat") {
    const model = String((ctx as any).mandate?.commission_model ?? "").toLowerCase();
    const isFlat = /pauschal|flat|fixed|chf/.test(model);
    const isPercent = /prozent|percent|%/.test(model) || (!isFlat && model !== "");
    if (path === "commission.show_percent") return isPercent ? "" : "display:none";
    return isFlat ? "" : "display:none";
  }

  // {{mandate.show_term}} → "" if either valid_from or valid_until is set, else "display:none"
  if (path === "mandate.show_term") {
    const m = (ctx as any).mandate ?? {};
    const has = (m.valid_from && String(m.valid_from).trim()) || (m.valid_until && String(m.valid_until).trim());
    return has ? "" : "display:none";
  }

  // Mark the selected percent option, e.g. {{commission.mark_3}} renders ✕ when 3% is selected
  if (path.startsWith("commission.mark_")) {
    const target = path.slice("commission.mark_".length).replace(/_/g, ".");
    const targetNum = parseFloat(target);
    const model = String((ctx as any).mandate?.commission_model ?? "").toLowerCase();
    const isPercent = /prozent|percent|%/.test(model);
    if (!isPercent) return "";
    const raw = String((ctx as any).mandate?.commission_value ?? "");
    const valNum = parseFloat(raw.replace(",", "."));
    return Number.isFinite(valNum) && Number.isFinite(targetNum) && Math.abs(valNum - targetNum) < 0.001 ? "✕" : "";
  }

  // Derived name parts (split full_name into Vorname / Name)
  if (path === "client.first_name" || path === "client.last_name" || path === "client_first_name" || path === "client_last_name") {
    const { first, last } = splitName(ctx.client?.full_name ?? "");
    return path.endsWith("first_name") ? first : last;
  }
  if (path === "partner.first_name" || path === "partner.last_name") {
    const { first, last } = splitName((ctx as any).partner?.full_name ?? "");
    return path.endsWith("first_name") ? first : last;
  }

  // Flat alias → resolve through the nested path
  if (FLAT_ALIASES[path]) {
    return resolveNested(ctx, FLAT_ALIASES[path]);
  }

  // Brand alias resolution
  if (BRAND_ALIASES[path]) {
    const key = BRAND_ALIASES[path];
    const v = ctx.brand?.[key] ?? DEFAULT_BRAND[key];
    return v ? String(v) : "";
  }

  // Fallbacks: if legal_name is empty fall back to company.name (and brand company_name)
  if (path === "company.legal_name") {
    const v = resolveNested(ctx, "company.legal_name")
      || resolveNested(ctx, "company.name")
      || (ctx.brand?.company_name ?? "");
    return v ? String(v) : "";
  }

  return resolveNested(ctx, path);
}

function resolveNested(ctx: TemplateContext, path: string): string {
  const parts = path.split(".");
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return "";
    }
  }
  if (cur === null || cur === undefined || cur === "") return "";

  if (NUMERIC_KEYS.has(path)) {
    const n = typeof cur === "number" ? cur : Number(cur);
    if (Number.isFinite(n)) {
      if (path === "mandate.commission_value") return String(n);
      return formatCurrency(n) ?? String(n);
    }
  }
  if (DATE_KEYS.has(path)) {
    return formatDate(String(cur)) ?? String(cur);
  }
  return String(cur);
}

export function renderTemplate(template: string, ctx: TemplateContext): string {
  const fullCtx: TemplateContext = {
    ...ctx,
    today: ctx.today ?? new Date().toISOString(),
  };
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path) =>
    getValue(fullCtx, String(path)),
  );
}

/**
 * Find which variables in a template are not resolvable from the given context.
 * Used by wizards to ask the user only for missing values.
 */
export function findMissingVariables(template: string, ctx: TemplateContext): string[] {
  const fullCtx: TemplateContext = { ...ctx, today: ctx.today ?? new Date().toISOString() };
  const used = new Set<string>();
  template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path) => {
    used.add(String(path));
    return "";
  });
  const missing: string[] = [];
  for (const path of used) {
    if (BRAND_ALIASES[path]) continue;
    if (path.startsWith("check.")) continue;
    // Use getValue so fallbacks (e.g. company.legal_name → company.name) are honored
    if (!getValue(fullCtx, path)) missing.push(path);
  }
  return missing;
}

/**
 * Layout-Stil (nicht Branding!). Vorlagen wählen den Stil per Marker im Body:
 *   <!--layout:compact-->  kompaktes Vertragslayout (Akzent = Tenant-Branding)
 *   <!--skin:asimo-->      Legacy-Alias für "compact" – bleibt für bestehende
 *                          Vorlagen/Dokumente rückwärtskompatibel erhalten.
 * Farben, Logo, Name und Kontakt kommen immer aus dem Tenant-Branding.
 */
export type DocumentLayout = "default" | "compact";
export function pickLayout(bodyHtml: string): DocumentLayout {
  if (/<!--\s*layout:compact\s*-->/i.test(bodyHtml)) return "compact";
  if (/<!--\s*skin:asimo\s*-->/i.test(bodyHtml)) return "compact"; // legacy
  return "default";
}
/** @deprecated Legacy-Name, liefert den Layout-Stil. */
export function pickSkin(bodyHtml: string): "default" | "asimo" {
  return pickLayout(bodyHtml) === "compact" ? "asimo" : "default";
}

export function wrapHtmlDocument(
  title: string,
  bodyHtml: string,
  brand?: TemplateContext["brand"] | null,
  options?: { customCss?: string | null; skin?: "default" | "asimo" | "compact" | "auto" },
): string {
  const b = { ...DEFAULT_BRAND, ...(brand ?? {}) };
  const primary = b.primary_color || DEFAULT_BRAND.primary_color;
  const secondary = b.secondary_color || DEFAULT_BRAND.secondary_color;
  const font = b.font_family || DEFAULT_BRAND.font_family;
  const companyName = escapeAttr(b.company_name || "");
  const customCss = (options?.customCss ?? "").toString();
  const skinOpt = options?.skin ?? "auto";
  const layout: DocumentLayout =
    skinOpt === "auto" ? pickLayout(bodyHtml) : skinOpt === "default" ? "default" : "compact";

  if (layout === "compact") {
    return wrapCompactLayout({ title, bodyHtml, brand: b, font, customCss });
  }

  const headerHtml = b.header_html
    ? b.header_html
    : `<div class="doc-header">
         <div class="doc-header__brand">
           ${
             b.logo_url
               ? `<img src="${escapeAttr(b.logo_url)}" alt="${companyName}" class="doc-logo" />`
               : `<div class="doc-wordmark">${companyName}</div>`
           }
         </div>
         <div class="doc-header__meta">
           <div class="doc-header__company">${companyName}</div>
           ${b.company_address ? `<div>${escapeAttr(b.company_address)}</div>` : ""}
           ${b.company_email ? `<div>${escapeAttr(b.company_email)}</div>` : ""}
           ${b.company_website ? `<div>${escapeAttr(b.company_website)}</div>` : ""}
         </div>
       </div>`;

  const footerHtml = b.footer_html
    ? b.footer_html
    : `<div class="doc-footer">
         <span>${companyName}</span>
         ${b.company_website ? `<span> · ${escapeAttr(b.company_website)}</span>` : ""}
         ${b.company_email ? `<span> · ${escapeAttr(b.company_email)}</span>` : ""}
       </div>`;

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<title>${title.replace(/</g, "&lt;")}</title>
<style>
  @page {
    size: A4;
    margin: 22mm 18mm 22mm 18mm;
  }
  :root {
    --brand-primary: ${primary};
    --brand-secondary: ${secondary};
    --brand-soft: color-mix(in oklab, ${primary} 6%, white);
    --text: #1a1a1a;
    --text-muted: #5b6770;
    --border: #d9dee2;
    --rule: ${secondary};
  }
  * { box-sizing: border-box; }
  html, body { background: #fff; }
  body {
    font-family: ${font};
    color: var(--text);
    line-height: 1.55;
    font-size: 11pt;
    margin: 0 auto;
    padding: 0;
    max-width: 800px;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .doc-shell { padding: 0 4mm; }

  /* Header */
  .doc-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 24px;
    padding-bottom: 14px;
    margin-bottom: 22px;
    border-bottom: 2px solid var(--brand-primary);
  }
  .doc-logo { height: 48px; width: auto; display: block; }
  .doc-wordmark {
    font-weight: 700;
    font-size: 20px;
    letter-spacing: 0.04em;
    color: var(--brand-primary);
    text-transform: uppercase;
  }
  .doc-header__meta {
    text-align: right;
    font-size: 10pt;
    color: var(--text-muted);
    line-height: 1.45;
  }
  .doc-header__company { color: var(--brand-primary); font-weight: 600; }

  /* Title block */
  .doc-title { margin: 0 0 6px; }
  h1 {
    font-size: 22pt;
    font-weight: 700;
    margin: 0 0 4px;
    color: var(--brand-primary);
    letter-spacing: -0.01em;
  }
  h2 {
    font-size: 12pt;
    font-weight: 700;
    margin: 22px 0 10px;
    color: var(--brand-primary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--brand-secondary);
  }
  h3 {
    font-size: 11pt;
    font-weight: 600;
    margin: 14px 0 6px;
    color: var(--brand-primary);
  }
  p { margin: 6px 0; }
  strong { color: var(--brand-primary); font-weight: 600; }
  hr { border: 0; border-top: 1px solid var(--border); margin: 18px 0; }

  /* Tables — structured data */
  table { border-collapse: collapse; width: 100%; margin: 8px 0; font-size: 10.5pt; }
  th, td { text-align: left; padding: 7px 9px; vertical-align: top; }
  table.data th {
    width: 38%;
    color: var(--text-muted);
    font-weight: 500;
    background: var(--brand-soft);
    border-bottom: 1px solid var(--border);
  }
  table.data td {
    border-bottom: 1px solid var(--border);
    color: var(--text);
  }

  /* Two-column grid */
  .grid-2 {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 18px;
    margin: 8px 0 14px;
  }
  .panel {
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 12px 14px;
    background: #fff;
    page-break-inside: avoid;
  }
  .panel h3 {
    margin-top: 0;
    font-size: 10pt;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--brand-primary);
  }
  .panel .label { font-size: 9pt; color: var(--text-muted); display: block; margin-top: 6px; }
  .panel .value { font-size: 11pt; color: var(--text); }

  /* Numbered sections */
  .section { page-break-inside: avoid; margin-top: 16px; }
  .section-title {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 12pt;
    font-weight: 700;
    color: var(--brand-primary);
    text-transform: uppercase;
    letter-spacing: 0.06em;
    margin: 22px 0 10px;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--brand-secondary);
  }
  .section-title .num {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 26px;
    height: 26px;
    padding: 0 6px;
    border-radius: 4px;
    background: var(--brand-primary);
    color: #fff;
    font-weight: 700;
    font-size: 10pt;
  }

  /* Checkboxes */
  .checks { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px 18px; margin: 6px 0; }
  .check { font-size: 10.5pt; line-height: 1.6; }
  .check .box-icon { font-size: 12pt; margin-right: 6px; color: var(--brand-primary); }

  .box {
    border-left: 4px solid var(--brand-secondary);
    padding: 10px 14px;
    margin: 12px 0;
    background: var(--brand-soft);
    border-radius: 0 4px 4px 0;
    page-break-inside: avoid;
  }

  .muted { color: var(--text-muted); font-size: 10pt; }

  /* Signatures */
  .signature {
    margin-top: 36px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 32px;
    page-break-inside: avoid;
  }
  .signature .sig-line {
    border-top: 1px solid var(--text);
    padding-top: 6px;
    font-size: 10pt;
    color: var(--text-muted);
  }
  .signature .sig-name { color: var(--text); font-weight: 600; }

  /* Footer */
  .doc-footer {
    margin-top: 32px;
    padding-top: 10px;
    border-top: 1px solid var(--border);
    font-size: 8.5pt;
    color: var(--text-muted);
    text-align: center;
  }

  /* Pagination */
  .page-break { page-break-after: always; break-after: page; }
  h1, h2, h3 { page-break-after: avoid; break-after: avoid; }
  table, .panel, .section, .signature, .box { page-break-inside: avoid; break-inside: avoid; }

  ${customCss || ""}
</style>
</head>
<body>
<div class="doc-shell">
${headerHtml}
${bodyHtml}
${footerHtml}
</div>
</body>
</html>`;
}

function escapeAttr(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}


/* ---------- Helpers used inside templates ---------- */
// Templates are pure HTML strings (no JS). Checkbox states are rendered via
// {{var}} substitution: if the variable resolves to a truthy value it shows ☑,
// otherwise ☐. We expose helper variables for the property type checkboxes via
// the wizard's `overrides.checks` payload (see MandateWizard).

const MANDATE_INTRO = `
<h1 class="doc-title">Maklermandat</h1>
<p class="muted">Verkaufsvermittlungsauftrag · {{mandate.type}}</p>
<p class="muted">Ausgestellt am {{today}} in {{company.default_place}}</p>
`;

const MANDATE_PARTIES_GRID = `
<div class="grid-2">
  <div class="panel">
    <h3>Auftraggeber</h3>
    <span class="label">Name</span>
    <div class="value"><strong>{{client.full_name}}</strong></div>
    <span class="label">Adresse</span>
    <div class="value">{{client.address}}<br/>{{client.postal_code}} {{client.city}}</div>
    <span class="label">Kontakt</span>
    <div class="value">{{client.email}} · {{client.phone}}</div>
  </div>
  <div class="panel">
    <h3>Auftragnehmer</h3>
    <span class="label">Firma</span>
    <div class="value"><strong>{{company.legal_name}}</strong></div>
    <span class="label">Adresse</span>
    <div class="value">{{company.address}}<br/>{{company.postal_code}} {{company.city}}</div>
    <span class="label">Kontakt</span>
    <div class="value">{{company.email}} · {{company.phone}}</div>
    <span class="label">UID</span>
    <div class="value">{{company.uid_number}}</div>
  </div>
</div>
`;

const MANDATE_OBJECT_GRID = `
<div class="grid-2">
  <div class="panel">
    <h3>Vermittlungsobjekt</h3>
    <span class="label">Bezeichnung</span>
    <div class="value"><strong>{{property.title}}</strong></div>
    <span class="label">Adresse</span>
    <div class="value">{{property.address}}<br/>{{property.postal_code}} {{property.city}}</div>
    <span class="label">Verkaufspreis</span>
    <div class="value"><strong>{{property.price}}</strong></div>
  </div>
  <div class="panel">
    <h3>Eckdaten</h3>
    <span class="label">Wohnfläche</span>
    <div class="value">{{property.living_area}} m²</div>
    <span class="label">Zimmer</span>
    <div class="value">{{property.rooms}}</div>
    <span class="label">Grundstück</span>
    <div class="value">{{property.plot_area}} m²</div>
    <span class="label">Baujahr</span>
    <div class="value">{{property.year_built}}</div>
  </div>
</div>

<h3>Objektart</h3>
<div class="checks">
  <div class="check"><span class="box-icon">{{check.house}}</span> Einfamilienhaus</div>
  <div class="check"><span class="box-icon">{{check.apartment}}</span> Eigentumswohnung</div>
  <div class="check"><span class="box-icon">{{check.multifamily}}</span> Mehrfamilienhaus</div>
  <div class="check"><span class="box-icon">{{check.commercial}}</span> Gewerbeobjekt</div>
  <div class="check"><span class="box-icon">{{check.land}}</span> Grundstück / Bauland</div>
  <div class="check"><span class="box-icon">{{check.other}}</span> Sonstiges</div>
</div>
`;

const MANDATE_SIGNATURES = `
<div class="signature">
  <div class="sig-line">
    <div class="sig-name">{{client.full_name}}</div>
    Auftraggeber · {{company.default_place}}, den {{today}}
  </div>
  <div class="sig-line">
    <div class="sig-name">{{company.default_signatory_name}}</div>
    {{company.default_signatory_role}} · {{company.name}}
  </div>
</div>
`;

export const DEFAULT_MANDATE_TEMPLATE = `${MANDATE_INTRO}
${MANDATE_PARTIES_GRID}

<div class="section-title"><span class="num">1</span> Vertragsgegenstand</div>
<p>Der Auftraggeber beauftragt den Auftragnehmer mit der <strong>exklusiven</strong> Vermittlung des nachstehend bezeichneten Objekts. Während der Laufzeit dieses Mandats ist der Auftraggeber nicht berechtigt, weitere Makler oder Vermittler mit der Vermarktung des Objekts zu beauftragen.</p>
${MANDATE_OBJECT_GRID}

<div class="section-title"><span class="num">2</span> Provision</div>
<table class="data">
  <tr><th>Provisionsmodell</th><td>{{mandate.commission_model}}</td></tr>
  <tr><th>Provisionssatz / Pauschale</th><td><strong>{{mandate.commission_value}}</strong></td></tr>
  <tr><th>Berechnungsbasis</th><td>Notariell beurkundeter Kaufpreis (zzgl. ges. MwSt.)</td></tr>
  <tr><th>Fälligkeit</th><td>Mit Abschluss des Kaufvertrages, spätestens bei Eigentumsübertragung</td></tr>
</table>

<div class="section-title"><span class="num">3</span> Laufzeit & Verlängerung</div>
<p>Dieses Mandat tritt am <strong>{{mandate.valid_from}}</strong> in Kraft und endet am <strong>{{mandate.valid_until}}</strong>. Wird das Mandat nicht spätestens 30 Tage vor Ablauf schriftlich gekündigt, verlängert es sich stillschweigend um jeweils drei Monate.</p>

<div class="section-title"><span class="num">4</span> Pflichten des Auftragnehmers</div>
<p>Der Auftragnehmer verpflichtet sich, das Objekt fachgerecht und mit der Sorgfalt eines ordentlichen Maklers zu vermarkten. Dies umfasst insbesondere:</p>
<ul>
  <li>Erstellung eines professionellen Exposés inkl. hochwertiger Fotos</li>
  <li>Listing auf relevanten Plattformen (ImmoScout24, Homegate, Newhome u. a.)</li>
  <li>Qualifizierung von Interessenten und Bonitätsprüfung</li>
  <li>Organisation und Durchführung der Besichtigungen</li>
  <li>Verhandlungsführung und Begleitung bis zur Beurkundung</li>
</ul>

<div class="section-title"><span class="num">5</span> Pflichten des Auftraggebers</div>
<p>Der Auftraggeber stellt dem Auftragnehmer alle für die Vermittlung erforderlichen Unterlagen vollständig und wahrheitsgemäss zur Verfügung. Er verpflichtet sich, alle Anfragen, die ihn direkt erreichen, unverzüglich an den Auftragnehmer weiterzuleiten.</p>

<div class="section-title"><span class="num">6</span> Datenschutz & Vertraulichkeit</div>
<p>Beide Parteien verpflichten sich zur vertraulichen Behandlung aller im Rahmen dieses Mandats ausgetauschten Informationen. Personenbezogene Daten werden ausschliesslich zum Zweck der Vertragserfüllung gemäss DSGVO und revDSG verarbeitet.</p>

<div class="section-title"><span class="num">7</span> Schlussbestimmungen</div>
<p>Änderungen und Ergänzungen dieses Vertrages bedürfen der Schriftform. Sollten einzelne Bestimmungen unwirksam sein, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt. Gerichtsstand ist {{company.default_place}}, anwendbar ist Schweizer Recht.</p>

${MANDATE_SIGNATURES}
`;

export const DEFAULT_MANDATE_PARTIAL_TEMPLATE = `${MANDATE_INTRO}
${MANDATE_PARTIES_GRID}

<div class="section-title"><span class="num">1</span> Vertragsgegenstand</div>
<p>Der Auftraggeber beauftragt den Auftragnehmer mit der <strong>teilexklusiven</strong> Vermittlung des unten bezeichneten Objekts. Der Auftraggeber behält das Recht, einen eigenen Käufer zu vermitteln, ohne dass ein Provisionsanspruch des Auftragnehmers entsteht. Die Beauftragung weiterer Makler ist ausgeschlossen.</p>
${MANDATE_OBJECT_GRID}

<div class="section-title"><span class="num">2</span> Provision</div>
<table class="data">
  <tr><th>Provisionsmodell</th><td>{{mandate.commission_model}}</td></tr>
  <tr><th>Provisionssatz / Pauschale</th><td><strong>{{mandate.commission_value}}</strong></td></tr>
  <tr><th>Berechnungsbasis</th><td>Notariell beurkundeter Kaufpreis (zzgl. ges. MwSt.)</td></tr>
  <tr><th>Fälligkeit</th><td>Mit Abschluss des Kaufvertrages</td></tr>
</table>
<div class="box"><strong>Eigenvermittlung:</strong> Findet der Auftraggeber selbst einen Käufer, ist keine Provision geschuldet. Der Auftraggeber informiert den Auftragnehmer hierüber unverzüglich.</div>

<div class="section-title"><span class="num">3</span> Laufzeit & Verlängerung</div>
<p>Dieses Mandat ist gültig vom <strong>{{mandate.valid_from}}</strong> bis zum <strong>{{mandate.valid_until}}</strong>. Eine stillschweigende Verlängerung erfolgt nicht.</p>

<div class="section-title"><span class="num">4</span> Pflichten des Auftragnehmers</div>
<p>Professionelle Vermarktung gemäss Standard des Maklers, inklusive Exposé, Online-Listings, Interessentenqualifizierung, Besichtigungen und Verhandlungsbegleitung.</p>

<div class="section-title"><span class="num">5</span> Pflichten des Auftraggebers</div>
<p>Bereitstellung aller relevanten Objektunterlagen sowie unverzügliche Weiterleitung sämtlicher direkt eingehender Anfragen, sofern diese nicht aus eigener Vermittlung stammen.</p>

<div class="section-title"><span class="num">6</span> Datenschutz & Vertraulichkeit</div>
<p>Beide Parteien behandeln alle ausgetauschten Informationen vertraulich. Datenverarbeitung erfolgt gemäss DSGVO und revDSG.</p>

<div class="section-title"><span class="num">7</span> Schlussbestimmungen</div>
<p>Änderungen bedürfen der Schriftform. Gerichtsstand: {{company.default_place}}. Es gilt Schweizer Recht.</p>

${MANDATE_SIGNATURES}
`;

export const DEFAULT_RESERVATION_TEMPLATE = `<h1>Reservationsvereinbarung</h1>
<p class="muted">Datum: {{today}} – Ort: {{company.default_place}}</p>

<h2>Reservierende Partei</h2>
<p>{{client.full_name}}<br/>{{client.address}}<br/>{{client.postal_code}} {{client.city}}<br/>E-Mail: {{client.email}} – Telefon: {{client.phone}}</p>

<h2>Reserviertes Objekt</h2>
<p><strong>{{property.title}}</strong><br/>{{property.address}}, {{property.postal_code}} {{property.city}}</p>
<p>Kaufpreis: <strong>{{property.price}}</strong></p>

<h2>Reservationsbedingungen</h2>
<p>Reservationsgebühr: <strong>{{reservation.reservation_fee}}</strong><br/>Reservation gültig bis: <strong>{{reservation.valid_until}}</strong><br/>Zahlungsfrist: {{reservation.payment_deadline}}</p>

<h2>Zahlungsdetails</h2>
<p>Bank: {{bank.bank_name}}<br/>Inhaber: {{bank.account_holder}}<br/>IBAN: <strong>{{bank.iban}}</strong><br/>BIC: {{bank.bic}}<br/>Verwendungszweck: {{bank.purpose}}</p>

<hr/>
<p>Die reservierende Partei sichert sich mit dieser Vereinbarung das ausschliessliche Vorkaufsrecht am oben genannten Objekt bis zum genannten Datum.</p>

<div class="signature">
  <div>{{client.full_name}}</div>
  <div>{{company.default_signatory_name}} – {{company.name}}</div>
</div>`;

export const DEFAULT_RESERVATION_RECEIPT_TEMPLATE = `<h1>Quittung – Reservationsgebühr</h1>
<p class="muted">Datum: {{today}} – Ort: {{company.default_place}}</p>

<p>Hiermit bestätigen wir den Erhalt der Reservationsgebühr in Höhe von <strong>{{reservation.reservation_fee}}</strong> für das Objekt <strong>{{property.title}}</strong>, {{property.address}}, {{property.postal_code}} {{property.city}}.</p>

<table>
  <tr><th>Reservierende Partei</th><td>{{client.full_name}}, {{client.address}}, {{client.postal_code}} {{client.city}}</td></tr>
  <tr><th>Betrag</th><td><strong>{{reservation.reservation_fee}}</strong></td></tr>
  <tr><th>Eingang auf Konto</th><td>{{bank.iban}} ({{bank.bank_name}})</td></tr>
  <tr><th>Reservation gültig bis</th><td>{{reservation.valid_until}}</td></tr>
</table>

<div class="signature">
  <div>{{client.full_name}}</div>
  <div>{{company.default_signatory_name}} – {{company.name}}</div>
</div>`;

export const DEFAULT_NDA_TEMPLATE = `<h1>Vertraulichkeitsvereinbarung (NDA)</h1>
<p class="muted">Datum: {{today}} – Ort: {{company.default_place}}</p>

<h2>Parteien</h2>
<p><strong>Empfangende Partei:</strong><br/>{{client.full_name}}<br/>{{client.address}}, {{client.postal_code}} {{client.city}}</p>
<p><strong>Offenlegende Partei:</strong><br/>{{company.legal_name}}<br/>{{company.address}}, {{company.postal_code}} {{company.city}}</p>

<h2>Gegenstand</h2>
<p>Diese Vereinbarung regelt die Behandlung vertraulicher Informationen im Rahmen folgender Tätigkeit: <strong>{{nda.purpose}}</strong>.</p>
<p>Bezug zum Objekt (sofern zutreffend): {{property.title}}, {{property.address}}, {{property.postal_code}} {{property.city}}.</p>

<h2>Pflichten</h2>
<p>Die empfangende Partei verpflichtet sich, alle erhaltenen Informationen vertraulich zu behandeln, ausschliesslich für den genannten Zweck zu verwenden und nicht ohne schriftliche Zustimmung an Dritte weiterzugeben.</p>

<h2>Laufzeit</h2>
<p>Diese Vereinbarung ist gültig von {{nda.valid_from}} bis {{nda.valid_until}}.</p>

<div class="signature">
  <div>{{client.full_name}}</div>
  <div>{{company.default_signatory_name}} – {{company.name}}</div>
</div>`;

export function defaultTemplateForType(type: string): string {
  switch (type) {
    case "mandate":
      return DEFAULT_MANDATE_TEMPLATE;
    case "mandate_partial":
      return DEFAULT_MANDATE_PARTIAL_TEMPLATE;
    case "reservation":
      return DEFAULT_RESERVATION_TEMPLATE;
    case "reservation_receipt":
      return DEFAULT_RESERVATION_RECEIPT_TEMPLATE;
    case "nda":
      return DEFAULT_NDA_TEMPLATE;
    default:
      return "";
  }
}

/* ============================================================
 * COMPACT LAYOUT — kompaktes Vertragslayout (ursprünglich für ASIMO entworfen).
 * Aktiv bei `<!--layout:compact-->` oder Legacy `<!--skin:asimo-->`.
 * Akzentfarbe = Tenant-Branding (secondary_color, sonst primary_color).
 * ============================================================ */

function wrapCompactLayout(args: {
  title: string;
  bodyHtml: string;
  brand: NonNullable<TemplateContext["brand"]>;
  font: string;
  customCss: string;
}): string {
  const { title, bodyHtml, brand, font, customCss } = args;
  const accent = brand.secondary_color || brand.primary_color || DEFAULT_BRAND.primary_color;
  const accentSoft = `color-mix(in srgb, ${accent} 12%, #ffffff)`;
  const companyName = escapeAttr(brand.company_name || "");
  const logoUrl = brand.logo_url ? escapeAttr(brand.logo_url) : "";
  const website = brand.company_website
    ? escapeAttr(brand.company_website.replace(/^https?:\/\//, ""))
    : "";
  const email = brand.company_email ? escapeAttr(brand.company_email) : "";

  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8" />
<title>${title.replace(/</g, "&lt;")}</title>
<style>
  @page {
    size: A4;
    margin: 12mm 12mm 16mm 12mm;
    @bottom-left {
      content: "${companyName.replace(/"/g, '\\"')}";
      font-family: ${font};
      font-size: 8pt;
      color: #6b7280;
      letter-spacing: 0.02em;
      vertical-align: bottom;
      padding-bottom: 6mm;
    }
    @bottom-center {
      content: "${title.replace(/"/g, '\\"').replace(/</g, "&lt;")}";
      font-family: ${font};
      font-size: 8pt;
      color: #9ca3af;
      vertical-align: bottom;
      padding-bottom: 6mm;
    }
    @bottom-right {
      content: "Seite " counter(page) " / " counter(pages);
      font-family: ${font};
      font-size: 8pt;
      color: ${accent};
      font-weight: 600;
      vertical-align: bottom;
      padding-bottom: 6mm;
    }
  }
  :root {
    --doc-accent: ${accent};
    --doc-accent-soft: ${accentSoft};
    --doc-text: #1a1a1a;
    --doc-muted: #6b7280;
    --doc-rule: #d6d6d6;
  }
  * { box-sizing: border-box; }
  html, body { background: #fff; margin: 0; padding: 0; }
  body {
    font-family: ${font};
    color: var(--doc-text);
    line-height: 1.35;
    font-size: 8.75pt;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .a-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 10px; }
  .a-title { font-size: 19pt; font-weight: 800; color: #111; letter-spacing: -0.01em; margin: 0; line-height: 1.1; }
  .a-title .sub { font-weight: 400; color: #111; }
  .a-logo { height: 32px; width: auto; display: block; }
  .a-parties {
    display: grid; grid-template-columns: 180px 1fr; gap: 14px; margin-bottom: 12px;
    border-left: 3px solid var(--doc-accent); padding-left: 12px;
  }
  .a-zwischen { font-weight: 700; color: #111; font-size: 9.5pt; margin-bottom: 4px; }
  .a-party-l { font-size: 8.5pt; line-height: 1.35; color: #111; }
  .a-parties-r-label { font-size: 9.5pt; margin-bottom: 4px; color: #111; }
  .a-formgrid { display: grid; grid-template-columns: 90px 1fr 90px 1fr; column-gap: 10px; row-gap: 0; }
  .a-formgrid .lbl { font-size: 8pt; color: #111; font-weight: 600; padding: 4px 0 3px; border-bottom: 1px solid var(--doc-rule); }
  .a-formgrid .val { font-size: 8.75pt; color: #111; padding: 4px 0 3px; border-bottom: 1px solid var(--doc-rule); min-height: 16px; }

  .a-objekt { border: 1px dashed var(--doc-accent); border-radius: 8px; padding: 10px 12px; margin: 0 0 10px; page-break-inside: avoid; }
  .a-objekt h3 { font-size: 11.5pt; font-weight: 800; color: #111; margin: 0 0 8px; }
  .a-objekt .a-formgrid { grid-template-columns: 100px 1fr; }
  .a-objekt .lbl.highlight { background: var(--doc-accent-soft); padding-left: 6px; border-bottom-color: var(--doc-accent); }

  .a-checks-row { display: grid; grid-template-columns: repeat(2, 1fr); gap: 3px 10px; font-size: 8.25pt; color: #111; margin-bottom: 8px; }
  .a-check { white-space: nowrap; }
  .bx { display: inline-block; width: 9px; height: 9px; border: 1px solid #111; margin-right: 4px; vertical-align: middle; line-height: 9px; text-align: center; font-size: 7pt; }
  .bx.on { background: #111; color: #fff; }

  .a-section { break-inside: avoid; page-break-inside: avoid; margin-bottom: 7px; }
  .a-section h4 { font-size: 9.5pt; font-weight: 700; color: var(--doc-accent); margin: 6px 0 3px; }
  .a-section h4.sub { font-size: 9pt; color: #333; margin-top: 4px; }
  .a-section p { margin: 0 0 4px; text-align: justify; hyphens: auto; -webkit-hyphens: auto; font-size: 8.25pt; line-height: 1.38; }
  .commission-row { display: flex; flex-wrap: wrap; gap: 5px 12px; margin-top: 5px; font-size: 8.25pt; align-items: center; }
  .commission-grid { display: grid; grid-template-columns: repeat(2, max-content); gap: 4px 18px; margin-top: 6px; font-size: 8.25pt; }
  .commission-pauschal { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 8.25pt; }
  .c-opt { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
  .pauschal-val { border-bottom: 1px solid #111; padding: 0 8px; min-width: 90px; display: inline-block; font-weight: 600; }
  .a-two-cols { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  .a-two-cols > div > .a-section:first-child,
  .a-two-cols > div > .a-objekt:first-child { margin-top: 0; }
  .a-clear { clear: both; }

  .a-signatures {
    margin-top: 14px;
    padding-top: 10px;
    border-top: 1px solid var(--doc-rule);
    width: calc(50% - 9px);
    margin-left: auto;
    display: block;
    break-inside: avoid;
    page-break-inside: avoid;
    break-before: avoid;
    page-break-before: avoid;
  }
  .a-sig { margin-top: 14px; break-inside: avoid; }
  .a-sig .line {
    border-bottom: 1px dashed #c4c4c4;
    height: 22px;
    position: relative;
    padding-left: 16px;
  }
  .a-sig .line::before {
    content: "›";
    position: absolute;
    left: 0;
    bottom: 6px;
    font-size: 11pt;
    color: var(--doc-accent);
    line-height: 1;
    opacity: 0.6;
  }
  .a-sig .label { font-size: 7.75pt; color: var(--doc-muted); margin-top: 3px; }

  .a-footer { position: fixed; bottom: 6mm; left: 14mm; right: 14mm; display: flex; justify-content: space-between; align-items: center; font-size: 8pt; color: var(--doc-muted); border-top: 1px solid var(--doc-rule); padding-top: 6px; }
  .a-foot-left { display: flex; align-items: center; gap: 8px; }
  .a-foot-left img { height: 12px; }
  .a-foot-mark { font-weight: 700; color: #111; font-size: 9pt; letter-spacing: 0.05em; }
  .a-pagenum { display: inline-flex; align-items: center; gap: 8px; }
  .a-pagenum .dot { width: 16px; height: 16px; border-radius: 50%; background: #111; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 8pt; font-weight: 700; }

  ${customCss || ""}
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

export const DEFAULT_MANDATE_ASIMO_EXCLUSIVE = `<!--skin:asimo-->
<div class="a-header">
  <h1 class="a-title">Maklermandat <span class="sub">/ Exklusiv</span></h1>
  <img src="{{logo_url}}" alt="{{company_name}}" class="a-logo" />
</div>

<div class="a-parties">
  <div>
    <div class="a-zwischen">zwischen</div>
    <div class="a-party-l">
      <strong>{{company.legal_name}}</strong><br/>
      {{company.address}}<br/>
      {{company.postal_code}} {{company.city}}<br/>
      vertreten durch: {{agent.full_name}}<br/>
      <span style="color:#6b7280;">(nachfolgend „Auftragnehmer")</span>
    </div>
  </div>
  <div>
    <div class="a-parties-r-label">und (nachfolgend: <strong>Auftraggeber</strong>)</div>
    <div class="a-formgrid">
      <div class="lbl">Vorname</div><div class="val">{{client.first_name}}</div>
      <div class="lbl">Name</div><div class="val">{{client.last_name}}</div>
      <div class="lbl">Strasse + Nr.</div><div class="val">{{client.address}}</div>
      <div class="lbl">Ort/PLZ</div><div class="val">{{client.postal_code}} {{client.city}}</div>
      <div class="lbl">Telefon</div><div class="val">{{client.phone}}</div>
      <div class="lbl">E-Mail</div><div class="val">{{client.email}}</div>
    </div>
  </div>
</div>

<div class="a-two-cols">
  <div>
    <div class="a-objekt">
      <h3>Objektart / Bezeichnung</h3>
      <div class="a-checks-row">
        <span class="a-check"><span class="bx on">✕</span>MFH</span>
        <span class="a-check"><span class="bx"></span>EFH</span>
        <span class="a-check"><span class="bx"></span>Wohnung</span>
        <span class="a-check"><span class="bx"></span>Gewerbeimmobilie</span>
        <span class="a-check"><span class="bx"></span>Reihenhaus</span>
        <span class="a-check"><span class="bx"></span>Doppelhaus</span>
        <span class="a-check"><span class="bx"></span>Grundstück</span>
        <span class="a-check"><span class="bx"></span>Garagen-/Stellplatz</span>
      </div>
      <div class="a-formgrid">
        <div class="lbl">Strasse + Nr.</div><div class="val">{{property.address}}</div>
        <div class="lbl">Ort/PLZ</div><div class="val">{{property.postal_code}} {{property.city}}</div>
        <div class="lbl highlight">Verkaufspreis</div><div class="val"><strong>{{property.price}}</strong></div>
      </div>
    </div>

    <div class="a-section">
      <h4>1. Mandatumfang</h4>
      <p>Der Immobilienmakler wird beauftragt, die oben genannte Immobilie zu verkaufen. Der Makler verpflichtet sich, alle erforderlichen Massnahmen zur Vermarktung der Immobilie zu ergreifen, einschliesslich der Erstellung von Exposés, der Durchführung von Besichtigungen und der Verhandlung mit potenziellen Käufern.</p>
    </div>

    <div class="a-section">
      <h4>2. Provision</h4>
      <p>Der Verkäufer verpflichtet sich, dem Immobilienmakler eine Provision in folgender Höhe zu zahlen, die bei erfolgreichem Abschluss des Kaufvertrages fällig wird. Die Provision ist zur Zahlung fällig, sobald der notarielle Kaufvertrag zwischen Käufer und Verkäufer beurkundet worden ist. Der Auftraggeber hat das Recht, die Immobilie selbst zu verkaufen, ohne dass dabei eine Provision geschuldet wird, sofern die Auftragnehmerin mit einer möglichen Kundschaft noch keine Reservation abgeschlossen ist.</p>
      <div class="commission-pauschal" style="{{commission.show_percent}}">
        <span class="c-opt"><span class="bx on">✕</span>Provision in Prozent vom Verkaufspreis:</span>
        <span class="pauschal-val"><strong>{{commission_value}}%</strong></span>
      </div>
      <div class="commission-pauschal" style="{{commission.show_flat}}">
        <span class="c-opt"><span class="bx on">✕</span>Pauschalbetrag:</span>
        <span class="pauschal-val"><strong>{{commission_value}}</strong></span>
      </div>
    </div>

    <div class="a-section">
      <h4>3. Provisionsschutz</h4>
      <p>Kommt es nach Auflösen des Vertrags innerhalb von zwei Jahren zu einem Geschäftsabschluss mit einem Interessenten, der auf die Kontakte und Bemühungen des Auftragnehmers zurückzuführen ist, ist die volle Provision geschuldet.</p>
    </div>
  </div>

  <div>
    <div class="a-section">
      <h4>4. Exklusivität</h4>
      <p>Der Verkäufer gewährt dem Makler das alleinige und exklusive Recht, die Immobilie zu verkaufen. Der Auftraggeber verpflichtet sich, keine weiteren Makler mit der Vermarktung der Immobilie zu beauftragen und den Verkauf der Immobilie nicht selbst durchzuführen oder durch Dritte vornehmen zu lassen, solange dieses Mandat besteht.</p>
    </div>

    <div class="a-section">
      <h4>5. Rücktritt</h4>
      <p>Sollte sich der Verkäufer vor Abschluss des Verkaufs vom Mandat zurückziehen, wird eine Pauschalentschädigung in Höhe von CHF 5'000 für den bereits entstandenen Bearbeitungs- und Marketingaufwand fällig.</p>
    </div>

    <div class="a-section">
      <h4>6. Dauer des Mandats</h4>
      <p>Dieses Mandat tritt mit Unterzeichnung in Kraft und ist unbefristet. Es kann von beiden Parteien mit einer Kündigungsfrist von drei Monaten zum Monatsende gekündigt werden. Es entstehen für den Auftraggeber während der Vertragslaufzeit keine Gebühren.</p>
    </div>

    <div class="a-section" style="{{mandate.show_term}}">
      <h4 class="sub">6.1 Vertragslaufzeit</h4>
      <p>Dieses Mandat ist gültig vom <strong>{{mandate.valid_from}}</strong> bis zum <strong>{{mandate.valid_until}}</strong>.</p>
    </div>

    <div class="a-section">
      <h4>7. Schlussbestimmungen</h4>
      <p>Änderungen und Ergänzungen dieses Mandats bedürfen der Schriftform. Sollte eine Bestimmung dieses Mandats unwirksam sein, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt.</p>
    </div>
  </div>
</div>

<div class="a-clear"></div>

<div class="a-signatures">
  <div class="a-sig">
    <div class="line"></div>
    <div class="label">Ort und Datum</div>
  </div>
  <div class="a-sig">
    <div class="line"></div>
    <div class="label">Unterschrift Auftraggeber (Verkäufer)</div>
  </div>
  <div class="a-sig">
    <div class="line"></div>
    <div class="label">Unterschrift Auftragsnehmer ({{company.name}})</div>
  </div>
</div>
`;

/* ============================================================
 * ASIMO – Maklermandat (Einfach / Nicht-exklusiv)
 * ============================================================ */
export const DEFAULT_MANDATE_ASIMO_PARTIAL = `<!--skin:asimo-->
<div class="a-header">
  <h1 class="a-title">Maklermandat <span class="sub">/ Einfach</span></h1>
  <img src="{{logo_url}}" alt="{{company_name}}" class="a-logo" />
</div>

<div class="a-parties">
  <div>
    <div class="a-zwischen">zwischen</div>
    <div class="a-party-l">
      <strong>{{company.legal_name}}</strong><br/>
      {{company.address}}<br/>
      {{company.postal_code}} {{company.city}}<br/>
      vertreten durch: {{agent.full_name}}<br/>
      <span style="color:#6b7280;">(nachfolgend „Auftragnehmer")</span>
    </div>
  </div>
  <div>
    <div class="a-parties-r-label">und (nachfolgend: <strong>Auftraggeber</strong>)</div>
    <div class="a-formgrid">
      <div class="lbl">Vorname</div><div class="val">{{client.first_name}}</div>
      <div class="lbl">Name</div><div class="val">{{client.last_name}}</div>
      <div class="lbl">Strasse + Nr.</div><div class="val">{{client.address}}</div>
      <div class="lbl">Ort/PLZ</div><div class="val">{{client.postal_code}} {{client.city}}</div>
      <div class="lbl">Telefon</div><div class="val">{{client.phone}}</div>
      <div class="lbl">E-Mail</div><div class="val">{{client.email}}</div>
    </div>
  </div>
</div>

<div class="a-two-cols">
  <div>
    <div class="a-objekt">
      <h3>Objekt</h3>
      <div class="a-formgrid">
        <div class="lbl">Strasse + Nr.</div><div class="val">{{property.address}}</div>
        <div class="lbl">Ort/PLZ</div><div class="val">{{property.postal_code}} {{property.city}}</div>
        <div class="lbl highlight">Verkaufspreis</div><div class="val"><strong>{{property.price}}</strong></div>
      </div>
    </div>

    <div class="a-section">
      <h4>1. Mandatumfang</h4>
      <p>Der Auftraggeber beauftragt den Auftragnehmer mit der nicht-exklusiven Vermittlung des oben genannten Objekts. Der Auftraggeber bleibt berechtigt, das Objekt selbst oder durch weitere Makler zu vermarkten.</p>
    </div>

    <div class="a-section">
      <h4>2. Provision</h4>
      <p>Bei erfolgreichem Abschluss eines Kaufvertrages mit einem vom Auftragnehmer nachgewiesenen oder vermittelten Käufer ist folgende Provision geschuldet, fällig mit notarieller Beurkundung des Kaufvertrages.</p>
      <div class="commission-pauschal" style="{{commission.show_percent}}">
        <span class="c-opt"><span class="bx on">✕</span>Provision in Prozent vom Verkaufspreis:</span>
        <span class="pauschal-val"><strong>{{commission_value}}%</strong></span>
      </div>
      <div class="commission-pauschal" style="{{commission.show_flat}}">
        <span class="c-opt"><span class="bx on">✕</span>Pauschalbetrag:</span>
        <span class="pauschal-val"><strong>{{commission_value}}</strong></span>
      </div>
    </div>

    <div class="a-section">
      <h4>3. Provisionsschutz</h4>
      <p>Kommt es nach Auflösen des Vertrags innerhalb von zwei Jahren zu einem Geschäftsabschluss mit einem Interessenten, der auf die Kontakte und Bemühungen des Auftragnehmers zurückzuführen ist, ist die volle Provision geschuldet.</p>
    </div>
  </div>

  <div>
    <div class="a-section">
      <h4>4. Mitwirkungspflicht</h4>
      <p>Der Auftraggeber stellt dem Auftragnehmer alle für die Vermarktung erforderlichen Unterlagen und Informationen unverzüglich zur Verfügung und informiert über parallele Verkaufsbemühungen oder erhaltene Angebote.</p>
    </div>

    <div class="a-section">
      <h4>5. Dauer des Mandats</h4>
      <p>Dieses Mandat tritt mit Unterzeichnung in Kraft und kann von beiden Parteien jederzeit schriftlich beendet werden. Bereits entstandene Provisionsansprüche bleiben unberührt.</p>
    </div>

    <div class="a-section" style="{{mandate.show_term}}">
      <h4 class="sub">5.1 Vertragslaufzeit</h4>
      <p>Dieses Mandat ist gültig vom <strong>{{mandate.valid_from}}</strong> bis zum <strong>{{mandate.valid_until}}</strong>.</p>
    </div>

    <div class="a-section">
      <h4>6. Schlussbestimmungen</h4>
      <p>Änderungen und Ergänzungen dieses Mandats bedürfen der Schriftform. Sollte eine Bestimmung dieses Mandats unwirksam sein, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt.</p>
    </div>
  </div>
</div>

<div class="a-clear"></div>

<div class="a-signatures">
  <div class="a-sig"><div class="line"></div><div class="label">Ort und Datum</div></div>
  <div class="a-sig"><div class="line"></div><div class="label">Unterschrift Auftraggeber</div></div>
  <div class="a-sig"><div class="line"></div><div class="label">Unterschrift {{company.name}}</div></div>
</div>
`;

/* ============================================================
 * ASIMO – Reservationsvereinbarung
 * ============================================================ */
export const DEFAULT_RESERVATION_ASIMO = `<!--skin:asimo-->
<div class="a-header">
  <h1 class="a-title">Reservationsvereinbarung</h1>
  <img src="{{logo_url}}" alt="{{company_name}}" class="a-logo" />
</div>

<div class="a-parties">
  <div>
    <div class="a-zwischen">zwischen</div>
    <div class="a-party-l">
      <strong>{{company.legal_name}}</strong><br/>
      {{company.address}}<br/>
      {{company.postal_code}} {{company.city}}<br/>
      vertreten durch: {{agent.full_name}}<br/>
      <span style="color:#6b7280;">(nachfolgend „Vermittler")</span>
    </div>
  </div>
  <div>
    <div class="a-parties-r-label">und (nachfolgend: <strong>Reservant</strong>)</div>
    <div class="a-formgrid">
      <div class="lbl">Vorname</div><div class="val">{{client.first_name}}</div>
      <div class="lbl">Name</div><div class="val">{{client.last_name}}</div>
      <div class="lbl">Strasse + Nr.</div><div class="val">{{client.address}}</div>
      <div class="lbl">Ort/PLZ</div><div class="val">{{client.postal_code}} {{client.city}}</div>
      <div class="lbl">Telefon</div><div class="val">{{client.phone}}</div>
      <div class="lbl">E-Mail</div><div class="val">{{client.email}}</div>
    </div>
  </div>
</div>

<div class="a-two-cols">
  <div>
    <div class="a-objekt">
      <h3>Reserviertes Objekt</h3>
      <div class="a-formgrid">
        <div class="lbl">Bezeichnung</div><div class="val">{{property.title}}</div>
        <div class="lbl">Strasse + Nr.</div><div class="val">{{property.address}}</div>
        <div class="lbl">Ort/PLZ</div><div class="val">{{property.postal_code}} {{property.city}}</div>
        <div class="lbl highlight">Kaufpreis</div><div class="val"><strong>{{property.price}}</strong></div>
      </div>
    </div>

    <div class="a-section">
      <h4>1. Gegenstand der Reservation</h4>
      <p>Der Vermittler bestätigt dem Reservanten die exklusive Reservation des oben bezeichneten Objekts. Während der Reservationsdauer wird das Objekt keinem Dritten angeboten oder verkauft.</p>
    </div>

    <div class="a-section">
      <h4>2. Reservationsgebühr</h4>
      <div class="commission-pauschal">
        <span class="c-opt"><span class="bx on">✕</span>Reservationsgebühr:</span>
        <span class="pauschal-val"><strong>{{reservation.reservation_fee}}</strong></span>
      </div>
      <p>Die Reservationsgebühr ist innert {{reservation.payment_deadline}} auf das vom Vermittler bezeichnete Konto zu überweisen. Bei Abschluss des Kaufvertrages wird die Gebühr vollumfänglich an den Kaufpreis angerechnet.</p>
    </div>
  </div>

  <div>
    <div class="a-section">
      <h4>3. Reservationsdauer</h4>
      <p>Diese Reservation gilt bis zum <strong>{{reservation.valid_until}}</strong>. Kommt innerhalb dieser Frist kein Kaufvertrag zustande, erlischt die Reservation automatisch.</p>
    </div>

    <div class="a-section">
      <h4>4. Rücktritt</h4>
      <p>Tritt der Reservant ohne triftigen Grund vom Kaufvorhaben zurück, verfällt die Reservationsgebühr als Aufwandsentschädigung zugunsten des Vermittlers. Tritt der Verkäufer zurück, wird die Gebühr vollumfänglich zurückerstattet.</p>
    </div>

    <div class="a-section">
      <h4>5. Form und Schlussbestimmungen</h4>
      <p>Diese Reservationsvereinbarung begründet keinen Anspruch auf Abschluss eines Kaufvertrages. Der Kaufvertrag bedarf der öffentlichen Beurkundung. Änderungen dieser Vereinbarung bedürfen der Schriftform.</p>
    </div>
  </div>
</div>

<div class="a-clear"></div>

<div class="a-signatures">
  <div class="a-sig"><div class="line"></div><div class="label">Ort und Datum</div></div>
  <div class="a-sig"><div class="line"></div><div class="label">Unterschrift Reservant</div></div>
  <div class="a-sig"><div class="line"></div><div class="label">Unterschrift {{company.name}}</div></div>
</div>
`;

/* ============================================================
 * ASIMO – Quittung Reservationsgebühr
 * ============================================================ */
export const DEFAULT_RESERVATION_RECEIPT_ASIMO = `<!--skin:asimo-->
<div class="a-header">
  <h1 class="a-title">Quittung <span class="sub">/ Reservationsgebühr</span></h1>
  <img src="{{logo_url}}" alt="{{company_name}}" class="a-logo" />
</div>

<div class="a-parties">
  <div>
    <div class="a-zwischen">Empfänger</div>
    <div class="a-party-l">
      <strong>{{company.legal_name}}</strong><br/>
      {{company.address}}<br/>
      {{company.postal_code}} {{company.city}}<br/>
      vertreten durch: {{agent.full_name}}
    </div>
  </div>
  <div>
    <div class="a-parties-r-label">Einzahler</div>
    <div class="a-formgrid">
      <div class="lbl">Name</div><div class="val">{{client.full_name}}</div>
      <div class="lbl">Adresse</div><div class="val">{{client.address}}, {{client.postal_code}} {{client.city}}</div>
      <div class="lbl">E-Mail</div><div class="val">{{client.email}}</div>
    </div>
  </div>
</div>

<div class="a-objekt">
  <h3>Bestätigte Zahlung</h3>
  <div class="a-formgrid">
    <div class="lbl">Verwendungszweck</div><div class="val">Reservation – {{property.title}}</div>
    <div class="lbl">Objekt</div><div class="val">{{property.address}}, {{property.postal_code}} {{property.city}}</div>
    <div class="lbl">Reservation gültig bis</div><div class="val">{{reservation.valid_until}}</div>
    <div class="lbl highlight">Erhaltener Betrag</div><div class="val"><strong>{{reservation.reservation_fee}}</strong></div>
  </div>
</div>

<div class="a-section">
  <h4>Bestätigung</h4>
  <p>Hiermit bestätigt {{company.legal_name}} den Erhalt der oben aufgeführten Reservationsgebühr für das genannte Objekt. Die Zahlung wird bei Abschluss des Kaufvertrages vollumfänglich an den Kaufpreis angerechnet.</p>
</div>

<div class="a-clear"></div>

<div class="a-signatures">
  <div class="a-sig"><div class="line"></div><div class="label">Ort und Datum</div></div>
  <div class="a-sig"><div class="line"></div><div class="label">Unterschrift {{company.name}}</div></div>
</div>
`;

/* ============================================================
 * ASIMO – Vertraulichkeitsvereinbarung (NDA)
 * ============================================================ */
export const DEFAULT_NDA_ASIMO = `<!--skin:asimo-->
<div class="a-header">
  <h1 class="a-title">Vertraulichkeitsvereinbarung <span class="sub">/ NDA</span></h1>
  <img src="{{logo_url}}" alt="{{company_name}}" class="a-logo" />
</div>

<div class="a-parties">
  <div>
    <div class="a-zwischen">zwischen</div>
    <div class="a-party-l">
      <strong>{{company.legal_name}}</strong><br/>
      {{company.address}}<br/>
      {{company.postal_code}} {{company.city}}<br/>
      vertreten durch: {{agent.full_name}}<br/>
      <span style="color:#6b7280;">(nachfolgend „Offenlegende Partei")</span>
    </div>
  </div>
  <div>
    <div class="a-parties-r-label">und (nachfolgend: <strong>Empfangende Partei</strong>)</div>
    <div class="a-formgrid">
      <div class="lbl">Vorname</div><div class="val">{{client.first_name}}</div>
      <div class="lbl">Name</div><div class="val">{{client.last_name}}</div>
      <div class="lbl">Strasse + Nr.</div><div class="val">{{client.address}}</div>
      <div class="lbl">Ort/PLZ</div><div class="val">{{client.postal_code}} {{client.city}}</div>
      <div class="lbl">E-Mail</div><div class="val">{{client.email}}</div>
    </div>
  </div>
</div>

<div class="a-two-cols">
  <div>
    <div class="a-section">
      <h4>1. Zweck</h4>
      <p>Die Parteien beabsichtigen, im Zusammenhang mit dem Objekt <strong>{{property.title}}</strong>, {{property.address}}, {{property.postal_code}} {{property.city}}, vertrauliche Informationen auszutauschen. Diese Vereinbarung regelt den Schutz dieser Informationen.</p>
    </div>

    <div class="a-section">
      <h4>2. Vertrauliche Informationen</h4>
      <p>Als vertraulich gelten alle mündlich oder schriftlich übermittelten Daten, Unterlagen, Pläne, Kalkulationen, Eigentums- und Mieterverhältnisse, Finanzkennzahlen sowie sämtliche objektbezogenen Informationen.</p>
    </div>

    <div class="a-section">
      <h4>3. Geheimhaltungspflicht</h4>
      <p>Die Empfangende Partei verpflichtet sich, die vertraulichen Informationen ausschliesslich für den unter Ziff. 1 genannten Zweck zu verwenden, sie streng vertraulich zu behandeln und nicht an Dritte weiterzugeben.</p>
    </div>
  </div>

  <div>
    <div class="a-section">
      <h4>4. Ausnahmen</h4>
      <p>Die Geheimhaltungspflicht gilt nicht für Informationen, die nachweislich öffentlich bekannt sind, der Empfangenden Partei bereits bekannt waren oder aufgrund gesetzlicher Vorschriften offengelegt werden müssen.</p>
    </div>

    <div class="a-section">
      <h4>5. Laufzeit</h4>
      <p>Diese Vereinbarung gilt vom <strong>{{nda.valid_from}}</strong> bis zum <strong>{{nda.valid_until}}</strong>. Die Geheimhaltungspflicht besteht über das Ende der Vereinbarung hinaus für weitere drei Jahre fort.</p>
    </div>

    <div class="a-section">
      <h4>6. Konventionalstrafe</h4>
      <p>Bei jeder schuldhaften Verletzung der Geheimhaltungspflicht ist eine Konventionalstrafe in Höhe von <strong>{{nda.penalty_amount}}</strong> geschuldet. Die Geltendmachung weitergehenden Schadens bleibt vorbehalten.</p>
    </div>

    <div class="a-section">
      <h4>7. Schlussbestimmungen</h4>
      <p>Es gilt schweizerisches Recht. Gerichtsstand ist der Sitz der Offenlegenden Partei. Änderungen dieser Vereinbarung bedürfen der Schriftform.</p>
    </div>
  </div>
</div>

<div class="a-clear"></div>

<div class="a-signatures">
  <div class="a-sig"><div class="line"></div><div class="label">Ort und Datum</div></div>
  <div class="a-sig"><div class="line"></div><div class="label">Unterschrift Empfangende Partei</div></div>
  <div class="a-sig"><div class="line"></div><div class="label">Unterschrift {{company.name}}</div></div>
</div>
`;

/* ============================================================
 * ASIMO-Tenantinhalte (Legacy). NICHT als Immolia-Default verwenden; wird von
 * keinem Code mehr eingespielt. Neutrale Defaults: src/lib/template-catalog.ts
 * ============================================================ */
export const ASIMO_TEMPLATES: Array<{
  key: string;
  name: string;
  type: string;
  category: string;
  description: string;
  content: string;
}> = [
  {
    key: "asimo_mandate_exclusive",
    name: "ASIMO – Maklermandat (Exklusiv)",
    type: "mandate",
    category: "mandate",
    description: "ASIMO-Standardvorlage für exklusive Verkaufsmandate.",
    content: DEFAULT_MANDATE_ASIMO_EXCLUSIVE,
  },
  {
    key: "asimo_mandate_partial",
    name: "ASIMO – Maklermandat (Einfach)",
    type: "mandate_partial",
    category: "mandate",
    description: "ASIMO-Standardvorlage für nicht-exklusive Vermittlungsmandate.",
    content: DEFAULT_MANDATE_ASIMO_PARTIAL,
  },
  {
    key: "asimo_reservation",
    name: "ASIMO – Reservationsvereinbarung",
    type: "reservation",
    category: "reservation",
    description: "ASIMO-Standardvorlage für Objektreservationen.",
    content: DEFAULT_RESERVATION_ASIMO,
  },
  {
    key: "asimo_reservation_receipt",
    name: "ASIMO – Quittung Reservationsgebühr",
    type: "reservation_receipt",
    category: "reservation",
    description: "ASIMO-Quittung für eingegangene Reservationsgebühren.",
    content: DEFAULT_RESERVATION_RECEIPT_ASIMO,
  },
  {
    key: "asimo_nda",
    name: "ASIMO – Vertraulichkeitsvereinbarung (NDA)",
    type: "nda",
    category: "nda",
    description: "ASIMO-Standardvorlage für Vertraulichkeitsvereinbarungen.",
    content: DEFAULT_NDA_ASIMO,
  },
];

