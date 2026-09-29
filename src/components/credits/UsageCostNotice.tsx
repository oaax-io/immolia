import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Coins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getUsagePreview, type UsagePreview } from "@/lib/usage-preview.functions";
import { USAGE_LABELS, creditUxState } from "@/lib/credit-ux";

const fmt = (n: number) => n.toLocaleString("de-CH");

export function useUsagePreview(usageKey: string, enabled = true) {
  const fn = useServerFn(getUsagePreview);
  return useQuery({
    queryKey: ["usage", "preview", usageKey],
    queryFn: () => fn({ data: { usageKey } }),
    enabled,
    staleTime: 0,
  });
}

/** Label für den Aktionsknopf: Credit-Preis nur, wenn die Aktion wirklich Credits kostet. */
export function costButtonLabel(base: string, p?: UsagePreview) {
  return p?.result === "credit_required" && p.creditCost > 0 ? `${base} – ${fmt(p.creditCost)} Credits` : base;
}

export function isBlocked(p?: UsagePreview) {
  return p?.result === "insufficient_credits" || p?.result === "hard_blocked" || p?.result === "not_available";
}

/** Zentrale Anzeige vor einer gezählten Aktion (inklusive / Credits / zu wenig Credits). */
export function UsageCostNotice({ usageKey, preview }: { usageKey: string; preview?: UsagePreview }) {
  if (!preview || preview.result === "free") return null;
  const name = USAGE_LABELS[usageKey]?.plural ?? "Nutzung";
  const allowance = preview.included != null && preview.used != null
    ? <div>{fmt(preview.used)} / {fmt(preview.included)} {name} inklusive verwendet</div>
    : null;

  if (preview.priceMissing && preview.result !== "included") {
    return <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">{allowance}<div>Das inkludierte Kontingent ist ausgeschöpft. Für zusätzliche Nutzung ist noch kein Preis festgelegt.</div></div>;
  }
  if (preview.result === "included") {
    return <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">{allowance}</div>;
  }
  if (preview.result === "credit_required") {
    const low = creditUxState(preview.balance, preview.creditCost) === "low";
    return (
      <div className="space-y-1 rounded-md border bg-muted/40 p-3 text-sm">
        {allowance}
        <div className="flex items-center gap-1.5 font-medium"><Coins className="h-4 w-4 shrink-0" />Diese Erstellung kostet jetzt {fmt(preview.creditCost)} Credits.</div>
        {preview.balance != null && <div className="text-muted-foreground">Guthaben: {fmt(preview.balance)} Credits</div>}
        {low && <div className="text-muted-foreground">Dein Guthaben wird knapp. <Link to="/settings/billing" hash="credits" className="underline">Credits kaufen</Link></div>}
      </div>
    );
  }
  if (preview.result === "insufficient_credits") {
    return (
      <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
        {allowance}
        <div className="flex items-center gap-1.5 font-medium text-destructive"><AlertTriangle className="h-4 w-4 shrink-0" />Du hast nicht genügend Credits für diese Aktion.</div>
        {preview.priceMissing ? (
          <div className="text-muted-foreground">Für zusätzliche Nutzung ist noch kein Preis festgelegt.</div>
        ) : (
          <div className="text-muted-foreground">Benötigt: {fmt(preview.creditCost)} · Verfügbar: {fmt(preview.balance ?? 0)}</div>
        )}
        {!preview.priceMissing && (
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm"><Link to="/settings/billing" hash="credits">Credits kaufen</Link></Button>
            <Button asChild size="sm" variant="outline"><Link to="/settings/billing" hash="credits">Pakete ansehen</Link></Button>
          </div>
        )}
      </div>
    );
  }
  return <div className="rounded-md border p-3 text-sm text-muted-foreground">Diese Aktion ist derzeit nicht verfügbar.</div>;
}
