import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SettingsPageShell } from "@/components/settings/SettingsPageShell";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getMsCalendarStatus, startMsConnect, listMsCalendars, saveMsCalendar, disconnectMs, type MsCalendarState } from "@/lib/ms-calendar.functions";

export const Route = createFileRoute("/_app/settings/calendar")({
  head: () => ({ meta: [{ title: "Microsoft-365-Kalender – Einstellungen" }] }),
  component: CalendarSettings,
});

const LABEL: Record<MsCalendarState, string> = {
  not_connected: "Nicht verbunden", connecting: "Kalender auswählen", configuration_required: "Einrichtung ausstehend",
  connected: "Verbunden", syncing: "Synchronisiert…", reconnect_required: "Erneut verbinden nötig",
  admin_approval_required: "Adminfreigabe nötig", error: "Fehler", disconnected: "Getrennt",
};
const RESULT: Record<string, string> = {
  choose_calendar: "Microsoft-Konto verbunden. Bitte Kalender auswählen.", connected: "Microsoft-Kalender wieder verbunden.",
  admin_approval_required: "Deine Firma verlangt eine Adminfreigabe in Microsoft.", canceled: "Verbindung abgebrochen.",
  expired: "Der Verbindungsversuch ist abgelaufen. Bitte erneut starten.", forbidden: "Kein Zugriff auf diese Firma.",
  configuration_required: "Die Microsoft-Integration ist noch nicht eingerichtet.", invalid: "Antwort von Microsoft ungültig.", error: "Verbindung fehlgeschlagen.",
};

function CalendarSettings() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getMsCalendarStatus);
  const startFn = useServerFn(startMsConnect);
  const listFn = useServerFn(listMsCalendars);
  const saveFn = useServerFn(saveMsCalendar);
  const discFn = useServerFn(disconnectMs);
  const status = useQuery({ queryKey: ["ms-calendar-status"], queryFn: () => statusFn() });
  const st = status.data?.state;
  const canPick = st === "connecting" || st === "connected";
  const cals = useQuery({ queryKey: ["ms-calendars"], queryFn: () => listFn(), enabled: canPick && !!status.data?.account });
  const [pick, setPick] = useState<string>("");

  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("ms");
    if (p && RESULT[p]) { (p === "choose_calendar" || p === "connected" ? toast.success : toast.error)(RESULT[p]); window.history.replaceState(null, "", window.location.pathname); }
  }, []);
  useEffect(() => { if (status.data?.calendarId) setPick(status.data.calendarId); }, [status.data?.calendarId]);

  const refresh = () => { qc.invalidateQueries({ queryKey: ["ms-calendar-status"] }); qc.invalidateQueries({ queryKey: ["ms-calendars"] }); };
  const connect = useMutation({
    mutationFn: (reconnect: boolean) => startFn({ data: { reconnect } }),
    onSuccess: (r) => { if (r.url) window.location.href = r.url; else refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const save = useMutation({ mutationFn: () => saveFn({ data: { calendarId: pick } }), onSuccess: () => { toast.success("Kalender gespeichert."); refresh(); }, onError: (e: Error) => toast.error(e.message) });
  const disc = useMutation({ mutationFn: () => discFn(), onSuccess: () => { toast.success("Verbindung getrennt."); refresh(); }, onError: (e: Error) => toast.error(e.message) });

  return (
    <SettingsPageShell title="Microsoft-365-Kalender" description="Persönliche Verbindung deines Microsoft-Kalenders für diese Firma">
      <Card><CardContent className="space-y-4 p-5">
        {status.isLoading ? <p className="text-sm text-muted-foreground">Lädt…</p> : status.isError ? (
          <p className="text-sm text-destructive">{(status.error as Error).message}</p>
        ) : st && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Badge variant={st === "connected" ? "default" : "secondary"}>{LABEL[st]}</Badge>
              {status.data?.account && <span className="text-sm text-muted-foreground">{status.data.account}</span>}
            </div>
            {st === "configuration_required" && <p className="text-sm text-muted-foreground">Die zentrale Microsoft-App ist noch nicht hinterlegt. Bitte wende dich an den Plattform-Betreiber.</p>}
            {st === "admin_approval_required" && <p className="text-sm text-muted-foreground">Deine Microsoft-Organisation erlaubt Benutzern keine eigene Zustimmung. Eine Person mit Microsoft-Adminrechten muss Immolia einmalig freigeben; danach erneut verbinden.</p>}
            {st === "reconnect_required" && <p className="text-sm text-muted-foreground">Der Zugriff wurde widerrufen oder ist abgelaufen. Bitte erneut verbinden.</p>}

            {canPick && status.data?.account && (
              <div className="flex flex-wrap items-end gap-2">
                <div className="min-w-64 flex-1">
                  <p className="mb-1 text-sm font-medium">Kalender</p>
                  <Select value={pick} onValueChange={setPick} disabled={cals.isLoading}>
                    <SelectTrigger><SelectValue placeholder={cals.isLoading ? "Kalender werden geladen…" : "Kalender wählen"} /></SelectTrigger>
                    <SelectContent>{(cals.data ?? []).map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.isDefault ? " (Standard)" : ""}</SelectItem>)}</SelectContent>
                  </Select>
                  {cals.isError && <p className="mt-1 text-xs text-destructive">Kalender konnten nicht geladen werden.</p>}
                </div>
                <Button onClick={() => save.mutate()} disabled={!pick || save.isPending || pick === status.data?.calendarId}>Speichern</Button>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {(st === "not_connected" || st === "disconnected") && <Button onClick={() => connect.mutate(false)} disabled={connect.isPending}>Mit Microsoft verbinden</Button>}
              {(st === "reconnect_required" || st === "admin_approval_required" || st === "error" || st === "connecting" || st === "connected") &&
                <Button variant="outline" onClick={() => connect.mutate(true)} disabled={connect.isPending}>Erneut verbinden</Button>}
              {status.data?.account && st !== "disconnected" && <Button variant="ghost" onClick={() => { if (window.confirm("Die Synchronisierung wird beendet. Bestehende Termine bleiben erhalten.\n\nHinweis: Das Trennen widerruft nicht automatisch die Zustimmung bei Microsoft (myapps.microsoft.com).")) disc.mutate(); }} disabled={disc.isPending}>Verbindung trennen</Button>}
            </div>
            <p className="text-xs text-muted-foreground">Die Verbindung gilt nur für dich und nur in der aktuell gewählten Firma. Andere Personen, auch Admins, sehen keine Zugangsdaten.</p>
          </>
        )}
      </CardContent></Card>
    </SettingsPageShell>
  );
}
