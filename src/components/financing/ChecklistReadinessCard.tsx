// Zeigt auf einen Blick, ob das Dossier bankreif ist und was noch fehlt.

import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, AlertTriangle, Sparkles } from "lucide-react";
import type { MissingItem } from "@/hooks/useChecklistAutofill";

type Props = {
  isReady: boolean;
  requiredPercent: number;
  requiredPresent: number;
  requiredTotal: number;
  missingRequired: MissingItem[];
  missingOptional?: MissingItem[];
  onJump?: (section: string) => void;
};

export function ChecklistReadinessCard({
  isReady, requiredPercent, requiredPresent, requiredTotal, missingRequired, missingOptional = [], onJump,
}: Props) {
  return (
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
          <Badge variant="secondary" className="gap-1">
            <Sparkles className="h-3 w-3" />automatisch geprüft
          </Badge>
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
  );
}
