import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Eye, FileText, Mail } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fetchDocumentPdfBytes } from "@/lib/documents.functions";
import { ExposeEmailDialog, ExposePdfViewerDialog, base64ToBlobUrl, formatBytes, triggerDownload } from "./ExposeTools";

type Expose = {
  id: string;
  title: string | null;
  file_url: string | null;
  pdf_url: string | null;
  html_content: string | null;
  created_at: string;
  created_by: string | null;
  variables: any;
};

function fileNameOf(d: Expose) {
  return d.variables?.file_name ?? `Expose-${(d.title ?? "Objekt").replace(/[^\w-]+/g, "-")}.pdf`;
}

/** Alle Exposés des Objekts – sichtbar für das ganze Team der aktiven Firma. */
export function ExposeHistoryCard({ exposes, isLoading }: { exposes: Expose[]; isLoading: boolean }) {
  const fetchBytes = useServerFn(fetchDocumentPdfBytes);
  const [view, setView] = useState<Expose | null>(null);
  const [mail, setMail] = useState<Expose | null>(null);

  const creatorIds = Array.from(new Set(exposes.map((e) => e.created_by).filter(Boolean))) as string[];
  const { data: creators = {} } = useQuery({
    queryKey: ["expose-creators", creatorIds.join(",")],
    enabled: creatorIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("id,full_name,email").in("id", creatorIds);
      return Object.fromEntries((data ?? []).map((p: any) => [p.id, p.full_name ?? p.email]));
    },
  });

  async function download(d: Expose) {
    const path = d.file_url ?? d.pdf_url;
    if (!path) {
      toast.error("Für dieses ältere Exposé gibt es kein PDF", { description: "Bitte neu generieren." });
      return;
    }
    const res = await fetchBytes({ data: { path } });
    if (!res.ok || !res.base64) {
      toast.error("Download fehlgeschlagen", { description: res.message ?? undefined });
      return;
    }
    const { url } = base64ToBlobUrl(res.base64);
    triggerDownload(url, fileNameOf(d));
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return (
    <Card><CardContent className="p-6">
      <h4 className="mb-1 font-semibold">Bisher erstellte Exposés</h4>
      <p className="mb-3 text-xs text-muted-foreground">Für alle im Team sichtbar.</p>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Wird geladen…</p>
      ) : exposes.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          Noch keine Exposés. Starte den Assistenten, um das erste Exposé zu erstellen.
        </p>
      ) : (
        <div className="space-y-2">
          {exposes.map((d) => {
            const hasPdf = !!(d.file_url ?? d.pdf_url);
            return (
              <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <FileText className="h-5 w-5 shrink-0 text-primary" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {d.title ?? d.variables?.title ?? "Exposé"}
                      {d.variables?.template_label && <Badge variant="outline" className="ml-2 text-[10px]">{d.variables.template_label}</Badge>}
                      {d.variables?.compressed && <Badge variant="secondary" className="ml-1 text-[10px]">komprimiert</Badge>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(d.created_at).toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "short" })}
                      {d.created_by && (creators as any)[d.created_by] ? ` · ${(creators as any)[d.created_by]}` : ""}
                      {d.variables?.size_bytes ? ` · ${formatBytes(d.variables.size_bytes)}` : ""}
                      {!hasPdf ? " · nur Vorschau" : ""}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => setView(d)}><Eye className="mr-1 h-3.5 w-3.5" />Ansehen</Button>
                  <Button size="sm" variant="outline" disabled={!hasPdf} onClick={() => download(d)}><Download className="mr-1 h-3.5 w-3.5" />Download</Button>
                  <Button size="sm" variant="ghost" onClick={() => setMail(d)}><Mail className="mr-1 h-3.5 w-3.5" />Senden</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ExposePdfViewerDialog
        open={!!view}
        onOpenChange={(o) => !o && setView(null)}
        path={view ? (view.file_url ?? view.pdf_url) : null}
        html={view?.html_content}
        title={view?.title ?? "Exposé"}
        fileName={view ? fileNameOf(view) : "Expose.pdf"}
      />
      <ExposeEmailDialog
        open={!!mail}
        onOpenChange={(o) => !o && setMail(null)}
        title={mail?.title ?? "Exposé"}
        onDownload={mail && (mail.file_url ?? mail.pdf_url) ? () => download(mail) : undefined}
      />
    </CardContent></Card>
  );
}
