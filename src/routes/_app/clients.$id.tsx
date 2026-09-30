import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  ArrowLeft, Mail, Phone, Trash2, RefreshCw, Pencil, FileSignature,
  Calendar, Target, Home, MapPin, Banknote, Ruler, BedDouble, Building2, MessageSquare,
  CalendarPlus, ExternalLink, CheckSquare, FileText, Activity, Plus,
  ClipboardList, Heart, X, User, Users, Upload, ChevronLeft, ChevronRight, Circle, Crown,
} from "lucide-react";
import { AssigneeAvatars, type EmployeeLite } from "@/components/clients/ClientAssignees";
import {
  clientTypeLabels, formatCurrency, formatDate, formatDateTime,
  propertyTypeLabels, propertyStatusLabels, listingTypeLabels, apptTypeLabels,
} from "@/lib/format";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { MatchPanel } from "@/components/matching/MatchPanel";
import { ClientFinanceTab } from "@/components/clients/ClientFinanceTab";
import { ClientSelfDisclosureWizard } from "@/components/clients/ClientSelfDisclosureWizard";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { ClientRelationshipsTab } from "@/components/clients/ClientRelationshipsTab";
import { ClientProfileSummary } from "@/components/clients/ClientProfileSummary";
import { ClientSmartOverview } from "@/components/clients/ClientSmartOverview";
import { ClientAppointmentsTab } from "@/components/clients/ClientAppointmentsTab";
import { ClientEditDialog } from "@/components/clients/ClientEditDialog";
import { ClientQuickActions } from "@/components/clients/ClientQuickActions";
import { BenchmarkCard } from "@/components/clients/BenchmarkCard";
import { useClientBenchmark } from "@/hooks/useClientBenchmark";
import { GeneratedDocumentsTable } from "@/components/documents/GeneratedDocumentsTable";
import { ClientDocumentsTab } from "@/components/clients/ClientDocumentsTab";
import { AssignPropertyDialog } from "@/components/clients/AssignPropertyDialog";
import { FinancingQuickCheckWizard } from "@/components/financing/FinancingQuickCheckWizard";
import {
  QUICK_CHECK_LABELS, DOSSIER_STATUS_LABELS, FINANCING_TYPE_LABELS,
  type QuickCheckStatus, type DossierStatus, type FinancingType,
} from "@/lib/financing";
import { deleteToTrash } from "@/lib/trash";

const CLIENT_STATUSES = [
  { value: "entwurf",       label: "Entwurf",       dot: "bg-slate-400",   badge: "bg-slate-500/15 text-slate-700 border-slate-500/30 dark:text-slate-300" },
  { value: "pendent",       label: "Pendent",       dot: "bg-amber-500",   badge: "bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300" },
  { value: "vollstaendig",  label: "Vollständig",   dot: "bg-blue-500",    badge: "bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300" },
  { value: "finanzierung",  label: "Finanzierung",  dot: "bg-violet-500",  badge: "bg-violet-500/15 text-violet-700 border-violet-500/30 dark:text-violet-300" },
  { value: "abgeschlossen", label: "Abgeschlossen", dot: "bg-emerald-500", badge: "bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300" },
  { value: "abgelehnt",     label: "Abgelehnt",     dot: "bg-red-500",     badge: "bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-300" },
  { value: "storniert",     label: "Storniert",     dot: "bg-zinc-500",    badge: "bg-zinc-500/15 text-zinc-700 border-zinc-500/30 dark:text-zinc-300" },
] as const;
const statusMap = new Map<string, (typeof CLIENT_STATUSES)[number]>(CLIENT_STATUSES.map((s) => [s.value, s]));



export const Route = createFileRoute("/_app/clients/$id")({ component: ClientDetailRoute });

function ClientDetailRoute() {
  const { id } = Route.useParams();
  return <ClientDetail id={id} />;
}

export function ClientDetail({ id, inDialog, onClose, clientIds, onNavigate }: { id: string; inDialog?: boolean; onClose?: () => void; clientIds?: string[]; onNavigate?: (id: string) => void }) {
  const confirm = useConfirm();
  const [editOpen, setEditOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [familyClientId, setFamilyClientId] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(false);
  const [visitedTabs, setVisitedTabs] = useState<string[]>(["overview"]);

  const qc = useQueryClient();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const canLoadProtectedData = !authLoading && !!user;

  useEffect(() => {
    setLoadTimedOut(false);
    setActiveTab("overview");
    setVisitedTabs(["overview"]);
  }, [id]);

  useEffect(() => {
    setVisitedTabs((prev) => (prev.includes(activeTab) ? prev : [...prev, activeTab]));
  }, [activeTab]);

  const { data: client, isLoading, isError, error: clientError, refetch } = useQuery({
    queryKey: ["client", id],
    enabled: canLoadProtectedData,
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("Kunde nicht gefunden");
      return data;
    },
  });

  useEffect(() => {
    if (!isLoading || isError || client) {
      setLoadTimedOut(false);
      return;
    }

    const timeout = window.setTimeout(() => setLoadTimedOut(true), 2500);
    return () => window.clearTimeout(timeout);
  }, [client, id, isError, isLoading]);

  const { data: dossiers = [] } = useQuery({
    queryKey: ["client_financing_dossiers", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financing_dossiers").select("*")
        .or(`client_id.eq.${id},co_applicant_client_id.eq.${id}`)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      // Mark role for display
      return (data ?? []).map((d: any) => ({
        ...d,
        _role: d.client_id === id ? "primary" : "co_applicant",
      }));
    },
    retry: false,
    enabled: canLoadProtectedData && (visitedTabs.includes("overview") || visitedTabs.includes("financing")),
  });

  // Erstes/aktuelles Dossier (für Hero-KPI und Selbstauskunft-Link)
  const dossier = dossiers.find((d: any) => d._role === "primary") ?? dossiers[0] ?? null;

  const { data: appointments = [] } = useQuery({
    queryKey: ["client_appointments", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("appointments").select("*").eq("client_id", id)
        .order("starts_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    retry: false,
    enabled: canLoadProtectedData && (visitedTabs.includes("overview") || visitedTabs.includes("consulting")),
  });

  const { data: matches = [] } = useQuery({
    queryKey: ["client_matches", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("*, properties(*)")
        .eq("client_id", id)
        .order("score", { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    retry: false,
    enabled: canLoadProtectedData && (visitedTabs.includes("overview") || visitedTabs.includes("matching")),
  });

  // Budget-Quelle: expliziter Kundenbudget, sonst aus zuletzt berechneter Finanzierung
  const dossierForBudget: any = dossier;
  const dossierBudget = dossierForBudget
    ? (Number(dossierForBudget.purchase_price ?? dossierForBudget.property_value ?? 0) || null)
    : null;
  const effectiveBudget = Number((client as any)?.budget_max ?? 0) || dossierBudget || null;

  // Vorgeschlagene Objekte, falls noch keine echten Matches existieren
  const { data: suggestedMatchesCount = 0 } = useQuery({
    queryKey: ["client_suggested_matches_count", id, effectiveBudget],
    queryFn: async () => {
      if (!effectiveBudget) return 0;
      const { count } = await supabase
        .from("properties")
        .select("id", { count: "exact", head: true })
        .eq("listing_type", "sale")
        .eq("status", "active")
        .lte("price", effectiveBudget * 1.05)
        .gte("price", effectiveBudget * 0.6);
      return count ?? 0;
    },
    retry: false,
    enabled: canLoadProtectedData && !!effectiveBudget && (client as any)?.client_type !== "seller" && (client as any)?.client_type !== "landlord" && visitedTabs.includes("overview"),
  });
  const matchCountDisplay = matches.length > 0 ? matches.length : suggestedMatchesCount;

  const { data: documentsCount = 0 } = useQuery({
    queryKey: ["client_documents_count", id],
    queryFn: async () => {
      const { count } = await supabase.from("documents")
        .select("id", { count: "exact", head: true })
        .eq("related_type", "client").eq("related_id", id);
      return count ?? 0;
    },
    enabled: canLoadProtectedData && visitedTabs.includes("documents"),
  });

  const { data: familyCount = 0 } = useQuery({
    queryKey: ["client_family_count", id],
    queryFn: async () => {
      const [rels, relsRev, children] = await Promise.all([
        supabase.from("client_relationships").select("id", { count: "exact", head: true }).eq("client_id", id),
        supabase.from("client_relationships").select("id", { count: "exact", head: true }).eq("related_client_id", id),
        supabase.from("client_children").select("id", { count: "exact", head: true }).eq("client_id", id),
      ]);
      return (rels.count ?? 0) + (relsRev.count ?? 0) + (children.count ?? 0);
    },
    enabled: canLoadProtectedData,
  });

  const toggleFamilyHead = useMutation({
    mutationFn: async (makeHead: boolean) => {
      if (makeHead) {
        const { data: rels } = await supabase
          .from("client_relationships")
          .select("client_id, related_client_id")
          .or(`client_id.eq.${id},related_client_id.eq.${id}`);
        const others = Array.from(
          new Set((rels ?? []).flatMap((r: any) => [r.client_id, r.related_client_id])),
        ).filter((c) => c && c !== id) as string[];
        if (others.length > 0) {
          const { error } = await supabase.from("clients").update({ is_family_head: false }).in("id", others);
          if (error) throw error;
        }
      }
      const { error } = await supabase.from("clients").update({ is_family_head: makeHead }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, makeHead) => {
      toast.success(makeHead ? "Als Hauptmitglied festgelegt" : "Hauptmitglied entfernt");
      qc.invalidateQueries({ queryKey: ["client"] });
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["client_relationships"] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Fehlgeschlagen"),
  });


  const { data: ownProperties = [] } = useQuery({
    queryKey: ["client_own_properties", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("properties").select("*").eq("seller_client_id", id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    retry: false,
    enabled: canLoadProtectedData && (visitedTabs.includes("overview") || visitedTabs.includes("properties")),
  });

  const { data: assignedProperties = [] } = useQuery({
    queryKey: ["client_assigned_properties", id],
    queryFn: async () => {
      const { data: roles, error } = await supabase
        .from("client_roles")
        .select("id, role_type, related_id, start_date, notes")
        .eq("client_id", id)
        .eq("related_type", "property")
        .eq("status", "active");
      if (error) throw error;
      const ids = (roles ?? []).map((r: any) => r.related_id).filter(Boolean);
      if (ids.length === 0) return [] as any[];
      const { data: props } = await supabase.from("properties").select("*").in("id", ids);
      const byId = new Map((props ?? []).map((p: any) => [p.id, p]));
      return (roles ?? [])
        .map((r: any) => ({ ...r, property: byId.get(r.related_id) }))
        .filter((r: any) => r.property);
    },
    retry: false,
    enabled: canLoadProtectedData && visitedTabs.includes("properties"),
  });

  const { data: clientStatusFlags } = useQuery({
    queryKey: ["client_status_flags", id],
    queryFn: async () => {
      const [sd, fp, rv] = await Promise.all([
        supabase.from("client_self_disclosures").select("status").eq("client_id", id).in("status", ["submitted", "reviewed"]).limit(1),
        supabase.from("financing_profiles").select("profile_status,approval_status").eq("client_id", id).maybeSingle(),
        supabase.from("reservations").select("id,status").eq("client_id", id).in("status", ["sent", "signed"]).limit(1),
      ]);
      return {
        selfDisclosureSubmitted: (sd.data?.length ?? 0) > 0,
        financing: fp.data ?? null,
        hasActiveReservation: (rv.data?.length ?? 0) > 0,
      };
    },
    retry: false,
    enabled: canLoadProtectedData && visitedTabs.includes("overview"),
  });

  const { data: benchmarkData } = useClientBenchmark(id, canLoadProtectedData && (visitedTabs.includes("overview") || visitedTabs.includes("matching")));
  const benchmark = benchmarkData?.benchmark ?? null;

  const ownerUserId = (client as any)?.assigned_to ?? (client as any)?.owner_id ?? null;
  const { data: ownerProfile } = useQuery({
    queryKey: ["client_owner_profile", ownerUserId],
    enabled: canLoadProtectedData && !!ownerUserId && visitedTabs.includes("overview"),
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles").select("id,full_name,email")
        .eq("id", ownerUserId).maybeSingle();
      return data;
    },
    retry: false,
  });
  const ownerLabel = ownerProfile?.full_name || ownerProfile?.email || null;

  // Ansprechpartner (Mehrfachzuweisung) mit Profilbild
  const { data: assigneeData } = useQuery({
    queryKey: ["client_assignee_profiles", id],
    enabled: canLoadProtectedData && !!id,
    retry: false,
    queryFn: async () => {
      const { data: rows } = await supabase.from("client_assignees").select("user_id").eq("client_id", id);
      const ids = Array.from(new Set([...(rows ?? []).map((r: any) => r.user_id), ...(ownerUserId ? [ownerUserId] : [])]));
      if (!ids.length) return { ids: [] as string[], people: [] as EmployeeLite[] };
      const { data: profs } = await supabase.from("profiles").select("id,full_name,email,avatar_url").in("id", ids);
      return { ids, people: (profs ?? []) as EmployeeLite[] };
    },
  });
  const assigneeIds = assigneeData?.ids ?? [];
  const assigneeMap = useMemo(
    () => new Map((assigneeData?.people ?? []).map((p) => [p.id, p])),
    [assigneeData],
  );


  const del = useMutation({
    mutationFn: async () => {
      await deleteToTrash("clients", id);
    },
    onSuccess: () => {
      toast.success("Gelöscht");
      if (inDialog) { onClose?.(); qc.invalidateQueries({ queryKey: ["clients"] }); }
      else navigate({ to: "/clients" });
    },
    onError: (e: any) => toast.error(e.message ?? "Fehler beim Löschen"),
  });

  const statusUpdate = useMutation({
    mutationFn: async (status: string) => {
      const { error } = await supabase.from("clients").update({ status: status as any }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Status aktualisiert");
      qc.invalidateQueries({ queryKey: ["client", id] });
      qc.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (e: any) => toast.error(e.message ?? "Fehler beim Aktualisieren"),
  });

  const currentStatus = statusMap.get(client?.status ?? "") ?? CLIENT_STATUSES[0];

  if (authLoading) return <div className="text-sm text-muted-foreground">Authentifizierung wird geprüft…</div>;
  if (isLoading && !isError && !loadTimedOut) return <div className="text-sm text-muted-foreground">Lädt…</div>;
  if (isLoading && !isError && loadTimedOut) return <div className="text-sm text-muted-foreground">Lade Kundendaten…</div>;
  if (clientError || !client) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" asChild><Link to="/clients"><ArrowLeft className="mr-1 h-4 w-4" />Zurück</Link></Button>
        <Card><CardContent className="p-6">
          <h2 className="font-display text-lg font-semibold">Kunde konnte nicht geladen werden</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {(clientError as any)?.message ?? "Datenbank derzeit nicht erreichbar. Bitte gleich erneut versuchen."}
          </p>
          <Button className="mt-4" onClick={() => refetch()}><RefreshCw className="mr-1.5 h-4 w-4" />Erneut versuchen</Button>
        </CardContent></Card>
      </div>
    );
  }

  const isSeller = client.client_type === "seller" || client.client_type === "landlord";
  const upcoming = appointments.filter((a: any) => new Date(a.starts_at) >= new Date());
  const past = appointments.filter((a: any) => new Date(a.starts_at) < new Date());

  const StatusSelect = (
    <Select
      value={client?.status ?? "entwurf"}
      onValueChange={(v) => statusUpdate.mutate(v)}
      disabled={statusUpdate.isPending}
    >
      <SelectTrigger className="h-8 w-[160px] gap-2 rounded-full border border-input bg-background px-3 text-xs font-medium text-foreground shadow-none hover:bg-accent">
        <SelectValue placeholder="Status" />
      </SelectTrigger>
      <SelectContent>
        {CLIENT_STATUSES.map((s) => (
          <SelectItem key={s.value} value={s.value} className="gap-3 pl-3 pr-8">
            <span className="flex items-center gap-3">
              <span className={`inline-block h-3 w-3 rounded-full ${s.dot}`} />
              <span className="text-sm">{s.label}</span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className={inDialog ? "flex min-h-0 flex-1 flex-col overflow-hidden" : ""}>
      <ClientSelfDisclosureWizard
        clientId={id}
        open={editOpen}
        onOpenChange={setEditOpen}
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className={inDialog ? "flex min-h-0 flex-1 flex-col overflow-hidden" : "space-y-6"}>
        <div className={inDialog ? "shrink-0 px-6 pt-6 bg-background" : ""}>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            {inDialog ? (
              <div className="flex flex-wrap items-center gap-3">
                {clientIds && clientIds.length > 1 && onNavigate && (
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={clientIds.indexOf(id) <= 0}
                      onClick={() => {
                        const idx = clientIds.indexOf(id);
                        if (idx > 0) onNavigate(clientIds[idx - 1]);
                      }}
                      title="Vorheriger Kunde"
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <span className="min-w-[44px] text-center text-xs tabular-nums text-muted-foreground">
                      {clientIds.indexOf(id) + 1} / {clientIds.length}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      disabled={clientIds.indexOf(id) >= clientIds.length - 1}
                      onClick={() => {
                        const idx = clientIds.indexOf(id);
                        if (idx < clientIds.length - 1) onNavigate(clientIds[idx + 1]);
                      }}
                      title="Nächster Kunde"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                )}
                {StatusSelect}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="ghost" asChild>
                  <Link to="/clients"><ArrowLeft className="mr-1 h-4 w-4" />Zurück</Link>
                </Button>
                {StatusSelect}
              </div>
            )}
            <div className="flex gap-2">
              <ClientQuickActions client={client} />
              <Button variant="outline" size="sm" disabled title="Beratung (Demnächst verfügbar)">
                <MessageSquare className="mr-1.5 h-4 w-4" />Beratung
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="mr-1.5 h-4 w-4" />Kunde bearbeiten
              </Button>
              <Button variant="outline" size="icon" title="Aktivitäten" onClick={() => setActivityOpen(true)}>
                <Activity className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={async () => { if (await confirm({ title: "Kunde löschen?", description: "Diese Aktion kann nicht rückgängig werden.", confirmText: "Löschen" })) del.mutate(); }}>
                <Trash2 className="h-4 w-4" />
              </Button>
              {inDialog && (
                <Button variant="outline" size="icon" onClick={onClose}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        <section className={inDialog ? "relative overflow-hidden rounded-2xl bg-sidebar/15 p-6 pb-2 shadow-[var(--shadow-soft)] ring-1 ring-sidebar/20" : "relative overflow-hidden rounded-2xl border border-sidebar/25 bg-sidebar/15 p-6 pb-2 shadow-[var(--shadow-soft)] ring-1 ring-sidebar/20"}>
          {!inDialog && <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-primary/60 via-primary/80 to-primary/40" />}

          {/* Hero */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="secondary">{clientTypeLabels[client.client_type as keyof typeof clientTypeLabels]}</Badge>
                {clientStatusFlags?.selfDisclosureSubmitted && (
                  <Badge className="bg-emerald-600 hover:bg-emerald-600">Selbstauskunft eingereicht</Badge>
                )}
                {clientStatusFlags?.financing && (
                  clientStatusFlags.financing.approval_status === "approved" || clientStatusFlags.financing.profile_status === "complete" ? (
                    <Badge className="bg-emerald-600 hover:bg-emerald-600">Finanzierung bereit</Badge>
                  ) : (
                    <Badge className="bg-amber-500 hover:bg-amber-500">Finanzierung in Prüfung</Badge>
                  )
                )}
                {clientStatusFlags?.hasActiveReservation && (
                  <Badge className="bg-amber-500 hover:bg-amber-500">Aktive Reservation</Badge>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <h1 className="font-display text-3xl font-bold">{client.full_name}</h1>
                {(client as any).is_family_head ? (
                  <button
                    type="button"
                    title="Als Hauptmitglied entfernen"
                    onClick={() => toggleFamilyHead.mutate(false)}
                    disabled={toggleFamilyHead.isPending}
                    className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 ring-1 ring-amber-300 transition hover:bg-amber-200"
                  >
                    <Crown className="h-3.5 w-3.5" />Hauptmitglied
                  </button>
                ) : (
                  <button
                    type="button"
                    title="Als Hauptmitglied festlegen"
                    onClick={() => toggleFamilyHead.mutate(true)}
                    disabled={toggleFamilyHead.isPending}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed px-2 py-0.5 text-xs font-medium text-muted-foreground transition hover:bg-amber-100 hover:text-amber-700"
                  >
                    <Crown className="h-3.5 w-3.5" />Als Hauptmitglied
                  </button>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                {client.email && (
                  <a href={`mailto:${client.email}`} className="flex items-center gap-1.5 hover:text-primary">
                    <Mail className="h-4 w-4" />{client.email}
                  </a>
                )}
                {client.phone && (
                  <a href={`tel:${client.phone}`} className="flex items-center gap-1.5 hover:text-primary">
                    <Phone className="h-4 w-4" />{client.phone}
                  </a>
                )}
                <span className="flex items-center gap-1.5">
                  <Calendar className="h-4 w-4" />Angelegt {formatDate(client.created_at)}
                </span>
                {assigneeIds.length > 0 ? (
                  <span className="flex items-center gap-2">
                    <User className="h-4 w-4" />Ansprechpartner:
                    <AssigneeAvatars ids={assigneeIds} employeeMap={assigneeMap} size="xs" />
                  </span>
                ) : ownerLabel ? (
                  <span className="flex items-center gap-1.5">
                    <User className="h-4 w-4" />Ansprechpartner: {ownerLabel}
                  </span>
                ) : null}

              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {client.email && (
                <Button variant="outline" size="sm" asChild>
                  <a href={`mailto:${client.email}`}><Mail className="mr-1.5 h-4 w-4" />Mail</a>
                </Button>
              )}
              {client.phone && (
                <Button variant="outline" size="sm" asChild>
                  <a href={`tel:${client.phone}`}><Phone className="mr-1.5 h-4 w-4" />Anrufen</a>
                </Button>
              )}
            </div>
          </div>

          {/* KPIs */}
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat icon={<Target className="h-3.5 w-3.5" />} label="Matches" value={matchCountDisplay} />
            <Stat icon={<Calendar className="h-3.5 w-3.5" />} label="Termine" value={appointments.length} />
            <Stat
              icon={<FileSignature className="h-3.5 w-3.5" />}
              label="Finanzierung"
              value={
                dossier?.quick_check_status
                  ? (QUICK_CHECK_LABELS[dossier.quick_check_status as QuickCheckStatus] ?? dossier.quick_check_status)
                  : dossier
                    ? `${dossier.completion_percent}%`
                    : "—"
              }
            />
            <Stat
              icon={<Home className="h-3.5 w-3.5" />}
              label={isSeller ? "Eigene Objekte" : "Budget"}
              value={
                isSeller
                  ? ownProperties.length
                  : effectiveBudget
                    ? formatCurrency(effectiveBudget)
                    : "—"
              }
            />
          </div>

          <TabsList className="mt-6 flex h-auto w-full flex-wrap items-center gap-1 bg-transparent p-0 shadow-none">
            <TabsTrigger
              value="overview"
              className="relative flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground rounded-xl border border-transparent transition-all hover:bg-sidebar/25 hover:backdrop-blur-xl hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.08)] data-[state=active]:border-border/60"
            >
              Übersicht
            </TabsTrigger>
            <TabsTrigger
              value="family"
              className="relative flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground rounded-xl border border-transparent transition-all hover:bg-sidebar/25 hover:backdrop-blur-xl hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.08)] data-[state=active]:border-border/60"
            >
              <Users className="h-4 w-4" />Familie
              {familyCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5 text-xs tabular-nums">{familyCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="disclosure"
              className="relative flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground rounded-xl border border-transparent transition-all hover:bg-sidebar/25 hover:backdrop-blur-xl hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.08)] data-[state=active]:border-border/60"
            >
              <ClipboardList className="h-4 w-4" />Finanzen
            </TabsTrigger>


            <TabsTrigger
              value="financing"
              className="relative flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground rounded-xl border border-transparent transition-all hover:bg-sidebar/25 hover:backdrop-blur-xl hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.08)] data-[state=active]:border-border/60"
            >
              <FileSignature className="h-4 w-4" />Finanzierung
              {dossier?.quick_check_status && (
                <Badge
                  variant="secondary"
                  className={
                    "ml-1 h-5 px-1.5 text-[10px] font-medium " +
                    (dossier.quick_check_status === "realistic"
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30"
                      : dossier.quick_check_status === "critical"
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30"
                        : dossier.quick_check_status === "not_financeable"
                          ? "bg-red-500/15 text-red-700 dark:text-red-300 border-red-500/30"
                          : "")
                  }
                >
                  {QUICK_CHECK_LABELS[dossier.quick_check_status as QuickCheckStatus] ?? dossier.quick_check_status}
                </Badge>
              )}
              {!dossier?.quick_check_status && dossier && (
                <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5 text-xs tabular-nums">{dossier.completion_percent}%</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="properties"
              className="relative flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground rounded-xl border border-transparent transition-all hover:bg-sidebar/25 hover:backdrop-blur-xl hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.08)] data-[state=active]:border-border/60"
            >
              <Building2 className="h-4 w-4" />Immobilien
              {(ownProperties.length + assignedProperties.length) > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5 text-xs tabular-nums">{ownProperties.length + assignedProperties.length}</Badge>
              )}
            </TabsTrigger>
            {!inDialog && (
              <TabsTrigger
                value="matching"
                className="relative flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground rounded-xl border border-transparent transition-all hover:bg-sidebar/25 hover:backdrop-blur-xl hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.08)] data-[state=active]:border-border/60"
              >
                <Target className="h-4 w-4" />Matching
                {matchCountDisplay > 0 && (
                  <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5 text-xs tabular-nums">{matchCountDisplay}</Badge>
                )}
              </TabsTrigger>
            )}
            <TabsTrigger
              value="documents"
              className="relative flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground rounded-xl border border-transparent transition-all hover:bg-sidebar/25 hover:backdrop-blur-xl hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.08)] data-[state=active]:border-border/60"
            >
              <FileText className="h-4 w-4" />Dokumente
              {documentsCount > 0 && (
                <Badge variant="secondary" className="ml-1 h-5 min-w-5 px-1.5 text-xs tabular-nums">{documentsCount}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger
              value="appointments"
              className="relative flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground rounded-xl border border-transparent transition-all hover:bg-sidebar/25 hover:backdrop-blur-xl hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.12),0_1px_3px_rgba(0,0,0,0.08)] data-[state=active]:border-border/60"
            >
              <Calendar className="h-4 w-4" />Termine
            </TabsTrigger>
          </TabsList>
        </section>
        </div>

        <div className={inDialog ? "max-h-[calc(92dvh-22rem)] min-h-[16rem] overflow-y-auto overscroll-contain px-6 pb-6" : "contents"}>

        {/* 1. Übersicht */}
        <TabsContent value="overview" className="mt-6 space-y-4">
          <BenchmarkOrPlaceholder benchmark={benchmark} compact />

          <ClientSmartOverview clientId={id} client={client} onJumpTab={setActiveTab} />

          {client.notes && (
            <Card>
              <CardContent className="p-6">
                <div className="mb-3 flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-display text-lg font-semibold">Notizen</h3>
                </div>
                <p className="whitespace-pre-wrap text-sm text-muted-foreground">{client.notes}</p>
              </CardContent>
            </Card>
          )}

        </TabsContent>



        {/* 3. Finanzen */}
        <TabsContent value="disclosure" className="mt-6 space-y-4">
          <ClientFinanceTab
            clientId={id}
            clientEmail={client.email}
            userId={user?.id}
          />
        </TabsContent>

        {/* 3b. Familie */}
        <TabsContent value="family" className="mt-6 space-y-4">
          <Card><CardContent className="p-6">
            <div className="mb-4 flex items-center gap-2">
              <Heart className="h-4 w-4 text-muted-foreground" />
              <h3 className="font-display text-lg font-semibold">Familie & Verknüpfungen</h3>
            </div>
            <ClientRelationshipsTab
              clientId={id}
              onOpenClient={(cid) => {
                if (inDialog && onNavigate) onNavigate(cid);
                else setFamilyClientId(cid);
              }}
            />
          </CardContent></Card>

          <Dialog open={!!familyClientId} onOpenChange={(o) => !o && setFamilyClientId(null)}>
            <DialogContent className="flex h-[92dvh] max-h-[92dvh] min-h-0 w-[min(96vw,72rem)] max-w-6xl flex-col gap-0 overflow-hidden p-0 sm:rounded-2xl [&>button]:hidden">
              <DialogTitle className="sr-only">Kundendetails</DialogTitle>
              {familyClientId && (
                <ClientDetail id={familyClientId} inDialog onClose={() => setFamilyClientId(null)} />
              )}
            </DialogContent>
          </Dialog>
        </TabsContent>



        {/* 4. Finanzierung */}
        <TabsContent value="financing" className="mt-6">
          <FinancingTab
            clientId={id}
            dossiers={dossiers}
            onChange={() => {
              qc.invalidateQueries({ queryKey: ["client_financing_dossiers", id] });
            }}
          />
        </TabsContent>

        {/* 5. Immobilien */}
        <TabsContent value="properties" className="mt-6 space-y-4">
          <Card><CardContent className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h3 className="font-display text-lg font-semibold">
                  {isSeller ? "Eigene Objekte" : "Zugewiesene Objekte"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {isSeller
                    ? "Objekte, bei denen dieser Kunde als Verkäufer/Vermieter eingetragen ist."
                    : "Objekte, die diesem Kunden zugewiesen sind."}
                </p>
              </div>
              <AssignPropertyDialog clientId={id} />
            </div>
            {ownProperties.length === 0 && assignedProperties.length === 0 ? (
              <div className="rounded-xl border border-dashed p-8 text-center">
                <Building2 className="mx-auto mb-2 h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">Dieser Kunde hat noch keine zugewiesene Immobilie.</p>
                <div className="mt-3 inline-flex">
                  <AssignPropertyDialog
                    clientId={id}
                    trigger={
                      <Button size="sm" variant="outline">
                        <Building2 className="mr-1.5 h-4 w-4" />Immobilie zuweisen
                      </Button>
                    }
                  />
                </div>
              </div>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {ownProperties.map((p: any) => (
                  <Link key={`own-${p.id}`} to="/properties/$id" params={{ id: p.id }}
                    className="rounded-xl border p-4 transition hover:border-primary hover:shadow-glow"
                  >
                    <div className="flex items-start justify-between">
                      <p className="font-medium">{p.title}</p>
                      <Badge variant="outline">{propertyStatusLabels[p.status as keyof typeof propertyStatusLabels]}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {p.city ?? "—"} · {p.price ? formatCurrency(Number(p.price)) : p.rent ? formatCurrency(Number(p.rent)) + "/Monat" : "—"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      <Badge variant="secondary" className="text-[10px]">Verkäufer</Badge>
                      <Badge variant="secondary" className="text-[10px]">
                        {propertyTypeLabels[p.property_type as keyof typeof propertyTypeLabels]}
                      </Badge>
                    </div>
                  </Link>
                ))}
                {assignedProperties.map((r: any) => {
                  const p = r.property;
                  const roleLabels: Record<string, string> = {
                    owner: "Eigentümer", buyer: "Kaufinteressent", former_owner: "Ehem. Eigentümer",
                    seller: "Verkäufer", tenant: "Mieter", landlord: "Vermieter",
                    investor: "Investor", contact_person: "Kontaktperson", general_contact: "Kontakt",
                  };
                  return (
                    <Link key={`role-${r.id}`} to="/properties/$id" params={{ id: p.id }}
                      className="rounded-xl border p-4 transition hover:border-primary hover:shadow-glow"
                    >
                      <div className="flex items-start justify-between">
                        <p className="font-medium">{p.title}</p>
                        <Badge variant="outline">{propertyStatusLabels[p.status as keyof typeof propertyStatusLabels]}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {p.city ?? "—"} · {p.price ? formatCurrency(Number(p.price)) : p.rent ? formatCurrency(Number(p.rent)) + "/Monat" : "—"}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Badge className="text-[10px]">{roleLabels[r.role_type] ?? r.role_type}</Badge>
                        <Badge variant="secondary" className="text-[10px]">
                          {propertyTypeLabels[p.property_type as keyof typeof propertyTypeLabels]}
                        </Badge>
                      </div>
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent></Card>

          <ClientProfileSummary clientId={id} entityType={client.entity_type} sections={["ownerships", "contacts"]} />
        </TabsContent>

        {/* 6. Matching (nicht im Dialog) */}
        {!inDialog && (
          <TabsContent value="matching" className="mt-6 space-y-4">
            <Card><CardContent className="p-6">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h3 className="font-display text-lg font-semibold">Passende Objekte</h3>
                  <p className="text-xs text-muted-foreground">Auf Basis von Budget, Lage und Eckdaten aus Selbstauskunft & Profil.</p>
                </div>
                <Button size="sm" variant="outline" asChild>
                  <Link to="/matching" search={{ clientId: id, view: "client" as const, profileId: "" }}>
                    <Target className="mr-1.5 h-4 w-4" />Matching-Übersicht
                  </Link>
                </Button>
              </div>
              {benchmark && (benchmark.status === "tight" || benchmark.status === "critical") && (
                <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-400">
                  Hinweis: Finanz-Benchmark ist «{benchmark.status === "tight" ? "knapp" : "kritisch"}». Tragfähigkeit vor Vermittlung prüfen.
                </div>
              )}
              <MatchPanel direction="client-to-property" client={client} />
            </CardContent></Card>

            {isSeller && (
              <Card><CardContent className="p-6">
                <h3 className="mb-4 font-display text-lg font-semibold">Eigene Objekte</h3>
                {ownProperties.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Diesem Kunden sind noch keine Objekte zugeordnet.</p>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {ownProperties.map((p: any) => (
                      <Link key={p.id} to="/properties/$id" params={{ id: p.id }}
                        className="rounded-xl border p-4 transition hover:border-primary hover:shadow-glow"
                      >
                        <div className="flex items-start justify-between">
                          <p className="font-medium">{p.title}</p>
                          <Badge variant="outline">{propertyStatusLabels[p.status as keyof typeof propertyStatusLabels]}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {p.city ?? "—"} · {p.price ? formatCurrency(Number(p.price)) : "—"}
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent></Card>
            )}

            <ClientProfileSummary clientId={id} entityType={client.entity_type} sections={["searchProfiles"]} />
          </TabsContent>
        )}

        {/* 7. Dokumente */}
        <TabsContent value="documents" className="mt-6">
          <ClientDocumentsTab clientId={id} userId={user!.id} />
        </TabsContent>

        <TabsContent value="appointments" className="mt-6">
          <ClientAppointmentsTab clientId={id} />
        </TabsContent>

        {/* 8. Aktivitäten (über Icon-Button im Header erreichbar) */}
        <Dialog open={activityOpen} onOpenChange={setActivityOpen}>
          <DialogContent className="max-h-[85dvh] max-w-2xl overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Activity className="h-5 w-5" />Aktivitäten – {client.full_name}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <ClientProfileSummary clientId={id} entityType={client.entity_type} sections={["roles"]} />
              <ClientActivityTab clientId={id} userId={user!.id} notes={client.notes} />
            </div>
          </DialogContent>
        </Dialog>
        </div>
      </Tabs>
    </div>
  );
}

function BenchmarkOrPlaceholder({
  benchmark,
  compact,
}: {
  benchmark: any;
  compact?: boolean;
}) {
  if (benchmark) {
    return <BenchmarkCard benchmark={benchmark} variant={compact ? "compact" : "full"} />;
  }
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col gap-3 p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <ClipboardList className="h-5 w-5" />
          </div>
          <div>
            <p className="font-medium">Finanz-Benchmark noch leer</p>
            <p className="text-sm text-muted-foreground">
              Selbstauskunft erfassen – die Reservequote wird live berechnet.
            </p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground sm:text-right">
          Wechsle zum Tab «Finanzierung & Selbstauskunft»,<br className="hidden sm:inline" />
          um Einnahmen und Ausgaben zu erfassen oder einen externen Link zu senden.
        </p>
      </CardContent>
    </Card>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-background/60 px-2.5 py-2">
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">{icon}{label}</div>
      <p className="mt-0.5 text-base font-semibold">{value}</p>
    </div>
  );
}

function Field({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs uppercase text-muted-foreground">{icon}{label}</div>
      <p className="mt-1 text-sm font-medium">{value}</p>
    </div>
  );
}

function KPI({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-background/60 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-sm font-semibold">{value}</div>
    </div>
  );
}

function AppointmentRow({ appt }: { appt: any }) {
  return (
    <div className="flex items-center justify-between rounded-xl border p-4">
      <div>
        <p className="font-medium">{appt.title}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {formatDateTime(appt.starts_at)} · {apptTypeLabels[appt.appointment_type as keyof typeof apptTypeLabels]}
          {appt.location ? ` · ${appt.location}` : ""}
        </p>
      </div>
      <Badge variant="outline">{appt.status}</Badge>
    </div>
  );
}

function NewAppointmentButton({
  clientId, userId, onCreated,
}: { clientId: string; userId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: "Besichtigung",
    appointment_type: "viewing" as "viewing" | "meeting" | "call" | "other",
    starts_at: "",
    ends_at: "",
    location: "",
    notes: "",
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.title || !form.starts_at || !form.ends_at) throw new Error("Titel, Start und Ende sind erforderlich");
      const { error } = await supabase.from("appointments").insert({
        owner_id: userId, client_id: clientId,
        title: form.title, appointment_type: form.appointment_type,
        starts_at: new Date(form.starts_at).toISOString(),
        ends_at: new Date(form.ends_at).toISOString(),
        location: form.location || null, notes: form.notes || null,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success("Termin angelegt"); setOpen(false); onCreated(); },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" onClick={() => setOpen(true)}><CalendarPlus className="mr-1.5 h-4 w-4" />Neuer Termin</Button>
      <DialogContent>
        <DialogHeader><DialogTitle>Neuer Termin</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Titel</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
          <div>
            <Label>Typ</Label>
            <Select value={form.appointment_type} onValueChange={(v: any) => setForm({ ...form, appointment_type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(apptTypeLabels) as Array<keyof typeof apptTypeLabels>).map(k =>
                  <SelectItem key={k} value={k}>{apptTypeLabels[k]}</SelectItem>
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Start</Label><Input type="datetime-local" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} /></div>
            <div><Label>Ende</Label><Input type="datetime-local" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} /></div>
          </div>
          <div><Label>Ort</Label><Input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></div>
          <div><Label>Notizen</Label><Textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>Speichern</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// EditClientDialog wurde durch ClientEditDialog (Stammdaten-only) ersetzt.

function FinancingTab({
  clientId, dossiers, onChange,
}: {
  clientId: string;
  dossiers: any[];
  onChange: () => void;
}) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const navigate = useNavigate();

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-display text-lg font-semibold">Finanzierungs-Dossiers</h3>
            <p className="text-sm text-muted-foreground">
              Zentrale Finanzierungen für diesen Kunden. Jedes Dossier kann
              Finanzierung, Selbstauskunft, Dokumente und Bank-Einreichung enthalten.
            </p>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setWizardOpen(true)}>
              <Plus className="mr-1.5 h-4 w-4" />Neues Finanzierungsdossier
            </Button>
          </div>
        </CardContent>
      </Card>

      {dossiers.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <FileSignature className="mx-auto h-10 w-10 text-muted-foreground" />
            <h3 className="mt-4 font-display text-lg font-semibold">Noch kein Finanzierungsdossier</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Starte eine Finanzierung, um die Finanzierbarkeit für diesen Kunden zu prüfen.
            </p>
            <div className="mt-6">
              <Button onClick={() => setWizardOpen(true)}>
                <Plus className="mr-1.5 h-4 w-4" />Finanzierung starten
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {dossiers.map((d: any) => {
            const reasons: Array<{ key: string; label: string; tone: "ok" | "warn" | "bad" }> =
              Array.isArray(d.quick_check_reasons) ? d.quick_check_reasons : [];
            const qcStatus = d.quick_check_status as QuickCheckStatus | null;
            const dossierStatus = (d.dossier_status ?? "draft") as DossierStatus;
            const qcTone =
              qcStatus === "realistic" ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
              : qcStatus === "critical" ? "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400"
              : qcStatus === "not_financeable" ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-400"
              : "border-border bg-muted/30 text-muted-foreground";
            return (
              <Card key={d.id} className="transition hover:shadow-md">
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-start gap-4">
                    <div className="flex-1 min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-medium truncate">
                          {d.title || `Dossier vom ${formatDate(d.created_at)}`}
                        </p>
                        {d._role === "co_applicant" && (
                          <Badge variant="secondary" className="bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30">
                            Als Ehepartner / Mitantragsteller
                          </Badge>
                        )}
                        {d.financing_type && (
                          <Badge variant="secondary">
                            {FINANCING_TYPE_LABELS[d.financing_type as FinancingType] ?? d.financing_type}
                          </Badge>
                        )}
                        <Badge variant="outline">
                          {DOSSIER_STATUS_LABELS[dossierStatus] ?? dossierStatus}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                        {d.bank_name && <span>Bank: {d.bank_name}</span>}
                        <span>Aktualisiert {formatDate(d.updated_at)}</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => navigate({ to: "/financing/$id", params: { id: d.id } })}
                      >
                        <Pencil className="mr-1.5 h-4 w-4" />Bearbeiten
                      </Button>
                    </div>
                  </div>

                  {/* Quick-Check Zusammenfassung */}
                  <div className={`rounded-lg border p-3 ${qcTone}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-xs font-semibold uppercase tracking-wide">
                        Finanzierung: {qcStatus ? (QUICK_CHECK_LABELS[qcStatus] ?? qcStatus) : "Noch nicht durchgeführt"}
                      </div>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <KPI label="Tragbarkeit" value={d.affordability_ratio != null ? `${Number(d.affordability_ratio).toFixed(1)}%` : "—"} />
                      <KPI label="Belehnung" value={d.loan_to_value_ratio != null ? `${Number(d.loan_to_value_ratio).toFixed(1)}%` : "—"} />
                      <KPI label="Hypothek" value={d.requested_mortgage != null ? formatCurrency(Number(d.requested_mortgage)) : "—"} />
                      <KPI label="Eigenmittel" value={d.own_funds_total != null ? formatCurrency(Number(d.own_funds_total)) : "—"} />
                    </div>
                    {reasons.length > 0 && (
                      <ul className="mt-3 space-y-1 text-xs">
                        {reasons.map((r, i) => (
                          <li key={`${r.key}-${i}`} className="flex items-start gap-1.5">
                            <span className={
                              r.tone === "ok" ? "text-emerald-600 dark:text-emerald-400"
                              : r.tone === "warn" ? "text-amber-600 dark:text-amber-400"
                              : "text-red-600 dark:text-red-400"
                            }>
                              {r.tone === "ok" ? "✓" : r.tone === "warn" ? "!" : "✕"}
                            </span>
                            <span>{r.label}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <FinancingQuickCheckWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        defaultClientId={clientId}
        onCreated={(id: string) => {
          setWizardOpen(false);
          onChange();
          navigate({ to: "/financing/$id", params: { id } });
        }}
      />
    </div>
  );
}

function ClientTasksTab({ clientId, userId }: { clientId: string; userId: string }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ title: "", description: "", due_date: "", priority: "normal" });

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["client_tasks", clientId],
    queryFn: async () => {
      const { data } = await supabase.from("tasks").select("*")
        .eq("related_type", "client").eq("related_id", clientId)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!form.title.trim()) throw new Error("Titel erforderlich");
      const { error } = await supabase.from("tasks").insert({
        title: form.title.trim(), description: form.description || null,
        due_date: form.due_date ? new Date(form.due_date).toISOString() : null,
        priority: form.priority as any,
        related_type: "client", related_id: clientId, created_by: userId,
      });
      if (error) throw error;
      await supabase.from("activity_logs").insert({
        actor_id: userId, action: `Aufgabe erstellt: ${form.title.trim()}`,
        related_type: "client", related_id: clientId,
      });
    },
    onSuccess: () => {
      toast.success("Aufgabe erstellt");
      setOpen(false); setForm({ title: "", description: "", due_date: "", priority: "normal" });
      qc.invalidateQueries({ queryKey: ["client_tasks", clientId] });
      qc.invalidateQueries({ queryKey: ["client_activity", clientId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: async (t: any) => {
      const { error } = await supabase.from("tasks")
        .update({ status: t.status === "done" ? "open" : "done" }).eq("id", t.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["client_tasks", clientId] }),
  });

  return (
    <Card><CardContent className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-display text-lg font-semibold">Aufgaben</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <Button size="sm" onClick={() => setOpen(true)}><Plus className="mr-1.5 h-4 w-4" />Neue Aufgabe</Button>
          <DialogContent>
            <DialogHeader><DialogTitle>Neue Aufgabe</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Titel</Label><Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></div>
              <div><Label>Beschreibung</Label><Textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><Label>Fällig</Label><Input type="datetime-local" value={form.due_date} onChange={(e) => setForm({ ...form, due_date: e.target.value })} /></div>
                <div>
                  <Label>Priorität</Label>
                  <Select value={form.priority} onValueChange={(v) => setForm({ ...form, priority: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Niedrig</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">Hoch</SelectItem>
                      <SelectItem value="urgent">Dringend</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
            <DialogFooter><Button onClick={() => create.mutate()} disabled={!form.title || create.isPending}>Speichern</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      {isLoading ? <p className="text-sm text-muted-foreground">Lädt…</p>
        : tasks.length === 0 ? <p className="text-sm text-muted-foreground">Noch keine Aufgaben für diesen Kunden.</p>
        : <div className="space-y-2">
            {tasks.map((t: any) => (
              <div key={t.id} className="flex items-start gap-3 rounded-xl border p-3">
                <button onClick={() => toggle.mutate(t)} className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded border ${t.status === "done" ? "bg-primary border-primary text-primary-foreground" : ""}`}>
                  {t.status === "done" && <CheckSquare className="h-3 w-3" />}
                </button>
                <div className="flex-1">
                  <p className={`text-sm font-medium ${t.status === "done" ? "line-through text-muted-foreground" : ""}`}>{t.title}</p>
                  {t.description && <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {t.due_date && <span>Fällig: {formatDate(t.due_date)}</span>}
                    {t.priority && <Badge variant="outline" className="text-[10px]">{t.priority}</Badge>}
                  </div>
                </div>
              </div>
            ))}
          </div>}
    </CardContent></Card>
  );
}



type TimelineEvent = {
  id: string;
  at: string;
  icon: "create" | "edit" | "note" | "appointment" | "task" | "financing" | "disclosure" | "document" | "match" | "relationship" | "mandate" | "nda" | "delete";
  title: string;
  detail?: string | null;
};

const iconColor: Record<TimelineEvent["icon"], string> = {
  create: "bg-emerald-500",
  edit: "bg-blue-500",
  note: "bg-primary",
  appointment: "bg-violet-500",
  task: "bg-amber-500",
  financing: "bg-cyan-500",
  disclosure: "bg-indigo-500",
  document: "bg-slate-500",
  match: "bg-pink-500",
  relationship: "bg-rose-500",
  mandate: "bg-orange-500",
  nda: "bg-teal-500",
  delete: "bg-red-500",
};

function ClientActivityTab({ clientId, userId, notes: _notes }: { clientId: string; userId: string; notes: string | null }) {
  const qc = useQueryClient();
  const [note, setNote] = useState("");

  const { data: timeline = [], isLoading } = useQuery({
    queryKey: ["client_timeline", clientId],
    queryFn: async (): Promise<TimelineEvent[]> => {
      const [
        clientRes, logsRes, apptRes, tasksRes, finRes, discRes,
        docsRes, genDocsRes, matchRes, relRes, mandRes, ndaRes,
      ] = await Promise.all([
        supabase.from("clients").select("created_at,updated_at,full_name,owner_id,assigned_to").eq("id", clientId).maybeSingle(),
        supabase.from("activity_logs").select("id,action,created_at,metadata")
          .eq("related_type", "client").eq("related_id", clientId).order("created_at", { ascending: false }).limit(200),
        supabase.from("appointments").select("id,title,starts_at,created_at,updated_at,status").eq("client_id", clientId),
        supabase.from("tasks").select("id,title,created_at,updated_at,status,due_date")
          .eq("related_type", "client").eq("related_id", clientId),
        supabase.from("financing_dossiers").select("id,title,created_at,updated_at,status,submitted_at,bank_decision_at").eq("client_id", clientId),
        supabase.from("client_self_disclosures").select("id,status,created_at,updated_at,sent_at,submitted_at,reviewed_at").eq("client_id", clientId),
        supabase.from("documents").select("id,file_name,created_at,document_type").eq("related_type", "client").eq("related_id", clientId),
        supabase.from("generated_documents").select("id,title,created_at,sent_at,esign_signed_at,document_type").eq("related_type", "client").eq("related_id", clientId),
        supabase.from("matches").select("id,created_at,status,property_id").eq("client_id", clientId),
        supabase.from("client_relationships").select("id,created_at,relationship_type,client_id,related_client_id").or(`client_id.eq.${clientId},related_client_id.eq.${clientId}`),
        supabase.from("mandates").select("id,created_at,updated_at,status,mandate_type").eq("client_id", clientId),
        supabase.from("nda_agreements").select("id,created_at,updated_at,status,nda_type").eq("client_id", clientId),
      ]);

      const events: TimelineEvent[] = [];

      const creatorId = (clientRes.data as any)?.owner_id ?? (clientRes.data as any)?.assigned_to ?? null;
      let creatorLabel: string | null = null;
      if (creatorId) {
        const { data: prof } = await supabase
          .from("profiles").select("full_name,email").eq("id", creatorId).maybeSingle();
        creatorLabel = (prof as any)?.full_name || (prof as any)?.email || null;
      }

      if (clientRes.data) {
        events.push({
          id: `client-create-${clientId}`, at: clientRes.data.created_at,
          icon: "create", title: "Kunde angelegt",
          detail: [clientRes.data.full_name, creatorLabel ? `durch ${creatorLabel}` : null].filter(Boolean).join(" · "),
        });
        if (clientRes.data.updated_at && clientRes.data.updated_at !== clientRes.data.created_at) {
          events.push({
            id: `client-update-${clientId}`, at: clientRes.data.updated_at,
            icon: "edit", title: "Stammdaten zuletzt geändert",
          });
        }
      }

      (logsRes.data ?? []).forEach((a: any) => {
        const meta = a.metadata ?? {};
        events.push({
          id: `log-${a.id}`, at: a.created_at,
          icon: meta.type === "note" ? "note" : "edit",
          title: a.action,
        });
      });

      (apptRes.data ?? []).forEach((x: any) => {
        events.push({
          id: `appt-${x.id}-c`, at: x.created_at, icon: "appointment",
          title: `Termin angelegt: ${x.title}`,
          detail: formatDateTime(x.starts_at),
        });
        if (x.updated_at && x.updated_at !== x.created_at) {
          events.push({
            id: `appt-${x.id}-u`, at: x.updated_at, icon: "edit",
            title: `Termin geändert: ${x.title}`, detail: `Status: ${x.status}`,
          });
        }
      });

      (tasksRes.data ?? []).forEach((x: any) => {
        events.push({
          id: `task-${x.id}-c`, at: x.created_at, icon: "task",
          title: `Aufgabe erstellt: ${x.title}`,
          detail: x.due_date ? `Fällig: ${formatDate(x.due_date)}` : null,
        });
        if (x.updated_at && x.updated_at !== x.created_at) {
          events.push({
            id: `task-${x.id}-u`, at: x.updated_at, icon: "edit",
            title: `Aufgabe aktualisiert: ${x.title}`, detail: `Status: ${x.status}`,
          });
        }
      });

      (finRes.data ?? []).forEach((x: any) => {
        events.push({
          id: `fin-${x.id}-c`, at: x.created_at, icon: "financing",
          title: `Finanzierung erstellt${x.title ? `: ${x.title}` : ""}`,
        });
        if (x.submitted_at) events.push({
          id: `fin-${x.id}-s`, at: x.submitted_at, icon: "financing",
          title: "Finanzierung eingereicht",
        });
        if (x.bank_decision_at) events.push({
          id: `fin-${x.id}-b`, at: x.bank_decision_at, icon: "financing",
          title: "Bank-Entscheidung erhalten",
        });
        if (x.updated_at && x.updated_at !== x.created_at) events.push({
          id: `fin-${x.id}-u`, at: x.updated_at, icon: "edit",
          title: "Finanzierung aktualisiert", detail: `Status: ${x.status}`,
        });
      });

      (discRes.data ?? []).forEach((x: any) => {
        events.push({
          id: `disc-${x.id}-c`, at: x.created_at, icon: "disclosure",
          title: "Selbstauskunft angelegt",
        });
        if (x.sent_at) events.push({ id: `disc-${x.id}-s`, at: x.sent_at, icon: "disclosure", title: "Selbstauskunft versendet" });
        if (x.submitted_at) events.push({ id: `disc-${x.id}-sub`, at: x.submitted_at, icon: "disclosure", title: "Selbstauskunft eingereicht" });
        if (x.reviewed_at) events.push({ id: `disc-${x.id}-r`, at: x.reviewed_at, icon: "disclosure", title: "Selbstauskunft geprüft" });
      });

      (docsRes.data ?? []).forEach((x: any) => {
        events.push({
          id: `doc-${x.id}`, at: x.created_at, icon: "document",
          title: `Dokument hochgeladen: ${x.file_name ?? "Datei"}`,
          detail: x.document_type,
        });
      });

      (genDocsRes.data ?? []).forEach((x: any) => {
        events.push({
          id: `gen-${x.id}-c`, at: x.created_at, icon: "document",
          title: `Dokument generiert${x.title ? `: ${x.title}` : ""}`,
        });
        if (x.sent_at) events.push({ id: `gen-${x.id}-s`, at: x.sent_at, icon: "document", title: `Dokument versendet${x.title ? `: ${x.title}` : ""}` });
        if (x.esign_signed_at) events.push({ id: `gen-${x.id}-sig`, at: x.esign_signed_at, icon: "document", title: `Dokument unterzeichnet${x.title ? `: ${x.title}` : ""}` });
      });

      (matchRes.data ?? []).forEach((x: any) => {
        events.push({
          id: `match-${x.id}`, at: x.created_at, icon: "match",
          title: "Match-Vorschlag", detail: `Status: ${x.status}`,
        });
      });

      (relRes.data ?? []).forEach((x: any) => {
        events.push({
          id: `rel-${x.id}`, at: x.created_at, icon: "relationship",
          title: `Beziehung hinzugefügt: ${x.relationship_type}`,
        });
      });

      (mandRes.data ?? []).forEach((x: any) => {
        events.push({
          id: `mand-${x.id}-c`, at: x.created_at, icon: "mandate",
          title: `Mandat erstellt (${x.mandate_type})`, detail: `Status: ${x.status}`,
        });
        if (x.updated_at && x.updated_at !== x.created_at) events.push({
          id: `mand-${x.id}-u`, at: x.updated_at, icon: "edit",
          title: "Mandat aktualisiert", detail: `Status: ${x.status}`,
        });
      });

      (ndaRes.data ?? []).forEach((x: any) => {
        events.push({
          id: `nda-${x.id}`, at: x.created_at, icon: "nda",
          title: `NDA (${x.nda_type})`, detail: `Status: ${x.status}`,
        });
      });

      return events
        .filter((e) => e.at)
        .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    },
  });

  const addNote = useMutation({
    mutationFn: async () => {
      if (!note.trim()) throw new Error("Notiz darf nicht leer sein");
      const { error } = await supabase.from("activity_logs").insert({
        actor_id: userId, action: note.trim(),
        related_type: "client", related_id: clientId, metadata: { type: "note" },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Notiz hinzugefügt"); setNote("");
      qc.invalidateQueries({ queryKey: ["client_timeline", clientId] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  // Gruppierung nach Datum
  const groups = timeline.reduce<Record<string, TimelineEvent[]>>((acc, ev) => {
    const key = formatDate(ev.at);
    (acc[key] = acc[key] ?? []).push(ev);
    return acc;
  }, {});

  return (
    <div className="space-y-4">
      <Card><CardContent className="p-6">
        <h3 className="mb-3 font-display text-lg font-semibold">Notiz hinzufügen</h3>
        <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Was ist passiert?" />
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={() => addNote.mutate()} disabled={!note.trim() || addNote.isPending}>
            <Plus className="mr-1.5 h-4 w-4" />Speichern
          </Button>
        </div>
      </CardContent></Card>

      <Card><CardContent className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-display text-lg font-semibold">Verlauf & Changelog</h3>
          <Badge variant="secondary" className="text-xs">{timeline.length} Ereignisse</Badge>
        </div>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Lädt…</p>
        ) : timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Aktivität.</p>
        ) : (
          <div className="space-y-6">
            {Object.entries(groups).map(([day, items]) => (
              <div key={day}>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{day}</p>
                <div className="relative space-y-3 border-l pl-5">
                  {items.map((ev) => (
                    <div key={ev.id} className="relative">
                      <span className={`absolute -left-[23px] top-1.5 h-2.5 w-2.5 rounded-full ${iconColor[ev.icon]}`} />
                      <p className="text-sm">{ev.title}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDateTime(ev.at)}{ev.detail ? ` · ${ev.detail}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}
