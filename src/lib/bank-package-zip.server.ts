// Speicherschonender ZIP-Aufbau für das Bank-Paket (Stabilisierung Step 7).
//
// Früher wurden alle Anhänge vollständig in den Server-Speicher geladen und danach
// mit zipSync ein zweites Mal als Gesamt-ZIP kopiert (Spitze ≈ 2 × Paketgrösse,
// plus ungeprüfte Einzeldownloads). Jetzt:
//   1) Planung: Grösse jeder Datei per HEAD ermitteln (kein Download), Grenzen prüfen.
//   2) Streaming: Dateien nacheinander stückweise lesen → fflate-Zip (ohne Kompression)
//      → ReadableStream → direkt in den privaten Storage hochladen.
// Im Speicher liegt damit immer nur ein kleiner Block (Netzwerk-Chunk), nie das ganze Paket.

import { Zip, ZipPassThrough } from "fflate";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25 MB pro Datei
// Paket muss unter der Upload-Grenze des Speichers (50 MB) bleiben.
export const MAX_TOTAL_ATTACHMENT_BYTES = 45 * 1024 * 1024; // 45 MB Anhänge total
export const MAX_ATTACHMENT_COUNT = 150;

const ATTACHMENT_BUCKETS = ["documents", "generated-documents", "media", "brand-assets"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

export type ResolvedFile = { url: string; size: number | null };

/** Liefert eine abrufbare URL + Grösse, ohne den Inhalt zu laden. null = nicht gefunden. */
export async function resolveAttachment(fileUrl: string, admin: AdminClient): Promise<ResolvedFile | null> {
  if (!fileUrl) return null;
  const head = async (url: string): Promise<ResolvedFile | null> => {
    try {
      const res = await fetch(url, { method: "HEAD" });
      if (!res.ok) return null;
      const len = Number(res.headers.get("content-length"));
      return { url, size: Number.isFinite(len) && len >= 0 ? len : null };
    } catch {
      return null;
    }
  };
  if (/^https?:\/\//i.test(fileUrl)) return head(fileUrl);
  for (const bucket of ATTACHMENT_BUCKETS) {
    try {
      const { data, error } = await admin.storage.from(bucket).createSignedUrl(fileUrl, 15 * 60);
      if (error || !data?.signedUrl) continue;
      const r = await head(data.signedUrl);
      if (r) return r;
    } catch {
      // nächster Bucket
    }
  }
  return null;
}

export type ZipEntry =
  | { path: string; bytes: Uint8Array }
  | { path: string; url: string; expectedSize: number | null; label: string };

export class PackageBuildError extends Error {
  constructor(public reason: "attachment_changed" | "attachment_failed" | "upload_failed", message: string) {
    super(message);
  }
}

/**
 * Baut das ZIP als Stream und lädt es direkt hoch. Gibt die Paketgrösse zurück.
 * Pro Datei wird maxFileBytes auch beim Lesen hart durchgesetzt (falls HEAD gelogen hat).
 */
export async function streamZipToStorage(opts: {
  admin: AdminClient;
  bucket: string;
  path: string;
  entries: ZipEntry[];
  maxFileBytes?: number;
  maxTotalBytes?: number;
  onPeak?: (bytesInFlight: number) => void;
}): Promise<{ bytes: number }> {
  const maxFile = opts.maxFileBytes ?? MAX_ATTACHMENT_BYTES;
  const maxTotal = (opts.maxTotalBytes ?? MAX_TOTAL_ATTACHMENT_BYTES) + 10 * 1024 * 1024; // + PDF/README
  const ts = new TransformStream<Uint8Array, Uint8Array>(undefined, { highWaterMark: 4 }, { highWaterMark: 4 });
  const writer = ts.writable.getWriter();
  let outBytes = 0;
  let pending: Promise<void> = Promise.resolve();
  let zipError: Error | null = null;

  const zip = new Zip((err, chunk, final) => {
    if (err) {
      zipError = err;
      return;
    }
    outBytes += chunk.byteLength;
    // Leere Blöcke nie schreiben: manche Laufzeiten werten sie als Ende des Upload-Streams.
    if (chunk.byteLength > 0) pending = pending.then(() => writer.write(chunk));
    if (final) pending = pending.then(() => writer.close());
  });

  const upload = opts.admin.storage
    .from(opts.bucket)
    .upload(opts.path, ts.readable, { contentType: "application/zip", upsert: false, duplex: "half" });

  const drain = async () => {
    await pending;
    await writer.ready;
    if (zipError) throw zipError;
  };

  try {
    let total = 0;
    for (const e of opts.entries) {
      const file = new ZipPassThrough(e.path);
      zip.add(file);
      if ("bytes" in e) {
        file.push(e.bytes, true);
        await drain();
        continue;
      }
      let res: Response;
      try {
        res = await fetch(e.url);
      } catch {
        throw new PackageBuildError("attachment_failed", `Datei konnte nicht geladen werden: ${e.label}`);
      }
      if (!res.ok || !res.body) {
        throw new PackageBuildError("attachment_failed", `Datei konnte nicht geladen werden: ${e.label}`);
      }
      const reader = res.body.getReader();
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.byteLength;
        total += value.byteLength;
        if (got > maxFile || total > maxTotal) {
          await reader.cancel().catch(() => {});
          throw new PackageBuildError("attachment_changed", `Datei ist grösser als erlaubt: ${e.label}`);
        }
        opts.onPeak?.(value.byteLength);
        file.push(value, false);
        await drain();
      }
      file.push(new Uint8Array(0), true);
      await drain();
    }
    zip.end();
    await drain();
  } catch (err) {
    await writer.abort(err).catch(() => {});
    await upload.catch(() => {});
    // evtl. halb geschriebenes Objekt entfernen
    await opts.admin.storage.from(opts.bucket).remove([opts.path]).catch(() => {});
    throw err;
  }

  const { error } = await upload;
  if (error) {
    await opts.admin.storage.from(opts.bucket).remove([opts.path]).catch(() => {});
    throw new PackageBuildError("upload_failed", `Upload fehlgeschlagen: ${error.message}`);
  }
  return { bytes: outBytes };
}
