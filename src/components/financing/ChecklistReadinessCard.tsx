// Zeigt auf einen Blick, ob das Dossier bankreif ist und was noch fehlt.

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { CheckCircle2, AlertTriangle, Sparkles, Send, Loader2 } from "lucide-react";
import type { MissingItem } from "@/hooks/useChecklistAutofill";

type Props = {
  isReady: boolean;
  requiredPercent: number;
  requiredPresent: number;
  requiredTotal: number;
  missingRequired: MissingItem[];
  missingOptional?: MissingItem[];
  onJump?: (section: string) => void;
  /** Dossier wurde trotz fehlender Punkte manuell freigegeben. */
  isForced?: boolean;
  /** Manuelle Freigabe trotz fehlender Pflichtpunkte. */
  onForceSubmit?: () => Promise<void>;
};

export function ChecklistReadinessCard({
  isReady, requiredPercent, requiredPresent, requiredTotal, missingRequired, missingOptional = [], onJump, isForced, onForceSubmit,
}: Props) {
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  async function confirmForce() {
    if (!onForceSubmit) return;
    setBusy(true);
    try {
      await onForceSubmit();
      toast.success("Status manuell auf «Bereit für Bank» gesetzt");
      setOpen(false);
      setAck(false);
    } catch (e) {
      toast.error((e as Error).message ?? "Status konnte nicht gesetzt werden");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <Card className={isReady ? "border-emerald-500/50 bg-emerald-500/5" : "border-amber-500/50 bg-amber-500/5"}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isReady
              ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              : <AlertTriangle className="h-5 w-5 text-amber-600" />}
            <div>
              <p className="font-semibold">
                {isReady ? "Bereit für die Bank" : "Noch nicht bankreif"}
              </p>
              <p className="text-xs text-muted-foreground">
                {requiredPresent} von {requiredTotal} Pflichtpunkten erfüllt
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <Sparkles className="h-3 w-3" />automatisch geprüft
            </Badge>
            {!isReady && isForced && (
              <Badge variant="outline" className="border-amber-500/60 text-amber-700">
                Manuell freigegeben
              </Badge>
            )}
            {!isReady && !isForced && onForceSubmit && (
              <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
                <Send className="mr-1.5 h-4 w-4" />Trotzdem einreichen
              </Button>
            )}
          </div>
        </div>

        <Progress value={requiredPercent} className="h-2" />

        {missingRequired.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Das fehlt noch:</p>
            <div className="flex flex-wrap gap-2">
              {missingRequired.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => onJump?.(m.section)}
                  title={m.reason}
                  className="rounded-full border border-destructive/40 bg-destructive/10 px-3 py-1 text-xs text-destructive hover:bg-destructive/20"
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {missingOptional.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Optional offen: {missingOptional.slice(0, 6).map((m) => m.label).join(", ")}
            {missingOptional.length > 6 ? " …" : ""}
          </p>
        )}
      </CardContent>
    </Card>

    <Dialog open={open} onOpenChange={(o) => { if (!busy) { setOpen(o); if (!o) setAck(false); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dossier trotzdem einreichen?</DialogTitle>
          <DialogDescription>
            Es fehlen noch {missingRequired.length} Pflichtpunkt(e). Die Freigabe wird in der Aktivität protokolliert.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-48 list-disc space-y-1 overflow-auto rounded-md border bg-muted/30 p-3 pl-7 text-sm">
          {missingRequired.map((m) => <li key={m.key}>{m.label}</li>)}
        </ul>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <Checkbox checked={ack} onCheckedChange={(v) => setAck(v === true)} className="mt-0.5" />
          <span>Mir ist bewusst, dass diese Dokumente fehlen, und ich möchte das Dossier trotzdem der Bank einreichen.</span>
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Abbrechen</Button>
          <Button onClick={confirmForce} disabled={!ack || busy}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Auf «Bereit für Bank» setzen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
