// Dialog "Deal erfassen / bearbeiten" – erfasst den kompletten Abschluss
// eines Objekts (Käufer, Verkaufspreis, Provision, Beteiligte, Finanzierung,
// Abschlussdatum) und kann bestehende Buchungen nachträglich korrigieren.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Info, Percent, Banknote, ChevronsUpDown, Check } from "lucide-react";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/format";
import { saveDeal } from "@/lib/commission.functions";
import { toastBooked } from "./commission-toast";
import { CommissionSplitEditor, useTeamProfiles, type SplitRow } from "./CommissionSplitEditor";
import { TypeCard } from "@/components/mandates/MandateWizard";

const ACTIVE_MANDATE = ["active", "signed", "sent"];
const today = () => new Date().toISOString().slice(0, 10);

export function DealDialog({
  open,
  onOpenChange,
  propertyId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  propertyId: string;
  onSaved?: () => void;
}) {
  const qc = useQueryClient();
  const save = useServerFn(saveDeal);
  const { data: profiles = [] } = useTeamProfiles();

  // Das Objekt kann im Dialog gewechselt werden (Preis wird dann übernommen).
  const [activeProperty, setActiveProperty] = useState(propertyId);
  useEffect(() => {
    if (open) setActiveProperty(propertyId);
  }, [open, propertyId]);

  const { data: propertyOptions = [] } = useQuery({
    queryKey: ["deal-property-options"],
    enabled: open,
    queryFn: async () => {
      const { data } = await supabase
        .from("properties")
        .select("id, title, price, rent, listing_type, status, reference_no")
        .order("created_at", { ascending: false })
        .limit(1000);
      return data ?? [];
    },
  });

  const { data } = useQuery({
    queryKey: ["deal-basis", activeProperty],
    enabled: open && !!activeProperty,
    queryFn: async () => {
      const propertyId = activeProperty;
      const [
        { data: property },
        { data: mandates },
        { data: records },
        { data: reservations },
        { data: plannedSplits },
        { data: dossiers },
        { data: clients },
      ] = await Promise.all([
        supabase
          .from("properties")
          .select("id, title, price, rent, listing_type, status, assigned_to, seller_client_id")
          .eq("id", propertyId)
          .maybeSingle(),
        supabase
          .from("mandates")
          .select("id, status, commission_model, commission_value, client_id")
          .eq("property_id", propertyId)
          .order("created_at", { ascending: false }),
        supabase
          .from("commission_records")
          .select("*")
          .eq("property_id", propertyId)
          .neq("status", "void"),
        supabase
          .from("reservations")
          .select("id, client_id, reservation_fee, status")
          .eq("property_id", propertyId)
          .order("created_at", { ascending: false }),
        supabase
          .from("mandate_commission_splits")
          .select("user_id, role, split_percent")
          .eq("property_id", propertyId),
        supabase
          .from("financing_dossiers")
          .select("id, requested_mortgage, purchase_price, property_value, dossier_status, financing_type")
          .eq("property_id", propertyId),
        supabase.from("clients").select("id, full_name").order("full_name"),
      ]);

      const deal = (records ?? []).find((r: any) => r.record_type === "commission") ?? null;
      const reservationFee = (records ?? []).find((r: any) => r.record_type === "reservation_fee") ?? null;

      let dealSplits: SplitRow[] = [];
      if (deal) {
        const { data: rows } = await supabase
          .from("commission_record_splits")
          .select("user_id, role, split_percent")
          .eq("commission_record_id", (deal as any).id);
        dealSplits = (rows ?? []).map((r: any) => ({
          user_id: r.user_id,
          role: r.role ?? "other",
          split_percent: Number(r.split_percent) || 0,
        }));
      }

      return {
        property,
        mandate:
          (mandates ?? []).find((m: any) => ACTIVE_MANDATE.includes(String(m.status))) ??
          (mandates ?? [])[0] ??
          null,
        deal,
        dealSplits,
        reservation: (reservations ?? [])[0] ?? null,
        reservationFee: reservationFee ? Number((reservationFee as any).gross_amount) : null,
        plannedSplits: (plannedSplits ?? []).map((r: any) => ({
          user_id: r.user_id,
          role: r.role ?? "other",
          split_percent: Number(r.split_percent) || 0,
        })) as SplitRow[],
        dossiers: dossiers ?? [],
        clients: clients ?? [],
      };
    },
  });

  const isEdit = !!data?.deal;

  // ---- Formularstate ----
  const [clientId, setClientId] = useState("");
  const [salePrice, setSalePrice] = useState("");
  const [model, setModel] = useState<"percent" | "fixed">("percent");
  const [value, setValue] = useState("3");
  const [override, setOverride] = useState("");
  const loadedOverride = useRef("");
  const [closedBy, setClosedBy] = useState("");
  const [splits, setSplits] = useState<SplitRow[]>([]);
  const [finMode, setFinMode] = useState<"none" | "dossier" | "manual">("none");
  const [dossierId, setDossierId] = useState("");
  const [finAmount, setFinAmount] = useState("");
  const [bookedAt, setBookedAt] = useState(today());
  const [notes, setNotes] = useState("");

  // Vorbelegung, sobald Daten geladen sind.
  useEffect(() => {
    if (!open || !data) return;
    const d: any = data.deal;
    const p: any = data.property;
    const m: any = data.mandate;
    setClientId(d?.client_id ?? data.reservation?.client_id ?? m?.client_id ?? "");
    const listPrice = p?.listing_type === "rent" ? p?.rent : p?.price;
    setSalePrice(String(d?.sale_price ?? listPrice ?? ""));
    setModel((m?.commission_model === "fixed" ? "fixed" : "percent") as "percent" | "fixed");
    setValue(String(m?.commission_value ?? (m?.commission_model === "fixed" ? "" : "3")));
    // Endbetrag nur vorbelegen, wenn er eine echte manuelle Abweichung war – sonst ist er
    // ein abgeleiteter Wert und muss bei Preis-/Satzänderung neu berechnet werden.
    {
      const mdl = m?.commission_model === "fixed" ? "fixed" : "percent";
      const v = Number(m?.commission_value ?? (mdl === "fixed" ? 0 : 3)) || 0;
      const pr = Number(d?.sale_price ?? listPrice) || 0;
      const calc = Math.round((mdl === "percent" ? (pr * v) / 100 : v) * 100) / 100;
      const stored = Number(d?.gross_amount) || 0;
      const manual = d && stored > 0 && Math.abs(stored - calc) > 0.005;
      setOverride(manual ? String(stored) : "");
      loadedOverride.current = manual ? String(stored) : "";
    }
    setClosedBy(d?.closed_by ?? p?.assigned_to ?? "");
    setSplits(
      data.dealSplits.length
        ? data.dealSplits
        : data.plannedSplits.length
          ? data.plannedSplits
          : p?.assigned_to
            ? [{ user_id: p.assigned_to, role: "listing_agent", split_percent: 100 }]
            : [],
    );
    if (d?.financing_dossier_id) {
      setFinMode("dossier");
      setDossierId(d.financing_dossier_id);
      setFinAmount("");
    } else if (d?.financing_amount) {
      setFinMode("manual");
      setFinAmount(String(Number(d.financing_amount)));
    } else {
      setFinMode("none");
      setDossierId("");
      setFinAmount("");
    }
    setBookedAt((d?.booked_at ?? "").slice(0, 10) || today());
    setNotes(d?.description && d.description !== "Abschlussprovision" ? d.description : "");
  }, [open, data]);

  // Ändert der Benutzer Preis/Satz/Modell, verliert ein nur übernommener alter Endbetrag seine Gültigkeit.
  useEffect(() => {
    if (loadedOverride.current && override === loadedOverride.current) setOverride("");
    loadedOverride.current = "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salePrice, value, model]);

  const computed = useMemo(() => {
    const price = Number(salePrice) || 0;
    const v = Number(value) || 0;
    return Math.round((model === "percent" ? (price * v) / 100 : v) * 100) / 100;
  }, [salePrice, value, model]);

  const names = new Map(profiles.map((p) => [p.id, p.full_name || p.email || "Unbekannt"]));

  const dossierAmount = (d: any) =>
    Number(d.requested_mortgage) || Number(d.purchase_price) || Number(d.property_value) || 0;

  const run = useMutation({
    mutationFn: async () => {
      const over = Number(override);
      const dossier = (data?.dossiers ?? []).find((d: any) => d.id === dossierId);
      return save({
        data: {
          propertyId: activeProperty,
          clientId: clientId || null,
          salePrice: Number(salePrice) || 0,
          commissionModel: model,
          commissionValue: Number(value) || 0,
          ...(over > 0 && over !== computed ? { finalCommissionAmount: over } : {}),
          financingAmount:
            finMode === "manual"
              ? Number(finAmount) || null
              : finMode === "dossier" && dossier
                ? dossierAmount(dossier) || null
                : null,
          financingDossierId: finMode === "dossier" && dossierId ? dossierId : null,
          closedBy: closedBy || null,
          splits: splits.filter((s) => s.user_id),
          bookedAt,
          notes: notes.trim() || undefined,
        },
      });
    },
    onSuccess: (record: any) => {
      toastBooked(record, names, isEdit ? "Deal aktualisiert" : "Deal erfasst", {
        salePrice: Number(salePrice) || null,
        financingAmount: record?.financing_amount != null ? Number(record.financing_amount) : null,
      });
      qc.invalidateQueries({ queryKey: ["commission-records"] });
      qc.invalidateQueries({ queryKey: ["commissions"] });
      qc.invalidateQueries({ queryKey: ["deal-basis", propertyId] });
      qc.invalidateQueries({ queryKey: ["property", propertyId] });
      qc.invalidateQueries({ queryKey: ["property_activities", propertyId] });
      qc.invalidateQueries({ queryKey: ["properties"] });
      onSaved?.();
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const gross = Number(override) > 0 ? Number(override) : computed;

  // Live-Aufteilung: was bekommt wer bei der aktuellen Eingabe?
  const breakdown = useMemo(() => {
    const rows = splits.filter((s) => s.user_id);
    const totalPct = rows.reduce((s, r) => s + (Number(r.split_percent) || 0), 0);
    return {
      totalPct,
      rows: rows.map((r) => {
        const prof: any = profiles.find((p: any) => p.id === r.user_id);
        const pct = Number(r.split_percent) || 0;
        const share = Math.round(((gross * pct) / 100) * 100) / 100;
        const rate = prof?.commission_payout_rate == null ? 50 : Number(prof.commission_payout_rate);
        return {
          key: r.user_id,
          name: prof?.full_name || prof?.email || "Unbekannt",
          pct,
          share,
          rate,
          payout: Math.round(((share * rate) / 100) * 100) / 100,
        };
      }),
    };
  }, [splits, profiles, gross]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[min(96vw,1100px)] max-w-none flex-col gap-3 overflow-hidden p-5">
        <DialogHeader className="space-y-0">
          <DialogTitle className="flex items-center gap-2 text-base">
            {isEdit ? "Deal bearbeiten" : "Deal erfassen"}
            {isEdit && (data?.deal as any)?.updated_at ? (
              <span className="text-xs font-normal text-muted-foreground">
                · zuletzt aktualisiert{" "}
                {new Date((data!.deal as any).updated_at).toLocaleDateString("de-CH")}
              </span>
            ) : null}
          </DialogTitle>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto text-sm lg:grid-cols-3 lg:overflow-visible">
          {/* Spalte 1: Eckdaten */}
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Objekt</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    className="h-9 w-full justify-between px-3 font-normal"
                  >
                    <span className="truncate">
                      {(() => {
                        const p: any = propertyOptions.find((o: any) => o.id === activeProperty);
                        if (!p) return "Objekt auswählen";
                        return `${p.reference_no ? `${p.reference_no} · ` : ""}${p.title}`;
                      })()}
                    </span>
                    <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                  <Command
                    filter={(value, search) => {
                      const term = search.toLowerCase();
                      const p: any = propertyOptions.find((o: any) => o.id === value);
                      if (!p) return 0;
                      const hay = `${p.title ?? ""} ${p.reference_no ?? ""}`.toLowerCase();
                      return hay.includes(term) ? 1 : 0;
                    }}
                  >
                    <CommandInput placeholder="Objekt suchen…" />
                    <CommandList>
                      <CommandEmpty>Kein Objekt gefunden.</CommandEmpty>
                      <CommandGroup>
                        {propertyOptions.map((p: any) => (
                          <CommandItem
                            key={p.id}
                            value={p.id}
                            onSelect={(v) => {
                              setActiveProperty(v);
                              const selected: any = propertyOptions.find((o: any) => o.id === v);
                              const listPrice =
                                selected?.listing_type === "rent" ? selected?.rent : selected?.price;
                              setSalePrice(listPrice != null ? String(listPrice) : "");
                              setOverride("");
                            }}
                          >
                            <Check
                              className={`mr-2 size-4 ${activeProperty === p.id ? "opacity-100" : "opacity-0"}`}
                            />
                            <span className="truncate">
                              {p.reference_no ? `${p.reference_no} · ` : ""}
                              {p.title}
                            </span>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
              <p className="mt-1 text-xs text-muted-foreground">
                Preis wird automatisch übernommen und kann angepasst werden.
              </p>
            </div>

            <div>
              <Label className="text-xs">Verkaufs-/Mietpreis (CHF)</Label>
              <Input
                className="h-9"
                type="number"
                step="1000"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <TypeCard
                icon={<Percent className="size-5" />}
                title="Prozent"
                description="Anteil vom Preis"
                selected={model === "percent"}
                onClick={() => setModel("percent")}
                compact
              />
              <TypeCard
                icon={<Banknote className="size-5" />}
                title="Pauschal"
                description="Fixer Betrag"
                selected={model === "fixed"}
                onClick={() => setModel("fixed")}
                compact
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">{model === "percent" ? "Provision (%)" : "Provision (CHF)"}</Label>
                <Input
                  className="h-9"
                  type="number"
                  step={model === "percent" ? "0.1" : "100"}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Endbetrag (optional)</Label>
                <Input
                  className="h-9"
                  type="number"
                  step="100"
                  placeholder={String(computed || "")}
                  value={override}
                  onChange={(e) => setOverride(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Abgeschlossen von</Label>
              <Select value={closedBy} onValueChange={setClosedBy}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Mitarbeiter auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.full_name || p.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Spalte 2: Beteiligte */}
          <div className="min-w-0 space-y-3">
            <CommissionSplitEditor rows={splits} onChange={setSplits} />
          </div>

          {/* Spalte 3: Ergebnis + Zusatzangaben */}
          <div className="space-y-3">
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Bruttoprovision</p>
              <p className="text-2xl font-bold tabular-nums text-primary">{formatCurrency(gross)}</p>
              {Number(override) > 0 && Number(override) !== computed ? (
                <p className="text-xs text-muted-foreground">
                  berechnet wären {formatCurrency(computed)}
                </p>
              ) : null}

              <div className="mt-3 space-y-1.5 border-t pt-2">
                {breakdown.rows.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Noch keine Beteiligten erfasst.</p>
                ) : (
                  breakdown.rows.map((r) => (
                    <div key={r.key} className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="truncate">
                        {r.name} <span className="text-muted-foreground">· {r.pct} %</span>
                      </span>
                      <span className="shrink-0 text-right tabular-nums">
                        <span className="font-semibold">{formatCurrency(r.share)}</span>
                        <span className="ml-1 text-muted-foreground">
                          (Auszahlung {formatCurrency(r.payout)})
                        </span>
                      </span>
                    </div>
                  ))
                )}
                {breakdown.rows.length > 0 && Math.abs(breakdown.totalPct - 100) > 0.01 && (
                  <p className="text-xs text-amber-600">
                    Summe der Anteile: {breakdown.totalPct.toFixed(1)} % statt 100 %.
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Abschlussdatum</Label>
                <Input className="h-9" type="date" value={bookedAt} onChange={(e) => setBookedAt(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Finanzierung</Label>
                <Select value={finMode} onValueChange={(v) => setFinMode(v as any)}>
                  <SelectTrigger className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Keine Angabe</SelectItem>
                    <SelectItem value="dossier">Dossier verknüpfen</SelectItem>
                    <SelectItem value="manual">Manueller Betrag</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {finMode === "dossier" && (
              <Select value={dossierId} onValueChange={setDossierId}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Dossier auswählen" />
                </SelectTrigger>
                <SelectContent>
                  {(data?.dossiers ?? []).map((d: any) => (
                    <SelectItem key={d.id} value={d.id}>
                      {formatCurrency(dossierAmount(d))} Hypothek — {d.dossier_status ?? "—"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {finMode === "manual" && (
              <Input
                className="h-9"
                type="number"
                step="1000"
                placeholder="Finanzierungsbetrag (CHF)"
                value={finAmount}
                onChange={(e) => setFinAmount(e.target.value)}
              />
            )}

            <div>
              <Label className="text-xs">Notizen</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            {data?.reservationFee ? (
              <p className="flex items-start gap-2 rounded-md bg-primary/10 p-2 text-xs text-primary">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Reservationsgebühr von {formatCurrency(data.reservationFee)} bereits gebucht – wird
                angerechnet.
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter className="border-t pt-3">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={() => run.mutate()} disabled={run.isPending || gross <= 0}>
            {run.isPending ? "Wird gespeichert…" : isEdit ? "Deal aktualisieren" : "Deal speichern"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
