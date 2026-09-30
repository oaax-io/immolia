import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, Check, ExternalLink, Unlink, X } from "lucide-react";
import { toast } from "sonner";
import { formatDateTime } from "@/lib/format";

type Item = {
  kind: "appointment" | "outlook" | "suggestion" | "shared";
  item_id: string; link_id: string | null; provider_event_id: string | null;
  title: string; starts_at: string; ends_at: string; status: string; origin: "immolia" | "microsoft";
  responsible: string[]; reason: string; source: string; web_link: string | null; is_own: boolean;
};

const REASON: Record<string, string> = {
  email_unique: "Automatisch: E-Mail eindeutig",
  email_ambiguous: "Vorschlag: E-Mail bei mehreren Kunden",
  phone: "Vorschlag: Telefonnummer",
  name: "Vorschlag: Name im Titel",
  company: "Vorschlag: Firma im Titel",
  manual: "Manuell zugeordnet",
  confirmed_suggestion: "Bestätigter Vorschlag",
  shared: "Vom Team freigegeben",
};

export function ClientAppointmentsTab({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const key = ["client_calendar_items", clientId];
  const { data = [], isLoading, error } = useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("client_calendar_items" as never, { _client_id: clientId } as never);
      if (error) throw error;
      return ((data ?? []) as Item[]).sort((a, b) => b.starts_at.localeCompare(a.starts_at));
    },
  });
  const refresh = () => { qc.invalidateQueries({ queryKey: key }); qc.invalidateQueries({ queryKey: ["client_appointments", clientId] }); };

  const run = useMutation({
    mutationFn: async (fn: () => PromiseLike<{ error: any }>) => { const { error } = await fn(); if (error) throw error; },
    onSuccess: refresh,
    onError: () => toast.error("Aktion fehlgeschlagen. Bitte erneut versuchen."),
  });

  const unlink = (it: Item) => run.mutate(() => it.kind === "appointment"
    ? supabase.from("appointments").update({ client_id: null }).eq("id", it.item_id).select("id").then((r) =>
        ({ error: r.error ?? (r.data?.length ? null : new Error("denied")) }))
    : supabase.rpc("calendar_unlink_client" as never, { _link_id: it.link_id } as never));
  const confirm = (it: Item) => run.mutate(() => supabase.rpc("calendar_link_client" as never,
    { _provider_event_id: it.provider_event_id, _client_id: clientId, _suggestion_id: it.item_id } as never));
  const dismiss = (it: Item) => run.mutate(() => supabase.rpc("calendar_dismiss_suggestion" as never, { _id: it.item_id } as never));

  if (isLoading) return <p className="text-sm text-muted-foreground">Termine werden geladen …</p>;
  if (error) return <p className="text-sm text-destructive">Termine konnten nicht geladen werden.</p>;

  const suggestions = data.filter((i) => i.kind === "suggestion");
  const linked = data.filter((i) => i.kind !== "suggestion");

  return (
    <div className="space-y-4">
      {suggestions.length > 0 && (
        <Card><CardContent className="space-y-2 p-4 sm:p-6">
          <h3 className="font-display text-base font-semibold">Vorschläge aus Outlook</h3>
          <p className="text-xs text-muted-foreground">Nur für dich sichtbar. Bitte bestätigen oder ablehnen.</p>
          {suggestions.map((it) => (
            <Row key={`s-${it.item_id}`} it={it}>
              <Button size="sm" variant="outline" onClick={() => confirm(it)} disabled={run.isPending}><Check className="mr-1 h-4 w-4" />Zuordnen</Button>
              <Button size="sm" variant="ghost" onClick={() => dismiss(it)} disabled={run.isPending} aria-label="Vorschlag ablehnen"><X className="h-4 w-4" /></Button>
            </Row>
          ))}
        </CardContent></Card>
      )}
      <Card><CardContent className="space-y-2 p-4 sm:p-6">
        <h3 className="font-display text-base font-semibold">Termine</h3>
        {linked.length === 0 && <p className="text-sm text-muted-foreground">Keine Termine verknüpft.</p>}
        {linked.map((it) => (
          <Row key={`${it.kind}-${it.item_id}-${it.link_id ?? ""}`} it={it}>
            {it.kind === "appointment" ? (
              <Button size="sm" variant="outline" asChild><Link to="/appointments">Öffnen</Link></Button>
            ) : it.web_link ? (
              <Button size="sm" variant="outline" asChild><a href={it.web_link} target="_blank" rel="noopener noreferrer"><ExternalLink className="mr-1 h-4 w-4" />In Outlook</a></Button>
            ) : null}
            {(it.kind === "appointment" || it.kind === "outlook") && (
              <Button size="sm" variant="ghost" onClick={() => unlink(it)} disabled={run.isPending} aria-label="Zuordnung entfernen"><Unlink className="h-4 w-4" /></Button>
            )}
          </Row>
        ))}
      </CardContent></Card>
    </div>
  );
}

function Row({ it, children }: { it: Item; children: React.ReactNode }) {
  const cancelled = it.status === "cancelled";
  return (
    <div className="flex flex-col gap-2 rounded-xl border p-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className={`break-words font-medium ${cancelled ? "line-through text-muted-foreground" : ""}`}>
          <Calendar className="mr-1.5 inline h-4 w-4 text-muted-foreground" />{it.title}
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatDateTime(it.starts_at)}{it.responsible.length ? ` · ${it.responsible.join(", ")}` : ""}
        </p>
        <div className="mt-1 flex flex-wrap gap-1">
          <Badge variant="outline">{it.origin === "microsoft" ? "Microsoft" : "Immolia"}</Badge>
          {cancelled ? <Badge variant="destructive">Abgesagt</Badge> : <Badge variant="secondary">Geplant</Badge>}
          {it.origin === "microsoft" && <Badge variant="outline">{REASON[it.reason] ?? it.reason}</Badge>}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">{children}</div>
    </div>
  );
}
