import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Crown,
  Handshake,
  Building2,
  User,
  Percent,
  Eye,
  Send,
  FileText,
} from "lucide-react";
import { GeneratePdfButton } from "@/components/documents/GeneratePdfButton";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";
import {
  defaultTemplateForType,
  renderTemplate,
  wrapHtmlDocument,
  type TemplateContext,
} from "@/lib/document-templates";
import { resolveDocumentContext } from "@/lib/document-context";
import { formatCurrency } from "@/lib/format";
import {
  CommissionSplitEditor,
  useTeamProfiles,
  SPLIT_ROLE_LABELS,
  type SplitRow,
} from "@/components/commission/CommissionSplitEditor";

type MandateType = "exclusive" | "partial";

const STEPS = [
  "Mandatstyp",
  "Kunde",
  "Immobilie",
  "Provision",
  "Vorschau",
  "Speichern",
] as const;

const PERCENT_OPTIONS = [2.5, 3, 4, 5];

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (mandateId: string) => void;
};

export function MandateWizard({ open, onOpenChange, onCreated }: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();

  const [step, setStep] = useState(0);
  const [mandateType, setMandateType] = useState<MandateType>("exclusive");
  const [clientId, setClientId] = useState<string>("");
  const [propertyId, setPropertyId] = useState<string>("");
  const [commissionType, setCommissionType] = useState<"percent" | "fixed">("percent");
  const [commissionValue, setCommissionValue] = useState<string>("3");
  const [validFrom, setValidFrom] = useState<string>("");
  const [validUntil, setValidUntil] = useState<string>("");
  const [createdDocumentId, setCreatedDocumentId] = useState<string | null>(null);
  // Provisions-Erweiterungen (Etappe 2)
  const [cancellationFee, setCancellationFee] = useState<string>("");
  const [cancellationNotes, setCancellationNotes] = useState<string>("");
  const [splits, setSplits] = useState<SplitRow[]>([]);

  useEffect(() => {
    if (open) {
      setStep(0);
      setMandateType("exclusive");
      setClientId("");
      setPropertyId("");
      setCommissionType("percent");
      setCommissionValue("3");
      setValidFrom("");
      setValidUntil("");
      setCreatedDocumentId(null);
      setCancellationFee("");
      setCancellationNotes("");
      // Vorbelegung: aktuell eingeloggter Nutzer, Listing-Agent, 100 %
      setSplits(user?.id ? [{ user_id: user.id, role: "listing_agent", split_percent: 100 }] : []);
    }
  }, [open, user?.id]);

  const { data: clients = [] } = useQuery({
    queryKey: ["clients-for-mandate-wizard"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("id, full_name, email, phone, address, postal_code, city")
        .order("full_name");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: properties = [] } = useQuery({
    queryKey: ["properties-for-mandate-wizard"],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("id, title, address, postal_code, city, price, property_type")
        .order("title");
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: teamProfiles = [] } = useTeamProfiles();
  const splitNames = new Map(teamProfiles.map((p) => [p.id, p.full_name || p.email || "Mitarbeiter"]));

  const selectedClient = clients.find((c) => c.id === clientId);
  const selectedProperty = properties.find((p) => p.id === propertyId);

  const docKind = mandateType === "exclusive" ? "mandate" : "mandate_partial";

  const extraContext: Partial<TemplateContext> = useMemo(() => {
    const ptype = String(selectedProperty?.property_type ?? "");
    const checks: Record<string, boolean> = {
      house: ptype === "house",
      apartment: ptype === "apartment",
      multifamily: ptype === "mixed_use",
      commercial: ptype === "commercial",
      land: ptype === "land",
      other: !["house", "apartment", "mixed_use", "commercial", "land"].includes(ptype),
    };
    return {
      mandate: {
        commission_model: commissionType === "percent" ? "Prozent" : "Pauschal",
        commission_value: commissionValue
          ? commissionType === "percent"
            ? `${commissionValue} %`
            : (formatCurrency(Number(commissionValue)) ?? `${commissionValue} CHF`)
          : null,
        valid_from: validFrom || null,
        valid_until: validUntil || null,
        type: mandateType === "exclusive" ? "Exklusiv" : "Teilexklusiv",
      },
      checks,
    };
  }, [commissionType, commissionValue, validFrom, validUntil, mandateType, selectedProperty?.property_type]);

  const { data: ctx } = useQuery({
    queryKey: [
      "mandate-wizard-ctx",
      clientId,
      propertyId,
      commissionType,
      commissionValue,
      validFrom,
      validUntil,
      mandateType,
    ],
    enabled: open && step >= 4 && !!clientId && !!propertyId,
    queryFn: () =>
      resolveDocumentContext({
        clientId,
        propertyId,
        overrides: extraContext,
      }),
  });

  // Vertragstext kommt ausschliesslich aus einer Vorlage der aktiven Firma
  // (RLS: current_agency_id). Kein Code-Fallback auf fremde/ASIMO-Texte.
  const { data: tenantTemplate, isLoading: tplLoading } = useQuery({
    queryKey: ["mandate-wizard-template", docKind],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_templates")
        .select("id, name, content, is_default")
        .eq("type", docKind as never)
        .eq("is_active", true)
        .order("is_default", { ascending: false })
        .order("name")
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data && data.content?.trim() ? data : null;
    },
  });
  const missingTemplate = open && !tplLoading && !tenantTemplate;

  const previewHtml = useMemo(() => {
    if (!ctx || !tenantTemplate) return "";
    return wrapHtmlDocument(
      mandateType === "exclusive" ? "Maklermandat (exklusiv)" : "Maklermandat (teilexklusiv)",
      renderTemplate(tenantTemplate.content, ctx),
      ctx.brand,
    );
  }, [ctx, tenantTemplate, mandateType]);

  const create = useMutation({
    mutationFn: async () => {
      if (!clientId || !propertyId) throw new Error("Kunde und Immobilie sind erforderlich");
      if (!commissionValue) throw new Error("Provision fehlt");
      if (!tenantTemplate || !previewHtml)
        throw new Error("Keine Mandatsvorlage vorhanden. Bitte unter Einstellungen → Dokumentvorlagen eine Vorlage erstellen.");

      // Validierung VOR jeder Speicherung: leere Zeilen (ohne Person und ohne Anteil) ignorieren,
      // Zeilen mit Person, aber 0 % bzw. > 100 % → Korrektur verlangen.
      const cleanSplits = splits.filter((r) => r.user_id || Number(r.split_percent) > 0);
      if (cleanSplits.some((r) => !r.user_id)) throw new Error("Bitte jeder Aufteilungszeile eine Person zuweisen oder die Zeile entfernen.");
      if (cleanSplits.some((r) => !(Number(r.split_percent) > 0) || Number(r.split_percent) > 100))
        throw new Error("Jeder Anteil muss grösser als 0 % und höchstens 100 % sein. Bitte korrigieren oder die Zeile entfernen.");

      // Mandat + Aufteilung + Dokument atomar in einer Transaktion (kein halbes Mandat).
      const { data, error } = await supabase.rpc("create_mandate_atomic" as any, {
        _mandate: {
          client_id: clientId,
          property_id: propertyId,
          commission_model: commissionType,
          commission_value: Number(commissionValue),
          valid_from: validFrom || null,
          valid_until: validUntil || null,
          mandate_type: mandateType,
          cancellation_fee: cancellationFee ? Number(cancellationFee) : null,
          cancellation_fee_notes: cancellationNotes.trim() || null,
        },
        _splits: cleanSplits.map((r) => ({ user_id: r.user_id, role: r.role, split_percent: Number(r.split_percent) })),
        _doc: {
          html_content: previewHtml,
          variables: JSON.parse(JSON.stringify(ctx ?? {})),
          title: mandateType === "exclusive" ? "Maklermandat (exklusiv)" : "Maklermandat (teilexklusiv)",
          document_type: docKind,
        },
      });
      if (error) throw error;
      const res = data as { mandate_id: string; document_id: string };
      return { mandateId: res.mandate_id, documentId: res.document_id };
    },
    onSuccess: ({ mandateId, documentId }) => {
      toast.success("Mandat gespeichert – PDF kann jetzt generiert werden");
      setCreatedDocumentId(documentId);
      qc.invalidateQueries({ queryKey: ["mandates"] });
      qc.invalidateQueries({ queryKey: ["generated-documents"] });
      qc.invalidateQueries({ queryKey: ["documents"] });
      onCreated?.(mandateId);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const canNext = (() => {
    if (step === 0) return !!mandateType;
    if (step === 1) return !!clientId;
    if (step === 2) return !!propertyId;
    if (step === 3) return !!commissionValue && Number(commissionValue) > 0;
    if (step === 4) return !!ctx;
    return true;
  })();

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  const progress = ((step + 1) / STEPS.length) * 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="size-5" /> Mandat-Assistent
          </DialogTitle>
        </DialogHeader>

        {/* Progress */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Schritt {step + 1} von {STEPS.length}: <span className="font-medium text-foreground">{STEPS[step]}</span>
            </span>
            <span>{Math.round(progress)} %</span>
          </div>
          <Progress value={progress} />
        </div>

        <div className="min-h-[420px] py-2">
          {/* STEP 0: Type */}
          {step === 0 && (
            <div className="grid gap-4 md:grid-cols-2">
              <TypeCard
                icon={<Crown className="size-8" />}
                title="Exklusiv"
                description="Alleiniger Vermarktungsauftrag. Nur der Makler darf das Objekt vermitteln. Höchste Provisionsklarheit."
                selected={mandateType === "exclusive"}
                onClick={() => setMandateType("exclusive")}
              />
              <TypeCard
                icon={<Handshake className="size-8" />}
                title="Teilexklusiv"
                description="Makler vermarktet exklusiv, der Eigentümer darf jedoch eigene Käufer ohne Provision vermitteln."
                selected={mandateType === "partial"}
                onClick={() => setMandateType("partial")}
              />
            </div>
          )}

          {/* STEP 1: Client */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <Label>Auftraggeber / Kunde</Label>
                <Select value={clientId} onValueChange={setClientId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Kunde auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.full_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedClient && (
                <DataSummary
                  icon={<User className="size-4" />}
                  title="Übernommene Kundendaten"
                  rows={[
                    ["Name", selectedClient.full_name],
                    ["E-Mail", selectedClient.email],
                    ["Telefon", selectedClient.phone],
                    [
                      "Adresse",
                      [selectedClient.address, selectedClient.postal_code, selectedClient.city]
                        .filter(Boolean)
                        .join(", "),
                    ],
                  ]}
                />
              )}
            </div>
          )}

          {/* STEP 2: Property */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <Label>Immobilie</Label>
                <Select value={propertyId} onValueChange={setPropertyId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Immobilie auswählen" />
                  </SelectTrigger>
                  <SelectContent>
                    {properties.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedProperty && (
                <DataSummary
                  icon={<Building2 className="size-4" />}
                  title="Übernommene Objektdaten"
                  rows={[
                    ["Titel", selectedProperty.title],
                    [
                      "Adresse",
                      [selectedProperty.address, selectedProperty.postal_code, selectedProperty.city]
                        .filter(Boolean)
                        .join(", "),
                    ],
                    ["Typ", selectedProperty.property_type],
                    [
                      "Preis",
                      selectedProperty.price != null
                        ? (formatCurrency(Number(selectedProperty.price)) ?? String(selectedProperty.price))
                        : "—",
                    ],
                  ]}
                />
              )}
            </div>
          )}

          {/* STEP 3: Commission */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2">
                <TypeCard
                  icon={<Percent className="size-6" />}
                  title="Prozent"
                  description="Provision als prozentualer Anteil vom Verkaufspreis."
                  selected={commissionType === "percent"}
                  onClick={() => {
                    setCommissionType("percent");
                    setCommissionValue("3");
                  }}
                  compact
                />
                <TypeCard
                  icon={<Banknote />}
                  title="Pauschal"
                  description="Fester Betrag in CHF, unabhängig vom Verkaufspreis."
                  selected={commissionType === "fixed"}
                  onClick={() => {
                    setCommissionType("fixed");
                    setCommissionValue("");
                  }}
                  compact
                />
              </div>

              {commissionType === "percent" ? (
                <div>
                  <Label>Provisionssatz</Label>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {PERCENT_OPTIONS.map((p) => (
                      <Button
                        key={p}
                        variant={Number(commissionValue) === p ? "default" : "outline"}
                        size="sm"
                        onClick={() => setCommissionValue(String(p))}
                      >
                        {p} %
                      </Button>
                    ))}
                    <Input
                      type="number"
                      step="0.1"
                      placeholder="Eigener Wert"
                      className="w-32"
                      value={commissionValue}
                      onChange={(e) => setCommissionValue(e.target.value)}
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <Label>Pauschalbetrag (CHF)</Label>
                  <Input
                    type="number"
                    step="100"
                    placeholder="z. B. 25000"
                    value={commissionValue}
                    onChange={(e) => setCommissionValue(e.target.value)}
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Gültig ab</Label>
                  <Input
                    type="date"
                    value={validFrom}
                    onChange={(e) => setValidFrom(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Gültig bis</Label>
                  <Input
                    type="date"
                    value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div>
                  <Label>Rücktritts-/Kündigungsentschädigung (CHF, fix)</Label>
                  <Input
                    type="number"
                    step="100"
                    placeholder="z. B. 5000"
                    value={cancellationFee}
                    onChange={(e) => setCancellationFee(e.target.value)}
                  />
                </div>
                <div>
                  <Label>Notiz zur Entschädigung (optional)</Label>
                  <Input
                    value={cancellationNotes}
                    onChange={(e) => setCancellationNotes(e.target.value)}
                    placeholder="z. B. bei Rücktritt vor Ablauf"
                  />
                </div>
              </div>

              <CommissionSplitEditor rows={splits} onChange={setSplits} />
            </div>
          )}

          {/* STEP 4: Preview */}
          {step === 4 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Eye className="size-4" /> Live-Vorschau
                </div>
                <GeneratePdfButton
                  html={previewHtml}
                  title={mandateType === "exclusive" ? "Maklermandat (exklusiv)" : "Maklermandat (teilexklusiv)"}
                  documentId={createdDocumentId}
                  documentType={mandateType === "exclusive" ? "mandate" : "mandate_partial"}
                  clientName={selectedClient?.full_name ?? null}
                  propertyTitle={selectedProperty?.title ?? null}
                  variant="outline"
                  size="sm"
                  disabled={!createdDocumentId}
                />
              </div>
              {missingTemplate ? (
                <div className="rounded-md border border-destructive/40 bg-destructive/5 p-6 text-sm">
                  <div className="font-medium text-foreground">
                    Keine {mandateType === "exclusive" ? "exklusive" : "teilexklusive"} Mandatsvorlage vorhanden
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    Bitte unter Einstellungen → Dokumentvorlagen eine Vorlage erstellen oder aktivieren. Ohne Vorlage kann kein Mandat gespeichert werden.
                  </p>
                </div>
              ) : previewHtml ? (
                <iframe
                  title="Vorschau"
                  srcDoc={previewHtml}
                  className="h-[55vh] w-full rounded-md border bg-white"
                />
              ) : (
                <div className="rounded-md border bg-muted/30 p-6 text-sm text-muted-foreground">
                  Vorschau wird geladen…
                </div>
              )}
            </div>
          )}

          {/* STEP 5: Save */}
          {step === 5 && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/20 p-4 text-sm">
                <p className="font-medium">Zusammenfassung</p>
                <ul className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-2">
                  <li>
                    Typ:{" "}
                    <span className="text-foreground">
                      {mandateType === "exclusive" ? "Exklusiv" : "Teilexklusiv"}
                    </span>
                  </li>
                  <li>
                    Kunde: <span className="text-foreground">{selectedClient?.full_name ?? "—"}</span>
                  </li>
                  <li>
                    Objekt: <span className="text-foreground">{selectedProperty?.title ?? "—"}</span>
                  </li>
                  <li>
                    Provision:{" "}
                    <span className="text-foreground">
                      {commissionValue}
                      {commissionType === "percent" ? " %" : " CHF"}
                    </span>
                  </li>
                  <li>
                    Gültig: <span className="text-foreground">{validFrom || "—"} bis {validUntil || "offen"}</span>
                  </li>
                  <li>
                    Rücktrittsentschädigung:{" "}
                    <span className="text-foreground">
                      {cancellationFee ? (formatCurrency(Number(cancellationFee)) ?? `${cancellationFee} CHF`) : "—"}
                    </span>
                  </li>
                </ul>
                <p className="mt-3 font-medium">Aufteilung</p>
                <ul className="mt-1 grid gap-1 text-muted-foreground sm:grid-cols-2">
                  {splits.filter((s) => s.user_id).length === 0 && <li>—</li>}
                  {splits
                    .filter((s) => s.user_id)
                    .map((s, i) => (
                      <li key={i}>
                        {splitNames.get(s.user_id) ?? "Mitarbeiter"} –{" "}
                        <span className="text-foreground">
                          {SPLIT_ROLE_LABELS[s.role] ?? s.role}, {s.split_percent} %
                        </span>
                      </li>
                    ))}
                </ul>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => create.mutate()}
                  disabled={create.isPending || !!createdDocumentId || missingTemplate}
                >
                  <Check className="mr-2 size-4" />
                  {createdDocumentId
                    ? "Mandat gespeichert"
                    : create.isPending
                    ? "Wird gespeichert…"
                    : "Mandat speichern"}
                </Button>
                <GeneratePdfButton
                  html={previewHtml}
                  title={mandateType === "exclusive" ? "Maklermandat (exklusiv)" : "Maklermandat (teilexklusiv)"}
                  documentId={createdDocumentId}
                  documentType={mandateType === "exclusive" ? "mandate" : "mandate_partial"}
                  clientName={selectedClient?.full_name ?? null}
                  propertyTitle={selectedProperty?.title ?? null}
                  variant="outline"
                  disabled={!createdDocumentId}
                />
                <Button
                  variant="outline"
                  onClick={() => toast.info("Versand-Funktion folgt (E-Sign-Integration vorbereitet)")}
                  disabled={!createdDocumentId}
                >
                  <Send className="mr-2 size-4" /> Senden
                </Button>
                {createdDocumentId && (
                  <Button variant="ghost" onClick={() => onOpenChange(false)}>
                    Schliessen
                  </Button>
                )}
              </div>
              {!createdDocumentId && (
                <p className="text-xs text-muted-foreground">
                  Speichere das Mandat zuerst, danach kannst du das PDF generieren und es erscheint im Dokumentencenter.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t pt-3">
          <Button variant="ghost" onClick={back} disabled={step === 0}>
            <ChevronLeft className="mr-1 size-4" /> Zurück
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Abbrechen
            </Button>
            {step < STEPS.length - 1 && (
              <Button onClick={next} disabled={!canNext}>
                Weiter <ChevronRight className="ml-1 size-4" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TypeCard({
  icon,
  title,
  description,
  selected,
  onClick,
  compact,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  selected: boolean;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col items-start gap-3 rounded-xl border-2 bg-card text-left transition-all hover:shadow-md",
        compact ? "p-4" : "p-6",
        selected
          ? "border-primary bg-primary/5 shadow-sm"
          : "border-border hover:border-primary/50",
      )}
    >
      <div
        className={cn(
          "flex size-12 items-center justify-center rounded-lg transition-colors",
          selected ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
        )}
      >
        {icon}
      </div>
      <div>
        <h3 className="text-base font-semibold">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {selected && (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary">
          <Check className="size-3.5" /> Ausgewählt
        </span>
      )}
    </button>
  );
}

function DataSummary({
  icon,
  title,
  rows,
}: {
  icon: React.ReactNode;
  title: string;
  rows: Array<[string, string | null | undefined]>;
}) {
  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        {icon} {title}
      </div>
      <dl className="grid gap-1 text-sm sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-3 border-b border-border/50 py-1 last:border-0">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className={v ? "text-foreground" : "text-muted-foreground"}>{v || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Banknote() {
  // simple inline icon to avoid an extra import
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-6"
    >
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 12h.01M18 12h.01" />
    </svg>
  );
}
