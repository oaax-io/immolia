import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ArrowLeft, User, Building2, Banknote, RotateCcw, ArrowUp, ArrowDown, Trash2, FileText, ChevronRight, ClipboardCheck, Calculator, LineChart, Sparkles } from "lucide-react";
import { ClientDetailDialog } from "@/components/clients/ClientDetailDialog";
import { PropertySwitchDialog } from "@/components/financing/PropertySwitchDialog";
import { formatCurrency } from "@/lib/format";
import { expenseFields, expenseLabels } from "@/lib/self-disclosure";
import {
  FINANCING_TYPE_LABELS, DOSSIER_STATUS_LABELS, QUICK_CHECK_LABELS, displayQuickCheckStatus,
  calcQuickCheck, isRefinancingDossier,
  type FinancingType, type DossierStatus, type QuickCheckStatus,
} from "@/lib/financing";
import { cn } from "@/lib/utils";
import { FinancingSelfDisclosureTab } from "@/components/financing/FinancingSelfDisclosureTab";
import { UbsChecklistTab } from "@/components/financing/UbsChecklistTab";
import { FinancingDocumentsTab } from "@/components/financing/FinancingDocumentsTab";
import { BankSubmissionTab } from "@/components/financing/BankSubmissionTab";
import { DossierQualityCard } from "@/components/financing/DossierQualityCard";
import { FinancingReportPreviewDialog } from "@/components/financing/FinancingReportPreviewDialog";
import { FinancingQuickCheckWizard } from "@/components/financing/FinancingQuickCheckWizard";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { ActivityTab, logActivity } from "@/components/ActivityTab";

export const Route = createFileRoute("/_app/financing/$id")({ component: FinancingDetailPage });

function FinancingDetailPage() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const [resetOpen, setResetOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [openClientId, setOpenClientId] = useState<string | null>(null);
  const [switchOpen, setSwitchOpen] = useState(false);

  const { data: dossier, isLoading } = useQuery({
    queryKey: ["financing_dossier", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financing_dossiers")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      const additionalApplicants = Array.isArray((data as any).additional_co_applicants) ? (data as any).additional_co_applicants : [];
      const applicantIds = Array.from(new Set([
        data.client_id,
        (data as any).co_applicant_client_id,
        ...additionalApplicants.map((a: any) => a?.client_id),
      ].filter(Boolean))) as string[];
      const [clientRes, propRes, coRes, applicantClientsRes, disclosuresRes, relationshipsRes] = await Promise.all([
        data.client_id
          ? supabase.from("clients").select("id, full_name, email, phone").eq("id", data.client_id).maybeSingle()
          : Promise.resolve({ data: null }),
        data.property_id
          ? supabase.from("properties").select("id, title, city, price").eq("id", data.property_id).maybeSingle()
          : Promise.resolve({ data: null }),
        (data as { co_applicant_client_id?: string | null }).co_applicant_client_id
          ? supabase.from("clients").select("id, full_name").eq("id", (data as { co_applicant_client_id: string }).co_applicant_client_id).maybeSingle()
          : Promise.resolve({ data: null }),
        applicantIds.length > 0
          ? supabase.from("clients").select("id, full_name").in("id", applicantIds)
          : Promise.resolve({ data: [] }),
        applicantIds.length > 0
          ? supabase.from("client_self_disclosures").select(`client_id, ${expenseFields.join(", ")}`).in("client_id", applicantIds)
          : Promise.resolve({ data: [] }),
        data.client_id
          ? supabase.from("client_relationships")
              .select("id, client_id, related_client_id, relationship_type, notes, related:clients!client_relationships_related_client_id_fkey(id, full_name)")
              .or(`client_id.eq.${data.client_id},related_client_id.eq.${data.client_id}`)
          : Promise.resolve({ data: [] }),
      ]);
      const normalizedRelationships = ((relationshipsRes.data ?? []) as any[]).map((row) => {
        const isOwner = row.client_id === data.client_id;
        const other = isOwner ? row.related : { id: row.client_id };
        return { ...row, related_client_id: other?.id ?? row.related_client_id };
      });
      return { ...data, clients: clientRes.data, properties: propRes.data, co_applicant: coRes.data, applicant_clients: applicantClientsRes.data ?? [], applicant_disclosures: disclosuresRes.data ?? [], relationships: normalizedRelationships } as any;
    },
  });

  const resetMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("financing_dossiers")
        .update({ quick_check_status: "incomplete" })
        .eq("id", id);
      if (error) throw error;
      await logActivity({
        relatedType: "financing_dossier",
        relatedId: id,
        action: "Finanzierung zurückgesetzt",
      });
    },
    onSuccess: () => {
      toast.success(t("financing.detail.toast.reset"));
      setResetOpen(false);
      queryClient.invalidateQueries({ queryKey: ["financing_dossier", id] });
      queryClient.invalidateQueries({ queryKey: ["financing_dossiers"] });
      queryClient.invalidateQueries({ queryKey: ["activity_logs", "financing_dossier", id] });
    },
    onError: (e: any) => toast.error(e.message ?? t("financing.detail.toast.resetFailed")),
  });

  const relatedClientIds = useMemo(() => {
    if (!dossier) return [] as string[];
    const extras = Array.isArray((dossier as any).additional_co_applicants)
      ? ((dossier as any).additional_co_applicants as any[]).map((a) => a?.client_id)
      : [];
    const rels = ((dossier as any).relationships ?? []).map((r: any) => r?.related_client_id);
    const applicants = ((dossier as any).applicant_clients ?? []).map((c: any) => c?.id);
    return Array.from(new Set([
      dossier.client_id,
      (dossier as any).co_applicant_client_id,
      ...extras,
      ...applicants,
      ...rels,
    ].filter(Boolean))) as string[];
  }, [dossier]);

  const docsCountQuery = useQuery({
    queryKey: ["financing_documents_count", id, relatedClientIds.join(","), dossier?.property_id],
    enabled: !!dossier,
    queryFn: async () => {
      const orParts: string[] = [`and(related_type.eq.financing,related_id.eq.${id})`];
      if (relatedClientIds.length > 0) orParts.push(`and(related_type.eq.client,related_id.in.(${relatedClientIds.join(",")}))`);
      if (dossier?.property_id) orParts.push(`and(related_type.eq.property,related_id.eq.${dossier.property_id})`);
      const [d, g] = await Promise.all([
        supabase.from("documents").select("id", { count: "exact", head: true }).or(orParts.join(",")),
        supabase.from("generated_documents").select("id", { count: "exact", head: true }).or(orParts.join(",")),
      ]);
      return (d.count ?? 0) + (g.count ?? 0);
    },
  });
  const docsCount = docsCountQuery.data ?? 0;

  if (isLoading) return <p className="text-sm text-muted-foreground">{t("financing.loading")}</p>;
  if (!dossier) return <p className="text-sm text-muted-foreground">{t("financing.detail.notFound")}</p>;

  const reasons = (dossier.quick_check_reasons as any[]) ?? [];
  const qcStatus = displayQuickCheckStatus(dossier);
  const isRefi = isRefinancingDossier(dossier);
  const refiInputs = isRefi ? deriveInputs(dossier) : null;
  const isIncomplete = qcStatus === "incomplete";
  const lastCheckAt = dossier.updated_at ? formatDateTime(dossier.updated_at) : null;

  return (
    <Tabs defaultValue="overview" className="space-y-6">
      <section className="relative overflow-hidden rounded-2xl border border-border bg-muted/70 p-6 pb-2 shadow-[var(--shadow-soft)]">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/60 via-primary/80 to-primary/40" />
        <Button variant="ghost" size="sm" onClick={() => navigate({ to: "/financing" })}>
          <ArrowLeft className="mr-1 h-4 w-4" />{t("financing.detail.back")}
        </Button>

        <div className="mt-4">
          <PageHeader
            title={dossier.title || FINANCING_TYPE_LABELS[dossier.financing_type as FinancingType] || t("financing.detail.fallback")}
            description={
              [
                FINANCING_TYPE_LABELS[dossier.financing_type as FinancingType],
                dossier.clients?.full_name,
                dossier.properties?.title,
              ].filter(Boolean).join(" · ")
            }
            action={
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{DOSSIER_STATUS_LABELS[dossier.dossier_status as DossierStatus] ?? t("financing.dossierStatus.draft")}</Badge>
                {dossier.quick_check_status && (
                  <Badge className={qcBadgeTone(qcStatus)}>{t(`financing.quickCheckStatus.${qcStatus}`, { defaultValue: QUICK_CHECK_LABELS[qcStatus] })}</Badge>
                )}
                {!isIncomplete && (
                  <>
                    <Button size="sm" onClick={() => setPreviewOpen(true)}>
                      <FileText className="mr-1 h-4 w-4" />Bericht ansehen
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setResetOpen(true)}>
                      <RotateCcw className="mr-1 h-4 w-4" />{t("financing.detail.quickcheck.recalculate")}
                    </Button>
                  </>
                )}
              </div>
            }
          />
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat icon={Banknote} label={isRefi ? "Immobilienwert" : t("financing.detail.stats.totalInvestment")} value={fmt(dossier.total_investment)} />
          <Stat icon={Banknote} label={isRefi ? "Neue Hypothek" : t("financing.detail.stats.mortgage")} value={fmt(dossier.requested_mortgage)} />
          <Stat icon={Banknote} label={isRefi ? "Aufstockungswunsch" : t("financing.detail.stats.ownFunds")} value={isRefi ? fmt(dossier.requested_increase) : fmt(dossier.own_funds_total)} />
          <Stat
            icon={Banknote}
            label={t("financing.detail.stats.affordability")}
            value={refiInputs ? pct(refiInputs.affordability) : dossier.affordability_ratio != null ? `${Number(dossier.affordability_ratio).toFixed(1)}%` : "—"}
            tone={affordabilityTone(refiInputs?.affordability ?? (dossier.affordability_ratio != null ? Number(dossier.affordability_ratio) : null))}
          />
        </div>

        <TabsList className="mt-6 flex h-auto w-full items-center justify-between gap-1 bg-transparent p-0 shadow-none">
          <TabsTrigger
            value="overview"
            className="relative flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground rounded-xl border border-transparent transition-all hover:bg-muted hover:backdrop-blur-xl hover:shadow-[0_0_0_1px_rgba(255,255,255,0.9),0_6px_18px_-4px_rgba(0,0,0,0.12)] hover:border-white/70 hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.08)] data-[state=active]:border-border/60"
          >
            {t("financing.detail.tabs.overview")}
          </TabsTrigger>
          <TabsTrigger
            value="ubs"
            className="relative flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground rounded-xl border border-transparent transition-all hover:bg-muted hover:backdrop-blur-xl hover:shadow-[0_0_0_1px_rgba(255,255,255,0.9),0_6px_18px_-4px_rgba(0,0,0,0.12)] hover:border-white/70 hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.08)] data-[state=active]:border-border/60"
          >
            {t("financing.detail.tabs.ubs")}
          </TabsTrigger>
          <TabsTrigger
            value="documents"
            className="relative flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground rounded-xl border border-transparent transition-all hover:bg-muted hover:backdrop-blur-xl hover:shadow-[0_0_0_1px_rgba(255,255,255,0.9),0_6px_18px_-4px_rgba(0,0,0,0.12)] hover:border-white/70 hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.08)] data-[state=active]:border-border/60"
          >
            {t("financing.detail.tabs.documents")}
            <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5 text-xs tabular-nums">{docsCount}</Badge>
          </TabsTrigger>
          <TabsTrigger
            value="bank"
            className="relative flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground rounded-xl border border-transparent transition-all hover:bg-muted hover:backdrop-blur-xl hover:shadow-[0_0_0_1px_rgba(255,255,255,0.9),0_6px_18px_-4px_rgba(0,0,0,0.12)] hover:border-white/70 hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.08)] data-[state=active]:border-border/60"
          >
            {t("financing.detail.tabs.bank")}
          </TabsTrigger>
          <TabsTrigger
            value="activity"
            className="relative flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground rounded-xl border border-transparent transition-all hover:bg-muted hover:backdrop-blur-xl hover:shadow-[0_0_0_1px_rgba(255,255,255,0.9),0_6px_18px_-4px_rgba(0,0,0,0.12)] hover:border-white/70 hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.08)] data-[state=active]:border-border/60"
          >
            {t("financing.detail.tabs.activity")}
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/60 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
          </TabsTrigger>
        </TabsList>
      </section>

      <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Card>
              <CardContent className="p-4 space-y-2">
                <h3 className="font-semibold flex items-center gap-2"><User className="h-4 w-4" />{t("financing.detail.overview.client")}</h3>
                <div className="divide-y rounded-lg border">
                  <ApplicantRow
                    label={t("financing.wizard.summary.mainApplicant")}
                    client={dossier.clients}
                    onOpen={setOpenClientId}
                  />
                  {spouses(dossier).map((r) => (
                    <ApplicantRow
                      key={r.id}
                      label={t("financing.wizard.summary.spouse")}
                      client={r.related}
                      onOpen={setOpenClientId}
                    />
                  ))}
                  {(dossier.applicant_clients ?? []).filter((c: { id: string }) => c.id === dossier.co_applicant_client_id && !spouseIds(dossier).has(c.id)).map((c: { id: string; full_name: string }) => (
                    <ApplicantRow
                      key={c.id}
                      label={t("financing.wizard.summary.coApplicant")}
                      client={c}
                      onOpen={setOpenClientId}
                    />
                  ))}
                  {(dossier.applicant_clients ?? []).filter((c: { id: string }) => c.id !== dossier.client_id && c.id !== dossier.co_applicant_client_id && !spouseIds(dossier).has(c.id)).map((c: { id: string; full_name: string }) => (
                    <ApplicantRow
                      key={c.id}
                      label={t("financing.wizard.summary.additionalApplicant")}
                      client={c}
                      onOpen={setOpenClientId}
                    />
                  ))}
                </div>
                {!dossier.clients && <p className="text-sm text-muted-foreground">—</p>}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold flex items-center gap-2"><Building2 className="h-4 w-4" />{t("financing.detail.overview.property")}</h3>
                  <Button size="sm" variant="outline" onClick={() => setSwitchOpen(true)}>
                    <Sparkles className="mr-1 h-4 w-4" />
                    {dossier.properties ? "Immobilie wechseln" : "Immobilie wählen"}
                  </Button>
                </div>
                {dossier.properties ? (
                  <Link to="/properties/$id" params={{ id: dossier.properties.id }} className="text-sm text-primary hover:underline">
                    {dossier.properties.title}
                  </Link>
                ) : <p className="text-sm text-muted-foreground">{t("financing.detail.overview.noProperty")}</p>}
                {dossier.properties?.city && <p className="text-xs text-muted-foreground">{dossier.properties.city}</p>}
              </CardContent>
            </Card>
            <PropertySwitchDialog open={switchOpen} onOpenChange={setSwitchOpen} dossier={dossier} />
          </div>


          {isIncomplete ? (
            <Card>
              <CardContent className="p-6 space-y-4">
                <div>
                  <h3 className="font-semibold">{t("financing.detail.quickcheck.start")}</h3>
                  <p className="text-sm text-muted-foreground">
                    {t("financing.detail.quickcheck.startDescription")}
                  </p>
                </div>
                <Button onClick={() => setWizardOpen(true)}>{t("financing.detail.quickcheck.start")}</Button>
              </CardContent>
            </Card>
          ) : (
            <>
              {lastCheckAt && (
                <p className="text-sm text-muted-foreground">
                  {t("financing.detail.quickcheck.lastCheck", { date: lastCheckAt })}
                </p>
              )}
              <Tabs defaultValue="vorpruefung">
                <TabsList className="w-full flex justify-start gap-0 bg-transparent border-b border-border rounded-none p-0 h-auto">
                  <SubTabTrigger value="vorpruefung" icon={<ClipboardCheck className="h-4 w-4" />}>
                    {t("financing.detail.quickcheck.subtabs.precheck")}
                  </SubTabTrigger>
                  <SubTabTrigger value="detail" icon={<Calculator className="h-4 w-4" />}>
                    {t("financing.detail.quickcheck.subtabs.detail")}
                  </SubTabTrigger>
                  <SubTabTrigger value="szenarien" icon={<LineChart className="h-4 w-4" />}>
                    {t("financing.detail.quickcheck.subtabs.scenarios")}
                  </SubTabTrigger>
                </TabsList>

                <TabsContent value="vorpruefung" className="space-y-4">
                  <QuickCheckVorpruefung dossier={dossier} />
                </TabsContent>

                <TabsContent value="detail" className="space-y-4">
                  <QuickCheckDetail dossier={dossier} />
                </TabsContent>

                <TabsContent value="szenarien" className="space-y-4">
                  <QuickCheckScenarios dossier={dossier} />
                </TabsContent>
              </Tabs>
              <DossierQualityCard dossierId={dossier.id} dossier={dossier} />

            </>
          )}
        </TabsContent>




        <TabsContent value="ubs">
          <UbsChecklistTab dossierId={dossier.id} />
        </TabsContent>
        <TabsContent value="documents">
          <FinancingDocumentsTab
            dossierId={dossier.id}
            clientId={dossier.client_id}
            clientIds={relatedClientIds}
            propertyId={dossier.property_id}
          />
        </TabsContent>
        <TabsContent value="bank">
          <BankSubmissionTab dossierId={dossier.id} />
        </TabsContent>
        <TabsContent value="activity">
          <ActivityTab relatedType="financing_dossier" relatedId={id} />
        </TabsContent>

      <FinancingQuickCheckWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        defaultClientId={dossier.client_id ?? undefined}
        defaultPropertyId={dossier.property_id ?? undefined}
        onCreated={(newId) => {
          setWizardOpen(false);
          queryClient.invalidateQueries({ queryKey: ["financing_dossier", id] });
          if (newId !== id) navigate({ to: "/financing/$id", params: { id: newId } });
        }}
      />

      <FinancingReportPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        dossierId={dossier.id}
        dossier={dossier}
      />

      <AlertDialog open={resetOpen} onOpenChange={setResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("financing.detail.resetDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("financing.detail.resetDialog.description")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("financing.detail.resetDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => resetMutation.mutate()}
              disabled={resetMutation.isPending}
            >
              {t("financing.detail.resetDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ClientDetailDialog
        clientId={openClientId}
        open={!!openClientId}
        onOpenChange={(o) => { if (!o) setOpenClientId(null); }}
      />
    </Tabs>
  );
}

function formatDateTime(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function qcBadgeTone(s: QuickCheckStatus): string {
  if (s === "realistic") return "bg-emerald-600 hover:bg-emerald-600 text-white";
  if (s === "critical") return "bg-amber-500 hover:bg-amber-500 text-white";
  if (s === "not_financeable") return "bg-red-600 hover:bg-red-600 text-white";
  return "bg-secondary text-secondary-foreground hover:bg-secondary";
}

function fmt(v: any) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!Number.isFinite(n)) return "—";
  return formatCurrency(n);
}

function affordabilityTone(v: number | null | undefined): "ok" | "warn" | "bad" | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (v <= 33) return "ok";
  if (v <= 38) return "warn";
  return "bad";
}

function Stat({ icon: Icon, label, value, tone }: { icon: any; label: string; value: string; tone?: "ok" | "warn" | "bad" | null }) {
  const toneClass =
    tone === "ok" ? "text-emerald-600" :
    tone === "warn" ? "text-amber-600" :
    tone === "bad" ? "text-red-600" : "";
  const borderClass =
    tone === "ok" ? "border-emerald-200" :
    tone === "warn" ? "border-amber-200" :
    tone === "bad" ? "border-red-200" : "";
  return (
    <Card className={cn("bg-card/90 shadow-sm backdrop-blur-sm", borderClass)}>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-4 w-4" />{label}</div>
        <p className={cn("mt-1 text-lg font-semibold", toneClass)}>{value}</p>
      </CardContent>
    </Card>
  );
}

function KV({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value}</p>
    </div>
  );
}

function ApplicantRow({ label, client, onOpen }: { label: string; client?: { id: string; full_name: string; email?: string | null; phone?: string | null } | null; onOpen?: (id: string) => void }) {
  if (!client) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen?.(client.id)}
      className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="text-sm font-medium truncate">{client.full_name}</p>
      </div>
      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
    </button>
  );
}

function spouses(dossier: Dossier) {
  return (dossier.relationships ?? []).filter((r) => r.relationship_type === "spouse");
}

function spouseIds(dossier: Dossier) {
  return new Set(spouses(dossier).map((r) => r.related_client_id));
}

function coApplicants(dossier: Dossier) {
  const mainId = dossier.clients?.id;
  return (dossier.applicant_clients ?? []).filter((c) => c.id !== mainId && !spouseIds(dossier).has(c.id));
}

function SubTabTrigger({
  value,
  icon,
  children,
}: {
  value: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        "relative flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground rounded-none border-b-2 border-transparent transition-colors hover:text-foreground data-[state=active]:text-foreground data-[state=active]:border-primary"
      )}
    >
      {icon}
      <span>{children}</span>
    </TabsTrigger>
  );
}

// ───────── Quick Check Sub-Tabs ─────────

type Dossier = Record<string, unknown> & {
  purchase_price?: number | string | null;
  renovation_costs?: number | string | null;
  requested_mortgage?: number | string | null;
  own_funds_total?: number | string | null;
  own_funds_pension_fund?: number | string | null;
  own_funds_vested_benefits?: number | string | null;
  gross_income_yearly?: number | string | null;
  calculated_interest_rate?: number | string | null;
  ancillary_costs_yearly?: number | string | null;
  amortisation_yearly?: number | string | null;
  co_applicant_client_id?: string | null;
  co_applicant_role?: string | null;
  co_applicant_einkommen?: number | string | null;
  co_applicant_eigenkapital?: number | string | null;
  co_applicant_pk_anteil?: number | string | null;
  einkommen_kombiniert?: number | string | null;
  eigenkapital_kombiniert?: number | string | null;
  pk_anteil_kombiniert?: number | string | null;
  co_applicant?: { id: string; full_name: string } | null;
  clients?: { id: string; full_name: string; email?: string | null; phone?: string | null } | null;
  applicant_clients?: { id: string; full_name: string }[] | null;
  applicant_disclosures?: Record<string, unknown>[] | null;
  additional_co_applicants?: unknown;
  relationships?: { id: string; client_id: string; related_client_id: string; relationship_type: string; notes: string | null; related?: { id: string; full_name: string } | null }[] | null;
  monthly_obligations?: number | string | null;
  existing_mortgage?: number | string | null;
  existing_mortgage_2?: number | string | null;
  requested_increase?: number | string | null;
  new_total_mortgage?: number | string | null;
};

function n(v: unknown, fallback = 0): number {
  const x = typeof v === "string" ? parseFloat(v) : (v as number);
  return Number.isFinite(x) ? x : fallback;
}
function chf(v: number): string {
  return formatCurrency(Math.round(v));
}
function chfCompact(v: number): string {
  const k = v / 1000;
  if (Math.abs(k) >= 1000) return `${(k / 1000).toFixed(1)}M`;
  return `${Math.round(k)}k`;
}
function pct(v: number): string {
  return `${v.toFixed(1)}%`;
}

type Inputs = {
  total: number;
  purchase: number;
  reno: number;
  mortgage: number;
  equity: number;
  pension: number;
  vested: number;
  hardEquity: number;
  income: number;
  rate: number;
  ancillaryPct: number;
  ancillary: number;
  firstMortgage: number;
  secondMortgage: number;
  amortYears: number;
  amort: number;
  yearly: number;
  interest: number;
  housingYearly: number;
  expensesMonthly: number;
  expensesYearly: number;
  allExpensesMonthly: number;
  allExpensesYearly: number;
  totalBudgetYearly: number;
  budgetRatio: number;
  ltv: number;
  affordability: number;
  equityRatio: number;
  hardRatio: number;
  minIncome: number;
  monthlyAvailable: number;
};

function deriveInputs(d: Dossier): Inputs {
  const purchase = n(d.purchase_price);
  const reno = n(d.renovation_costs);
  const total = purchase + reno;
  const mortgage = n(d.requested_mortgage);
  
  const equity = d.eigenkapital_kombiniert != null && d.eigenkapital_kombiniert !== ""
    ? n(d.eigenkapital_kombiniert) : n(d.own_funds_total);
  const pension = d.pk_anteil_kombiniert != null && d.pk_anteil_kombiniert !== ""
    ? n(d.pk_anteil_kombiniert) : n(d.own_funds_pension_fund);
  const vested = n(d.own_funds_vested_benefits);
  const pensionRelated = pension + vested;
  const hardEquity = Math.max(0, equity - pensionRelated);
  const extraIncome = Array.isArray(d.additional_co_applicants)
    ? (d.additional_co_applicants as any[]).reduce((sum, a) => sum + n(a?.einkommen), 0)
    : 0;
  const storedCombinedIncome = n(d.einkommen_kombiniert);
  const itemizedIncome = n(d.gross_income_yearly) + n(d.co_applicant_einkommen) + extraIncome;
  const income = Math.max(storedCombinedIncome, itemizedIncome);
  const rate = n(d.calculated_interest_rate, 5);
  const ancillary = d.ancillary_costs_yearly != null && d.ancillary_costs_yearly !== ""
    ? n(d.ancillary_costs_yearly)
    : total * 0.01;
  const ancillaryPct = total > 0 ? (ancillary / total) * 100 : 1;
  const firstMortgageMax = total * 0.65;
  const firstMortgage = Math.min(mortgage, firstMortgageMax);
  const secondMortgage = Math.max(0, mortgage - firstMortgageMax);
  const amortYears = 15;
  const amort = d.amortisation_yearly != null && d.amortisation_yearly !== ""
    ? n(d.amortisation_yearly)
    : secondMortgage / amortYears;
  const interest = mortgage * (rate / 100);
  const housingYearly = interest + ancillary + amort;
  const disclosedExpensesMonthly = totalApplicantExpensesMonthly(d);
  const allExpensesMonthly = isRefinancingDossier(d) ? (disclosedExpensesMonthly || n(d.monthly_obligations)) : 0;
  const expensesMonthly = allExpensesMonthly;
  const allExpensesYearly = allExpensesMonthly * 12;
  const expensesYearly = allExpensesYearly;
  // Bank-Tragbarkeit (CH-Standard): nur Wohnkosten / Einkommen.
  const yearly = housingYearly;
  // Budgetquote: alle Haushaltsausgaben + Wohnkosten.
  const totalBudgetYearly = housingYearly + allExpensesYearly;
  const ltv = total > 0 ? (mortgage / total) * 100 : 0;
  const affordability = income > 0 ? (housingYearly / income) * 100 : 0;
  const budgetRatio = income > 0 ? (totalBudgetYearly / income) * 100 : 0;
  const equityRatio = total > 0 ? (equity / total) * 100 : 0;
  const hardRatio = total > 0 ? (hardEquity / total) * 100 : 0;
  const minIncome = housingYearly > 0 ? housingYearly / 0.33 : 0;
  const monthlyAvailable = Math.max(0, (income - housingYearly - allExpensesYearly) / 12);
  return {
    total, purchase, reno, mortgage, equity, pension, vested, hardEquity,
    income, rate, ancillary, ancillaryPct, firstMortgage, secondMortgage,
    amortYears, amort, yearly, interest, housingYearly, expensesMonthly, expensesYearly,
    allExpensesMonthly, allExpensesYearly, totalBudgetYearly, budgetRatio, ltv, affordability, equityRatio,
    hardRatio, minIncome, monthlyAvailable,
  };
}

function applicantList(d: Dossier): { id: string; name: string; income: number }[] {
  const clientMap = new Map((d.applicant_clients ?? []).map((c) => [c.id, c.full_name]));
  const extras = Array.isArray(d.additional_co_applicants) ? d.additional_co_applicants as any[] : [];
  const rows: { id: string; name: string; income: number }[] = [];
  if (d.clients?.id) rows.push({ id: d.clients.id, name: d.clients.full_name, income: n(d.gross_income_yearly) });
  if (d.co_applicant_client_id) rows.push({ id: d.co_applicant_client_id, name: d.co_applicant?.full_name ?? clientMap.get(d.co_applicant_client_id) ?? "Mitantragsteller", income: n(d.co_applicant_einkommen) });
  for (const a of extras) {
    if (a?.client_id) rows.push({ id: a.client_id, name: clientMap.get(a.client_id) ?? "Mitantragsteller", income: n(a.einkommen) });
  }
  return rows.filter((row, index, arr) => arr.findIndex((x) => x.id === row.id) === index);
}

const TRAGBARKEIT_RELEVANT_EXPENSE_FIELDS = [
  "leasing_expense",
  "credit_expense",
  "alimony_expense",
  "life_insurance_expense",
] as const;

function applicantExpenseGroups(d: Dossier, fieldsToUse: readonly (typeof expenseFields)[number][] = expenseFields) {
  const disclosures = new Map((d.applicant_disclosures ?? []).map((r) => [String(r.client_id), r]));
  return applicantList(d).map((applicant) => {
    const disclosure = disclosures.get(applicant.id) ?? {};
    const fields = fieldsToUse
      .map((field) => ({ label: expenseLabels[field], monthly: n(disclosure[field]) }))
      .filter((row) => row.monthly > 0);
    const monthly = fields.reduce((sum, row) => sum + row.monthly, 0);
    return { ...applicant, fields, monthly, yearly: monthly * 12 };
  });
}

function totalApplicantExpensesMonthly(d: Dossier): number {
  return applicantExpenseGroups(d).reduce((sum, group) => sum + group.monthly, 0);
}

function totalTragbarkeitRelevantExpensesMonthly(d: Dossier): number {
  return applicantExpenseGroups(d, TRAGBARKEIT_RELEVANT_EXPENSE_FIELDS).reduce((sum, group) => sum + group.monthly, 0);
}

function toneFor(value: number, limit: number, warn: number, mode: "max" | "min"): "ok" | "warn" | "bad" {
  if (mode === "max") {
    if (value <= limit) return "ok";
    if (value <= warn) return "warn";
    return "bad";
  }
  if (value >= limit) return "ok";
  if (value >= warn) return "warn";
  return "bad";
}
function toneText(t: "ok" | "warn" | "bad"): string {
  return t === "ok" ? "text-emerald-600" : t === "warn" ? "text-amber-600" : "text-red-600";
}
function toneBar(t: "ok" | "warn" | "bad"): string {
  return t === "ok" ? "bg-emerald-500" : t === "warn" ? "bg-amber-500" : "bg-red-500";
}

function MetricCard({
  label, value, limitLabel, tone, fillPct, limitPct,
}: {
  label: string; value: string; limitLabel: string;
  tone: "ok" | "warn" | "bad"; fillPct: number; limitPct: number;
}) {
  const fill = Math.max(0, Math.min(100, fillPct));
  const limit = Math.max(0, Math.min(100, limitPct));
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <div className="flex items-baseline justify-between">
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="text-xs text-muted-foreground">{limitLabel}</p>
        </div>
        <p className={cn("text-2xl font-semibold", toneText(tone))}>{value}</p>
        <div className="relative h-2 w-full rounded bg-muted">
          <div className={cn("h-2 rounded transition-all", toneBar(tone))} style={{ width: `${fill}%` }} />
          <div
            className="absolute top-[-2px] h-3 w-px bg-foreground/70"
            style={{ left: `${limit}%` }}
            aria-hidden
          />
        </div>
      </CardContent>
    </Card>
  );
}

function RefiBarometerCard({
  label, value, detail, tone = "ok", fillPct, limitPct,
}: {
  label: string; value: string; detail: string; tone?: "ok" | "warn" | "bad"; fillPct?: number; limitPct?: number;
}) {
  const hasBar = fillPct != null && limitPct != null;
  const fill = Math.max(0, Math.min(100, fillPct ?? 0));
  const limit = Math.max(0, Math.min(100, limitPct ?? 0));
  return (
    <Card>
      <CardContent className="p-4 space-y-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={cn("text-2xl font-semibold", hasBar ? toneText(tone) : "text-foreground")}>{value}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
        {hasBar && (
          <div className="relative h-2 w-full rounded bg-muted">
            <div className={cn("h-2 rounded transition-all", toneBar(tone))} style={{ width: `${fill}%` }} />
            <div className="absolute top-[-2px] h-3 w-px bg-foreground/70" style={{ left: `${limit}%` }} aria-hidden />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QuickCheckVorpruefung({ dossier }: { dossier: Dossier }) {
  const { t } = useTranslation();
  const isRefi = isRefinancingDossier(dossier);
  const i = deriveInputs(dossier);
  const ltvTone = toneFor(i.ltv, 80, 90, "max");
  const affTone = toneFor(i.affordability, 33, 38, "max");
  const eqTone = toneFor(i.equityRatio, 20, 15, "min");
  const hardTone = toneFor(i.hardRatio, 10, 7, "min");
  const refiStatus = displayQuickCheckStatus(dossier);

  const tips: { tone: "ok" | "warn" | "bad"; text: string }[] = [];
  if (i.affordability > 33 && i.income > 0) {
    const incomeNeeded = i.minIncome;
    const delta = Math.max(0, incomeNeeded - i.income);
    tips.push({
      tone: "warn",
      text: isRefi
        ? `Bank-Tragbarkeit ${pct(i.affordability)} — Wohnkosten (${chf(i.housingYearly)} p.a.) übersteigen 33% des Einkommens. Einkommen müsste um ${chf(delta)} steigen (benötigt: ${chf(incomeNeeded)} p.a.) oder Hypothek/Zins reduzieren.`
        : t("financing.detail.quickcheck.tips.incomeNeeded", { delta: chf(delta), needed: chf(incomeNeeded) }),
    });
  }
  if (isRefi && i.ltv > 80 && i.total > 0) {
    tips.push({ tone: "warn", text: `Belehnung ${pct(i.ltv)} — neue Hypothek auf maximal ${chf(i.total * 0.8)} reduzieren.` });
  }
  if (!isRefi && i.equityRatio < 20 && i.total > 0) {
    const needed = i.total * 0.20;
    const missing = Math.max(0, needed - i.equity);
    tips.push({
      tone: "warn",
      text: t("financing.detail.quickcheck.tips.equityMissing", { missing: chf(missing), needed: chf(needed) }),
    });
  }
  if (!isRefi && i.hardRatio < 10 && i.total > 0) {
    const neededHard = i.total * 0.10;
    tips.push({
      tone: "warn",
      text: t("financing.detail.quickcheck.tips.hardEquityLow", { needed: chf(neededHard), current: chf(i.hardEquity) }),
    });
  }
  if (tips.length === 0) {
    tips.push({ tone: "ok", text: t("financing.detail.quickcheck.tips.allOk") });
  }

  return (
    <>
      {isRefi ? (
        <div className="space-y-3">
          <RefiBarometerCard label="Aufstockungswunsch" value={chf(n(dossier.requested_increase))} detail="Zusätzlich gewünschter Betrag" />
          <RefiBarometerCard label="Neue Hypothek" value={chf(i.mortgage)} detail={`Belehnung ${pct(i.ltv)} / max. 80%`} tone={ltvTone} fillPct={i.ltv} limitPct={80} />
          <RefiBarometerCard label="Einnahmen p.a." value={chf(i.income)} detail={`${applicantList(dossier).length || 1} Antragsteller`} />
          <RefiBarometerCard
            label="Bank-Tragbarkeit"
            value={pct(i.affordability)}
            detail={`Wohnkosten ${chf(i.housingYearly)} p.a. / Limit 33%`}
            tone={affTone}
            fillPct={i.affordability * (100 / 50)}
            limitPct={33 * (100 / 50)}
          />
          <RefiBarometerCard
            label="Budgetquote (Haushaltsbelastung)"
            value={pct(i.budgetRatio)}
            detail={`Wohnkosten + alle Ausgaben (${chf(i.totalBudgetYearly)} p.a.)`}
          />
          <RefiBarometerCard label="Mindesteinkommen (33%)" value={chf(i.minIncome)} detail="Einkommen, damit Bank-Tragbarkeit ≤ 33%" />
          <RefiBarometerCard label="Verfügbar pro Monat" value={chf(i.monthlyAvailable)} detail="Einkommen − Wohnkosten − Haushaltsausgaben" />
          <Card>
            <CardContent className="p-4 space-y-2">
              <p className="text-sm text-muted-foreground">Finanzierbarkeit</p>
              <Badge className={cn("w-fit", qcBadgeTone(refiStatus))}>{t(`financing.quickCheckStatus.${refiStatus}`, { defaultValue: QUICK_CHECK_LABELS[refiStatus] })}</Badge>
              <p className="text-xs text-muted-foreground">{i.affordability <= 33 && i.ltv <= 80 ? "Finanzierbar: JA" : i.affordability <= 38 && i.ltv <= 80 ? "Finanzierbar: KRITISCH" : "Finanzierbar: NEIN"}</p>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <MetricCard label={t("financing.detail.quickcheck.metrics.ltv")} value={pct(i.ltv)} limitLabel={t("financing.detail.quickcheck.metrics.limit", { value: 80 })} tone={ltvTone} fillPct={i.ltv} limitPct={80} />
          <MetricCard label={t("financing.detail.quickcheck.metrics.affordability")} value={pct(i.affordability)} limitLabel={t("financing.detail.quickcheck.metrics.limit", { value: 33 })} tone={affTone} fillPct={i.affordability * (100 / 50)} limitPct={33 * (100 / 50)} />
          <MetricCard label={t("financing.detail.quickcheck.metrics.equityRatio")} value={pct(i.equityRatio)} limitLabel={t("financing.detail.quickcheck.metrics.limit", { value: 20 })} tone={eqTone} fillPct={i.equityRatio * (100 / 50)} limitPct={20 * (100 / 50)} />
          <MetricCard label={t("financing.detail.quickcheck.metrics.hardEquity")} value={pct(i.hardRatio)} limitLabel={t("financing.detail.quickcheck.metrics.limit", { value: 10 })} tone={hardTone} fillPct={i.hardRatio * (100 / 30)} limitPct={10 * (100 / 30)} />
        </div>
      )}
      <Card>
        <CardContent className="p-4 space-y-2">
          <h3 className="font-semibold">{t("financing.detail.quickcheck.tips.title")}</h3>
          <ul className="space-y-1 text-sm">
            {tips.map((tp, idx) => (
              <li key={idx} className={toneText(tp.tone)}>• {tp.text}</li>
            ))}
          </ul>
          {!isRefi && (() => {
            const coIncome = n(dossier.co_applicant_einkommen);
            const coName = dossier.co_applicant?.full_name;
            const coId = dossier.co_applicant_client_id;
            const mainIncome = n(dossier.gross_income_yearly);
            const mainName = dossier.clients?.full_name ?? t("financing.detail.quickcheck.detail.mainIncome");
            if (coId && coName && coIncome > 0) {
              return (
                <div className="mt-3 rounded-md border border-blue-300/60 bg-blue-50 dark:bg-blue-950/30 p-3 text-xs text-blue-900 dark:text-blue-100">
                  {t("financing.detail.quickcheck.tips.combinedIncome")}{" "}
                  <span className="font-medium">{mainName}</span> {chf(mainIncome)} +{" "}
                  <span className="font-medium">{coName}</span> {chf(coIncome)} ={" "}
                  <span className="font-semibold">{chf(i.income)}</span> {t("financing.detail.quickcheck.tips.perYear")}
                </div>
              );
            }
            if (coId && coName && coIncome <= 0) {
              return (
                <div className="mt-3 rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-100">
                  {t("financing.detail.quickcheck.tips.coIncomeMissing", { name: coName })}{" "}
                  <a href={`/clients/${coId}`} className="underline font-medium">{t("financing.detail.quickcheck.tips.toClient")}</a>
                </div>
              );
            }
            return null;
          })()}
        </CardContent>
      </Card>
    </>
  );
}

function DetailRow({ label, value, bold, indent, divider }: {
  label: string; value: string; bold?: boolean; indent?: boolean; divider?: boolean;
}) {
  return (
    <>
      {divider && <div className="my-2 border-t" />}
      <div className={cn("flex justify-between gap-4 text-sm", indent && "pl-4 text-muted-foreground")}>
        <span>{label}</span>
        <span className={cn("tabular-nums", bold && "font-semibold")}>{value}</span>
      </div>
    </>
  );
}

function QuickCheckDetail({ dossier }: { dossier: Dossier }) {
  const { t } = useTranslation();
  const isRefi = isRefinancingDossier(dossier);
  const i = deriveInputs(dossier);
  const affTone = toneFor(i.affordability, 33, 38, "max");
  const expenseGroups = applicantExpenseGroups(dossier);
  void TRAGBARKEIT_RELEVANT_EXPENSE_FIELDS;

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Card>
        <CardContent className="p-4 space-y-1">
          <h3 className="font-semibold mb-2">{t("financing.detail.quickcheck.detail.structure")}</h3>
          <DetailRow label={t("financing.detail.quickcheck.detail.purchasePrice")} value={chf(i.purchase)} />
          {i.reno > 0 && <DetailRow label={t("financing.detail.quickcheck.detail.plusRenovation")} value={chf(i.reno)} />}
          <DetailRow label={t("financing.detail.quickcheck.detail.totalInvestment")} value={chf(i.total)} bold divider />
          {isRefi && n(dossier.existing_mortgage) > 0 && <DetailRow label="Bestehende Hypothek 1" value={chf(n(dossier.existing_mortgage))} divider />}
          {isRefi && n(dossier.existing_mortgage_2) > 0 && <DetailRow label="Bestehende Hypothek 2" value={chf(n(dossier.existing_mortgage_2))} indent />}
          {isRefi && n(dossier.requested_increase) > 0 && <DetailRow label="Aufstockungswunsch" value={chf(n(dossier.requested_increase))} indent />}
          {!isRefi && (
            <>
              <DetailRow label={t("financing.detail.quickcheck.detail.ownFundsTotal", { ratio: pct(i.equityRatio) })} value={chf(i.equity)} divider />
              <DetailRow label={t("financing.detail.quickcheck.detail.cashEquity")} value={chf(i.hardEquity)} indent />
              <DetailRow label={t("financing.detail.quickcheck.detail.pensionEquity")} value={chf(i.pension + i.vested)} indent />
            </>
          )}
          <DetailRow label={t("financing.detail.quickcheck.detail.mortgageTotal", { ratio: pct(i.ltv) })} value={chf(i.mortgage)} divider />
          <DetailRow label={t("financing.detail.quickcheck.detail.firstMortgage")} value={chf(i.firstMortgage)} indent />
          <DetailRow label={t("financing.detail.quickcheck.detail.secondMortgage")} value={chf(i.secondMortgage)} indent />
          <DetailRow label={t("financing.detail.quickcheck.detail.amortization", { years: i.amortYears })} value={t("financing.detail.quickcheck.detail.perYearShort", { amount: chf(i.amort) })} divider />
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-4 space-y-1">
          <h3 className="font-semibold mb-2">{t("financing.detail.quickcheck.detail.yearlyCosts")}</h3>
          <DetailRow label={t("financing.detail.quickcheck.detail.calcInterest", { rate: i.rate.toFixed(1) })} value={chf(i.interest)} />
          <DetailRow label={t("financing.detail.quickcheck.detail.ancillary", { pct: i.ancillaryPct.toFixed(1) })} value={chf(i.ancillary)} />
          <DetailRow label={t("financing.detail.quickcheck.detail.amortLabel")} value={chf(i.amort)} />
          <DetailRow label="Wohnkosten p.a." value={chf(i.housingYearly)} bold divider />
          {isRefi && (
            <>
              {expenseGroups.map((group) => group.yearly > 0 && (
                <div key={group.id} className="space-y-1 pt-2">
                  <DetailRow label={`Jahresausgaben ${group.name}`} value={chf(group.yearly)} bold divider />
                  {group.fields.map((field) => (
                    <DetailRow key={`${group.id}-${field.label}`} label={field.label} value={chf(field.monthly * 12)} indent />
                  ))}
                </div>
              ))}
              {i.allExpensesYearly > 0 && <DetailRow label="Haushaltsausgaben total p.a. (informativ)" value={chf(i.allExpensesYearly)} bold divider />}
            </>
          )}
          <DetailRow label="Wohnkosten p.a. (Bank-Tragbarkeit)" value={chf(i.housingYearly)} bold divider />
          {applicantList(dossier).length > 1 ? (
            <>
              {applicantList(dossier).map((applicant) => (
                <DetailRow key={applicant.id} label={`Einkommen ${applicant.name}`} value={chf(applicant.income)} />
              ))}
              <DetailRow label={t("financing.detail.quickcheck.detail.combinedIncome")} value={chf(i.income)} bold />
            </>
          ) : (
            <DetailRow label={t("financing.detail.quickcheck.detail.grossIncome")} value={chf(i.income)} />
          )}
          <div className="my-2 border-t" />
          <div className="flex justify-between gap-4 text-sm">
            <span className="font-semibold">Bank-Tragbarkeit (Wohnkosten / Einkommen)</span>
            <span className={cn("font-semibold tabular-nums", toneText(affTone))}>{pct(i.affordability)}</span>
          </div>
          <DetailRow label="Mindesteinkommen (33%-Regel)" value={chf(i.minIncome)} />
          <DetailRow label="Finanzierbar" value={i.affordability <= 33 && i.ltv <= 80 ? "JA" : i.affordability <= 38 && i.ltv <= 80 ? "Kritisch" : "NEIN"} />
          {isRefi && i.allExpensesYearly > 0 && (
            <>
              <div className="my-2 border-t" />
              <DetailRow label="Budgetquote (Haushaltsbelastung)" value={pct(i.budgetRatio)} />
              <DetailRow label="Verfügbares Einkommen / Monat" value={chf(i.monthlyAvailable)} />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

type ScenarioRow = {
  id: string;
  created_at: string;
  dossier_id: string;
  bezeichnung: string;
  kaufpreis: number | null;
  eigenmittel: number | null;
  bruttoeinkommen: number | null;
  hypothek: number | null;
  kalk_zinssatz: number | null;
  tragbarkeit: number | null;
  belehnung: number | null;
  eigenmittelquote: number | null;
  harte_eigenmittel: number | null;
  status: string | null;
};

function QuickCheckScenarios({ dossier }: { dossier: Dossier }) {
  const { t } = useTranslation();
  const original = useMemo(() => deriveInputs(dossier), [dossier]);
  const isRefi = isRefinancingDossier(dossier);
  const dossierId = String((dossier as { id?: string }).id ?? "");
  const queryClient = useQueryClient();

  const [purchase, setPurchase] = useState<number>(Math.round(original.purchase));
  const [equity, setEquity] = useState<number>(Math.round(original.equity));
  const [income, setIncome] = useState<number>(Math.round(original.income));
  const [mortgage, setMortgage] = useState<number>(Math.round(original.mortgage));
  const [rate, setRate] = useState<number>(Math.round(original.rate * 10) / 10);
  const [reno, setReno] = useState<number>(Math.round(original.reno));
  const [ownWork, setOwnWork] = useState<number>(Math.round(n((dossier as { renovation_own_work?: number | string | null }).renovation_own_work)));
  const [expensesMonthly, setExpensesMonthly] = useState<number>(Math.round(original.expensesMonthly));

  const [saveOpen, setSaveOpen] = useState(false);
  const [scenarioName, setScenarioName] = useState("");

  const purchaseMin = Math.round(original.purchase * 0.5);
  const purchaseMax = Math.round(original.purchase * 1.5) || 100000;
  const equityMax = Math.max(Math.round((purchase + reno) * 0.5), Math.round(original.equity * 2.0), 200000);
  const incomeMin = Math.round(original.income * 0.5);
  const incomeMax = Math.round(original.income * 2.0) || 200000;
  const mortgageMin = Math.round(original.mortgage * 0.5);
  const mortgageMax = Math.round(original.mortgage * 1.3) || 100000;
  const renoMax = Math.max(Math.round(original.reno * 2.0), Math.round(purchase * 0.5), 200000);
  const ownWorkMax = Math.max(reno, 50000);
  const expensesMax = Math.max(Math.round(original.expensesMonthly * 2), 10000);

  // Live calculation based on slider values
  const live = useMemo(() => {
    const p = Math.round(purchase);
    const eq = Math.round(equity);
    const inc = Math.round(income);
    const mort = Math.round(mortgage);
    const r = Math.round(rate * 10) / 10;
    const rn = Math.round(reno);
    const ow = Math.min(Math.round(ownWork), rn);
    const monthlyExpenses = Math.round(expensesMonthly);
    const effectiveEq = isRefi ? original.equity : eq + ow;
    const scenarioReno = isRefi ? original.reno : rn;
    const scenarioPurchase = isRefi ? original.purchase : p;
    const total = scenarioPurchase + scenarioReno;
    const ancillary = total * (original.ancillaryPct / 100);
    const firstMortgageMax = total * 0.65;
    const second = Math.max(0, mort - firstMortgageMax);
    const amort = second / original.amortYears;
    const result = calcQuickCheck({
      purchase_price: scenarioPurchase,
      renovation_costs: scenarioReno,
      requested_mortgage: mort,
      own_funds_total: effectiveEq,
      own_funds_pension_fund: original.pension,
      own_funds_vested_benefits: original.vested,
      gross_income_yearly: inc,
      calculated_interest_rate: r,
      ancillary_costs_yearly: ancillary,
      amortisation_yearly: amort,
    });
    const expensesYearly = isRefi ? monthlyExpenses * 12 : 0;
    // Bank-Tragbarkeit: nur Wohnkosten (result.yearly_costs) / Einkommen.
    const affordability = inc > 0 ? (result.yearly_costs / inc) * 100 : 0;
    const ltv = total > 0 ? (mort / total) * 100 : 0;
    const status: QuickCheckStatus = isRefi
      ? (ltv > 80 || affordability > 38 ? "not_financeable" : affordability > 33 ? "critical" : "realistic")
      : result.status;
    return { p, eq: effectiveEq, inc, mort, r, total, rn, ow, monthlyExpenses, expensesYearly, result, ltv, affordability, status };
  }, [purchase, equity, income, mortgage, rate, reno, ownWork, expensesMonthly, isRefi, original]);

  const reset = () => {
    setPurchase(Math.round(original.purchase));
    setEquity(Math.round(original.equity));
    setIncome(Math.round(original.income));
    setMortgage(Math.round(original.mortgage));
    setRate(Math.round(original.rate * 10) / 10);
    setReno(Math.round(original.reno));
    setOwnWork(Math.round(n((dossier as { renovation_own_work?: number | string | null }).renovation_own_work)));
    setExpensesMonthly(Math.round(original.expensesMonthly));
  };

  const saveMutation = useMutation({
    mutationFn: async (label: string) => {
      const r = live.result;
      const { error } = await supabase.from("financing_dossiers_scenarios" as never).insert({
        dossier_id: dossierId,
        bezeichnung: label,
        kaufpreis: live.p,
        eigenmittel: live.eq,
        bruttoeinkommen: live.inc,
        hypothek: live.mort,
        kalk_zinssatz: live.r,
        tragbarkeit: live.affordability,
        belehnung: live.ltv,
        eigenmittelquote: live.total > 0 ? (live.eq / live.total) * 100 : 0,
        harte_eigenmittel: r.hard_equity,
        status: live.status,
      } as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("financing.detail.quickcheck.scenarios.toast.saved"));
      setSaveOpen(false);
      setScenarioName("");
      queryClient.invalidateQueries({ queryKey: ["financing_scenarios", dossierId] });
    },
    onError: (e: Error) => toast.error(e.message ?? t("financing.detail.quickcheck.scenarios.toast.saveFailed")),
  });

  const { data: scenarios } = useQuery({
    queryKey: ["financing_scenarios", dossierId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financing_dossiers_scenarios" as never)
        .select("*")
        .eq("dossier_id", dossierId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as ScenarioRow[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (sid: string) => {
      const { error } = await supabase
        .from("financing_dossiers_scenarios" as never)
        .delete()
        .eq("id", sid);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(t("financing.detail.quickcheck.scenarios.toast.deleted"));
      queryClient.invalidateQueries({ queryKey: ["financing_scenarios", dossierId] });
    },
    onError: (e: Error) => toast.error(e.message ?? t("financing.detail.quickcheck.scenarios.toast.deleteFailed")),
  });

  const loadScenario = (s: ScenarioRow) => {
    if (s.kaufpreis != null) setPurchase(Math.round(Number(s.kaufpreis)));
    if (s.eigenmittel != null) setEquity(Math.round(Number(s.eigenmittel)));
    if (s.bruttoeinkommen != null) setIncome(Math.round(Number(s.bruttoeinkommen)));
    if (s.hypothek != null) setMortgage(Math.round(Number(s.hypothek)));
    if (s.kalk_zinssatz != null) setRate(Math.round(Number(s.kalk_zinssatz) * 10) / 10);
    toast.success(t("financing.detail.quickcheck.scenarios.toast.loaded", { name: s.bezeichnung }));
  };

  const liveLtv = live.ltv;
  const liveAff = live.affordability;
  const liveEqRatio = live.total > 0 ? (live.eq / live.total) * 100 : 0;
  const liveStatus = live.status;

  // Matrix uses slider values for equity, mortgage, rate
  const priceSteps = [-200000, -100000, 0, 100000, 200000];
  const incomeSteps = [-40000, -20000, 0, 20000, 40000];

  type Cell = { tone: "ok" | "warn" | "bad" | "gray"; label: string; isCurrent: boolean };
  const matrix: Cell[][] = incomeSteps.map((dInc) =>
    priceSteps.map((dPrice) => {
      const p = Math.max(0, live.p + dPrice);
      const total = p + live.rn;
      const ancillary = total * (original.ancillaryPct / 100);
      const firstMortgageMax = total * 0.65;
      const second = Math.max(0, live.mort - firstMortgageMax);
      const amort = second / original.amortYears;
      const result = calcQuickCheck({
        purchase_price: p,
        renovation_costs: live.rn,
        requested_mortgage: live.mort,
        own_funds_total: live.eq,
        own_funds_pension_fund: original.pension,
        own_funds_vested_benefits: original.vested,
        gross_income_yearly: Math.max(0, live.inc + dInc),
        calculated_interest_rate: live.r,
        ancillary_costs_yearly: ancillary,
        amortisation_yearly: amort,
      });
      const eqRatio = total > 0 ? (live.eq / total) * 100 : 0;
      // Bank-Tragbarkeit: nur Wohnkosten / Einkommen.
      const aff = isRefi
        ? (Math.max(0, live.inc + dInc) > 0 ? (result.yearly_costs / Math.max(0, live.inc + dInc)) * 100 : 0)
        : result.affordability_ratio;
      const ltv = total > 0 ? (live.mort / total) * 100 : 0;
      let tone: Cell["tone"];
      let label: string;
      if (isRefi && (ltv > 80 || aff > 38)) { tone = "bad"; label = pct(aff); }
      else if (isRefi && aff > 33) { tone = "warn"; label = pct(aff); }
      else if (isRefi) { tone = "ok"; label = pct(aff); }
      else if (eqRatio < 10) { tone = "gray"; label = t("financing.detail.quickcheck.scenarios.matrixEqInsufficient"); }
      else if (aff > 38 || eqRatio < 15) { tone = "bad"; label = pct(aff); }
      else if (aff > 33 || eqRatio < 20) { tone = "warn"; label = pct(aff); }
      else { tone = "ok"; label = pct(aff); }
      return { tone, label, isCurrent: dPrice === 0 && dInc === 0 };
    })
  );

  const cellTone = (t: Cell["tone"]) =>
    t === "ok" ? "bg-emerald-100 text-emerald-800"
    : t === "warn" ? "bg-amber-100 text-amber-800"
    : t === "bad" ? "bg-red-100 text-red-800"
    : "bg-muted text-muted-foreground";
  const borderTone = (t: Cell["tone"]) =>
    t === "ok" ? "border-emerald-600"
    : t === "warn" ? "border-amber-600"
    : t === "bad" ? "border-red-600"
    : "border-muted-foreground";

  const equityPctNow = live.total > 0 ? (live.eq / live.total) * 100 : 0;
  const ltvNow = live.total > 0 ? (live.mort / live.total) * 100 : 0;

  return (
    <>
      {/* BEREICH A — Slider */}
      <Card>
        <CardContent className="p-4 space-y-4">
          <div>
            <h3 className="font-semibold">{t("financing.detail.quickcheck.scenarios.title")}</h3>
            <p className="text-sm text-muted-foreground">
              {t("financing.detail.quickcheck.scenarios.description")}
            </p>
          </div>

          {!isRefi && (
            <>
              <SliderRow
                label={t("financing.detail.quickcheck.scenarios.purchase")}
                display={chf(purchase)}
                value={purchase}
                min={purchaseMin}
                max={purchaseMax}
                step={10000}
                onChange={setPurchase}
              />
              <SliderRow
                label={t("financing.detail.quickcheck.scenarios.equity")}
                display={`${chf(equity)} (${pct(equityPctNow)})`}
                value={equity}
                min={0}
                max={equityMax}
                step={5000}
                onChange={setEquity}
              />
              <SliderRow
                label={t("financing.detail.quickcheck.scenarios.renovation")}
                display={chf(reno)}
                value={reno}
                min={0}
                max={renoMax}
                step={5000}
                onChange={(v) => setReno(Math.round(v))}
              />
              <SliderRow
                label={t("financing.detail.quickcheck.scenarios.ownWork")}
                display={chf(ownWork)}
                value={ownWork}
                min={0}
                max={ownWorkMax}
                step={1000}
                onChange={(v) => setOwnWork(Math.round(v))}
              />
            </>
          )}
          <SliderRow
            label={t("financing.detail.quickcheck.scenarios.income")}
            display={t("financing.detail.quickcheck.scenarios.incomePerYear", { amount: chf(income) })}
            value={income}
            min={incomeMin}
            max={incomeMax}
            step={5000}
            onChange={setIncome}
          />
          <SliderRow
            label={t("financing.detail.quickcheck.scenarios.mortgage")}
            display={t("financing.detail.quickcheck.scenarios.mortgageWithLtv", { amount: chf(mortgage), ltv: pct(ltvNow) })}
            value={mortgage}
            min={mortgageMin}
            max={mortgageMax}
            step={10000}
            onChange={setMortgage}
          />
          {isRefi && (
            <SliderRow
              label="Fixe Verpflichtungen"
              display={`${chf(expensesMonthly)} / Monat`}
              value={expensesMonthly}
              min={0}
              max={expensesMax}
              step={100}
              onChange={setExpensesMonthly}
            />
          )}
          <SliderRow
            label={t("financing.detail.quickcheck.scenarios.rate")}
            display={`${rate.toFixed(1)}%`}
            value={rate}
            min={1.0}
            max={8.0}
            step={0.1}
            onChange={(v) => setRate(Math.round(v * 10) / 10)}
            isPercent
          />

          {/* Live result */}
          <div className={cn("grid gap-2 pt-2 border-t", isRefi ? "sm:grid-cols-3" : "sm:grid-cols-4")}>
            <LiveMetric label={t("financing.detail.quickcheck.scenarios.liveLtv")} value={pct(liveLtv)} delta={liveLtv - original.ltv} betterWhenLower />
            <LiveMetric label={t("financing.detail.quickcheck.scenarios.liveAffordability")} value={pct(liveAff)} delta={liveAff - original.affordability} betterWhenLower />
            {!isRefi && <LiveMetric label={t("financing.detail.quickcheck.scenarios.liveEquityRatio")} value={pct(liveEqRatio)} delta={liveEqRatio - original.equityRatio} betterWhenLower={false} />}
            <div className="rounded-lg border p-3 flex flex-col justify-center">
              <p className="text-xs text-muted-foreground">{t("financing.detail.quickcheck.scenarios.status")}</p>
              <Badge className={cn("mt-1 w-fit", qcBadgeTone(liveStatus))}>{t(`financing.quickCheckStatus.${liveStatus}`, { defaultValue: QUICK_CHECK_LABELS[liveStatus] })}</Badge>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setSaveOpen(true)}>{t("financing.detail.quickcheck.scenarios.saveScenario")}</Button>
            <Button variant="outline" onClick={reset}>{t("financing.detail.quickcheck.scenarios.reset")}</Button>
          </div>
        </CardContent>
      </Card>

      {/* BEREICH B — Matrix */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-semibold">{t("financing.detail.quickcheck.scenarios.matrixTitle")}</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] border-separate border-spacing-1 text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left text-xs text-muted-foreground">{t("financing.detail.quickcheck.scenarios.matrixCorner")}</th>
                  {priceSteps.map((dp) => {
                    const v = Math.max(0, live.p + dp);
                    return (
                      <th key={dp} className="p-2 text-center text-xs text-muted-foreground tabular-nums">
                        {chfCompact(v)}
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {incomeSteps.map((di, rowIdx) => {
                  const incomeV = Math.max(0, live.inc + di);
                  return (
                    <tr key={di}>
                      <th className="p-2 text-left text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                        {t("financing.detail.quickcheck.scenarios.matrixPerYearShort", { amount: chfCompact(incomeV) })}
                      </th>
                      {matrix[rowIdx].map((cell, colIdx) => (
                        <td key={colIdx} className="p-0">
                          <div
                            className={cn(
                              "rounded px-2 py-3 text-center text-xs font-medium tabular-nums border-2",
                              cellTone(cell.tone),
                              cell.isCurrent ? borderTone(cell.tone) : "border-transparent",
                            )}
                          >
                            {cell.label}
                          </div>
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3 text-xs">
            <LegendDot tone="ok" label={t("financing.detail.quickcheck.scenarios.legend.realistic")} />
            <LegendDot tone="warn" label={t("financing.detail.quickcheck.scenarios.legend.critical")} />
            <LegendDot tone="bad" label={t("financing.detail.quickcheck.scenarios.legend.notFinanceable")} />
            {!isRefi && <LegendDot tone="gray" label={t("financing.detail.quickcheck.scenarios.legend.eqInsufficient")} />}
          </div>
          <p className="text-xs text-muted-foreground">
            {isRefi
              ? `Annahmen: Kalkulationszins ${live.r.toFixed(1)}%, Nebenkosten ${original.ancillaryPct.toFixed(1)}%, Hypothek ${chf(live.mort)}, Verpflichtungen ${chf(live.expensesYearly)} p.a.`
              : t("financing.detail.quickcheck.scenarios.assumptions", { equity: chf(live.eq), rate: live.r.toFixed(1), anc: original.ancillaryPct.toFixed(1), mortgage: chf(live.mort) })}
          </p>
        </CardContent>
      </Card>

      {/* Saved scenarios */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-semibold">{t("financing.detail.quickcheck.scenarios.savedTitle")}</h3>
          {!scenarios || scenarios.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("financing.detail.quickcheck.scenarios.noneSaved")}</p>
          ) : (
            <div className="grid gap-2 md:grid-cols-2">
              {scenarios.map((s) => {
                const st = (s.status as QuickCheckStatus) ?? "incomplete";
                return (
                  <div key={s.id} className="rounded-lg border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-semibold">{s.bezeichnung}</p>
                        <p className="text-xs text-muted-foreground">{formatDateOnly(s.created_at)}</p>
                      </div>
                      <Badge className={qcBadgeTone(st)}>{t(`financing.quickCheckStatus.${st}`, { defaultValue: QUICK_CHECK_LABELS[st] })}</Badge>
                    </div>
                    <div className="flex gap-3 text-xs text-muted-foreground tabular-nums">
                      <span>{t("financing.detail.quickcheck.scenarios.affordabilityShort")}: <span className="font-medium text-foreground">{s.tragbarkeit != null ? pct(Number(s.tragbarkeit)) : "—"}</span></span>
                      <span>{t("financing.detail.quickcheck.scenarios.ltvShort")}: <span className="font-medium text-foreground">{s.belehnung != null ? pct(Number(s.belehnung)) : "—"}</span></span>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => loadScenario(s)}>{t("financing.detail.quickcheck.scenarios.load")}</Button>
                      <DeleteScenarioButton onConfirm={() => deleteMutation.mutate(s.id)} pending={deleteMutation.isPending} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Save dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("financing.detail.quickcheck.scenarios.saveDialog.title")}</DialogTitle>
            <DialogDescription>{t("financing.detail.quickcheck.scenarios.saveDialog.description")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="scenario-name">{t("financing.detail.quickcheck.scenarios.saveDialog.label")}</Label>
            <Input
              id="scenario-name"
              value={scenarioName}
              onChange={(e) => setScenarioName(e.target.value)}
              placeholder={t("financing.detail.quickcheck.scenarios.saveDialog.placeholder")}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)}>{t("financing.detail.quickcheck.scenarios.saveDialog.cancel")}</Button>
            <Button
              onClick={() => saveMutation.mutate(scenarioName.trim())}
              disabled={!scenarioName.trim() || saveMutation.isPending}
            >
              {saveMutation.isPending ? t("financing.detail.quickcheck.scenarios.saveDialog.saving") : t("financing.detail.quickcheck.scenarios.saveDialog.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function SliderRow({
  label, display, value, min, max, step, onChange, isPercent,
}: {
  label: string; display: string; value: number;
  min: number; max: number; step: number;
  onChange: (v: number) => void; isPercent?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-sm">{label}</Label>
        <span className="text-sm font-medium tabular-nums">{display}</span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(isPercent ? v[0] : Math.round(v[0]))}
      />
    </div>
  );
}

function LiveMetric({
  label, value, delta, betterWhenLower,
}: { label: string; value: string; delta: number; betterWhenLower: boolean }) {
  const { t } = useTranslation();
  const abs = Math.abs(delta);
  const showDelta = abs >= 0.05;
  const isBetter = betterWhenLower ? delta < 0 : delta > 0;
  const colorCls = !showDelta ? "text-muted-foreground" : isBetter ? "text-emerald-600" : "text-muted-foreground";
  const Icon = delta > 0 ? ArrowUp : ArrowDown;
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      {showDelta && (
        <p className={cn("text-xs flex items-center gap-1 tabular-nums", colorCls)}>
          <Icon className="h-3 w-3" />
          {t("financing.detail.quickcheck.scenarios.vsOriginal", { value: abs.toFixed(1) })}
        </p>
      )}
    </div>
  );
}

function DeleteScenarioButton({ onConfirm, pending }: { onConfirm: () => void; pending: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Trash2 className="h-4 w-4" />
      </Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("financing.detail.quickcheck.scenarios.deleteDialog.title")}</AlertDialogTitle>
            <AlertDialogDescription>{t("financing.detail.quickcheck.scenarios.deleteDialog.description")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("financing.detail.quickcheck.scenarios.deleteDialog.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { onConfirm(); setOpen(false); }} disabled={pending}>
              {t("financing.detail.quickcheck.scenarios.deleteDialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function formatDateOnly(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

function LegendDot({ tone, label }: { tone: "ok" | "warn" | "bad" | "gray"; label: string }) {
  const cls =
    tone === "ok" ? "bg-emerald-500"
    : tone === "warn" ? "bg-amber-500"
    : tone === "bad" ? "bg-red-500"
    : "bg-muted-foreground";
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("h-3 w-3 rounded", cls)} />
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}
