import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import { buildDocumentFileName } from "@/lib/document-filename";

/**
 * Server-side PDF generation via self-hosted Puppeteer microservice.
 *
 * Contract:
 *   POST {PDF_SERVICE_URL}
 *   Headers: x-api-key: {PDF_SERVICE_TOKEN}
 *   Body:    { html: string, filename?: string }
 *   Response: application/pdf (binary)
 *
 * Workflow:
 *   1. POST HTML to microservice (10s timeout)
 *   2. Upload returned PDF bytes to Storage bucket "generated-documents"
 *      under generated/{document_id}.pdf
 *   3. Update generated_documents row (file_url, pdf_url, pdf_generated_at,
 *      pdf_provider, status='ready')
 *   4. Return signed URL (1h) so the UI can immediately download
 *
 * If the service is unreachable / fails / times out → ok:false; the UI falls
 * back to the existing window.print() flow.
 */

const PDF_TIMEOUT_MS = 30_000;
const BUCKET = "documents";
const PDF_PROVIDER = "railway-puppeteer";
type StoredDocumentInsert = Database["public"]["Tables"]["documents"]["Insert"];

export const renderDocumentPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(
    (input: {
      html: string;
      title?: string;
      documentId?: string | null;
      fileName?: string | null;
      documentType?: string | null;
      clientName?: string | null;
      propertyTitle?: string | null;
      companyName?: string | null;
    }) => {
      if (!input || typeof input.html !== "string" || input.html.length === 0) {
        throw new Error("html is required");
      }
      if (input.html.length > 5_000_000) {
        throw new Error("html too large");
      }
      const trim = (v: unknown, n: number): string | null =>
        typeof v === "string" && v.trim() ? v.trim().slice(0, n) : null;
      return {
        html: input.html,
        title: typeof input.title === "string" ? input.title.slice(0, 200) : "Dokument",
        documentId: input.documentId ?? null,
        fileName: trim(input.fileName, 200),
        documentType: trim(input.documentType, 50),
        clientName: trim(input.clientName, 120),
        propertyTitle: trim(input.propertyTitle, 200),
        companyName: trim(input.companyName, 120),
      };
    },
  )
  .handler(async ({ data, context }) => {
    // Phase 3A.1: Tenant-Prüfung VOR jedem Service-Role-Zugriff.
    const { requireCurrentAgency, assertGeneratedDocumentAccess } = await import("@/lib/document-access.server");
    const tenantAgency = await requireCurrentAgency(context.supabase);
    if (data.documentId) await assertGeneratedDocumentAccess(context.supabase, data.documentId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const serviceUrl = process.env.PDF_SERVICE_URL;
    const serviceToken = process.env.PDF_SERVICE_TOKEN;
    const startedAt = Date.now();

    if (!serviceUrl || !serviceToken) {
      console.warn("[pdf] PDF_SERVICE_URL/PDF_SERVICE_TOKEN not configured – falling back to browser print");
      return {
        ok: false as const,
        reason: "no_server_pdf_provider",
        message:
          "Server-PDF ist noch nicht konfiguriert (PDF_SERVICE_URL/PDF_SERVICE_TOKEN fehlen). Es wird der Browser-Druck-Fallback verwendet.",
        fileUrl: null as string | null,
        title: data.title,
      };
    }

    const id = data.documentId ?? crypto.randomUUID();

    // Enrich missing filename inputs from the database when we have a documentId.
    let clientName = data.clientName;
    let propertyTitle = data.propertyTitle;
    let companyName = data.companyName;
    let documentType = data.documentType;
    if (data.documentId && (!clientName || !propertyTitle || !companyName || !documentType)) {
      try {
        const { data: gdoc } = await supabaseAdmin
          .from("generated_documents")
          .select("document_type, related_type, related_id")
          .eq("id", data.documentId)
          .maybeSingle();
        if (gdoc) {
          documentType = documentType ?? gdoc.document_type ?? null;
          // Resolve client / property from the related record
          if (!clientName || !propertyTitle) {
            const rt = gdoc.related_type;
            const rid = gdoc.related_id;
            if (rt && rid) {
              const tableMap: Record<string, string> = {
                mandate: "mandates",
                reservation: "reservations",
                nda: "ndas",
              };
              const table = tableMap[rt];
              if (table) {
                const { data: rel } = await supabaseAdmin
                  .from(table as never)
                  .select("client_id, property_id")
                  .eq("id", rid)
                  .maybeSingle();
                const relRow = rel as { client_id?: string; property_id?: string } | null;
                if (relRow?.client_id && !clientName) {
                  const { data: c } = await supabaseAdmin
                    .from("clients")
                    .select("full_name")
                    .eq("id", relRow.client_id)
                    .maybeSingle();
                  clientName = c?.full_name ?? null;
                }
                if (relRow?.property_id && !propertyTitle) {
                  const { data: p } = await supabaseAdmin
                    .from("properties")
                    .select("title")
                    .eq("id", relRow.property_id)
                    .maybeSingle();
                  propertyTitle = p?.title ?? null;
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn(`[pdf] enrichment failed: ${(e as Error).message}`);
      }
    }
    if (!companyName) {
      try {
        const { data: brand } = await supabaseAdmin
          .from("brand_settings" as never)
          .select("company_name")
          .eq("agency_id" as never, (tenantAgency ?? "00000000-0000-0000-0000-000000000000") as never)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const brandRow = brand as { company_name?: string } | null;
        if (brandRow?.company_name) companyName = brandRow.company_name;
        if (!companyName) {
          const { data: company } = await supabaseAdmin.from("company").select("name").eq("agency_id", tenantAgency ?? "00000000-0000-0000-0000-000000000000").maybeSingle();
          if (company?.name) companyName = company.name;
        }
      } catch (e) {
        console.warn(`[pdf] company lookup failed: ${(e as Error).message}`);
      }
    }

    const filename =
      data.fileName ??
      buildDocumentFileName({
        company: companyName,
        documentType,
        documentLabel: !documentType ? data.title : null,
        clientName,
        propertyTitle,
        documentId: id,
      });
    // Neue Uploads tenantbezogen ablegen (agency/{id}/...); Legacy-Pfade bleiben gültig.
    const safeName = filename.replace(/[\\/]+/g, "-").replace(/\.\.+/g, ".");
    const storagePath = `agency/${tenantAgency}/generated/${safeName}`;

    // 1) Render via microservice (10s timeout)
    let pdfBytes: ArrayBuffer;
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
        body: JSON.stringify({ html: data.html, title: data.title, filename }),
      });
      if (!res.ok) {
        const text = await safeText(res);
        const ms = Date.now() - startedAt;
        console.error(`[pdf] microservice error status=${res.status} ms=${ms} body=${text.slice(0, 300)}`);
        return {
          ok: false as const,
          reason: "provider_error",
          message: `PDF-Service Fehler [${res.status}]: ${text.slice(0, 200)}`,
          fileUrl: null as string | null,
          title: data.title,
        };
      }
      pdfBytes = await res.arrayBuffer();
    } catch (err) {
      const ms = Date.now() - startedAt;
      const aborted = (err as Error)?.name === "AbortError";
      console.error(`[pdf] microservice ${aborted ? "timeout" : "unreachable"} ms=${ms} err=${(err as Error).message}`);
      return {
        ok: false as const,
        reason: aborted ? "provider_timeout" : "provider_unreachable",
        message: aborted
          ? `PDF-Service Timeout nach ${PDF_TIMEOUT_MS}ms`
          : `PDF-Service nicht erreichbar: ${(err as Error).message}`,
        fileUrl: null as string | null,
        title: data.title,
      };
    } finally {
      clearTimeout(timeoutId);
    }

    // 2) Upload to Storage
    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(storagePath, new Uint8Array(pdfBytes), {
        contentType: "application/pdf",
        upsert: true,
      });
    if (upErr) {
      console.error(`[pdf] storage upload failed path=${storagePath} err=${upErr.message}`);
      return {
        ok: false as const,
        reason: "storage_error",
        message: `Storage-Upload fehlgeschlagen: ${upErr.message}`,
        fileUrl: null as string | null,
        title: data.title,
      };
    }

    // 3) Signed URL (1h)
    const { data: signed, error: signErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(storagePath, 60 * 60);
    if (signErr || !signed?.signedUrl) {
      console.error(`[pdf] signed url failed path=${storagePath} err=${signErr?.message}`);
      return {
        ok: false as const,
        reason: "signed_url_error",
        message: `Signed URL fehlgeschlagen: ${signErr?.message ?? "unknown"}`,
        fileUrl: null as string | null,
        title: data.title,
      };
    }

    // 4) Update generated_documents row when known
    if (data.documentId) {
      const { data: generatedDoc, error: generatedDocErr } = await supabaseAdmin
        .from("generated_documents")
        .select("id, related_type, related_id, title, document_type, created_by")
        .eq("id", data.documentId)
        .maybeSingle();

      if (generatedDocErr) {
        console.warn(`[pdf] generated_documents lookup failed id=${data.documentId} err=${generatedDocErr.message}`);
      }

      const { error: updErr } = await supabaseAdmin
        .from("generated_documents")
        .update({
          file_url: storagePath,
          pdf_url: storagePath,
          pdf_generated_at: new Date().toISOString(),
          pdf_provider: PDF_PROVIDER,
          status: "ready",
        })
        .eq("id", data.documentId);
      if (updErr) {
        console.warn(`[pdf] generated_documents update failed id=${data.documentId} err=${updErr.message}`);
      }

      if (generatedDoc?.related_type && generatedDoc.related_id) {
        const documentsPayload: StoredDocumentInsert = {
          agency_id: tenantAgency,
          file_name: filename,
          file_url: storagePath,
          document_type: mapGeneratedDocumentTypeToStoredType(generatedDoc.document_type),
          related_type: generatedDoc.related_type,
          related_id: generatedDoc.related_id,
          uploaded_by: generatedDoc.created_by ?? null,
          size_bytes: pdfBytes.byteLength,
          mime_type: "application/pdf",
          notes: `Automatisch generiertes PDF${generatedDoc.title ? `: ${generatedDoc.title}` : ""}`,
        };

        const { data: existingDocument, error: existingDocumentErr } = await supabaseAdmin
          .from("documents")
          .select("id")
          .eq("file_url", storagePath)
          .maybeSingle();

        if (existingDocumentErr) {
          console.warn(`[pdf] documents lookup failed path=${storagePath} err=${existingDocumentErr.message}`);
        } else if (existingDocument?.id) {
          const { error: docUpdateErr } = await supabaseAdmin
            .from("documents")
            .update(documentsPayload)
            .eq("id", existingDocument.id);
          if (docUpdateErr) {
            console.warn(`[pdf] documents update failed id=${existingDocument.id} err=${docUpdateErr.message}`);
          }
        } else {
          const { error: docInsertErr } = await supabaseAdmin.from("documents").insert(documentsPayload);
          if (docInsertErr) {
            console.warn(`[pdf] documents insert failed path=${storagePath} err=${docInsertErr.message}`);
          }
        }
      }
    }

    const ms = Date.now() - startedAt;
    console.log(`[pdf] ok bytes=${pdfBytes.byteLength} ms=${ms} path=${storagePath} doc=${data.documentId ?? "-"}`);

    return {
      ok: true as const,
      fileUrl: signed.signedUrl,
      path: storagePath,
      title: data.title,
      provider: PDF_PROVIDER,
      durationMs: ms,
    };
  });

/**
 * Refresh a signed URL for an existing PDF (path stored in pdf_url/file_url).
 */
export const getDocumentPdfUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { documentId: string }) => {
    if (!input?.documentId) throw new Error("documentId is required");
    return { documentId: input.documentId };
  })
  .handler(async ({ data, context }) => {
    const { assertGeneratedDocumentAccess } = await import("@/lib/document-access.server");
    let row: { pdf_url: string | null; file_url: string | null };
    try {
      row = (await assertGeneratedDocumentAccess(context.supabase, data.documentId)).doc;
    } catch {
      return { ok: false as const, fileUrl: null as string | null };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const path = row.pdf_url ?? row.file_url;
    if (!path) return { ok: false as const, fileUrl: null as string | null };
    const { data: signed } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
    return { ok: !!signed?.signedUrl, fileUrl: signed?.signedUrl ?? null };
  });

/**
 * Fetch a generated PDF as base64 — proxies the bytes through the server so the
 * client never has to load the Supabase storage domain directly (which is often
 * blocked by adblockers / ERR_BLOCKED_BY_CLIENT).
 */
export const fetchDocumentPdfBytes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { path: string }) => {
    if (!input?.path || typeof input.path !== "string") throw new Error("path is required");
    return { path: input.path };
  })
  .handler(async ({ data, context }) => {
    const { assertDocumentPathAccess, DOCUMENT_ACCESS_DENIED } = await import("@/lib/document-access.server");
    let path: string;
    try {
      path = (await assertDocumentPathAccess(context.supabase, data.path)).path;
    } catch {
      return { ok: false as const, base64: null as string | null, message: DOCUMENT_ACCESS_DENIED };
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: file, error } = await supabaseAdmin.storage.from(BUCKET).download(path);
    if (error || !file) {
      return { ok: false as const, base64: null as string | null, message: error?.message ?? "not_found" };
    }
    const buf = new Uint8Array(await file.arrayBuffer());
    // Convert to base64 in chunks (avoid stack overflow on large files)
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < buf.length; i += chunkSize) {
      binary += String.fromCharCode(...buf.subarray(i, i + chunkSize));
    }
    return { ok: true as const, base64: btoa(binary), message: null as string | null };
  });

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function mapGeneratedDocumentTypeToStoredType(
  documentType: string | null | undefined,
): StoredDocumentInsert["document_type"] {
  if (documentType === "reservation") return "reservation";
  if (documentType === "reservation_receipt") return "reservation_receipt";
  if (documentType === "mandate") return "mandate";
  if (documentType === "mandate_partial") return "mandate_partial";
  if (documentType === "nda") return "nda";
  if (documentType === "expose") return "contract";
  return "contract";
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
