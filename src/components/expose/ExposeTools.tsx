import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Download, Link2, Loader2, Mail, Send } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { fetchDocumentPdfBytes } from "@/lib/documents.functions";

export function base64ToBlobUrl(base64: string): { url: string; size: number } {
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const blob = new Blob([arr], { type: "application/pdf" });
  return { url: URL.createObjectURL(blob), size: blob.size };
}

export function formatBytes(n?: number | null): string {
  if (!n) return "–";
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function triggerDownload(url: string, fileName: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Lädt ein gespeichertes PDF (Storage-Pfad) über den geschützten Server-Weg als Blob-URL. */
export function useStoredPdf(path: string | null) {
  const fetchBytes = useServerFn(fetchDocumentPdfBytes);
  const [state, setState] = useState<{ url: string | null; size: number; loading: boolean; error: string | null }>({
    url: null, size: 0, loading: false, error: null,
  });
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    let created: string | null = null;
    setState({ url: null, size: 0, loading: true, error: null });
    fetchBytes({ data: { path } })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok || !res.base64) {
          setState({ url: null, size: 0, loading: false, error: res.message ?? "PDF nicht gefunden" });
          return;
        }
        const { url, size } = base64ToBlobUrl(res.base64);
        created = url;
        setState({ url, size, loading: false, error: null });
      })
      .catch((e) => !cancelled && setState({ url: null, size: 0, loading: false, error: (e as Error).message }));
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [path, fetchBytes]);
  return state;
}

/** PDF-Ansicht im Modal; Download erst auf Klick. */
export function ExposePdfViewerDialog({
  open, onOpenChange, path, html, title, fileName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  path: string | null;
  html?: string | null;
  title: string;
  fileName: string;
}) {
  const pdf = useStoredPdf(open ? path : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[94vh] max-w-5xl flex-col">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            {pdf.url ? `PDF · ${formatBytes(pdf.size)}` : path ? "PDF wird geladen…" : "Nur HTML-Vorschau verfügbar (älteres Exposé)."}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1">
          {pdf.loading && (
            <div className="flex h-[70vh] items-center justify-center text-sm text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />PDF wird geladen…
            </div>
          )}
          {pdf.url && <iframe title={title} src={pdf.url} className="h-[72vh] w-full rounded border" />}
          {!pdf.loading && !pdf.url && html && (
            <iframe title={title} srcDoc={html} className="h-[72vh] w-full rounded border" />
          )}
          {!pdf.loading && !pdf.url && !html && (
            <p className="py-10 text-center text-sm text-muted-foreground">{pdf.error ?? "Keine Vorschau verfügbar."}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Schliessen</Button>
          <Button disabled={!pdf.url} onClick={() => pdf.url && triggerDownload(pdf.url, fileName)}>
            <Download className="mr-1 h-4 w-4" />Download
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Platzhalter für den E-Mail-Versand, bis der E-Mail-Dienst aktiviert ist. */
export function ExposeEmailDialog({
  open, onOpenChange, title, defaultRecipient, onDownload,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  defaultRecipient?: string | null;
  onDownload?: () => void;
}) {
  const [to, setTo] = useState(defaultRecipient ?? "");
  const [subject, setSubject] = useState(`Exposé: ${title}`);
  const [body, setBody] = useState(
    `Guten Tag\n\nGerne sende ich Ihnen das Exposé zu «${title}». Bei Fragen stehe ich Ihnen jederzeit zur Verfügung.\n\nFreundliche Grüsse`,
  );
  useEffect(() => {
    if (open) setSubject(`Exposé: ${title}`);
  }, [open, title]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Mail className="h-4 w-4 text-primary" />Exposé per E-Mail senden</DialogTitle>
          <DialogDescription>Der E-Mail-Dienst ist in Vorbereitung. Du kannst die Nachricht schon vorbereiten.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Empfänger</Label>
            <Input type="email" placeholder="name@beispiel.ch" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Betreff</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Begleittext</Label>
            <Textarea rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="rounded-lg border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
            Der automatische Versand wird bald freigeschaltet. Bis dahin: PDF herunterladen und an deine E-Mail anhängen.
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t pt-3">
          <Button
            variant="outline"
            onClick={async () => {
              await navigator.clipboard?.writeText(`${subject}\n\n${body}`).catch(() => {});
              toast.success("Text kopiert");
            }}
          >
            <Link2 className="mr-1 h-4 w-4" />Text kopieren
          </Button>
          {onDownload && (
            <Button variant="outline" onClick={onDownload}><Download className="mr-1 h-4 w-4" />PDF herunterladen</Button>
          )}
          <Button disabled title="E-Mail-Dienst in Vorbereitung">
            <Send className="mr-1 h-4 w-4" />Senden (bald)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
