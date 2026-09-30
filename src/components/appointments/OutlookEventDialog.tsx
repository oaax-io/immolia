// Fenster für synchronisierte Outlook-Termine: Kunde, Verantwortliche, Teamfreigabe, Absage.
// Alle Änderungen laufen über serverseitig geprüfte Funktionen; nur der Verbindungseigentümer sieht dieses Fenster.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { respondMsEvent } from "@/lib/ms-calendar.functions";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink, Lock, Unlink, X } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";

type Detail = {
  provider_event_id: string; subject: string | null; location: string | null; starts_at: string; ends_at: string;
  is_private: boolean; is_cancelled: boolean; is_organizer: boolean | null; has_attendees: boolean; web_link: string | null;
  visibility: "personal" | "shared"; responsible: string[]; shared_with: string[];
  clients: { link_id: string; client_id: string; source: string; reason: string | null; name: string }[];
};
type Emp = { id: string; full_name: string | null; email: string | null };

const ERR: Record<string, string> = {
  private_event_not_shareable: "Private Microsoft-Termine können nicht freigegeben werden.",
  assignment_requires_share: "Wer andere Personen zuweist, muss den Termin für sie freigeben.",
  user_other_agency: "Eine ausgewählte Person ist kein aktives Mitglied dieser Firma.",
  client_other_agency: "Der Kunde gehört nicht zu dieser Firma.",
  event_not_found: "Termin nicht gefunden.",
};
const errText = (e: any) => { const m = String(e?.message ?? ""); return Object.entries(ERR).find(([k]) => m.includes(k))?.[1] ?? (m || "Aktion fehlgeschlagen."); };

export function OutlookEventDialog({ providerEventId, onClose, employees, currentUserId }: {
  providerEventId: string | null; onClose: () => void; employees: Emp[]; currentUserId?: string;
}) {
  const qc = useQueryClient();
  const respond = useServerFn(respondMsEvent);
  const key = ["calendar-event-detail", providerEventId];
  const { data: d, isLoading, error } = useQuery({
    queryKey: key, enabled: !!providerEventId,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("calendar_event_detail" as never, { _provider_event_id: providerEventId } as never);
      if (error) throw error;
      return data as unknown as Detail;
    },
  });
  const [shared, setShared] = useState(false);
  const [sharedWith, setSharedWith] = useState<string[]>([]);
  const [responsible, setResponsible] = useState<string[]>([]);
  const [clientQ, setClientQ] = useState("");
  const [confirm, setConfirm] = useState<null | "cancel" | "decline">(null);
  const [comment, setComment] = useState("");
  useEffect(() => { if (d) { setShared(d.visibility === "shared"); setSharedWith(d.shared_with); setResponsible(d.responsible); } }, [d]);

  const others = useMemo(() => employees.filter((e) => e.id !== currentUserId), [employees, currentUserId]);
  const { data: clientHits = [] } = useQuery({
    queryKey: ["outlook-client-search", clientQ], enabled: clientQ.trim().length >= 2,
    queryFn: async () => {
      const q = clientQ.trim().replace(/[%,()]/g, "");
      return (await supabase.from("clients").select("id, full_name, company_name, email")
        .or(`full_name.ilike.%${q}%,company_name.ilike.%${q}%,email.ilike.%${q}%`).limit(8)).data ?? [];
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["calendar-busy-blocks"] });
    qc.invalidateQueries({ queryKey: ["client_calendar_items"] });
  };
  const assign = (over: Partial<{ client: string | null; shared: boolean; sharedWith: string[]; responsible: string[] }> = {}) => {
    const s = over.shared ?? shared;
    return supabase.rpc("calendar_assign_event" as never, {
      _provider_event_id: providerEventId, _client_id: over.client ?? null,
      _responsible: s ? (over.responsible ?? responsible) : (over.responsible ?? responsible).filter((x) => x === currentUserId),
      _visibility: s ? "shared" : "personal", _shared_with: s ? (over.sharedWith ?? sharedWith) : [],
      _source: "manual",
    } as never);
  };
  const run = useMutation({
    mutationFn: async (fn: () => PromiseLike<{ error: any }>) => { const { error } = await fn(); if (error) throw error; },
    onSuccess: () => { refresh(); toast.success("Gespeichert."); },
    onError: (e) => toast.error(errText(e)),
  });
  const respondM = useMutation({
    mutationFn: (action: "cancel" | "decline") => respond({ data: { providerEventId: providerEventId!, action, comment: comment || undefined } }),
    onSuccess: (_r, action) => { refresh(); setConfirm(null); setComment(""); toast.success(action === "cancel" ? "Absage an Microsoft gesendet." : "Einladung in Microsoft abgelehnt."); },
    onError: (e: any) => { toast.error(e?.message ?? "Microsoft-Aktion fehlgeschlagen. Nichts wurde geändert."); },
  });

  const toggle = (arr: string[], id: string) => arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];
  const name = (id: string) => { const e = employees.find((x) => x.id === id); return e?.full_name || e?.email || "Unbekannt"; };

  return (
    <>
      <Dialog open={!!providerEventId} onOpenChange={(o) => { if (!o) onClose(); }}>
        <DialogContent className="max-h-[92vh] w-full max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {d?.subject || "Outlook-Termin"}
              <Badge variant="outline">Microsoft</Badge>
              {d?.is_private && <Badge variant="secondary"><Lock className="mr-1 h-3 w-3" />Privat</Badge>}
              {d?.is_cancelled && <Badge variant="destructive">Abgesagt</Badge>}
            </DialogTitle>
            <DialogDescription>
              {d ? `${formatDateTime(d.starts_at)} – ${formatDateTime(d.ends_at)}${d.location ? ` · ${d.location}` : ""}` : " "}
            </DialogDescription>
          </DialogHeader>

          {isLoading && <p className="text-sm text-muted-foreground">Wird geladen …</p>}
          {error && <p className="text-sm text-destructive">Dieser Termin ist für dich nicht verfügbar.</p>}
          {d && (
            <div className="grid gap-6 md:grid-cols-2">
              <section className="space-y-3">
                <Label>Kunden</Label>
                {d.clients.length === 0 && <p className="text-sm text-muted-foreground">Kein Kunde zugeordnet.</p>}
                <ul className="space-y-1">
                  {d.clients.map((c) => (
                    <li key={c.link_id} className="flex items-center justify-between gap-2 rounded-md border px-2 py-1 text-sm">
                      <span className="min-w-0 truncate">{c.name || "Kunde"} <span className="text-xs text-muted-foreground">({c.source === "auto" ? "automatisch" : "manuell"})</span></span>
                      <Button size="icon" variant="ghost" aria-label="Zuordnung entfernen"
                        onClick={() => run.mutate(() => supabase.rpc("calendar_unlink_client" as never, { _link_id: c.link_id } as never))}>
                        <Unlink className="h-4 w-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
                <Input placeholder="Kunde suchen (mind. 2 Zeichen)" value={clientQ} onChange={(e) => setClientQ(e.target.value)} />
                {(clientHits as any[]).length > 0 && (
                  <ul className="max-h-40 overflow-y-auto rounded-md border">
                    {(clientHits as any[]).map((c) => (
                      <li key={c.id}>
                        <button type="button" className="w-full px-2 py-1.5 text-left text-sm hover:bg-accent"
                          onClick={() => { setClientQ(""); run.mutate(() => assign({ client: c.id })); }}>
                          {c.full_name || c.company_name || c.email}
                          {c.email && <span className="ml-1 text-xs text-muted-foreground">{c.email}</span>}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">Eine Kundenzuordnung gibt den Termin nicht frei.</p>
              </section>

              <section className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="share-sw">Für Teammitglieder freigeben</Label>
                  <Switch id="share-sw" checked={shared} disabled={d.is_private}
                    onCheckedChange={(v) => { setShared(v); if (!v) { setSharedWith([]); setResponsible(responsible.filter((x) => x === currentUserId)); } }} />
                </div>
                {d.is_private
                  ? <p className="text-xs text-muted-foreground">Private Microsoft-Termine bleiben persönlich und können nicht freigegeben werden.</p>
                  : <p className="text-xs text-muted-foreground">Freigegebene Personen sehen Titel, Zeit, Ort und Kunde – keine Teilnehmer. Es wird keine Outlook-Einladung versendet.</p>}
                {shared && (
                  <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2">
                    {others.map((e) => (
                      <div key={e.id} className="flex items-center justify-between gap-2 text-sm">
                        <label className="flex min-w-0 items-center gap-2">
                          <Checkbox checked={sharedWith.includes(e.id)} onCheckedChange={() => {
                            const next = toggle(sharedWith, e.id); setSharedWith(next);
                            if (!next.includes(e.id)) setResponsible(responsible.filter((x) => x !== e.id));
                          }} />
                          <span className="truncate">{e.full_name || e.email}</span>
                        </label>
                        <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          <Checkbox checked={responsible.includes(e.id)} onCheckedChange={() => {
                            setResponsible(toggle(responsible, e.id));
                            if (!sharedWith.includes(e.id)) setSharedWith([...sharedWith, e.id]);
                          }} />verantwortlich
                        </label>
                      </div>
                    ))}
                  </div>
                )}
                {d.visibility === "shared" && d.shared_with.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {d.shared_with.map((id) => (
                      <Badge key={id} variant="secondary" className="gap-1">{name(id)}
                        <button type="button" aria-label={`Freigabe für ${name(id)} entziehen`}
                          onClick={() => { const next = d.shared_with.filter((x) => x !== id);
                            run.mutate(() => assign({ shared: next.length > 0, sharedWith: next, responsible: d.responsible.filter((x) => x !== id) })); }}>
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
                <Button size="sm" disabled={run.isPending} onClick={() => run.mutate(() => assign())}>Freigabe speichern</Button>
              </section>
            </div>
          )}

          {d && (
            <DialogFooter className="flex-wrap gap-2 sm:justify-between">
              {d.web_link ? <Button variant="outline" asChild><a href={d.web_link} target="_blank" rel="noreferrer"><ExternalLink className="mr-1 h-4 w-4" />In Outlook öffnen</a></Button> : <span />}
              {!d.is_cancelled && (d.is_organizer === true
                ? <Button variant="destructive" onClick={() => setConfirm("cancel")}>Termin absagen</Button>
                : d.has_attendees ? <Button variant="outline" onClick={() => setConfirm("decline")}>Einladung ablehnen</Button> : null)}
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!confirm} onOpenChange={(o) => { if (!o) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === "cancel" ? "Termin in Microsoft absagen?" : "Einladung ablehnen?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirm === "cancel"
                ? "Microsoft sendet allen Teilnehmern eine Absage. Das lässt sich nicht rückgängig machen."
                : "Microsoft teilt dem Organisator mit, dass du nicht teilnimmst. Der Termin selbst bleibt für die anderen bestehen."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea placeholder="Nachricht (optional)" value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} />
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction disabled={respondM.isPending} onClick={(e) => { e.preventDefault(); if (confirm) respondM.mutate(confirm); }}>
              {respondM.isPending ? "Wird gesendet …" : confirm === "cancel" ? "Absagen" : "Ablehnen"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
