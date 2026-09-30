// Automatische Erkennung für die Bank-Checkliste.
// Gleicht vorhandene Dossier-Daten, Kundenangaben, Selbstauskunft und
// hochgeladene Dokumente mit der Checkliste ab. Schweizer Rechtschreibung, kein ß.

import type { ChecklistItemStatus } from "@/lib/financing-checklist";

export type AutoDoc = {
  id: string;
  file_name?: string | null;
  document_type?: string | null;
  related_type?: string | null;
};

export type AutoContext = {
  dossier: any;
  clients: any[];
  disclosures: any[];
  documents: AutoDoc[];
};

export type AutoResult = {
  status: Exclude<ChecklistItemStatus, "not_relevant">;
  reason: string;
  documentId?: string | null;
};

/** Schlüssel = `${section}:${item_key}` */
export type AutoMap = Record<string, AutoResult>;

const norm = (s: unknown) =>
  String(s ?? "")
    .toLowerCase()
    .replace(/[äÄ]/g, "a")
    .replace(/[öÖ]/g, "o")
    .replace(/[üÜ]/g, "u")
    .replace(/[^a-z0-9]+/g, " ");

function findDoc(docs: AutoDoc[], words: string[]): AutoDoc | undefined {
  return docs.find((d) => {
    const hay = `${norm(d.file_name)} ${norm(d.document_type)}`;
    return words.some((w) => hay.includes(norm(w).trim()));
  });
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Wertet alle automatisch prüfbaren Checklistenpunkte aus.
 * Punkte ohne sichere Aussage bleiben unberührt (kein Eintrag im Ergebnis).
 */
export function detectChecklist(ctx: AutoContext): AutoMap {
  const out: AutoMap = {};
  const d = ctx.dossier ?? {};
  const docs = ctx.documents ?? [];
  const clients = ctx.clients ?? [];
  const disclosures = ctx.disclosures ?? [];

  const setDoc = (key: string, words: string[], label: string) => {
    const hit = findDoc(docs, words);
    if (hit) out[key] = { status: "present", reason: `Dokument erkannt: ${hit.file_name ?? label}`, documentId: hit.id };
    else out[key] = { status: "missing", reason: `Kein Dokument gefunden (${label})` };
  };

  const ok = (key: string, reason: string) => { out[key] = { status: "present", reason }; };
  const miss = (key: string, reason: string) => { out[key] = { status: "missing", reason }; };

  // ---------- Kundendossier ----------
  setDoc("customer:id_document", ["ausweis", "pass", "identitat", "id kopie", "id card", "identity"], "ID/Pass");
  setDoc("customer:residence_permit", ["aufenthalt", "bewilligung", "permit", "niederlassung", "wohnsitz"], "Aufenthaltsbewilligung");

  const mainClient = clients[0];
  const disc = disclosures[0];
  if (mainClient) {
    const missingFields: string[] = [];
    if (!mainClient.full_name) missingFields.push("Name");
    if (!mainClient.email && !mainClient.phone) missingFields.push("E-Mail oder Telefon");
    if (!mainClient.address || !mainClient.city) missingFields.push("Adresse");
    if (!disc?.birth_date) missingFields.push("Geburtsdatum");
    if (!disc?.nationality) missingFields.push("Nationalität");
    if (missingFields.length === 0) ok("customer:client_overview", "Kundenprofil vollständig erfasst");
    else miss("customer:client_overview", `Fehlt im Kundenprofil: ${missingFields.join(", ")}`);
  }
  if (disc?.marital_status) ok("customer:civil_status_proof", `Zivilstand erfasst: ${disc.marital_status}`);

  // ---------- Finanzierungsstruktur ----------
  const purchase = num(d.purchase_price) ?? num(d.property_value);
  const total = num(d.total_investment) ?? purchase;
  const mortgage = num(d.requested_mortgage) ?? num(d.new_total_mortgage);
  if (purchase && purchase > 0) ok("financing_structure:purchase_price_doc", `Kaufpreis erfasst: CHF ${purchase.toLocaleString("de-CH")}`);
  else miss("financing_structure:purchase_price_doc", "Kaufpreis im Dossier nicht erfasst");

  const reno = num(d.renovation_costs);
  if (reno && reno > 0) ok("financing_structure:renovation_costs_doc", `Renovationskosten erfasst: CHF ${reno.toLocaleString("de-CH")}`);

  setDoc("financing_structure:equity_proof", ["kontoauszug", "eigenmittel", "bankauszug", "vermogensausweis", "saldo"], "Eigenmittelnachweis");

  if (num(d.own_funds_pillar_3a)) setDoc("financing_structure:pillar_3a_proof", ["3a", "saule 3", "vorsorge"], "Säule 3a");
  if (num(d.own_funds_pension_fund)) setDoc("financing_structure:pension_fund_proof", ["pensionskasse", "pk ", "vorbezug", "bvg"], "Pensionskasse");
  if (num(d.own_funds_vested_benefits)) setDoc("financing_structure:vested_benefits_proof", ["freizugigkeit", "freizugigkeitskonto"], "Freizügigkeitskonto");
  if (num(d.own_funds_gift)) setDoc("financing_structure:gift_contract", ["schenkung"], "Schenkungsvertrag");
  if (num(d.own_funds_inheritance)) setDoc("financing_structure:inheritance_doc", ["erbvorbezug", "erbschaft"], "Erbvorbezug");
  if (num(d.own_funds_private_loan)) setDoc("financing_structure:private_loan_contract", ["darlehen"], "Darlehensvertrag");

  const ownTotal = num(d.own_funds_total);
  const pk = num(d.own_funds_pension_fund) ?? 0;
  if (ownTotal !== null && total) {
    const hard = ownTotal - pk;
    const share = (hard / total) * 100;
    if (share >= 10) ok("financing_structure:hard_equity_check", `Harte Eigenmittel ${share.toFixed(1)}% (ohne PK) – Richtwert 10% erfüllt`);
    else miss("financing_structure:hard_equity_check", `Harte Eigenmittel nur ${share.toFixed(1)}% (Richtwert 10%)`);
  }

  // ---------- Objektdokumentation ----------
  setDoc("property_docs:expose", ["expose", "verkaufsdoku", "objektdoku", "dokumentation"], "Exposé");
  setDoc("property_docs:land_register", ["grundbuch", "grundbuchauszug"], "Grundbuchauszug");
  setDoc("property_docs:building_insurance", ["gebaudeversicherung", "gvz", "gvb", "versicherungspolice", "police"], "Gebäudeversicherung");
  setDoc("property_docs:floor_plans", ["grundriss", "plan", "planunterlagen"], "Grundrisspläne");
  setDoc("property_docs:building_description", ["baubeschrieb", "baubeschreibung"], "Baubeschrieb");
  setDoc("property_docs:stw_regulation", ["reglement", "stwe", "stockwerk"], "STWE-Reglement");
  setDoc("property_docs:stw_accounts", ["nebenkosten", "abrechnung"], "Nebenkostenabrechnung");
  if (d.renovation_description) ok("property_docs:renovations_list", "Renovationen im Dossier beschrieben");

  // ---------- Einkommen & Anstellung ----------
  setDoc("income_employment:salary_statement", ["lohnausweis", "salarausweis"], "Lohnausweis");
  setDoc("income_employment:payslips", ["lohnabrechnung", "lohnblatt", "payslip", "salar"], "Lohnabrechnungen");
  setDoc("income_employment:employment_contract", ["arbeitsvertrag", "anstellungsvertrag"], "Arbeitsvertrag");
  setDoc("income_employment:pk_statement", ["pk ausweis", "vorsorgeausweis", "pensionskassenausweis"], "PK-Ausweis");

  if (disc?.employed_since) {
    const since = new Date(disc.employed_since);
    const months = (Date.now() - since.getTime()) / (1000 * 60 * 60 * 24 * 30.4);
    if (months >= 3) ok("income_employment:probation_passed", `Anstellung seit ${since.toLocaleDateString("de-CH")} – Probezeit vorbei`);
    else miss("income_employment:probation_passed", `Anstellung erst seit ${since.toLocaleDateString("de-CH")} – Probezeit möglicherweise offen`);
    if (months < 12) miss("rejection_reasons:no_recent_job_change", "Stellenantritt liegt weniger als 12 Monate zurück");
    else ok("rejection_reasons:no_recent_job_change", "Anstellung länger als 12 Monate");
  }
  if (disc?.employment_status) {
    ok("income_employment:employment_active", `Anstellungsverhältnis erfasst: ${disc.employment_status}`);
  }

  // ---------- Steuern ----------
  setDoc("tax:tax_last", ["steuererklarung", "steuerveranlagung", "veranlagung", "steuer"], "Steuererklärung");

  // ---------- Selbständige ----------
  const selfEmployed = norm(disc?.employment_status).includes("selbst");
  if (selfEmployed) {
    setDoc("self_employed:balance_sheets_3y", ["bilanz"], "Bilanzen");
    setDoc("self_employed:income_statements_3y", ["erfolgsrechnung"], "Erfolgsrechnungen");
    setDoc("self_employed:interim_report", ["zwischenabschluss"], "Zwischenabschluss");
    setDoc("self_employed:commercial_register", ["handelsregister"], "Handelsregisterauszug");
  }

  // ---------- Tragbarkeit ----------
  const afford = num(d.affordability_ratio);
  const ltv = num(d.loan_to_value_ratio);
  const income = num(d.gross_income_yearly) ?? num(d.einkommen_kombiniert);
  if (afford !== null && income && mortgage) ok("affordability:calc_complete", "Tragbarkeitsberechnung im Dossier vorhanden");
  else miss("affordability:calc_complete", "Tragbarkeitsberechnung unvollständig (Einkommen, Hypothek oder Tragbarkeit fehlt)");

  if (afford !== null) {
    if (afford <= 33) ok("affordability:ratio_under_33", `Tragbarkeit ${afford.toFixed(1)}% – Richtwert 33% erfüllt`);
    else miss("affordability:ratio_under_33", `Tragbarkeit ${afford.toFixed(1)}% über Richtwert 33%`);
  }
  if (ltv !== null) {
    if (ltv <= 80) ok("affordability:ltv_under_80", `Belehnung ${ltv.toFixed(1)}% – Richtwert 80% erfüllt`);
    else miss("affordability:ltv_under_80", `Belehnung ${ltv.toFixed(1)}% über Richtwert 80%`);
  }

  // ---------- Zusätzliche Prüfung ----------
  if (disc) {
    const obligations = num(disc.credit_expense) ?? 0;
    const leasing = num(disc.leasing_expense) ?? 0;
    if (disc.total_expenses_monthly != null) ok("additional_check:obligations_listed", "Verpflichtungen aus der Selbstauskunft übernommen");
    if (disc.alimony_expense != null) ok("additional_check:alimony_listed", "Unterhaltszahlungen aus der Selbstauskunft übernommen");
    if (disc.reserve_total != null) ok("additional_check:assets_overview", "Vermögensübersicht aus der Selbstauskunft vorhanden");
    const monthlyIncome = num(disc.total_income_monthly);
    if (monthlyIncome && monthlyIncome > 0) {
      const share = ((obligations + leasing) / monthlyIncome) * 100;
      if (share <= 10) ok("rejection_reasons:no_excessive_obligations", `Kredite/Leasing bei ${share.toFixed(1)}% des Einkommens`);
      else miss("rejection_reasons:no_excessive_obligations", `Kredite/Leasing bei ${share.toFixed(1)}% des Einkommens – kritisch`);
      ok("rejection_reasons:stable_income", "Einkommen in der Selbstauskunft nachgewiesen");
    }
  }

  // ---------- Einreichungsqualität ----------
  const discSigned = disclosures.some((x) => ["submitted", "reviewed", "completed", "signed"].includes(String(x?.status)));
  if (discSigned) ok("submission_quality:self_disclosure_signed", "Selbstauskunft wurde eingereicht");
  else if (disclosures.length > 0) miss("submission_quality:self_disclosure_signed", "Selbstauskunft erfasst, aber noch nicht eingereicht");
  else miss("submission_quality:self_disclosure_signed", "Keine Selbstauskunft vorhanden");

  if (docs.length > 0) ok("submission_quality:docs_legible", `${docs.length} Dokumente im Dossier hinterlegt`);

  return out;
}

/** Punkte, die für «Bereit für Bank» zwingend erfüllt sein müssen. */
export function requiredKeys(template: Record<string, { key: string; required?: boolean }[]>): Set<string> {
  const s = new Set<string>();
  Object.entries(template).forEach(([section, items]) => {
    items.forEach((it) => { if (it.required) s.add(`${section}:${it.key}`); });
  });
  return s;
}
