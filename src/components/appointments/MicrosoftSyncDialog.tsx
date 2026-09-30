import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { CalendarSync, CheckCircle2, AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { getMsCalendarStatus, startMsConnect, listMsCalendars, saveMsCalendar, disconnectMs, syncMsNow } from "@/lib/ms-calendar.functions";

const RETURN_MSG: Record<string, { tone: "ok" | "err"; text: string }> = {
  canceled: { tone: "err", text: "Die Microsoft-Anmeldung wurde abgebrochen." },
  denied: { tone: "err", text: "Der Zugriff wurde in Microsoft verweigert. Ohne Zustimmung kann Immolia deinen Kalender nicht verbinden." },
  expired: { tone: "err", text: "Der Verbindungsversuch ist abgelaufen. Bitte starte ihn erneut." },
  forbidden: { tone: "err", text: "Für diese Firma besteht kein Zugriff auf den Kalender." },
  invalid: { tone: "err", text: "Die Anmeldung konnte nicht bestätigt werden. Bitte versuche es erneut." },
  error: { tone: "err", text: "Die Verbindung ist fehlgeschlagen. Bitte versuche es später erneut." },
  configuration_required: { tone: "err", text: "Die Microsoft-Integration ist noch nicht eingerichtet." },
};

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "short" }) : "Noch nie";
}

export function MicrosoftSyncButton() {
  const statusFn = useServerFn(getMsCalendarStatus);
  const status = useQuery({ queryKey: ["ms-calendar-status"], queryFn: () => statusFn(), refetchInterval: (q) => (q.state.data?.state === "syncing" ? 5000 : false) });
  const [open, setOpen] = useState(false);
  const [returnCode, setReturnCode] = useState<string | null>(null);

  // OAuth-Kontext nach Rückkehr wiederherstellen
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const ms = p.get("ms");
    if (!ms) return;
    p.delete("ms");
    window.history.replaceState(null, "", window.location.pathname + (p.toString() ? `?${p}` : ""));
    setReturnCode(ms);
    setOpen(true);
  }, []);

  const st = status.data?.state;
  const label = st === "connected" || st === "syncing" ? "Microsoft verbunden"
    : st === "reconnect_required" ? "Microsoft erneut verbinden" : "Microsoft Sync";
  const ok = st === "connected" || st === "syncing";
  const warn = st === "reconnect_required" || st === "admin_approval_required" || st === "error";

  return (
    <>
      <Button variant="outline" size="sm" className="h-9 gap-2" onClick={() => setOpen(true)} disabled={status.isLoading}
        aria-label={label} title={label}>
        {ok ? <span className="h-2 w-2 rounded-full bg-success" aria-hidden /> : warn ? <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden /> : <CalendarSync className="h-4 w-4" aria-hidden />}
        <span className="hidden md:inline">{label}</span>
      </Button>
      {open && <MicrosoftSyncDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setReturnCode(null); }} returnCode={returnCode} />}
    </>
  );
}

function MicrosoftSyncDialog({ open, onOpenChange, returnCode }: { open: boolean; onOpenChange: (o: boolean) => void; returnCode: string | null }) {
  const qc = useQueryClient();
  const statusFn = useServerFn(getMsCalendarStatus);
  const startFn = useServerFn(startMsConnect);
  const listFn = useServerFn(listMsCalendars);
  const saveFn = useServerFn(saveMsCalendar);
  const discFn = useServerFn(disconnectMs);
  const syncFn = useServerFn(syncMsNow);
  const status = useQuery({ queryKey: ["ms-calendar-status"], queryFn: () => statusFn(), refetchInterval: (q) => (q.state.data?.state === "syncing" ? 5000 : false) });
  const s = status.data;
  const st = s?.state;
  const [editing, setEditing] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const needsPick = st === "connecting" && !!s?.account;
  const showPicker = needsPick || editing;
  const cals = useQuery({ queryKey: ["ms-calendars"], queryFn: () => listFn(), enabled: showPicker, retry: false });
  const [pick, setPick] = useState("");
  const [push, setPush] = useState(true);
  const [busy, setBusy] = useState(true);
  const primaryRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (s) { setPush(s.pushToOutlook); setBusy(s.showBusy); } }, [s?.pushToOutlook, s?.showBusy]);
  useEffect(() => {
    if (!cals.data || pick) return;
    const current = cals.data.find((c) => c.id === s?.calendarId);
    const defs = cals.data.filter((c) => c.isDefault);
    setPick(current?.id ?? (defs.length === 1 ? defs[0].id : cals.data.length === 1 ? cals.data[0].id : ""));
  }, [cals.data]);

  const refresh = () => { qc.invalidateQueries({ queryKey: ["ms-calendar-status"] }); };
  const connect = useMutation({
    mutationFn: (reconnect: boolean) => startFn({ data: { reconnect, returnTo: "calendar" } }),
    onSuccess: (r) => { if (r.url) window.location.assign(r.url); else refresh(); },
    onError: () => toast.error("Die Verbindung konnte nicht gestartet werden."),
  });
  const save = useMutation({
    mutationFn: () => saveFn({ data: { calendarId: pick, pushToOutlook: push, showBusy: busy } }),
    onSuccess: () => { setEditing(false); setJustSaved(true); refresh(); },
    onError: () => toast.error("Die Einstellungen konnten nicht gespeichert werden."),
  });
  const disc = useMutation({ mutationFn: () => discFn(), onSuccess: () => { toast.success("Verbindung getrennt."); setJustSaved(false); refresh(); }, onError: () => toast.error("Trennen fehlgeschlagen.") });
  const sync = useMutation({ mutationFn: () => syncFn(), onSuccess: (r) => { toast.success(r.queued ? "Synchronisierung angefordert." : "Eine Synchronisierung läuft bereits."); refresh(); }, onError: () => toast.error("Synchronisierung konnte nicht angefordert werden.") });

  const ret = returnCode ? RETURN_MSG[returnCode] : undefined;
  const connected = st === "connected" || st === "syncing";
  const isConnecting = connect.isPending || connect.isSuccess;

  let title = "Microsoft 365 verbinden";
  if (showPicker) title = "Kalender bestätigen";
  else if (justSaved && connected) title = "Verbindung eingerichtet";
  else if (connected || st === "reconnect_required" || st === "error") title = "Microsoft-Kalender";

  const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
    <div className="flex justify-between gap-4 py-1.5 text-sm"><dt className="text-muted-foreground">{k}</dt><dd className="truncate text-right font-medium">{v}</dd></div>
  );
  const syncLabel = st === "syncing" ? "Erste Synchronisierung läuft" : s?.lastSyncedAt ? "Kalender synchronisiert" : "Wartet auf Synchronisierung";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onOpenAutoFocus={(e) => { e.preventDefault(); primaryRef.current?.focus(); }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><CalendarSync className="h-5 w-5 text-primary" aria-hidden />{title}</DialogTitle>
          <DialogDescription className="sr-only">Microsoft-365-Kalender mit Immolia verbinden und verwalten</DialogDescription>
        </DialogHeader>

        {ret && (
          <div role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />{ret.text}
          </div>
        )}

        {status.isLoading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground" aria-live="polite"><Loader2 className="h-4 w-4 animate-spin" />Lädt…</div>
        ) : status.isError || !s ? (
          <p role="alert" className="text-sm text-destructive">Der Verbindungsstatus konnte nicht geladen werden.</p>
        ) : st === "configuration_required" ? (
          <p className="text-sm text-muted-foreground">Die Microsoft-Integration ist noch nicht eingerichtet. Bitte wende dich an den Plattform-Betreiber.</p>
        ) : st === "admin_approval_required" ? (
          <div className="space-y-3 text-sm">
            <p>Deine Microsoft-Organisation verlangt eine <strong>Administratorfreigabe</strong>. Eine Person mit Microsoft-Adminrechten muss Immolia einmalig freigeben.</p>
            <p className="text-muted-foreground">Erst danach erneut verbinden – ein weiterer Versuch vorher führt wieder zu dieser Meldung.</p>
          </div>
        ) : showPicker ? (
          <div className="space-y-4">
            <dl className="rounded-lg bg-muted/50 px-3 py-1"><Row k="Microsoft-Konto" v={s.account} /><Row k="Firma" v={s.agencyName ?? "–"} /></dl>
            <div className="space-y-1.5">
              <Label htmlFor="ms-cal">Kalender</Label>
              {cals.isLoading ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />Kalender werden geladen…</p>
                : cals.isError ? <p role="alert" className="text-sm text-destructive">Die Kalender konnten nicht geladen werden. Die Verbindung ist eventuell abgelaufen.</p>
                : (cals.data?.length ?? 0) === 0 ? <p role="alert" className="text-sm text-destructive">In deinem Microsoft-Konto wurde kein beschreibbarer Kalender gefunden.</p>
                : (
                  <Select value={pick} onValueChange={setPick}>
                    <SelectTrigger id="ms-cal"><SelectValue placeholder="Kalender wählen" /></SelectTrigger>
                    <SelectContent>{cals.data!.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}{c.isDefault ? " (Standard)" : ""}</SelectItem>)}</SelectContent>
                  </Select>
                )}
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3"><Label htmlFor="ms-push" className="font-normal">Immolia-Termine mit Outlook synchronisieren</Label><Switch id="ms-push" checked={push} onCheckedChange={setPush} /></div>
              <div className="flex items-center justify-between gap-3"><Label htmlFor="ms-busy" className="font-normal">Outlook-Belegungen in Immolia anzeigen</Label><Switch id="ms-busy" checked={busy} onCheckedChange={setBusy} /></div>
              <p className="text-xs text-muted-foreground">Externe Termine erscheinen als Beschäftigt. Private Inhalte werden nicht ins Team übernommen.</p>
            </div>
          </div>
        ) : connected ? (
          <div className="space-y-3">
            {justSaved && <p className="flex items-center gap-2 text-sm text-success"><CheckCircle2 className="h-4 w-4" aria-hidden />Einstellungen gespeichert.</p>}
            <dl className="rounded-lg bg-muted/50 px-3 py-1">
              <Row k="Konto" v={s.account} />
              <Row k="Kalender" v={s.calendarName} />
              <Row k="Firma" v={s.agencyName ?? "–"} />
              <Row k="Status" v={<span className={cn("inline-flex items-center gap-1.5", st === "syncing" ? "text-muted-foreground" : "text-success")} aria-live="polite">
                {st === "syncing" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <span className="h-2 w-2 rounded-full bg-success" />}{syncLabel}</span>} />
              <Row k="Letzte Synchronisierung" v={fmt(s.lastSyncedAt)} />
            </dl>
            {s.lastErrorCode === "token_refresh_transient" && <p className="text-xs text-muted-foreground">Vorübergehender Synchronisationsfehler – Immolia versucht es automatisch erneut.</p>}
          </div>
        ) : st === "reconnect_required" || st === "error" ? (
          <div className="space-y-3 text-sm">
            <p>{st === "reconnect_required" ? "Die Verbindung ist abgelaufen oder der Zugriff wurde widerrufen. Bitte verbinde dich erneut." : "Bei der Verbindung ist ein Fehler aufgetreten. Bitte verbinde dich erneut."}</p>
            {s.account && <dl className="rounded-lg bg-muted/50 px-3 py-1"><Row k="Konto" v={s.account} /><Row k="Kalender" v={s.calendarName ?? "–"} /></dl>}
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p>Verbinde deinen Microsoft-Kalender mit Immolia. Deine Verbindung gilt für dein Benutzerkonto in dieser Firma.</p>
            <dl className="rounded-lg bg-muted/50 px-3 py-1"><Row k="Aktuelle Firma" v={s.agencyName ?? "–"} /></dl>
            <p className="text-xs text-muted-foreground">Du wirst zur Microsoft-Anmeldung weitergeleitet und stimmst dort dem Zugriff zu.</p>
          </div>
        )}

        <DialogFooter className="flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          {s && !status.isLoading && (() => {
            if (st === "configuration_required") return <Button ref={primaryRef} variant="outline" onClick={() => onOpenChange(false)}>Schliessen</Button>;
            if (st === "admin_approval_required") return <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Schliessen</Button>
              <Button ref={primaryRef} variant="secondary" disabled={isConnecting} onClick={() => connect.mutate(true)}>Freigabe erteilt – erneut verbinden</Button></>;
            if (showPicker) return <>
              <Button variant="outline" onClick={() => editing ? setEditing(false) : onOpenChange(false)}>Abbrechen</Button>
              {cals.isError && <Button variant="secondary" disabled={isConnecting} onClick={() => connect.mutate(true)}>Erneut verbinden</Button>}
              <Button ref={primaryRef} disabled={!pick || save.isPending || cals.isLoading} onClick={() => save.mutate()}>
                {save.isPending && <Loader2 className="h-4 w-4 animate-spin" />}{editing ? "Speichern" : "Synchronisierung aktivieren"}</Button></>;
            if (connected) return <>
              <Button variant="ghost" className="text-destructive" disabled={disc.isPending} onClick={() => disc.mutate()}>Verbindung trennen</Button>
              <Button variant="outline" onClick={() => { setPick(""); setEditing(true); setJustSaved(false); }}>Einstellungen</Button>
              <Button variant="outline" disabled={sync.isPending || st === "syncing"} onClick={() => sync.mutate()}><RefreshCw className={cn("h-4 w-4", sync.isPending && "animate-spin")} />Jetzt synchronisieren</Button>
              {justSaved ? <Button ref={primaryRef} asChild onClick={() => onOpenChange(false)}><Link to="/appointments">Zum Kalender</Link></Button>
                : <Button ref={primaryRef} onClick={() => onOpenChange(false)}>Schliessen</Button>}</>;
            if (st === "reconnect_required" || st === "error") return <>
              {s.account && <Button variant="ghost" className="text-destructive" disabled={disc.isPending} onClick={() => disc.mutate()}>Verbindung trennen</Button>}
              <Button ref={primaryRef} disabled={isConnecting} onClick={() => connect.mutate(true)}>{isConnecting && <Loader2 className="h-4 w-4 animate-spin" />}Erneut verbinden</Button></>;
            return <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Abbrechen</Button>
              <Button ref={primaryRef} disabled={isConnecting} onClick={() => connect.mutate(false)}>{isConnecting && <Loader2 className="h-4 w-4 animate-spin" />}Mit Microsoft verbinden</Button></>;
          })()}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
