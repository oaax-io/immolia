// Server-Funktionen für das Bank-Paket (Stufe 1 - Erstellung & Download).
// - buildBankPackage: sammelt Dossier-Daten, rendert Master-PDF, baut ZIP, lädt hoch
// - listBankPackages: gibt Historie zurück
// - getBankPackageSignedUrl: frischer signed Download-Link
// - fetchBankPackageBytes: proxy für adblocker-blockierte Domains

import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { zipSync, strToU8, type Zippable } from "fflate";
import { buildBankPackageHtml, type BankPackageInput, type PackageLocale } from "./bank-package-report";

const BANK_PACKAGES_BUCKET = "bank-packages";
const PDF_TIMEOUT_MS = 60_000;
// Server-Arbeitsspeicher ist begrenzt (~128 MB): Anhänge + ZIP liegen gleichzeitig im Speicher.
const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024; // 15 MB pro Datei
const MAX_TOTAL_ATTACHMENT_BYTES = 40 * 1024 * 1024; // 40 MB total
const MAX_PROXY_DOWNLOAD_BYTES = 8 * 1024 * 1024; // grössere ZIPs per signiertem Link

// ---------- helpers ----------

function safeFolderName(input: string): string {
  return (input || "Sonstige")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .slice(0, 80);
}

function safeFileName(input: string, fallback: string): string {
  const cleaned = (input || fallback)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .slice(0, 150);
  return cleaned || fallback;
}

function dedupeFileName(set: Set<string>, name: string): string {
  if (!set.has(name)) {
    set.add(name);
    return name;
  }
  const m = /^(.*?)(\.[^.]+)?$/.exec(name);
  const base = m?.[1] ?? name;
  const ext = m?.[2] ?? "";
  for (let i = 2; i < 9999; i++) {
    const candidate = `${base} (${i})${ext}`;
    if (!set.has(candidate)) {
      set.add(candidate);
      return candidate;
    }
  }
  return name;
}

// Versucht, eine Datei aus Storage zu laden. file_url kann sein:
// - voll-qualifizierte http(s)-URL (signed / public)
// - Storage-Pfad (z.B. "client/<uuid>/foo.pdf") in einem unbekannten Bucket
async function fetchAttachment(
  fileUrl: string,
  supabaseAdmin: unknown,
): Promise<{ bytes: Uint8Array; size: number } | null> {
  if (!fileUrl) return null;
  const admin = supabaseAdmin as {
    storage: {
      from: (b: string) => {
        download: (p: string) => Promise<{ data: Blob | null; error: { message: string } | null }>;
      };
    };
  };

  if (/^https?:\/\//i.test(fileUrl)) {
    try {
      const res = await fetch(fileUrl);
      if (!res.ok) return null;
      const buf = new Uint8Array(await res.arrayBuffer());
      return { bytes: buf, size: buf.byteLength };
    } catch {
      return null;
    }
  }

  // Storage-Pfad: durchprobieren der bekannten Buckets
  const candidates = ["documents", "generated-documents", "media", "brand-assets"];
  for (const bucket of candidates) {
    try {
      const { data, error } = await admin.storage.from(bucket).download(fileUrl);
      if (!error && data) {
        const buf = new Uint8Array(await data.arrayBuffer());
        return { bytes: buf, size: buf.byteLength };
      }
    } catch {
      // weiter mit nächstem Bucket
    }
  }
  return null;
}

// ---------- Zugriffsprüfung (RLS als angemeldeter Benutzer) ----------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type UserClient = any;
async function assertDossierAccess(sb: UserClient, dossierId: string) {
  const { data } = await sb.from("financing_dossiers").select("id").eq("id", dossierId).maybeSingle();
  if (!data) throw new Error("Kein Zugriff auf dieses Finanzierungsdossier");
}
async function assertPackageAccess(sb: UserClient, id: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("generated_documents").select("related_id").eq("id", id).eq("document_type", "bank_package").maybeSingle();
  if (!data?.related_id) throw new Error("Kein Zugriff auf dieses Bank-Paket");
  await assertDossierAccess(sb, data.related_id);
}
async function assertPackagePathAccess(sb: UserClient, path: string) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin.from("generated_documents").select("related_id").eq("file_url", path).eq("document_type", "bank_package").limit(1);
  const rel = data?.[0]?.related_id;
  if (!rel) throw new Error("Kein Zugriff auf dieses Bank-Paket");
  await assertDossierAccess(sb, rel);
}

// ---------- buildBankPackage ----------

export const buildBankPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { dossierId: string; locale?: PackageLocale }) => {
    if (!input?.dossierId || typeof input.dossierId !== "string") {
      throw new Error("dossierId is required");
    }
    return {
      dossierId: input.dossierId,
      locale: (input.locale ?? "de") as PackageLocale,
    };
  })
  .handler(async ({ data, context }) => {
    await assertDossierAccess(context.supabase, data.dossierId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const serviceUrl = process.env.PDF_SERVICE_URL;
    const serviceToken = process.env.PDF_SERVICE_TOKEN;

    if (!serviceUrl || !serviceToken) {
      return {
        ok: false as const,
        reason: "no_server_pdf_provider" as const,
        message: "PDF-Service ist nicht konfiguriert.",
        filePath: null as string | null,
        fileUrl: null as string | null,
        generatedDocumentId: null as string | null,
      };
    }

    // 1) Dossier laden
    const { data: dossier, error: dossierErr } = await supabaseAdmin
      .from("financing_dossiers")
      .select("*")
      .eq("id", data.dossierId)
      .maybeSingle();
    if (dossierErr || !dossier) {
      return {
        ok: false as const,
        reason: "dossier_not_found" as const,
        message: dossierErr?.message ?? "Dossier nicht gefunden.",
        filePath: null,
        fileUrl: null,
        generatedDocumentId: null,
      };
    }

    // 2) Kunde + Ehepartner + zusätzliche Mitantragsteller laden
    // Zusätzliche Mitantragsteller können aus zwei Quellen stammen:
    //   a) dossier.additional_co_applicants (jsonb array) mit optionaler client_id
    //   b) client_relationships (Ehepartner/Partner des Hauptkunden)
    const additionalRaw = Array.isArray((dossier as any).additional_co_applicants)
      ? ((dossier as any).additional_co_applicants as Array<Record<string, unknown>>)
      : [];
    const additionalIdsFromDossier = additionalRaw
      .map((a) => (typeof a?.client_id === "string" ? a.client_id : null))
      .filter((v): v is string => !!v);

    let relationshipIds: string[] = [];
    if (dossier.client_id) {
      const { data: rels } = await supabaseAdmin
        .from("client_relationships")
        .select("client_id, related_client_id, relationship_type")
        .or(`client_id.eq.${dossier.client_id},related_client_id.eq.${dossier.client_id}`);
      relationshipIds = (rels ?? [])
        .map((r: any) => (r.client_id === dossier.client_id ? r.related_client_id : r.client_id))
        .filter((v: string | null): v is string => !!v);
    }

    const excluded = new Set([dossier.client_id, dossier.co_applicant_client_id].filter(Boolean) as string[]);
    const extraApplicantIds = Array.from(
      new Set([...additionalIdsFromDossier, ...relationshipIds].filter((id) => id && !excluded.has(id))),
    );

    const clientIds = [
      dossier.client_id,
      dossier.co_applicant_client_id,
      ...extraApplicantIds,
    ].filter(Boolean) as string[];

    const { data: clients } = await supabaseAdmin.from("clients").select("*").in("id", clientIds);
    const mainClient = clients?.find((c) => c.id === dossier.client_id) ?? null;
    const coClient = dossier.co_applicant_client_id
      ? (clients?.find((c) => c.id === dossier.co_applicant_client_id) ?? null)
      : null;
    const extraClients = extraApplicantIds
      .map((id) => clients?.find((c) => c.id === id) ?? null)
      .filter(Boolean) as NonNullable<typeof mainClient>[];

    // 3) Selbstauskünfte
    const { data: disclosures } = await supabaseAdmin
      .from("client_self_disclosures")
      .select("*")
      .in("client_id", clientIds);
    const mainDisclosure = disclosures?.find((d) => d.client_id === dossier.client_id) ?? null;
    const coDisclosure = dossier.co_applicant_client_id
      ? (disclosures?.find((d) => d.client_id === dossier.co_applicant_client_id) ?? null)
      : null;
    const discByClient = new Map(
      (disclosures ?? []).map((d) => [d.client_id as string, d]),
    );

    // Folder-Namen pro Extra-Antragsteller vorbereiten
    const extraFolderByClient = new Map<string, string>();
    extraClients.forEach((c, idx) => {
      const nameSlug = safeFolderName(c.full_name || `Mitantragsteller_${idx + 1}`);
      extraFolderByClient.set(c.id, `02b_Mitantragsteller_${idx + 1}_${nameSlug}`);
    });

    // 4) Property: verlinkt oder Snapshot aus Dossier
    let property:
      | {
          title?: string | null;
          address?: string | null;
          postal_code?: string | null;
          city?: string | null;
          country?: string | null;
          property_type?: string | null;
          listing_type?: string | null;
          price?: number | null;
          living_area?: number | null;
          plot_area?: number | null;
          area?: number | null;
          rooms?: number | null;
          bathrooms?: number | null;
          floor?: number | null;
          year_built?: number | null;
          energy_class?: string | null;
          heating_type?: string | null;
          condition?: string | null;
        }
      | null = null;
    let propertyMedia: Array<{
      file_url: string;
      file_name: string | null;
      file_type: string | null;
      is_cover: boolean;
      sort_order?: number | null;
    }> = [];
    if (dossier.property_id) {
      const { data: prop } = await supabaseAdmin
        .from("properties")
        .select(
          "title, address, postal_code, city, country, property_type, listing_type, price, living_area, plot_area, area, rooms, bathrooms, floor, year_built, energy_class, heating_type, condition",
        )
        .eq("id", dossier.property_id)
        .maybeSingle();
      property = (prop as typeof property) ?? null;

      const { data: media } = await supabaseAdmin
        .from("property_media")
        .select("file_url, file_name, file_type, is_cover, sort_order")
        .eq("property_id", dossier.property_id)
        .order("is_cover", { ascending: false })
        .order("sort_order", { ascending: true })
        .limit(30);
      propertyMedia = (media ?? []) as typeof propertyMedia;
    }
    // Fallback: aus property_snapshot / dossier-Feldern (falls kein Objekt verknüpft)
    if (!property) {
      const snap = ((dossier as any).property_snapshot ?? {}) as Record<string, unknown>;
      const hasAny =
        snap.title || snap.address || snap.price ||
        (dossier as any).purchase_price || (dossier as any).property_value;
      if (hasAny) {
        property = {
          title: (snap.title as string) ?? null,
          address: (snap.address as string) ?? null,
          property_type: (snap.object_type as string) ?? null,
          price: (typeof snap.price === "number" ? (snap.price as number) : null)
            ?? ((dossier as any).purchase_price as number | null)
            ?? ((dossier as any).property_value as number | null),
        };
      }
    }

    // 5) Checkliste
    const { data: checklistRows } = await supabaseAdmin
      .from("financing_checklist_items")
      .select("label, section, status, note, sort_order")
      .eq("dossier_id", data.dossierId)
      .order("sort_order", { ascending: true });

    // 6) Dokumente (Kunde, Ehepartner, weitere Mitantragsteller, Objekt, Financing)
    const orParts: string[] = [`and(related_type.eq.financing,related_id.eq.${data.dossierId})`];
    for (const cid of clientIds) {
      orParts.push(`and(related_type.eq.client,related_id.eq.${cid})`);
    }
    if (dossier.property_id) orParts.push(`and(related_type.eq.property,related_id.eq.${dossier.property_id})`);

    const { data: documents } = await supabaseAdmin
      .from("documents")
      .select("id, file_name, file_url, document_type, related_type, related_id, mime_type, size_bytes, created_at")
      .or(orParts.join(","));

    // Generierte Dokumente (Mandate, Reservation, Quick-Check-PDFs etc.) - aber bereits erstellte Bank-Pakete ausschliessen
    const { data: generated } = await supabaseAdmin
      .from("generated_documents")
      .select("id, title, file_url, document_type, related_type, related_id, created_at")
      .or(orParts.join(","));

    // 7) Brand + Agent
    const { data: brand } = await supabaseAdmin
      .from("brand_settings")
      .select("*")
      .eq("agency_id", (dossier as { agency_id?: string | null }).agency_id ?? "00000000-0000-0000-0000-000000000000")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // 8) Dokumente herunterladen und ZIP-Inventar zusammenstellen
    const zipEntries: Zippable = {};
    const usedNames = new Set<string>();
    const inventory: BankPackageInput["documents"] = [];
    let totalBytes = 0;

    type DocSource = {
      file_name?: string | null;
      file_url: string | null;
      document_type?: string | null;
      related_type?: string | null;
      related_id?: string | null;
      title?: string | null;
      mime_type?: string | null;
      size_bytes?: number | null;
    };

    const sourceLabel = (d: DocSource): { folder: string; label: string } => {
      if (d.related_type === "client") {
        if (d.related_id === dossier.co_applicant_client_id) return { folder: "02_Ehepartner", label: "Ehepartner" };
        if (d.related_id && extraFolderByClient.has(d.related_id)) {
          return { folder: extraFolderByClient.get(d.related_id)!, label: "Weiterer Mitantragsteller" };
        }
        return { folder: "01_Kunde", label: "Kunde" };
      }
      if (d.related_type === "property") return { folder: "03_Immobilie", label: "Immobilie" };
      if (d.related_type === "financing") return { folder: "04_Finanzierung", label: "Finanzierung" };
      return { folder: "05_Sonstige", label: "Sonstige" };
    };

    const addToZipBytes = (folder: string, filename: string, bytes: Uint8Array, sourceText: string) => {
      const cleaned = safeFileName(filename, "datei.bin");
      const targetFolder = safeFolderName(folder);
      const fullPath = `${targetFolder}/${dedupeFileName(usedNames, cleaned)}`;
      zipEntries[fullPath] = bytes;
      totalBytes += bytes.byteLength;
      inventory.push({
        folder: targetFolder,
        filename: fullPath.split("/").pop() ?? cleaned,
        source: sourceText,
        size_bytes: bytes.byteLength,
      });
    };

    const addToZip = async (d: DocSource, isGenerated: boolean) => {
      if (!d.file_url) return;
      if (totalBytes >= MAX_TOTAL_ATTACHMENT_BYTES) return;

      const fetched = await fetchAttachment(d.file_url, supabaseAdmin);
      if (!fetched) return;
      if (fetched.size > MAX_ATTACHMENT_BYTES) return;
      if (totalBytes + fetched.size > MAX_TOTAL_ATTACHMENT_BYTES) return;

      const baseName = isGenerated
        ? (d.title ?? d.file_name ?? `generiert_${d.related_id ?? "datei"}.pdf`)
        : (d.file_name ?? `datei_${d.related_id ?? "x"}`);
      const { folder, label } = sourceLabel(d);
      addToZipBytes(
        isGenerated ? "06_Generiert" : folder,
        baseName,
        fetched.bytes,
        isGenerated ? "Generiert" : label,
      );
    };

    for (const d of documents ?? []) await addToZip(d as DocSource, false);
    for (const d of generated ?? []) {
      // Bereits existierende Bank-Pakete nicht ins neue Paket aufnehmen
      if (d.document_type === "bank_package") continue;
      await addToZip(d as DocSource, true);
    }

    // Objekt-Bilder (Cover zuerst) als eigenständige Anhänge unter 03_Immobilie/Bilder
    for (let i = 0; i < propertyMedia.length; i++) {
      if (totalBytes >= MAX_TOTAL_ATTACHMENT_BYTES) break;
      const m = propertyMedia[i];
      if (!m.file_url) continue;
      const fetched = await fetchAttachment(m.file_url, supabaseAdmin);
      if (!fetched) continue;
      if (fetched.size > MAX_ATTACHMENT_BYTES) continue;
      if (totalBytes + fetched.size > MAX_TOTAL_ATTACHMENT_BYTES) break;
      const ext = (() => {
        const raw = m.file_url.split("?")[0].split(".").pop();
        return raw && raw.length <= 5 ? `.${raw.toLowerCase()}` : "";
      })();
      const idx = String(i + 1).padStart(2, "0");
      const name = m.is_cover
        ? `Cover${ext}`
        : (m.file_name ? safeFileName(m.file_name, `Bild_${idx}${ext}`) : `Bild_${idx}${ext}`);
      addToZipBytes("03_Immobilie/Bilder", name, fetched.bytes, "Immobilie-Bild");
    }

    // Immobilie-Zusammenfassung als Textdatei — sorgt dafür, dass der Ordner
    // "03_Immobilie" immer im ZIP existiert, wenn Objektdaten vorliegen
    if (property) {
      const lines: string[] = ["Immobilie", ""];
      const push = (k: string, v: unknown) => {
        if (v === null || v === undefined || v === "") return;
        lines.push(`${k}: ${String(v)}`);
      };
      push("Titel", property.title);
      push("Objektart", property.property_type);
      push("Adresse", property.address);
      push("PLZ", property.postal_code);
      push("Ort", property.city);
      push("Land", property.country);
      push("Preis (CHF)", property.price);
      push("Wohnfläche (m²)", property.living_area);
      push("Grundstück (m²)", property.plot_area);
      push("Fläche (m²)", property.area);
      push("Zimmer", property.rooms);
      push("Badezimmer", property.bathrooms);
      push("Stockwerk", property.floor);
      push("Baujahr", property.year_built);
      push("Energieklasse", property.energy_class);
      push("Heizung", property.heating_type);
      push("Zustand", property.condition);
      addToZipBytes("03_Immobilie", "Immobilie.txt", strToU8(lines.join("\n")), "Immobilie-Zusammenfassung");
    }




    // 9) Master-HTML & PDF
    const applicantData = {
      full_name: mainClient?.full_name ?? null,
      email: mainClient?.email ?? null,
      phone: mainClient?.phone ?? null,
      address: [mainClient?.address, mainClient?.postal_code, mainClient?.city]
        .filter(Boolean)
        .join(", ") || null,
      birth_date: mainDisclosure?.birth_date ?? null,
      nationality: mainDisclosure?.nationality ?? null,
      marital_status: mainDisclosure?.marital_status ?? null,
      employment_status: mainDisclosure?.employment_status ?? null,
      employer_name: mainDisclosure?.employer_name ?? null,
      salary_net_monthly: mainDisclosure?.salary_net_monthly ?? null,
      annual_net_salary: mainDisclosure?.annual_net_salary ?? null,
      total_income_monthly: mainDisclosure?.total_income_monthly ?? null,
      total_expenses_monthly: mainDisclosure?.total_expenses_monthly ?? null,
      reserve_total: mainDisclosure?.reserve_total ?? null,
      disclosure: (mainDisclosure ?? null) as never,
    };

    const coApplicantData = coClient
      ? {
          full_name: coClient.full_name ?? null,
          email: coClient.email ?? null,
          phone: coClient.phone ?? null,
          address: [coClient.address, coClient.postal_code, coClient.city].filter(Boolean).join(", ") || null,
          birth_date: coDisclosure?.birth_date ?? null,
          nationality: coDisclosure?.nationality ?? null,
          marital_status: coDisclosure?.marital_status ?? null,
          employment_status: coDisclosure?.employment_status ?? null,
          employer_name: coDisclosure?.employer_name ?? null,
          salary_net_monthly: coDisclosure?.salary_net_monthly ?? null,
          annual_net_salary: coDisclosure?.annual_net_salary ?? null,
          total_income_monthly: coDisclosure?.total_income_monthly ?? null,
          total_expenses_monthly: coDisclosure?.total_expenses_monthly ?? null,
          reserve_total: coDisclosure?.reserve_total ?? null,
          disclosure: (coDisclosure ?? null) as never,
        }
      : null;

    const additionalApplicantsData = extraClients.map((c) => {
      const disc = discByClient.get(c.id) ?? null;
      return {
        full_name: c.full_name ?? null,
        email: c.email ?? null,
        phone: c.phone ?? null,
        address: [c.address, c.postal_code, c.city].filter(Boolean).join(", ") || null,
        birth_date: (disc as any)?.birth_date ?? null,
        nationality: (disc as any)?.nationality ?? null,
        marital_status: (disc as any)?.marital_status ?? null,
        employment_status: (disc as any)?.employment_status ?? null,
        employer_name: (disc as any)?.employer_name ?? null,
        salary_net_monthly: (disc as any)?.salary_net_monthly ?? null,
        annual_net_salary: (disc as any)?.annual_net_salary ?? null,
        total_income_monthly: (disc as any)?.total_income_monthly ?? null,
        total_expenses_monthly: (disc as any)?.total_expenses_monthly ?? null,
        reserve_total: (disc as any)?.reserve_total ?? null,
        disclosure: (disc ?? null) as never,
      };
    });

    const html = buildBankPackageHtml({
      locale: data.locale,
      brand: brand ?? null,
      dossier: dossier as BankPackageInput["dossier"],
      applicant: applicantData,
      coApplicant: coApplicantData,
      additionalApplicants: additionalApplicantsData,
      property,
      checklist: (checklistRows ?? []).map((c) => ({
        label: c.label,
        section: c.section,
        status: c.status,
        note: c.note,
      })),
      documents: inventory,
    });

    // PDF rendern
    let pdfBytes: Uint8Array;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PDF_TIMEOUT_MS);
    try {
      const endpoint = serviceUrl.replace(/\/+$/, "") + "/render-pdf";
      const res = await fetch(endpoint, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "x-pdf-token": serviceToken,
          "x-api-key": serviceToken,
        },
        body: JSON.stringify({ html, title: "Bank-Paket", filename: "00_Dossier.pdf" }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        return {
          ok: false as const,
          reason: "pdf_render_failed" as const,
          message: `PDF-Service Fehler [${res.status}]: ${text.slice(0, 200)}`,
          filePath: null,
          fileUrl: null,
          generatedDocumentId: null,
        };
      }
      pdfBytes = new Uint8Array(await res.arrayBuffer());
    } catch (err) {
      return {
        ok: false as const,
        reason: "pdf_render_error" as const,
        message: `PDF-Service nicht erreichbar: ${(err as Error).message}`,
        filePath: null,
        fileUrl: null,
        generatedDocumentId: null,
      };
    } finally {
      clearTimeout(timeoutId);
    }

    // 10) ZIP bauen
    const clientSlug = safeFileName(mainClient?.full_name ?? "Kunde", "Kunde").replace(/[ .]+$/, "");
    zipEntries[`00_Dossier_${clientSlug}.pdf`] = pdfBytes;
    zipEntries["README.txt"] = strToU8(
      [
        `Bank-Paket - ${mainClient?.full_name ?? ""}`,
        `Dossier-ID: ${dossier.id}`,
        `Erstellt: ${new Date().toLocaleString("de-CH")}`,
        ``,
        `Inhalt:`,
        `- 00_Dossier_${clientSlug}.pdf: Master-Dossier mit allen Antragstellern, Objekt, Finanzierung, Checkliste, Notizen`,
        `- 01_Kunde/: Unterlagen des Hauptantragstellers`,
        coApplicantData ? `- 02_Ehepartner/: Unterlagen des Ehepartners / Mitantragstellers` : null,
        ...Array.from(extraFolderByClient.entries()).map(
          ([, folder]) => `- ${folder}/: Unterlagen weiterer Mitantragsteller`,
        ),
        property ? `- 03_Immobilie/: Unterlagen zur Immobilie (inkl. Bilder unter 03_Immobilie/Bilder/)` : null,
        `- 04_Finanzierung/: Unterlagen zur Finanzierung`,
        `- 06_Generiert/: Generierte Dokumente (Quick-Check PDF etc.)`,
      ]
        .filter(Boolean)
        .join("\n"),
    );

    let zipBytes: Uint8Array;
    try {
      // level 0 (Speichern): PDFs/Bilder sind bereits komprimiert; spart Speicher und CPU
      zipBytes = zipSync(zipEntries, { level: 0 });
      for (const k of Object.keys(zipEntries)) delete zipEntries[k];
    } catch (err) {
      return {
        ok: false as const,
        reason: "zip_failed" as const,
        message: `ZIP konnte nicht erstellt werden: ${(err as Error).message}`,
        filePath: null,
        fileUrl: null,
        generatedDocumentId: null,
      };
    }

    // 11) Upload
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const zipFileName = `Bank-Paket_${clientSlug}_${timestamp.slice(0, 19)}.zip`;
    const dossierAgency = (dossier as { agency_id?: string | null }).agency_id ?? null;
    const storagePath = dossierAgency
      ? `agency/${dossierAgency}/${data.dossierId}/${zipFileName}`
      : `${data.dossierId}/${zipFileName}`;

    const { error: upErr } = await supabaseAdmin.storage
      .from(BANK_PACKAGES_BUCKET)
      .upload(storagePath, zipBytes, {
        contentType: "application/zip",
        upsert: false,
      });
    if (upErr) {
      return {
        ok: false as const,
        reason: "storage_upload_failed" as const,
        message: `Upload fehlgeschlagen: ${upErr.message}`,
        filePath: null,
        fileUrl: null,
        generatedDocumentId: null,
      };
    }

    // 12) generated_documents Eintrag (Historie)
    const insertRow = {
      title: `Bank-Paket ${clientSlug} (${new Date().toLocaleString("de-CH")})`,
      document_type: "bank_package",
      related_type: "financing",
      related_id: data.dossierId,
      file_url: storagePath,
      status: "ready",
      variables: {
        bytes: zipBytes.byteLength,
        attachments: inventory.length,
        attachment_bytes: totalBytes,
      } as Record<string, unknown>,
    };
    const { data: createdRow, error: insertErr } = await supabaseAdmin
      .from("generated_documents")
      .insert(insertRow as never)
      .select("id")
      .maybeSingle();
    if (insertErr) {
      console.warn("[bank-package] generated_documents insert failed", insertErr.message);
    }

    // 13) Signed URL (1h) für sofortigen Download
    const { data: signed } = await supabaseAdmin.storage
      .from(BANK_PACKAGES_BUCKET)
      .createSignedUrl(storagePath, 60 * 60);

    // 14) Activity-Log
    try {
      await supabaseAdmin.from("activity_logs").insert({
        action: "Bank-Paket erstellt",
        related_type: "financing",
        related_id: data.dossierId,
        metadata: {
          bytes: zipBytes.byteLength,
          attachments: inventory.length,
          storage_path: storagePath,
        },
      } as never);
    } catch {
      // non-fatal
    }

    return {
      ok: true as const,
      filePath: storagePath,
      fileUrl: signed?.signedUrl ?? null,
      fileName: zipFileName,
      sizeBytes: zipBytes.byteLength,
      attachmentCount: inventory.length,
      generatedDocumentId: createdRow?.id ?? null,
    };
  });

// ---------- listBankPackages ----------

export const listBankPackages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { dossierId: string }) => {
    if (!input?.dossierId) throw new Error("dossierId is required");
    return { dossierId: input.dossierId };
  })
  .handler(async ({ data, context }) => {
    await assertDossierAccess(context.supabase, data.dossierId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("generated_documents")
      .select("id, title, file_url, created_at, variables, created_by")
      .eq("related_type", "financing")
      .eq("related_id", data.dossierId)
      .eq("document_type", "bank_package")
      .order("created_at", { ascending: false });
    if (error) return { ok: false as const, packages: [] as const, message: error.message };
    return {
      ok: true as const,
      message: null as string | null,
      packages: (rows ?? []).map((r) => {
        const vars = (r.variables ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          title: r.title,
          file_url: r.file_url,
          created_at: r.created_at,
          bytes: typeof vars.bytes === "number" ? vars.bytes : null,
          attachments: typeof vars.attachments === "number" ? vars.attachments : null,
        };
      }),
    };
  });

// ---------- getBankPackageSignedUrl ----------

export const getBankPackageSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { path: string }) => {
    if (!input?.path) throw new Error("path is required");
    return { path: input.path };
  })
  .handler(async ({ data, context }) => {
    await assertPackagePathAccess(context.supabase, data.path);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from(BANK_PACKAGES_BUCKET)
      .createSignedUrl(data.path, 60 * 60 * 24); // 24h
    if (error || !signed?.signedUrl) {
      return { ok: false as const, fileUrl: null as string | null, message: error?.message ?? "not_found" };
    }
    return { ok: true as const, fileUrl: signed.signedUrl, message: null as string | null };
  });

// ---------- fetchBankPackageBytes (proxy für adblocker) ----------

export const fetchBankPackageBytes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { path: string }) => {
    if (!input?.path) throw new Error("path is required");
    return { path: input.path };
  })
  .handler(async ({ data, context }) => {
    await assertPackagePathAccess(context.supabase, data.path);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: file, error } = await supabaseAdmin.storage
      .from(BANK_PACKAGES_BUCKET)
      .download(data.path);
    if (error || !file) {
      return { ok: false as const, base64: null as string | null, message: error?.message ?? "not_found" };
    }
    if (file.size > MAX_PROXY_DOWNLOAD_BYTES) {
      return { ok: false as const, base64: null as string | null, message: "too_large_use_signed_url" };
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < buf.length; i += chunkSize) {
      binary += String.fromCharCode(...buf.subarray(i, i + chunkSize));
    }
    return { ok: true as const, base64: btoa(binary), message: null as string | null };
  });

// ---------- createBankPackageShare (7-Tage öffentlicher Download-Link) ----------

function randomToken(len = 40): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < bytes.length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export const createBankPackageShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { generatedDocumentId: string }) => {
    if (!input?.generatedDocumentId) throw new Error("generatedDocumentId is required");
    return { generatedDocumentId: input.generatedDocumentId };
  })
  .handler(async ({ data, context }) => {
    await assertPackageAccess(context.supabase, data.generatedDocumentId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Lade Paket
    const { data: pkg, error: pkgErr } = await supabaseAdmin
      .from("generated_documents")
      .select("id, title, file_url, related_id, variables")
      .eq("id", data.generatedDocumentId)
      .eq("document_type", "bank_package")
      .maybeSingle();
    if (pkgErr || !pkg || !pkg.file_url) {
      return { ok: false as const, token: null as string | null, message: pkgErr?.message ?? "Paket nicht gefunden" };
    }

    // Kundenname aus Dossier
    let clientName: string | null = null;
    if (pkg.related_id) {
      const { data: dossier } = await supabaseAdmin
        .from("financing_dossiers")
        .select("client_id")
        .eq("id", pkg.related_id)
        .maybeSingle();
      if (dossier?.client_id) {
        const { data: client } = await supabaseAdmin
          .from("clients")
          .select("full_name")
          .eq("id", dossier.client_id)
          .maybeSingle();
        clientName = client?.full_name ?? null;
      }
    }

    const vars = (pkg.variables ?? {}) as Record<string, unknown>;
    const token = randomToken(40);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    const { error: insertErr } = await supabaseAdmin
      .from("bank_package_shares")
      .insert({
        token,
        dossier_id: pkg.related_id,
        storage_path: pkg.file_url,
        client_name: clientName,
        package_title: pkg.title,
        size_bytes: typeof vars.bytes === "number" ? vars.bytes : null,
        attachment_count: typeof vars.attachments === "number" ? vars.attachments : null,
        expires_at: expiresAt,
      } as never);
    if (insertErr) {
      return { ok: false as const, token: null, message: insertErr.message };
    }
    return { ok: true as const, token, expiresAt, message: null as string | null };
  });


// ---------- deleteBankPackage ----------

export const deleteBankPackage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { generatedDocumentId: string }) => {
    if (!input?.generatedDocumentId) throw new Error("generatedDocumentId is required");
    return { generatedDocumentId: input.generatedDocumentId };
  })
  .handler(async ({ data, context }) => {
    await assertPackageAccess(context.supabase, data.generatedDocumentId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pkg, error: pkgErr } = await supabaseAdmin
      .from("generated_documents")
      .select("id, file_url")
      .eq("id", data.generatedDocumentId)
      .eq("document_type", "bank_package")
      .maybeSingle();
    if (pkgErr || !pkg) {
      return { ok: false as const, message: pkgErr?.message ?? "Paket nicht gefunden" };
    }
    if (pkg.file_url) {
      await supabaseAdmin.storage.from(BANK_PACKAGES_BUCKET).remove([pkg.file_url]);
      await supabaseAdmin.from("bank_package_shares").delete().eq("storage_path", pkg.file_url);
    }
    const { error: delErr } = await supabaseAdmin
      .from("generated_documents")
      .delete()
      .eq("id", data.generatedDocumentId);
    if (delErr) return { ok: false as const, message: delErr.message };
    return { ok: true as const, message: null as string | null };
  });
