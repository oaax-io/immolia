// Immobilien-Wechsel im Finanzierungsdossier: schlägt passende Objekte vor,
// simuliert die Finanzierbarkeit und verlangt eine ausdrückliche Bestätigung.
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { PropertyPhoto } from "@/components/properties/PropertyPhoto";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { calcQuickCheck, QUICK_CHECK_LABELS, type QuickCheckResult } from "@/lib/financing";
import { scoreMatch } from "@/lib/matching";
import { logActivity } from "@/components/ActivityTab";
import { toast } from "sonner";
import { ArrowRight, Building2, Search, Sparkles } from "lucide-react";

const OPEN_STATUSES = ["available", "draft", "preparation", "reserved"] as const;

function num(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(n) ? n : fallback;
}

function combinedIncome(d: any): number {
  const extras = Array.isArray(d?.additional_co_applicants)
    ? d.additional_co_applicants.reduce((s: number, a: any) => s + num(a?.einkommen), 0)
    : 0;
  return Math.max(
    num(d?.einkommen_kombiniert),
    num(d?.gross_income_yearly) + num(d?.co_applicant_einkommen) + extras,
  );
}

function simulate(dossier: any, price: number): QuickCheckResult {
  const equity = num(dossier?.own_funds_total);
  const reno = num(dossier?.renovation_costs);
  const mortgage = Math.max(0, price + reno - equity);
  return calcQuickCheck({
    purchase_price: price,
    renovation_costs: reno,
    requested_mortgage: mortgage,
    own_funds_total: equity,
    own_funds_pension_fund: num(dossier?.own_funds_pension_fund),
    own_funds_vested_benefits: num(dossier?.own_funds_vested_benefits),
    gross_income_yearly: combinedIncome(dossier),
    calculated_interest_rate: num(dossier?.calculated_interest_rate, 5),
  });
}

const toneClass = (s: string) =>
  s === "realistic" ? "bg-emerald-100 text-emerald-800 border-emerald-200"
  : s === "critical" ? "bg-amber-100 text-amber-800 border-amber-200"
  : s === "not_financeable" ? "bg-red-100 text-red-800 border-red-200"
  : "bg-muted text-muted-foreground";

export function PropertySwitchDialog({
  open, onOpenChange, dossier,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  dossier: any;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [recalc, setRecalc] = useState(true);
  const [adoptPrice, setAdoptPrice] = useState(true);

  const { data: client } = useQuery({
    queryKey: ["financing_switch_client", dossier?.client_id],
    enabled: open && !!dossier?.client_id,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("id", dossier.client_id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: properties = [], isLoading } = useQuery({
    queryKey: ["financing_switch_properties"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("*")
        .in("status", OPEN_STATUSES)
        .order("updated_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return data ?? [];
    },
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (properties as any[])
      .filter((p) => p.id !== dossier?.property_id)
      .filter((p) => !q || [p.title, p.city, p.address, p.zip].filter(Boolean).some((v: string) => String(v).toLowerCase().includes(q)))
      .map((p) => {
        const price = num(p.price) || num(p.rent);
        const sim = simulate(dossier, price);
        const match = client ? scoreMatch(client as any, p as any, null) : null;
        const rank = (sim.status === "realistic" ? 2 : sim.status === "critical" ? 1 : 0) * 1000 + (match?.score ?? 0);
        return { property: p, price, sim, match, rank };
      })
      .sort((a, b) => b.rank - a.rank)
      .slice(0, 60);
  }, [properties, search, dossier, client]);

  const selected = rows.find((r) => r.property.id === selectedId) ?? null;
  const currentPrice = num(dossier?.purchase_price);

  const switchMutation = useMutation({
    mutationFn: async () => {
      if (!selected) return;
      const update: Record<string, any> = { property_id: selected.property.id };
      if (adoptPrice && selected.price > 0) update.purchase_price = selected.price;
      if (recalc && selected.price > 0) {
        const sim = selected.sim;
        update.requested_mortgage = Math.max(0, selected.price + num(dossier?.renovation_costs) - num(dossier?.own_funds_total));
        update.total_investment = sim.total_investment;
        update.loan_to_value_ratio = sim.loan_to_value_ratio;
        update.affordability_ratio = sim.affordability_ratio;
        update.quick_check_status = sim.status;
        update.quick_check_reasons = sim.reasons;
      }
      const { error } = await supabase.from("financing_dossiers").update(update as never).eq("id", dossier.id);
      if (error) throw error;
      await logActivity({
        relatedType: "financing_dossier",
        relatedId: dossier.id,
        action: `Immobilie gewechselt: ${dossier?.properties?.title ?? "keine"} → ${selected.property.title}`,
        metadata: {
          kind: "financing_property_switch",
          from_property_id: dossier?.property_id ?? null,
          to_property_id: selected.property.id,
          price_adopted: adoptPrice,
          recalculated: recalc,
          quick_check_status: recalc ? selected.sim.status : undefined,
        },
      } as any);
    },
    onSuccess: () => {
      toast.success("Immobilie im Dossier gewechselt");
      onOpenChange(false);
      setSelectedId(null);
      setConfirmed(false);
      queryClient.invalidateQueries({ queryKey: ["financing_dossier", dossier.id] });
      queryClient.invalidateQueries({ queryKey: ["financing_dossiers"] });
      queryClient.invalidateQueries({ queryKey: ["activity_logs", "financing_dossier", dossier.id] });
      queryClient.invalidateQueries({ queryKey: ["financing_checklist", dossier.id] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Wechsel fehlgeschlagen"),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setSelectedId(null); setConfirmed(false); } }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Mögliche Immobilien für diese Finanzierung
          </DialogTitle>
          <DialogDescription>
            Vorschläge nach Finanzierbarkeit (Eigenmittel {formatCurrency(num(dossier?.own_funds_total))}, Einkommen {formatCurrency(combinedIncome(dossier))}) und Suchprofil der Kundschaft. Der Wechsel wird erst nach Ihrer Bestätigung gespeichert.
          </DialogDescription>
        </DialogHeader>

        {!selected ? (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Objekt, Ort oder PLZ suchen" className="pl-8" />
            </div>
            <ScrollArea className="h-[420px] pr-3">
              {isLoading ? (
                <p className="text-sm text-muted-foreground">Objekte werden geladen …</p>
              ) : rows.length === 0 ? (
                <p className="text-sm text-muted-foreground">Keine weiteren Objekte gefunden.</p>
              ) : (
                <div className="space-y-2">
                  {rows.map(({ property, price, sim, match }) => (
                    <button
                      key={property.id}
                      type="button"
                      onClick={() => setSelectedId(property.id)}
                      className="flex w-full items-center gap-3 rounded-xl border p-2 text-left transition hover:border-primary/50 hover:bg-muted/60"
                    >
                      <div className="h-14 w-20 shrink-0 overflow-hidden rounded-lg bg-muted">
                        <PropertyPhoto sources={property.images} alt={property.title} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{property.title}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {[property.address, [property.zip, property.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "—"}
                        </p>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <Badge variant="outline" className={cn("text-[10px]", toneClass(sim.status))}>
                            {QUICK_CHECK_LABELS[sim.status]}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground tabular-nums">
                            Belehnung {sim.loan_to_value_ratio.toFixed(0)}% · Tragbarkeit {sim.affordability_ratio.toFixed(0)}%
                          </span>
                          {match && <span className="text-[11px] text-muted-foreground">· Passung {match.score}%</span>}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold tabular-nums">{price > 0 ? formatCurrency(price) : "—"}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <div className="rounded-xl border p-3">
                <p className="text-xs text-muted-foreground">Bisher</p>
                <p className="flex items-center gap-1.5 text-sm font-medium"><Building2 className="h-4 w-4" />{dossier?.properties?.title ?? "Keine Immobilie"}</p>
                <p className="text-xs text-muted-foreground tabular-nums">{currentPrice > 0 ? formatCurrency(currentPrice) : "—"}</p>
              </div>
              <ArrowRight className="mx-auto hidden h-4 w-4 text-muted-foreground sm:block" />
              <div className="rounded-xl border border-primary/40 bg-primary/5 p-3">
                <p className="text-xs text-muted-foreground">Neu</p>
                <p className="text-sm font-medium">{selected.property.title}</p>
                <p className="text-xs text-muted-foreground tabular-nums">{selected.price > 0 ? formatCurrency(selected.price) : "—"}</p>
              </div>
            </div>

            <div className="rounded-xl border p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={toneClass(selected.sim.status)}>{QUICK_CHECK_LABELS[selected.sim.status]}</Badge>
                <span className="text-xs text-muted-foreground tabular-nums">
                  Belehnung {selected.sim.loan_to_value_ratio.toFixed(1)}% · Tragbarkeit {selected.sim.affordability_ratio.toFixed(1)}% · Eigenmittel {formatCurrency(num(dossier?.own_funds_total))}
                </span>
              </div>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {selected.sim.reasons.map((r) => <li key={r.key}>• {r.label}</li>)}
              </ul>
            </div>

            <div className="space-y-2">
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={adoptPrice} onCheckedChange={(v) => setAdoptPrice(v === true)} />
                <span>Kaufpreis aus dem Objekt übernehmen {selected.price > 0 ? `(${formatCurrency(selected.price)})` : ""}</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox checked={recalc} onCheckedChange={(v) => setRecalc(v === true)} />
                <span>Hypothek, Belehnung, Tragbarkeit und Vorprüfung automatisch neu berechnen</span>
              </label>
              <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                <Checkbox checked={confirmed} onCheckedChange={(v) => setConfirmed(v === true)} />
                <span>Ich bestätige den Wechsel der Immobilie in diesem Finanzierungsdossier.</span>
              </label>
            </div>
          </div>
        )}

        <DialogFooter>
          {selected ? (
            <>
              <Button variant="outline" onClick={() => { setSelectedId(null); setConfirmed(false); }}>Zurück</Button>
              <Button disabled={!confirmed || switchMutation.isPending} onClick={() => switchMutation.mutate()}>
                {switchMutation.isPending ? "Wird gespeichert …" : "Immobilie wechseln"}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>Schliessen</Button>
          )}
        </DialogFooter>
        <Label className="sr-only">Immobilienwechsel</Label>
      </DialogContent>
    </Dialog>
  );
}
