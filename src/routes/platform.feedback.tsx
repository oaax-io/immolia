import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PlatformPage, QueryState } from "@/components/platform/PlatformLayout";
import { supabase } from "@/integrations/supabase/client";
import { fmtDate } from "@/lib/platform-admin";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getPlatformFeedbackAttachments } from "@/lib/platform-feedback.functions";

type Row = {
  id: string; agency_id: string | null; agency_name: string | null; author_name: string | null; author_email: string | null;
  type: string; title: string; status: string; priority: string; created_at: string; comments: number; votes: number;
};
const STATUS: Record<string, string> = { new: "Neu", under_review: "In Prüfung", planned: "Geplant", in_progress: "In Arbeit", done: "Erledigt", rejected: "Abgelehnt", duplicate: "Duplikat", updated: "Aktualisiert" };
const PRIO: Record<string, string> = { low: "Tief", medium: "Mittel", high: "Hoch", critical: "Kritisch" };
const TYPE: Record<string, string> = { idea: "Idee", bug: "Fehler", question: "Frage", other: "Sonstiges" };

// Zentrale Feedback-Verwaltung: ausschliesslich über platform_* RPCs (serverseitig is_platform_admin)
export const Route = createFileRoute("/platform/feedback")({ component: FeedbackCenter });

function FeedbackCenter() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["platform", "feedback"],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("platform_list_feedback", { _agency_id: null });
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
  const upd = useMutation({
    mutationFn: async (a: { id: string; status?: string; priority?: string }) => {
      const { error } = await (supabase.rpc as any)("platform_update_feedback", { _id: a.id, _status: a.status ?? null, _priority: a.priority ?? null });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Gespeichert"); qc.invalidateQueries({ queryKey: ["platform", "feedback"] }); },
    onError: () => toast.error("Aktion fehlgeschlagen."),
  });
  return (
    <PlatformPage title="Feedback" description="Feedback aller Unternehmen an Immolia.">
      <Card><CardContent className="p-0">
        <QueryState isLoading={q.isLoading} error={q.error} />
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground"><tr>
              <th className="p-3">Unternehmen</th><th className="p-3">Benutzer</th><th className="p-3">Kategorie</th>
              <th className="p-3">Betreff</th><th className="p-3">Status</th><th className="p-3">Priorität</th><th className="p-3">Datum</th><th className="p-3">Anhänge</th>
            </tr></thead>
            <tbody>
              {(q.data ?? []).map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="p-3">{r.agency_name ?? "Nicht zugeordnet"}</td>
                  <td className="p-3">{r.author_name ?? r.author_email ?? "–"}</td>
                  <td className="p-3">{TYPE[r.type] ?? r.type}</td>
                  <td className="p-3 font-medium">{r.title}</td>
                  <td className="p-3">
                    <Select value={r.status} onValueChange={(v) => upd.mutate({ id: r.id, status: v })}>
                      <SelectTrigger className="h-8 w-36"><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(STATUS).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="p-3">
                    <Select value={r.priority} onValueChange={(v) => upd.mutate({ id: r.id, priority: v })}>
                      <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
                      <SelectContent>{Object.entries(PRIO).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                    </Select>
                  </td>
                  <td className="p-3">{fmtDate(r.created_at)}</td>
                  <td className="p-3"><AttachmentsCell id={r.id} /></td>
                </tr>
              ))}
              {q.data && q.data.length === 0 && <tr><td className="p-6 text-center text-muted-foreground" colSpan={8}>Noch kein Feedback.</td></tr>}
            </tbody>
          </table>
        </div>
      </CardContent></Card>
    </PlatformPage>
  );
}

function AttachmentsCell({ id }: { id: string }) {
  const fetchAtt = useServerFn(getPlatformFeedbackAttachments);
  const [show, setShow] = useState(false);
  const q = useQuery({
    queryKey: ["platform", "feedback-attachments", id],
    enabled: show,
    staleTime: 10 * 60 * 1000,
    queryFn: () => fetchAtt({ data: { feedbackId: id } }),
  });
  if (!show) return <button type="button" className="text-xs underline" onClick={() => setShow(true)}>Anzeigen</button>;
  if (q.isLoading) return <span className="text-xs text-muted-foreground">Lädt…</span>;
  if (q.error) return <span className="text-xs text-destructive">Kein Zugriff</span>;
  if (!q.data?.length) return <span className="text-xs text-muted-foreground">Keine</span>;
  return (
    <div className="flex flex-col gap-1">
      {q.data.map((a, i) => a.url
        ? <a key={i} href={a.url} target="_blank" rel="noreferrer" className="text-xs underline">{a.name}</a>
        : <span key={i} className="text-xs text-muted-foreground">{a.name} (nicht verfügbar)</span>)}
    </div>
  );
}
