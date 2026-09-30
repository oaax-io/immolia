import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { useIsCommissionAdmin } from "@/hooks/useIsCommissionAdmin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  BarChart3, Building2, Users, UserPlus, FileSignature, FileCheck2,
  Banknote, AlertTriangle, TrendingUp, Layers, Ruler, Coins, Target,
} from "lucide-react";
import {
  formatCurrency, formatArea,
  propertyStatusLabels, propertyTypeLabels, listingTypeLabels,
} from "@/lib/format";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { StatusDonutGrid } from "@/components/dashboard/StatusDonutCards";

export const Route = createFileRoute("/_app/analytics")({
  component: AnalyticsPage,
});

// ----- Filter Types -----
type Period = "all" | "year" | "quarter" | "month";
type ListingFilter = "all" | "sale" | "rent";
type StatusFilter = "all" | "active" | "reserved" | "sold" | "rented" | "archived";

function periodStart(p: Period): Date | null {
  const now = new Date();
  if (p === "all") return null;
  if (p === "year") return new Date(now.getFullYear(), 0, 1);
  if (p === "month") return new Date(now.getFullYear(), now.getMonth(), 1);
  if (p === "quarter") {
    const q = Math.floor(now.getMonth() / 3);
    return new Date(now.getFullYear(), q * 3, 1);
  }
  return null;
}

const CHART_COLORS = ["hsl(var(--primary))", "#6A9387", "#F59E0B", "#3B82F6", "#EF4444", "#8B5CF6", "#10B981", "#EC4899"];

// ----- Data Hooks -----
function useAnalyticsData() {
  return useQuery({
    queryKey: ["analytics", "all"],
    queryFn: async () => {
      const [properties, leads, clients, mandates, reservations, dossiers, tasks, profiles] = await Promise.all([
        supabase.from("properties").select("id,title,price,rent,living_area,plot_area,status,listing_type,property_type,assigned_to,owner_id,images,created_at,is_archived:is_unit").limit(5000),
        supabase.from("leads").select("id,status,assigned_to,owner_id,created_at,converted_client_id").limit(5000),
        supabase.from("clients").select("id,status,assigned_to,owner_id,created_at,is_archived").limit(5000),
        supabase.from("mandates").select("id,property_id,client_id,commission_model,commission_value,status,generated_document_id,created_at").limit(5000),
        supabase.from("reservations").select("id,property_id,client_id,status,generated_document_id,created_at").limit(5000),
        supabase.from("financing_dossiers").select("id,client_id,status,dossier_status,quick_check_status,created_at").limit(5000),
        supabase.from("tasks").select("id,status,due_date,assigned_to,created_at").limit(5000),
        supabase.from("profiles").select("id,full_name,email,is_active").limit(1000),
      ]);
      return {
        properties: properties.data ?? [],
        leads: leads.data ?? [],
        clients: clients.data ?? [],
        mandates: mandates.data ?? [],
        reservations: reservations.data ?? [],
        dossiers: dossiers.data ?? [],
        tasks: tasks.data ?? [],
        profiles: profiles.data ?? [],
      };
    },
  });
}

// Reale, gebuchte Provisionen (Provisions-Modul). Bewusst getrennt vom
// live berechneten Pipeline-Potenzial, damit beides nie vermischt wird.
function useBookedCommissions() {
  return useQuery({
    queryKey: ["analytics", "booked-commissions"],
    queryFn: async () => {
      const [records, splits] = await Promise.all([
        supabase
          .from("commission_records")
          .select("id,property_id,record_type,status,gross_amount,booked_at")
          .limit(5000),
        supabase
          .from("commission_record_splits")
          .select("commission_record_id,user_id,gross_share")
          .limit(20000),
      ]);
      return { records: (records.data ?? []) as any[], splits: (splits.data ?? []) as any[] };
    },
  });
}



// ----- Helpers -----
function isArchived(p: any): boolean {
  return p.status === "archived";
}

function commissionForProperty(p: any, mandates: any[]): number {
  if (p.listing_type !== "sale" || !p.price) return 0;
  if (isArchived(p) || p.status === "sold") return 0;
  const m = mandates.find((x) => x.property_id === p.id && x.commission_value != null);
  if (m) {
    if (m.commission_model === "fixed") return Number(m.commission_value) || 0;
    if (m.commission_model === "percent") return (Number(p.price) * Number(m.commission_value)) / 100;
  }
  return Number(p.price) * 0.03;
}

function KpiCard({ icon: Icon, label, value, hint, loading }: {
  icon: any; label: string; value: string | number; hint?: string; loading?: boolean;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
            {loading ? (
              <Skeleton className="mt-2 h-7 w-24" />
            ) : (
              <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
            )}
            {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
          </div>
          <div className="rounded-lg bg-primary/10 p-2 text-primary">
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>("all");
  const [employee, setEmployee] = useState<string>("all");
  const [listing, setListing] = useState<ListingFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const { data, isLoading } = useAnalyticsData();
  const { isCommissionAdmin } = useIsCommissionAdmin();
  const { data: bookedData } = useBookedCommissions();

  // Gebuchte Provision im gewählten Zeitraum (nach booked_at)
  const booked = useMemo(() => {
    const since = periodStart(period);
    const recs = (bookedData?.records ?? []).filter(
      (r: any) =>
        r.status !== "void" && (!since || (r.booked_at && new Date(r.booked_at) >= since)),
    );
    const ids = new Set(recs.filter((r: any) => r.record_type === "commission").map((r: any) => r.id));
    const total = recs
      .filter((r: any) => r.record_type === "commission")
      .reduce((s: number, r: any) => s + (Number(r.gross_amount) || 0), 0);
    const perUser = new Map<string, number>();
    (bookedData?.splits ?? []).forEach((s: any) => {
      if (!ids.has(s.commission_record_id)) return;
      perUser.set(s.user_id, (perUser.get(s.user_id) || 0) + (Number(s.gross_share) || 0));
    });
    // Objekte mit Abschluss-Status, für die noch keine Provision gebucht wurde
    const bookedPropIds = new Set(
      (bookedData?.records ?? [])
        .filter((r: any) => r.record_type === "commission" && r.status !== "void")
        .map((r: any) => r.property_id),
    );
    const missing = (data?.properties ?? []).filter(
      (p: any) => ["sold", "rented"].includes(p.status) && !bookedPropIds.has(p.id),
    );
    return { total, perUser, missing };
  }, [bookedData, period, data]);



  const filtered = useMemo(() => {
    if (!data) return null;
    const since = periodStart(period);
    const inPeriod = (createdAt: string | null | undefined) => {
      if (!since) return true;
      if (!createdAt) return false;
      return new Date(createdAt) >= since;
    };
    const matchEmployee = (assignedTo: string | null | undefined, ownerId?: string | null) => {
      if (employee === "all") return true;
      return assignedTo === employee || ownerId === employee;
    };

    const properties = data.properties.filter((p: any) => {
      if (!inPeriod(p.created_at)) return false;
      if (!matchEmployee(p.assigned_to, p.owner_id)) return false;
      if (listing !== "all" && p.listing_type !== listing) return false;
      if (statusFilter !== "all" && p.status !== statusFilter) return false;
      return true;
    });

    const leads = data.leads.filter((l: any) => inPeriod(l.created_at) && matchEmployee(l.assigned_to, l.owner_id));
    const clients = data.clients.filter((c: any) => inPeriod(c.created_at) && matchEmployee(c.assigned_to, c.owner_id) && !c.is_archived);
    const mandates = data.mandates.filter((m: any) => inPeriod(m.created_at));
    const reservations = data.reservations.filter((r: any) => inPeriod(r.created_at));
    const dossiers = data.dossiers.filter((d: any) => inPeriod(d.created_at));
    const tasks = data.tasks.filter((t: any) => matchEmployee(t.assigned_to, null));

    return { ...data, properties, leads, clients, mandates, reservations, dossiers, tasks };
  }, [data, period, employee, listing, statusFilter]);

  // ---- KPI Berechnungen ----
  const kpis = useMemo(() => {
    if (!filtered) return null;
    const props = filtered.properties;
    const saleActive = props.filter((p: any) => p.listing_type === "sale" && !isArchived(p));
    const rentActive = props.filter((p: any) => p.listing_type === "rent" && !isArchived(p));

    const totalValue = saleActive.reduce((s: number, p: any) => s + (Number(p.price) || 0), 0);
    const monthlyRent = rentActive.reduce((s: number, p: any) => s + (Number(p.rent) || 0), 0);
    const commissionTotal = props.reduce((s: number, p: any) => s + commissionForProperty(p, filtered.mandates), 0);
    const totalLiving = props.reduce((s: number, p: any) => s + (Number(p.living_area) || 0), 0);
    const totalPlot = props.reduce((s: number, p: any) => s + (Number(p.plot_area) || 0), 0);

    const salePrices = saleActive.map((p: any) => Number(p.price)).filter((n: number) => n > 0);
    const avgSalePrice = salePrices.length ? salePrices.reduce((a: number, b: number) => a + b, 0) / salePrices.length : 0;

    const pricePerSqmList = saleActive
      .filter((p: any) => Number(p.price) > 0 && Number(p.living_area) > 0)
      .map((p: any) => Number(p.price) / Number(p.living_area));
    const avgPricePerSqm = pricePerSqmList.length ? pricePerSqmList.reduce((a: number, b: number) => a + b, 0) / pricePerSqmList.length : 0;

    return {
      totalValue, monthlyRent, commissionTotal, totalLiving, totalPlot, avgSalePrice, avgPricePerSqm,
      countTotal: props.length,
      countActive: props.filter((p: any) => p.status === "active" || p.status === "available").length,
      countReserved: props.filter((p: any) => p.status === "reserved").length,
      countClosed: props.filter((p: any) => p.status === "sold" || p.status === "rented").length,
      leadsTotal: filtered.leads.length,
      clientsTotal: filtered.clients.length,
      activeMandates: filtered.mandates.filter((m: any) => m.status === "active" || m.status === "signed").length,
      activeReservations: filtered.reservations.filter((r: any) => r.status === "signed" || r.status === "sent").length,
      financingDossiers: filtered.dossiers.length,
    };
  }, [filtered]);

  // ---- Charts ----
  const charts = useMemo(() => {
    if (!filtered) return null;
    const props = filtered.properties;

    const byStatus = Object.entries(
      props.reduce((acc: Record<string, number>, p: any) => {
        const k = p.status || "unknown";
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {})
    ).map(([k, v]) => ({ name: (propertyStatusLabels as any)[k] || k, value: v as number }));

    const byType = Object.entries(
      props.reduce((acc: Record<string, number>, p: any) => {
        const k = p.property_type || "other";
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {})
    ).map(([k, v]) => ({ name: (propertyTypeLabels as any)[k] || k, value: v as number }));

    const byListing = Object.entries(
      props.reduce((acc: Record<string, number>, p: any) => {
        const k = p.listing_type || "sale";
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {})
    ).map(([k, v]) => ({ name: (listingTypeLabels as any)[k] || k, value: v as number }));

    const valueByStatus = Object.entries(
      props.reduce((acc: Record<string, number>, p: any) => {
        if (p.listing_type !== "sale") return acc;
        const k = p.status || "unknown";
        acc[k] = (acc[k] || 0) + (Number(p.price) || 0);
        return acc;
      }, {})
    ).map(([k, v]) => ({ name: (propertyStatusLabels as any)[k] || k, value: Math.round(v as number) }));

    return { byStatus, byType, byListing, valueByStatus };
  }, [filtered]);

  // ---- Mitarbeiter-Tabelle ----
  const employeeRows = useMemo(() => {
    if (!filtered) return [];
    const map = new Map<string, any>();
    const ensure = (id: string) => {
      if (!map.has(id)) {
        const profile = filtered.profiles.find((p: any) => p.id === id);
        map.set(id, {
          id, name: profile?.full_name || profile?.email || "Unbekannt",
          properties: 0, value: 0, commission: 0, mandates: 0, reservations: 0, leads: 0, clients: 0,
        });
      }
      return map.get(id);
    };
    filtered.properties.forEach((p: any) => {
      const id = p.assigned_to || p.owner_id;
      if (!id) return;
      const r = ensure(id);
      r.properties += 1;
      if (p.listing_type === "sale") r.value += Number(p.price) || 0;
      r.commission += commissionForProperty(p, filtered.mandates);
    });
    filtered.mandates.forEach((m: any) => {
      const prop = filtered.properties.find((p: any) => p.id === m.property_id);
      const id = prop?.assigned_to || prop?.owner_id;
      if (id) ensure(id).mandates += 1;
    });
    filtered.reservations.forEach((r: any) => {
      const prop = filtered.properties.find((p: any) => p.id === r.property_id);
      const id = prop?.assigned_to || prop?.owner_id;
      if (id) ensure(id).reservations += 1;
    });
    filtered.leads.forEach((l: any) => {
      const id = l.assigned_to || l.owner_id;
      if (id) ensure(id).leads += 1;
    });
    filtered.clients.forEach((c: any) => {
      const id = c.assigned_to || c.owner_id;
      if (id) ensure(id).clients += 1;
    });
    return Array.from(map.values()).sort((a, b) => b.commission - a.commission);
  }, [filtered]);

  // ---- Funnel ----
  const funnel = useMemo(() => {
    if (!filtered) return null;
    return {
      leads: filtered.leads.length,
      converted: filtered.leads.filter((l: any) => l.converted_client_id || l.status === "converted").length,
      clients: filtered.clients.length,
      financing: filtered.dossiers.filter((d: any) => d.status !== "draft").length,
      reservations: filtered.reservations.filter((r: any) => r.status === "signed" || r.status === "sent").length,
      closed: filtered.properties.filter((p: any) => p.status === "sold" || p.status === "rented").length,
    };
  }, [filtered]);

  // ---- Quality / Risk ----
  const issues = useMemo(() => {
    if (!filtered) return null;
    const noPrice = filtered.properties.filter((p: any) => p.listing_type === "sale" && !p.price && p.status !== "archived");
    const noArea = filtered.properties.filter((p: any) => !p.living_area && p.status !== "archived");
    const noImages = filtered.properties.filter((p: any) => (!p.images || p.images.length === 0) && p.status !== "archived");
    const propIdsWithMandate = new Set(filtered.mandates.map((m: any) => m.property_id));
    const noMandate = filtered.properties.filter((p: any) => !propIdsWithMandate.has(p.id) && p.status !== "archived" && p.listing_type === "sale");
    const reservationsNoDoc = filtered.reservations.filter((r: any) => (r.status === "signed" || r.status === "sent") && !r.generated_document_id);
    const mandatesNoDoc = filtered.mandates.filter((m: any) => (m.status === "active" || m.status === "signed") && !m.generated_document_id);
    const criticalFinancing = filtered.dossiers.filter((d: any) => d.quick_check_status === "critical" || d.quick_check_status === "not_financeable");
    const overdueTasks = filtered.tasks.filter((t: any) => t.status !== "done" && t.due_date && new Date(t.due_date) < new Date());
    return { noPrice, noArea, noImages, noMandate, reservationsNoDoc, mandatesNoDoc, criticalFinancing, overdueTasks };
  }, [filtered]);

  // ---- Status-Verteilungen (Ringdiagramme wie im Dashboard) ----
  const statusCounts = useMemo(() => {
    const count = (items: any[], key: (x: any) => string) => {
      const out: Record<string, number> = {};
      items.forEach((x) => { const k = key(x); out[k] = (out[k] ?? 0) + 1; });
      return out;
    };
    const dossierList = filtered?.dossiers ?? [];
    const qcCounts = { pass: 0, warn: 0, fail: 0, none: 0 };
    const qcMap: Record<string, "pass" | "warn" | "fail" | "none"> = {
      realistic: "pass", pass: "pass", critical: "warn", warn: "warn",
      not_financeable: "fail", fail: "fail", incomplete: "none", none: "none",
    };
    dossierList.forEach((d: any) => {
      const qc = qcMap[(d.quick_check_status ?? "none") as string] ?? "none";
      qcCounts[qc] += 1;
    });
    return {
      clientCounts: count(filtered?.clients ?? [], (c) => c.status ?? "entwurf"),
      propCounts: count(filtered?.properties ?? [], (p) => p.status ?? "draft"),
      leadCounts: count(filtered?.leads ?? [], (l) => l.status ?? "new"),
      dossierCounts: count(dossierList, (d) => d.dossier_status ?? d.status ?? "draft"),
      qcCounts,
    };
  }, [filtered]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2.5">
            <BarChart3 className="h-8 w-8 text-[#6F6B94]" />
            Analytics
          </span>
        }
      />

      {/* Filter */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-[160px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Zeitraum</label>
            <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle</SelectItem>
                <SelectItem value="year">Dieses Jahr</SelectItem>
                <SelectItem value="quarter">Dieses Quartal</SelectItem>
                <SelectItem value="month">Dieser Monat</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[200px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Mitarbeiter</label>
            <Select value={employee} onValueChange={setEmployee}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle</SelectItem>
                {(data?.profiles ?? []).map((p: any) => (
                  <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[160px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Vermarktung</label>
            <Select value={listing} onValueChange={(v) => setListing(v as ListingFilter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle</SelectItem>
                <SelectItem value="sale">Kauf</SelectItem>
                <SelectItem value="rent">Miete</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[180px]">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Immobilienstatus</label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle</SelectItem>
                <SelectItem value="active">Aktiv</SelectItem>
                <SelectItem value="reserved">Reserviert</SelectItem>
                <SelectItem value="sold">Verkauft</SelectItem>
                <SelectItem value="rented">Vermietet</SelectItem>
                <SelectItem value="archived">Archiviert</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Übersicht */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Unternehmensübersicht</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          <KpiCard icon={Coins} label="Gesamtwert Verkauf" value={formatCurrency(kpis?.totalValue ?? 0)} loading={isLoading} />
          <KpiCard icon={Banknote} label="Mietvolumen / Monat" value={formatCurrency(kpis?.monthlyRent ?? 0)} loading={isLoading} />
          <KpiCard icon={TrendingUp} label="Provisionspotenzial" value={formatCurrency(kpis?.commissionTotal ?? 0)} hint="Prognose für aktive Objekte, noch nicht gebucht" loading={isLoading} />
          {isCommissionAdmin && (
            <KpiCard icon={Coins} label="Gebuchte Provision" value={formatCurrency(booked.total)} hint="real verbucht im Zeitraum" loading={isLoading} />
          )}

          <KpiCard icon={Building2} label="Immobilien total" value={kpis?.countTotal ?? 0} loading={isLoading} />
          <KpiCard icon={Building2} label="Aktive Immobilien" value={kpis?.countActive ?? 0} loading={isLoading} />
          <KpiCard icon={FileCheck2} label="Reserviert" value={kpis?.countReserved ?? 0} loading={isLoading} />
          <KpiCard icon={Target} label="Verkauft / Vermietet" value={kpis?.countClosed ?? 0} loading={isLoading} />
          <KpiCard icon={UserPlus} label="Leads total" value={kpis?.leadsTotal ?? 0} loading={isLoading} />
          <KpiCard icon={Users} label="Kunden total" value={kpis?.clientsTotal ?? 0} loading={isLoading} />
          <KpiCard icon={FileSignature} label="Aktive Mandate" value={kpis?.activeMandates ?? 0} loading={isLoading} />
          <KpiCard icon={FileCheck2} label="Aktive Reservationen" value={kpis?.activeReservations ?? 0} loading={isLoading} />
          <KpiCard icon={Banknote} label="Finanzierungsdossiers" value={kpis?.financingDossiers ?? 0} loading={isLoading} />
        </div>
      </section>

      {/* Status-Verteilungen */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Status-Verteilungen</h2>
        <StatusDonutGrid
          clientCounts={statusCounts.clientCounts}
          propCounts={statusCounts.propCounts}
          leadCounts={statusCounts.leadCounts}
          dossierCounts={statusCounts.dossierCounts}
          qcCounts={statusCounts.qcCounts}
          loading={isLoading}
        />
      </section>

      {/* Portfolio */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Immobilien-Portfolio</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard icon={Ruler} label="Gesamtwohnfläche" value={formatArea(kpis?.totalLiving ?? 0)} loading={isLoading} />
          <KpiCard icon={Layers} label="Gesamtgrundstück" value={formatArea(kpis?.totalPlot ?? 0)} loading={isLoading} />
          <KpiCard icon={Coins} label="Ø Verkaufspreis" value={formatCurrency(kpis?.avgSalePrice ?? 0)} loading={isLoading} />
          <KpiCard icon={TrendingUp} label="Ø CHF / m²" value={formatCurrency(kpis?.avgPricePerSqm ?? 0)} loading={isLoading} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-sm">Immobilien nach Status</CardTitle></CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts?.byStatus ?? []}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip />
                  <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Immobilien nach Typ</CardTitle></CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={charts?.byType ?? []} dataKey="value" nameKey="name" outerRadius={80} label>
                    {(charts?.byType ?? []).map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Vermarktungsart</CardTitle></CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={charts?.byListing ?? []} dataKey="value" nameKey="name" outerRadius={80} label>
                    {(charts?.byListing ?? []).map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-sm">Wert nach Status (Verkauf)</CardTitle></CardHeader>
            <CardContent className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={charts?.valueByStatus ?? []}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" fontSize={11} />
                  <YAxis fontSize={11} tickFormatter={(v) => `${(v / 1_000_000).toFixed(1)}M`} />
                  <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                  <Bar dataKey="value" fill="#6A9387" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Mitarbeiter */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Mitarbeiterleistung</h2>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mitarbeiter</TableHead>
                  <TableHead className="text-right">Immobilien</TableHead>
                  <TableHead className="text-right">Wert</TableHead>
                  {isCommissionAdmin && <TableHead className="text-right">Potenzial</TableHead>}
                  {isCommissionAdmin && <TableHead className="text-right">Gebucht</TableHead>}

                  <TableHead className="text-right">Mandate</TableHead>
                  <TableHead className="text-right">Reservationen</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Kunden</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {employeeRows.length === 0 ? (
                  <TableRow><TableCell colSpan={isCommissionAdmin ? 9 : 7} className="py-8 text-center text-sm text-muted-foreground">Keine Daten</TableCell></TableRow>
                ) : employeeRows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.properties}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatCurrency(r.value)}</TableCell>
                    {isCommissionAdmin && <TableCell className="text-right tabular-nums text-muted-foreground">{formatCurrency(r.commission)}</TableCell>}
                    {isCommissionAdmin && <TableCell className="text-right tabular-nums font-semibold">{formatCurrency(booked.perUser.get(r.id) || 0)}</TableCell>}


                    <TableCell className="text-right tabular-nums">{r.mandates}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.reservations}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.leads}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.clients}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </section>

      {/* Funnel */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Funnel</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <KpiCard icon={UserPlus} label="Leads" value={funnel?.leads ?? 0} loading={isLoading} />
          <KpiCard icon={Users} label="Konvertiert" value={funnel?.converted ?? 0} loading={isLoading} />
          <KpiCard icon={Users} label="Kunden" value={funnel?.clients ?? 0} loading={isLoading} />
          <KpiCard icon={Banknote} label="Finanzierungen" value={funnel?.financing ?? 0} loading={isLoading} />
          <KpiCard icon={FileCheck2} label="Reservationen" value={funnel?.reservations ?? 0} loading={isLoading} />
          <KpiCard icon={Target} label="Abschlüsse" value={funnel?.closed ?? 0} loading={isLoading} />
        </div>
      </section>

      {/* Aufmerksamkeit */}
      <section>
        <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <AlertTriangle className="h-4 w-4 text-amber-500" /> Aufmerksamkeit erforderlich
        </h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          <IssueCard title="Immobilien ohne Preis" count={issues?.noPrice.length ?? 0} to="/properties" />
          <IssueCard title="Immobilien ohne Wohnfläche" count={issues?.noArea.length ?? 0} to="/properties" />
          <IssueCard title="Immobilien ohne Bilder" count={issues?.noImages.length ?? 0} to="/properties" />
          <IssueCard title="Verkaufsobjekte ohne Mandat" count={issues?.noMandate.length ?? 0} to="/mandates" />
          <IssueCard title="Reservationen ohne Dokument" count={issues?.reservationsNoDoc.length ?? 0} to="/reservations" />
          <IssueCard title="Mandate ohne Dokument" count={issues?.mandatesNoDoc.length ?? 0} to="/mandates" />
          <IssueCard title="Kritische Finanzierungen" count={issues?.criticalFinancing.length ?? 0} to="/financing" />
          <IssueCard title="Überfällige Aufgaben" count={issues?.overdueTasks.length ?? 0} to="/tasks" />
          {isCommissionAdmin && (
            <IssueCard title="Verkauft/vermietet ohne gebuchte Provision" count={booked.missing.length} to="/commissions" />
          )}

        </div>
      </section>
    </div>
  );
}

function IssueCard({ title, count, to }: { title: string; count: number; to: string }) {
  const tone = count > 0 ? "border-amber-500/40 bg-amber-500/5" : "";
  return (
    <Link to={to as any}>
      <Card className={`transition hover:shadow-md ${tone}`}>
        <CardContent className="flex items-center justify-between p-4">
          <p className="text-sm font-medium">{title}</p>
          <Badge variant={count > 0 ? "default" : "secondary"} className="tabular-nums">{count}</Badge>
        </CardContent>
      </Card>
    </Link>
  );
}
