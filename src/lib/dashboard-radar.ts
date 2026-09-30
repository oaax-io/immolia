/**
 * Dashboard "Action Radar" – deterministische Erkennung dessen, was heute zu tun ist.
 * Reine Funktionen ohne Netzwerk: alle Rohdaten kommen von aussen, damit die
 * Auswertung testbar bleibt und sofort (ohne KI, ohne Wartezeit) verfügbar ist.
 */

export type RadarGroup = "financing" | "closing" | "clients" | "properties" | "leads";
export type RadarSeverity = "ready" | "warn" | "urgent" | "info";

export type RadarItem = {
  id: string;
  group: RadarGroup;
  severity: RadarSeverity;
  title: string;
  subtitle?: string;
  to: string;
  params?: Record<string, string>;
  actionLabel?: string;
  /** Sortiergewicht, höher = weiter oben */
  weight: number;
};

export type RadarInput = {
  dossiers: any[];
  clients: any[];
  disclosures: any[];
  leads: any[];
  properties: any[];
  media: any[];
  exposeDocs: any[];
  appointments: any[];
  reservations: any[];
};

const DAY = 86_400_000;
const daysSince = (iso?: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / DAY) : null);

const SEV_WEIGHT: Record<RadarSeverity, number> = { urgent: 400, warn: 300, ready: 200, info: 100 };

export const GROUP_LABELS: Record<RadarGroup, string> = {
  financing: "Finanzierung & Bank",
  closing: "Notar & Abschluss",
  clients: "Kundschaft",
  properties: "Immobilien",
  leads: "Leads",
};

/** Ein aktives Objekt braucht diese Angaben, um bankfähig / inseratefähig zu sein. */
export function propertyGaps(p: any, photoCount: number, hasExpose: boolean): string[] {
  const gaps: string[] = [];
  if (!p.price || Number(p.price) <= 0) gaps.push("Preis");
  if (!p.address || !p.city) gaps.push("Adresse");
  if (!p.description || String(p.description).trim().length < 120) gaps.push("Beschreibung");
  if (!p.area && !p.rooms) gaps.push("Fläche/Zimmer");
  if (photoCount < 3) gaps.push("Fotos");
  if (!hasExpose) gaps.push("Exposé");
  return gaps;
}

export function buildRadar(input: RadarInput): RadarItem[] {
  const items: RadarItem[] = [];
  const push = (i: Omit<RadarItem, "weight"> & { weight?: number }) =>
    items.push({ ...i, weight: (i.weight ?? 0) + SEV_WEIGHT[i.severity] });

  const clientName = new Map<string, string>(input.clients.map((c) => [c.id, c.full_name ?? "Kundschaft"]));
  const propTitle = new Map<string, string>(input.properties.map((p) => [p.id, p.title ?? "Objekt"]));

  // ---------- Finanzierung ----------
  for (const d of input.dossiers) {
    const who = d.client_id ? clientName.get(d.client_id) ?? "Kundschaft" : "Dossier";
    const obj = d.property_id ? propTitle.get(d.property_id) : null;
    const suffix = obj ? ` · ${obj}` : "";

    if (d.dossier_status === "ready_for_bank") {
      push({
        id: `fin-ready-${d.id}`, group: "financing", severity: "ready",
        title: `${who} – bereit für die Bank`,
        subtitle: `Alle Pflichtangaben vorhanden${suffix}`,
        to: "/financing/$id", params: { id: d.id }, actionLabel: "Jetzt einreichen", weight: 40,
      });
    } else if (d.dossier_status === "submitted_to_bank") {
      const age = daysSince(d.submitted_to_bank_at);
      if (!d.bank_decision_at && age != null && age >= 6) {
        push({
          id: `fin-wait-${d.id}`, group: "financing", severity: "warn",
          title: `${d.bank_name || "Bank"} – seit ${age} Tagen ohne Entscheid`,
          subtitle: `${who}${suffix}`,
          to: "/financing/$id", params: { id: d.id }, actionLabel: "Nachfassen", weight: Math.min(age, 40),
        });
      }
    } else if (d.dossier_status === "documents_missing") {
      push({
        id: `fin-docs-${d.id}`, group: "financing", severity: "warn",
        title: `${who} – Unterlagen fehlen`,
        subtitle: `Dossier kann noch nicht eingereicht werden${suffix}`,
        to: "/financing/$id", params: { id: d.id }, actionLabel: "Checkliste öffnen", weight: 20,
      });
    } else if ((d.dossier_status === "draft" || d.dossier_status === "quick_check") && daysSince(d.updated_at)! >= 14) {
      push({
        id: `fin-stale-${d.id}`, group: "financing", severity: "info",
        title: `${who} – seit ${daysSince(d.updated_at)} Tagen unverändert`,
        subtitle: `Dossier weiterbearbeiten${suffix}`,
        to: "/financing/$id", params: { id: d.id }, actionLabel: "Öffnen",
      });
    }
  }

  // ---------- Notar & Abschluss ----------
  const in14 = Date.now() + 14 * DAY;
  for (const a of input.appointments) {
    const t = new Date(a.starts_at).getTime();
    if (t > in14) continue;
    const text = `${a.title ?? ""} ${a.notes ?? ""} ${a.location ?? ""}`.toLowerCase();
    const isNotary = text.includes("notar") || text.includes("beurkund") || text.includes("verschreibung");
    if (!isNotary) continue;
    const days = Math.max(0, Math.ceil((t - Date.now()) / DAY));
    push({
      id: `close-appt-${a.id}`, group: "closing", severity: days <= 3 ? "urgent" : "warn",
      title: `Notartermin: ${a.title || "Beurkundung"}`,
      subtitle: `${days === 0 ? "heute" : `in ${days} Tagen`}${a.location ? ` · ${a.location}` : ""}`,
      to: "/appointments", actionLabel: "Termin öffnen", weight: 60 - days,
    });
  }
  for (const c of input.clients) {
    if (c.pipeline_stage !== "notary") continue;
    push({
      id: `close-stage-${c.id}`, group: "closing", severity: "warn",
      title: `${c.full_name} – Phase Notartermin`,
      subtitle: "Beurkundung vorbereiten und Termin sichern",
      to: "/clients/$id", params: { id: c.id }, actionLabel: "Kunde öffnen", weight: 10,
    });
  }
  for (const r of input.reservations) {
    if (!["draft", "sent"].includes(r.status)) continue;
    const age = daysSince(r.created_at) ?? 0;
    push({
      id: `close-res-${r.id}`, group: "closing", severity: age >= 7 ? "warn" : "info",
      title: `Reservation ${r.status === "draft" ? "noch nicht versendet" : "wartet auf Unterschrift"}`,
      subtitle: `${r.client_id ? clientName.get(r.client_id) ?? "Kundschaft" : "Kundschaft"}${
        r.property_id ? ` · ${propTitle.get(r.property_id) ?? ""}` : ""
      } · seit ${age} Tagen`,
      to: "/reservations", actionLabel: "Reservation öffnen", weight: Math.min(age, 20),
    });
  }

  // ---------- Kundschaft: Selbstauskunft ----------
  const discByClient = new Map<string, any>();
  for (const d of input.disclosures) {
    const prev = discByClient.get(d.client_id);
    const rank = (s: string) => ({ completed: 4, reviewed: 3, submitted: 2, sent: 1, draft: 0 } as any)[s] ?? 0;
    if (!prev || rank(d.status) > rank(prev.status)) discByClient.set(d.client_id, d);
  }
  const dossierClientIds = new Set(input.dossiers.map((d) => d.client_id).filter(Boolean));
  for (const c of input.clients) {
    const inProcess = !!c.pipeline_stage || dossierClientIds.has(c.id) || c.financing_status;
    if (!inProcess) continue;
    const disc = discByClient.get(c.id);
    if (disc && ["submitted", "reviewed", "completed"].includes(disc.status)) continue;
    push({
      id: `cli-disc-${c.id}`, group: "clients",
      severity: dossierClientIds.has(c.id) ? "warn" : "info",
      title: `${c.full_name} – Selbstauskunft ${disc ? "noch nicht abgeschickt" : "fehlt"}`,
      subtitle: disc ? "Link wurde erstellt, Kunde hat noch nicht abgeschlossen" : "Selbstauskunft-Link versenden",
      to: "/clients/$id", params: { id: c.id }, actionLabel: "Kunde öffnen", weight: 15,
    });
  }

  // ---------- Immobilien ----------
  const photoCount = new Map<string, number>();
  for (const m of input.media) photoCount.set(m.property_id, (photoCount.get(m.property_id) ?? 0) + 1);
  const withExpose = new Set(input.exposeDocs.map((g) => g.related_id));
  for (const p of input.properties) {
    const gaps = propertyGaps(p, photoCount.get(p.id) ?? 0, withExpose.has(p.id));
    if (gaps.length === 0) continue;
    const onlyExpose = gaps.length === 1 && gaps[0] === "Exposé";
    push({
      id: `prop-gap-${p.id}`, group: "properties",
      severity: onlyExpose ? "info" : gaps.length >= 3 ? "warn" : "info",
      title: onlyExpose ? `${p.title ?? "Objekt"} – kein Exposé` : `${p.title ?? "Objekt"} – Dossier unvollständig`,
      subtitle: onlyExpose ? "Exposé erstellen und versenden" : `Es fehlt: ${gaps.join(", ")}`,
      to: "/properties/$id", params: { id: p.id },
      actionLabel: onlyExpose ? "Exposé erstellen" : "Objekt ergänzen",
      weight: gaps.length * 3,
    });
  }

  // ---------- Leads ----------
  for (const l of input.leads) {
    if (!["new", "neu"].includes(String(l.status))) continue;
    const age = daysSince(l.created_at) ?? 0;
    const hours = (Date.now() - new Date(l.created_at).getTime()) / 3_600_000;
    if (hours < 12) continue;
    push({
      id: `lead-${l.id}`, group: "leads", severity: age >= 2 ? "urgent" : "warn",
      title: `${l.full_name || "Neuer Lead"} – noch kein Erstkontakt`,
      subtitle: age >= 1 ? `seit ${age} Tag${age === 1 ? "" : "en"} offen` : `seit ${Math.round(hours)} Stunden offen`,
      to: "/leads/$id", params: { id: l.id }, actionLabel: "Lead kontaktieren", weight: Math.min(age * 5, 40),
    });
  }

  return items.sort((a, b) => b.weight - a.weight);
}

/** Dynamischer Begrüssungssatz – ohne KI, immer sofort da. */
export function buildBriefing(items: RadarItem[], todayAppts: number): string[] {
  const by = (g: RadarGroup) => items.filter((i) => i.group === g).length;
  const s: string[] = [];
  const ready = items.filter((i) => i.id.startsWith("fin-ready-")).length;
  const waiting = items.filter((i) => i.id.startsWith("fin-wait-")).length;
  const notary = items.filter((i) => i.id.startsWith("close-appt-")).length;
  const urgentLeads = items.filter((i) => i.group === "leads").length;

  if (todayAppts > 0) s.push(`${todayAppts} Termin${todayAppts === 1 ? "" : "e"} heute`);
  if (notary > 0) s.push(`${notary} Notartermin${notary === 1 ? "" : "e"} in den nächsten 14 Tagen`);
  if (ready > 0) s.push(`${ready} Dossier${ready === 1 ? "" : "s"} bereit für die Bank`);
  if (waiting > 0) s.push(`${waiting}× Bankentscheid überfällig`);
  if (urgentLeads > 0) s.push(`${urgentLeads} Lead${urgentLeads === 1 ? "" : "s"} ohne Erstkontakt`);
  if (by("clients") > 0) s.push(`${by("clients")}× Selbstauskunft offen`);
  if (by("properties") > 0) s.push(`${by("properties")} Objekt${by("properties") === 1 ? "" : "e"} unvollständig`);
  return s;
}
