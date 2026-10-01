// Selbstauskunft-PDF-Import (Immolia Core).
// Architektur: PDF-Extraktion → Source Adapter (Format-Erkennung + Mapping)
//   → kanonische Selbstauskunftsfelder.
// Formate:
//   - legacy_asimo_self_disclosure_v1: historisches interaktives Formular mit
//     Feldcodes AN../MI.. (nur Eingabeformat, unabhängig von der Firma).
//   - unknown: kein bekanntes Formular → nur beschriftete Personen-/Kontaktangaben,
//     keine Beträge (review_required), damit keine falschen Finanzdaten entstehen.
// Firma ausschliesslich aus der Sitzung (current_agency_id), nie aus dem PDF.
//
// Returns structured field values
// matching the client_self_disclosures schema.
//
// Strategy:
//   1) Extract AcroForm field values directly from the PDF (deterministic, exact).
//      Legacy forms are interactive — Vision-only OCR misses these because
//      the values are stored in form objects, not rendered as glyphs.
//   2) Send the raw form-field map + extracted text to Gemini with the target
//      schema, so the LLM does the mapping (label codes -> our DB columns).
//   3) Fallback to pure vision if the PDF has no AcroForm.

import { PDFDocument } from "https://esm.sh/pdf-lib@1.17.1";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PERSON_PROPERTIES = {
  salutation: { type: "string", description: "Herr | Frau | Divers" },
  title: { type: "string" },
  first_name: { type: "string" },
  last_name: { type: "string" },
  birth_name: { type: "string" },
  street: { type: "string" },
  street_number: { type: "string" },
  postal_code: { type: "string" },
  city: { type: "string" },
  country: { type: "string" },
  resident_since: { type: "string", description: "ISO YYYY-MM-DD oder YYYY" },
  phone: { type: "string" },
  mobile: { type: "string" },
  email: { type: "string" },
  birth_date: { type: "string", description: "ISO YYYY-MM-DD (von DD.MM.YYYY konvertieren)" },
  nationality: { type: "string" },
  birth_place: { type: "string" },
  birth_country: { type: "string" },
  marital_status: { type: "string" },
  tax_id_ch: { type: "string" },
  employment_status: { type: "string" },
  employer_name: { type: "string" },
  employer_address: { type: "string" },
  employer_phone: { type: "string" },
  employed_as: { type: "string" },
  employed_since: { type: "string" },
  salary_type: { type: "string" },
  annual_net_salary: { type: "number" },
  salary_net_monthly: { type: "number" },
  additional_income: { type: "number" },
  income_job_two: { type: "number" },
  income_rental: { type: "number" },
  mortgage_expense: { type: "number" },
  rent_expense: { type: "number" },
  leasing_expense: { type: "number" },
  credit_expense: { type: "number" },
  life_insurance_expense: { type: "number" },
  alimony_expense: { type: "number" },
  health_insurance_expense: { type: "number" },
  property_insurance_expense: { type: "number" },
  utilities_expense: { type: "number" },
  telecom_expense: { type: "number" },
  living_costs_expense: { type: "number" },
  taxes_expense: { type: "number" },
  miscellaneous_expense: { type: "number" },
  disclosure_date: { type: "string", description: "ISO date" },
  disclosure_place: { type: "string" },
  advisor_id: { type: "string" },
} as const;

const FIELD_SCHEMA = {
  type: "object",
  properties: {
    applicant: {
      type: "object",
      description: "Hauptantragsteller (AN-Felder im PDF)",
      properties: PERSON_PROPERTIES,
      additionalProperties: false,
    },
    co_applicant: {
      type: "object",
      description: "Mitantragsteller (MI-Felder). Nur ausfüllen wenn vorhanden.",
      properties: PERSON_PROPERTIES,
      additionalProperties: false,
    },
  },
  required: ["applicant"],
  additionalProperties: false,
};

const ALLOWED_KEYS = new Set(Object.keys(PERSON_PROPERTIES));
const NUMERIC_KEYS = new Set(
  Object.entries(PERSON_PROPERTIES)
    .filter(([, v]) => (v as { type: string }).type === "number")
    .map(([k]) => k),
);
const DATE_KEYS = new Set([
  "resident_since",
  "birth_date",
  "employed_since",
  "disclosure_date",
]);

function pickValue(
  fields: Record<string, string>,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = fields[key]?.trim();
    if (value) return value;
  }
  return undefined;
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  if (/^\d{4}$/.test(trimmed)) return `${trimmed}-01-01`;

  const match = trimmed.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!match) return undefined;

  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function normalizeNumber(value: string | number | undefined): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (!value) return undefined;

  const cleaned = value
    .trim()
    .replace(/\s+/g, "")
    .replace(/CHF/gi, "")
    .replace(/[’']/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".")
    .replace(/[^\d.-]/g, "");

  if (!cleaned) return undefined;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseJsonObject(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(cleaned);
}

function sanitizeFields(input: unknown): Record<string, string | number> {
  if (!input || typeof input !== "object") return {};

  const source = input as Record<string, unknown>;
  const out: Record<string, string | number> = {};

  for (const key of ALLOWED_KEYS) {
    const value = source[key];
    if (value === undefined || value === null || value === "") continue;

    if (NUMERIC_KEYS.has(key)) {
      const parsed = normalizeNumber(
        typeof value === "string" || typeof value === "number"
          ? value
          : undefined,
      );
      if (parsed !== undefined) out[key] = parsed;
      continue;
    }

    if (DATE_KEYS.has(key)) {
      const parsed = normalizeDate(typeof value === "string" ? value : undefined);
      if (parsed) out[key] = parsed;
      continue;
    }

    if (typeof value === "string" && value.trim()) {
      out[key] = value.trim();
    }
  }

  return out;
}

function detectSalutation(
  fields: Record<string, string>,
  prefix: "AN" | "MI",
): string | undefined {
  // Legacy-Formular verwendet meist Checkboxen wie "ANanrede_herr" / "ANherr" / "ANfrau".
  const lcPrefix = prefix.toLowerCase();
  for (const [k, v] of Object.entries(fields)) {
    const lk = k.toLowerCase();
    if (!lk.startsWith(lcPrefix)) continue;
    const val = (v ?? "").toString().trim().toLowerCase();
    const isChecked =
      val === "true" || val === "yes" || val === "1" || val === "on" || val === "x";
    if (!isChecked && val !== "herr" && val !== "frau" && val !== "divers") continue;
    if (lk.includes("herr")) return "Herr";
    if (lk.includes("frau")) return "Frau";
    if (lk.includes("divers")) return "Divers";
  }
  const direct = pickValue(fields, `${prefix}anrede`, `${prefix}01`, `${prefix}salutation`);
  if (direct) {
    const d = direct.toLowerCase();
    if (d.startsWith("h")) return "Herr";
    if (d.startsWith("f")) return "Frau";
    if (d.startsWith("d")) return "Divers";
  }
  return undefined;
}

/** Source Adapter legacy_asimo_self_disclosure_v1 (Feldcodes AN../MI..). */
function mapLegacyFormFields(
  fields: Record<string, string>,
  prefix: "AN" | "MI" = "AN",
): Record<string, string | number> {
  const mapped: Record<string, string | number> = {};
  const P = prefix;

  const setString = (key: string, ...suffixes: string[]) => {
    const value = pickValue(fields, ...suffixes.map((s) => `${P}${s}`));
    if (value) mapped[key] = value;
  };
  const setNumber = (key: string, ...suffixes: string[]) => {
    const value = pickValue(fields, ...suffixes.map((s) => `${P}${s}`));
    const parsed = normalizeNumber(value);
    if (parsed !== undefined) mapped[key] = parsed;
  };
  const setDate = (key: string, ...suffixes: string[]) => {
    const value = pickValue(fields, ...suffixes.map((s) => `${P}${s}`));
    const parsed = normalizeDate(value);
    if (parsed) mapped[key] = parsed;
  };

  const sal = detectSalutation(fields, P);
  if (sal) mapped.salutation = sal;

  setString("title", "title", "01x");
  setString("first_name", "02");
  setString("last_name", "03");
  setString("birth_name", "03x", "ledigname");
  setString("street", "16", "04");
  setString("street_number", "16x", "04x");
  setString("postal_code", "05plz");
  setString("city", "05ort");
  setDate("resident_since", "06", "06x", "wohnhaft");
  setString("phone", "07");
  setString("mobile", "07x");
  setString("email", "08");
  setDate("birth_date", "09");
  setString("nationality", "09x");
  setString("birth_place", "10");
  setString("birth_country", "10x");
  setString("marital_status", "11");
  setString("tax_id_ch", "12");
  setString("employment_status", "13");
  setString("employer_name", "14");
  setString("employer_phone", "17");
  setString("employed_as", "18");
  setDate("employed_since", "18x");
  setNumber("salary_net_monthly", "19");
  setNumber("additional_income", "20");
  setNumber("annual_net_salary", "21");
  setNumber("mortgage_expense", "23");
  setNumber("rent_expense", "24");
  setNumber("leasing_expense", "25");
  setNumber("credit_expense", "26");
  setNumber("life_insurance_expense", "27");
  setNumber("alimony_expense", "28");
  setNumber("health_insurance_expense", "29");
  setNumber("property_insurance_expense", "30");
  setNumber("utilities_expense", "31");
  setNumber("telecom_expense", "32");
  setNumber("living_costs_expense", "33");
  setNumber("taxes_expense", "34");
  setNumber("miscellaneous_expense", "35");

  if (P === "AN") {
    const dDate = normalizeDate(pickValue(fields, "Datum", "Datum1", "Date"));
    if (dDate) mapped.disclosure_date = dDate;
    const dPlace = pickValue(fields, "Ort1", "Ort", "Place");
    if (dPlace) mapped.disclosure_place = dPlace;
    const dAdvisor = pickValue(fields, "Berater", "Advisor");
    if (dAdvisor) mapped.advisor_id = dAdvisor;
  }

  // Personen-Land (z. B. AN_dp2 = "CH -")
  const countryRaw = pickValue(fields, `${P}_dp2`, `${P}land`, `${P}country`);
  if (countryRaw) {
    const c = countryRaw.replace(/[-\s]+$/g, "").trim();
    if (c) mapped.country = c;
  }

  // Arbeitgeber-Adresse. Beim Mitantragsteller verwendet das Legacy-Formular
  // AN15plzM/AN15ortM und M16/M16x statt MI15plz/MI15ort/MI16.
  const empStreet = P === "MI"
    ? [pickValue(fields, "M16", "MI16"), pickValue(fields, "M16x", "MI16x")]
        .filter(Boolean).join(" ").trim()
    : [pickValue(fields, `${P}16`), pickValue(fields, `${P}16x`)]
        .filter(Boolean).join(" ").trim();
  const empCity = P === "MI"
    ? [pickValue(fields, "AN15plzM", "MI15plz"), pickValue(fields, "AN15ortM", "MI15ort")]
        .filter(Boolean).join(" ").trim()
    : [pickValue(fields, `${P}15plz`), pickValue(fields, `${P}15ort`)]
        .filter(Boolean).join(" ").trim();
  const employerAddress = [empStreet, empCity].filter(Boolean).join(", ");
  if (employerAddress) mapped.employer_address = employerAddress;

  // Mitantragsteller: Beruf-/Einkommensfelder verwenden im Legacy-Formular
  // das Präfix "M" statt "MI" (M13, M14, M17, M18, M18x, M19, M22).
  if (P === "MI") {
    const setIfMissingStr = (key: string, ...names: string[]) => {
      if (mapped[key] !== undefined) return;
      const v = pickValue(fields, ...names);
      if (v) mapped[key] = v;
    };
    const setIfMissingNum = (key: string, ...names: string[]) => {
      if (mapped[key] !== undefined) return;
      const v = normalizeNumber(pickValue(fields, ...names));
      if (v !== undefined) mapped[key] = v;
    };
    const setIfMissingDate = (key: string, ...names: string[]) => {
      if (mapped[key] !== undefined) return;
      const v = normalizeDate(pickValue(fields, ...names));
      if (v) mapped[key] = v;
    };
    setIfMissingStr("employment_status", "M13");
    setIfMissingStr("employer_name", "M14");
    setIfMissingStr("employer_phone", "M17");
    setIfMissingStr("employed_as", "M18");
    setIfMissingDate("employed_since", "M18x");
    setIfMissingNum("salary_net_monthly", "M19");
    setIfMissingNum("annual_net_salary", "M22");
  }

  return mapped;
}

interface ChildEntry {
  full_name: string;
  birth_date?: string;
}

function extractChildren(fields: Record<string, string>): ChildEntry[] {
  const out: ChildEntry[] = [];
  for (let i = 1; i <= 10; i++) {
    const idx = String(i).padStart(2, "0");
    const name = pickValue(fields, `Kind${idx}`, `Kind${i}`);
    const birth = normalizeDate(pickValue(fields, `Geb${idx}`, `Geb${i}`));
    if (name) {
      const entry: ChildEntry = { full_name: name.trim() };
      if (birth) entry.birth_date = birth;
      out.push(entry);
    }
  }
  return out;
}

function hasMeaningfulPerson(m: Record<string, string | number>): boolean {
  return Boolean(m.first_name || m.last_name || m.email);
}

async function extractFormFields(
  pdfBytes: Uint8Array,
): Promise<Record<string, string>> {
  try {
    const pdf = await PDFDocument.load(pdfBytes, {
      ignoreEncryption: true,
      updateMetadata: false,
    });
    const form = pdf.getForm();
    const fields = form.getFields();
    const out: Record<string, string> = {};
    for (const f of fields) {
      const name = f.getName();
      // pdf-lib: only TextField and Dropdown have getText/getSelected
      // deno-lint-ignore no-explicit-any
      const anyF = f as any;
      let val: string | undefined;
      if (typeof anyF.getText === "function") {
        val = anyF.getText();
      } else if (typeof anyF.getSelected === "function") {
        const sel = anyF.getSelected();
        if (Array.isArray(sel) && sel.length) val = sel.join(", ");
      } else if (typeof anyF.isChecked === "function") {
        val = anyF.isChecked() ? "true" : "";
      }
      if (val && val.trim() !== "") out[name] = val.trim();
    }
    return out;
  } catch (e) {
    console.warn("extractFormFields failed", e);
    return {};
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Phase 3A.1: nur angemeldete Benutzer mit aktiver Firma (kein anonymer KI-Missbrauch).
    const __auth = req.headers.get("Authorization") ?? "";
    const __deny = (status: number, error: string) =>
      new Response(JSON.stringify({ error }), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!__auth.startsWith("Bearer ")) return __deny(401, "Unauthorized");
    const __userClient = createClient(Deno.env.get("SUPABASE_URL")!, (Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_PUBLISHABLE_KEY"))!, { global: { headers: { Authorization: __auth } }, auth: { persistSession: false } });
    const { data: __u } = await __userClient.auth.getUser(__auth.slice(7));
    if (!__u?.user) return __deny(401, "Unauthorized");
    const { data: __ag } = await __userClient.rpc("current_agency_id");
    if (!__ag) return __deny(403, "Keine aktive Firma");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY missing");

    const { pdf_base64, mime_type } = await req.json();
    if (!pdf_base64 || typeof pdf_base64 !== "string") {
      return new Response(JSON.stringify({ error: "pdf_base64 required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Decode base64 -> bytes
    const binary = atob(pdf_base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    // 1) Extract AcroForm fields deterministically.
    const formFields = await extractFormFields(bytes);
    const formFieldsCount = Object.keys(formFields).length;
    // Format-Erkennung: mind. 3 Feldcodes nach Legacy-Schema (AN/MI + 2 Ziffern).
    const legacyCodeCount = Object.keys(formFields).filter((k) => /^(AN|MI)\d{2}/.test(k)).length;
    const sourceFormat = legacyCodeCount >= 3 ? "legacy_asimo_self_disclosure_v1" : "unknown";
    const isLegacy = sourceFormat !== "unknown";

    const directFields = isLegacy ? mapLegacyFormFields(formFields, "AN") : {};
    const coApplicantFields = isLegacy ? mapLegacyFormFields(formFields, "MI") : {};
    const hasCoApplicant = hasMeaningfulPerson(coApplicantFields);
    // Hinweis: Wir returnen NICHT mehr früh, auch wenn AcroForm Daten lieferte.
    // Die AI ergänzt Felder, die in den Formularfeldern fehlen oder nicht
    // sauber benannt sind (z. B. Anrede-Checkboxen, Wohnhaft seit als Freitext).
    // AcroForm-Werte haben am Ende Vorrang.

    const genericPrompt = `Du bist ein präziser Datenextraktor für Selbstauskünfte (Schweiz).
Das Dokument hat kein bekanntes Formularschema. Extrahiere NUR Werte, die eindeutig
neben einer Beschriftung im Dokument stehen (Name, Adresse, Kontakt, Geburtsdatum,
Zivilstand, Anstellung, Arbeitgeber). Keine Beträge schätzen. Unklare Felder weglassen.
Antragsteller → "applicant", Mitantragsteller → "co_applicant". Keine Halluzinationen.`;

    const legacyPrompt = `Du bist ein präziser Datenextraktor für Selbstauskunft-Formulare (Schweiz), Format legacy_v1.
Du erhältst (a) die rohen AcroForm-Feldwerte des PDFs als JSON und (b) die PDF-Datei.

WICHTIG – Feld-Kodierung:
- Präfix "AN" = ANTRAGSTELLER → in "applicant" zurückgeben.
- Präfix "MI" = MITANTRAGSTELLER → in "co_applicant" zurückgeben (falls vorhanden).
- Investment-Checkliste (Seite 1) ignorieren – nur Selbstauskunft.
- Anrede ("Herr" / "Frau" / "Divers") ist meist eine Checkbox – erkenne sie visuell und gib als salutation zurück.

Mapping (typische Codes):
- 02→first_name | 03→last_name (kann Ledigname sein) | 03x→birth_name
- 04/16→street | 04x/16x→street_number | 05plz→postal_code | 05ort→city
- 06→resident_since (Jahr oder Datum) | Land→country (sonst "CH")
- 07→phone | 07x→mobile | 08→email
- 09→birth_date (DD.MM.YYYY → YYYY-MM-DD) | 09x→nationality
- 10→birth_place | 10x→birth_country
- 11→marital_status | 12→tax_id_ch
- 13→employment_status | 14→employer_name
- 15plz/15ort + 16/16x → employer_address (zusammensetzen)
- 17→employer_phone | 18→employed_as | 18x→employed_since
- 19→salary_net_monthly | 20→additional_income | 21→annual_net_salary
- 23–30 Ausgaben: 23=mortgage, 24=rent, 25=leasing, 26=credit,
  27=life_insurance, 28=alimony, 29=health_insurance, 30=property_insurance.
- "Datum"→disclosure_date | "Ort1"→disclosure_place | "Berater"→advisor_id

CHF-Beträge: nur Zahlen, ohne Tausender, ohne Währung.
Felder die leer/nicht vorhanden sind weglassen. Keine Halluzinationen.
Wenn kein Mitantragsteller im PDF erkennbar ist, co_applicant weglassen oder leer lassen.`;


    const userParts: Array<Record<string, unknown>> = [
      {
        type: "text",
        text:
          formFieldsCount > 0
            ? `AcroForm-Feldwerte aus dem PDF (autoritativ):\n\`\`\`json\n${JSON.stringify(
                formFields,
                null,
                2,
              )}\n\`\`\`\n\nMappe diese Werte gemäss Schema und Hinweisen. Nutze die PDF-Vorlage zur visuellen Kontrolle der Label-Reihenfolge.`
            : "Keine AcroForm-Felder gefunden. Extrahiere alle Felder visuell aus der PDF.",
      },
      {
        type: "image_url",
        image_url: {
          url: `data:${mime_type ?? "application/pdf"};base64,${pdf_base64}`,
        },
      },
    ];

    const aiResp = await fetch(
      "https://ai.gateway.lovable.dev/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userParts },
          ],
          tools: [
            {
              type: "function",
              function: {
                name: "extract_self_disclosure",
                description: "Extrahierte Felder aus der Selbstauskunft",
                parameters: FIELD_SCHEMA,
              },
            },
          ],
          tool_choice: {
            type: "function",
            function: { name: "extract_self_disclosure" },
          },
        }),
      },
    );

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error("AI error", aiResp.status, txt.slice(0, 200));
      // Bei AI-Fehler: AcroForm-Daten allein zurückgeben, falls vorhanden.
      if (Object.keys(directFields).length > 0) {
        return new Response(
          JSON.stringify({
            fields: directFields,
            co_applicant_fields: hasCoApplicant ? coApplicantFields : null,
            has_co_applicant: hasCoApplicant,
            children: isLegacy ? extractChildren(formFields) : [],
            form_fields_count: formFieldsCount,
            source: "acroform-only",
            source_format: sourceFormat,
            review_required: false,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiResp.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit erreicht – bitte gleich nochmals." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      if (aiResp.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI-Guthaben aufgebraucht." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          error: "Automatische Erkennung war für dieses PDF nicht möglich.",
          fallback: true,
          fields: {},
          form_fields_count: formFieldsCount,
          source: "fallback",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = await aiResp.json();
    const toolCall = json.choices?.[0]?.message?.tool_calls?.[0];
    const content = json.choices?.[0]?.message?.content;

    let aiRaw: Record<string, unknown> = {};
    try {
      if (toolCall?.function?.arguments) {
        aiRaw = parseJsonObject(toolCall.function.arguments) as Record<string, unknown>;
      } else if (typeof content === "string" && content.trim()) {
        aiRaw = parseJsonObject(content) as Record<string, unknown>;
      } else if (Array.isArray(content)) {
        const textPart = content.find(
          (part: Record<string, unknown>) =>
            part?.type === "text" && typeof part?.text === "string" && (part.text as string).trim(),
        );
        if (textPart?.text && typeof textPart.text === "string") {
          aiRaw = parseJsonObject(textPart.text) as Record<string, unknown>;
        }
      }
    } catch (parseError) {
      console.warn("could not parse AI result", parseError);
    }

    // Unbekanntes Format: keine automatisch erkannten Beträge übernehmen (fail safe).
    const stripAmounts = (f: Record<string, string | number>) =>
      isLegacy ? f : Object.fromEntries(Object.entries(f).filter(([, v]) => typeof v !== "number"));
    const aiApplicant = stripAmounts(sanitizeFields(aiRaw.applicant ?? aiRaw));
    const aiCoApplicant = stripAmounts(sanitizeFields(aiRaw.co_applicant));

    // AcroForm-Werte haben Vorrang. AI ergänzt nur fehlende Felder.
    const mergedFields: Record<string, string | number> = { ...aiApplicant, ...directFields };
    const mergedCoApplicant: Record<string, string | number> = {
      ...aiCoApplicant,
      ...coApplicantFields,
    };
    const finalHasCoApplicant = hasMeaningfulPerson(mergedCoApplicant);
    const children = isLegacy ? extractChildren(formFields) : [];

    return new Response(
      JSON.stringify({
        fields: mergedFields,
        co_applicant_fields: finalHasCoApplicant ? mergedCoApplicant : null,
        has_co_applicant: finalHasCoApplicant,
        children,
        form_fields_count: formFieldsCount,
        source: Object.keys(directFields).length > 0 ? "acroform+ai" : "ai",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );

  } catch (e) {
    console.error("parse-self-disclosure error", e);
    return new Response(
      JSON.stringify({
        error: e instanceof Error ? e.message : "unknown",
        fallback: true,
        fields: {},
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
