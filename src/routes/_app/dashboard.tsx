import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import {
  Building2, Users, UserPlus, CheckSquare, CalendarDays, FileSignature,
  ArrowRight, Plus, Upload, Sparkles, AlertTriangle, Clock, ChevronDown,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  formatCurrency, formatDateTime, formatDate,
} from "@/lib/format";
import { isBackendUnavailableError } from "@/lib/backend-errors";
import { UpcomingCalendarList } from "@/components/dashboard/UpcomingCalendarList";

import { useTranslation } from "react-i18next";

export const Route = createFileRoute("/_app/dashboard")({
  component: Dashboard,
});

// ---------- helpers ----------
const startOfToday = () => { const d = new Date(); d.setHours(0,0,0,0); return d.toISOString(); };
const endOfToday = () => { const d = new Date(); d.setHours(23,59,59,999); return d.toISOString(); };
const sevenDaysAgo = () => { const d = new Date(); d.setDate(d.getDate()-7); return d.toISOString(); };

function unwrap<T>(res: { data: T | null; error: any; count?: number | null }) {
  // Immer werfen – inkl. Backend-Unavailable. Der QueryClient retryed
  // transiente Backend-Fehler automatisch mit Backoff.
  if (res.error) throw res.error;
  return { data: res.data, count: res.count ?? 0, unavailable: false };
}

// Einzelne KPI-Query: liefert null bei Fehler, damit eine kaputte Sub-Query
// nicht alle 6 KPIs blockiert. Transiente Backend-Fehler werden trotzdem
// vom QueryClient via Throw-and-Retry abgefangen (siehe useQuery unten).
function settledCount(res: PromiseSettledResult<{ count: number | null; error: any }>): number | null {
  if (res.status === "rejected") return null;
  if (res.value.error) return null;
  return res.value.count ?? 0;
}

// ---------- KPI ----------
function KpiCard({ icon: Icon, label, value, hint, accent, loading, to }: {
  icon: any; label: string; value: number | string; hint?: string;
  accent?: string; loading?: boolean; to?: string;
}) {
  const inner = (
    <Card className="group transition hover:border-primary/40 hover:shadow-sm">
      <CardContent className="p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            {loading ? (
              <Skeleton className="mt-1 h-6 w-12" />
            ) : (
              <p className="mt-0.5 font-display text-2xl font-bold leading-none tracking-tight">{value}</p>
            )}
            {hint && <p className="mt-1 text-[10px] text-muted-foreground">{hint}</p>}
          </div>
          <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${accent ?? "bg-accent text-primary"}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

function getGreetingKey() {
  const h = new Date().getHours();
  if (h < 5) return "dashboard.greeting.night";
  if (h < 12) return "dashboard.greeting.morning";
  if (h < 18) return "dashboard.greeting.day";
  return "dashboard.greeting.evening";
}

// ---------- main ----------
function Dashboard() {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const profile = useQuery({
    queryKey: ["dashboard", "profile", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data } = await supabase.from("profiles").select("full_name").eq("id", user!.id).maybeSingle();
      return data;
    },
  });
  const displayName = (profile.data?.full_name?.trim().split(/\s+/)[0])
    || user?.user_metadata?.full_name?.trim().split(/\s+/)[0]
    || user?.email?.split("@")[0]
    || "";
  const kpis = useQuery({
    queryKey: ["dashboard", "kpis"],
    queryFn: async () => {
      // allSettled: jede KPI lädt unabhängig. Wenn z.B. "matches" 503 wirft,
      // sehen wir trotzdem Leads/Kunden/Immobilien.
      const results = await Promise.allSettled([
        supabase.from("leads").select("id", { count: "exact", head: true }).gte("created_at", sevenDaysAgo()),
        supabase.from("clients").select("id", { count: "exact", head: true }),
        supabase.from("properties").select("id", { count: "exact", head: true }).in("status", ["available", "active", "preparation"]),
        supabase.from("tasks").select("id", { count: "exact", head: true }).neq("status", "done"),
        supabase.from("appointments").select("id", { count: "exact", head: true })
          .gte("starts_at", startOfToday()).lte("starts_at", endOfToday()),
        supabase.from("reservations").select("id", { count: "exact", head: true })
          .in("status", ["draft", "sent", "signed"]),
      ]);
      const [newLeads, clients, activeProps, openTasks, todayAppts, activeRes] = results.map(settledCount);

      // Wenn ALLE failed -> werfen, damit Retry greift. Sonst partielles Ergebnis.
      if (results.every((r) => r.status === "rejected" || (r as any).value?.error)) {
        const firstError = (results.find((r) => r.status === "rejected") as any)?.reason
          ?? (results.find((r) => r.status === "fulfilled" && (r as any).value?.error) as any)?.value?.error;
        throw firstError ?? new Error("Backend aktuell nicht erreichbar");
      }
      return { newLeads, clients, activeProps, openTasks, todayAppts, activeRes };
    },
  });

  const today = useQuery({
    queryKey: ["dashboard", "today"],
    queryFn: async () => {
      const [appts, overdue, leads] = await Promise.all([
        supabase.from("appointments").select("id, title, starts_at, location")
          .gte("starts_at", startOfToday()).lte("starts_at", endOfToday()).order("starts_at").limit(6),
        supabase.from("tasks").select("id, title, due_date, priority")
          .neq("status", "done").lt("due_date", new Date().toISOString())
          .order("due_date").limit(6),
        supabase.from("leads").select("id, full_name, source, status, created_at")
          .order("created_at", { ascending: false }).limit(6),
      ]);
      return {
        appts: unwrap(appts).data ?? [],
        overdue: unwrap(overdue).data ?? [],
        leads: unwrap(leads).data ?? [],
      };
    },
  });

  const focus = useQuery({
    queryKey: ["dashboard", "focus"],
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const [tasks, upcoming] = await Promise.all([
        supabase.from("tasks").select("id, title, due_date, priority, status")
          .neq("status", "done").neq("status", "cancelled")
          .order("due_date", { ascending: true, nullsFirst: false }).limit(8),
        supabase.from("appointments").select("id, title, starts_at, location, appointment_type")
          .gte("starts_at", nowIso).order("starts_at").limit(8),
      ]);
      return {
        tasks: unwrap(tasks).data ?? [],
        upcoming: unwrap(upcoming).data ?? [],
      };
    },
  });

  const pipeline = useQuery({
    queryKey: ["dashboard", "pipeline"],
    queryFn: async () => {
      const [leads, props] = await Promise.all([
        supabase.from("leads").select("status"),
        supabase.from("properties").select("status"),
      ]);
      const leadCounts: Record<string, number> = {};
      (unwrap(leads).data ?? []).forEach((l: any) => { leadCounts[l.status] = (leadCounts[l.status] ?? 0) + 1; });
      const propCounts: Record<string, number> = {};
      (unwrap(props).data ?? []).forEach((p: any) => { propCounts[p.status] = (propCounts[p.status] ?? 0) + 1; });
      return { leadCounts, propCounts };
    },
  });

  const stats = useQuery({
    queryKey: ["dashboard", "stats"],
    queryFn: async () => {
      const [clients, dossiers] = await Promise.all([
        supabase.from("clients").select("status").eq("is_archived", false),
        supabase.from("financing_dossiers").select("dossier_status, quick_check_status, submitted_to_bank_at"),
      ]);
      const clientCounts: Record<string, number> = {};
      (clients.data ?? []).forEach((c: any) => { clientCounts[c.status] = (clientCounts[c.status] ?? 0) + 1; });
      const dossierCounts: Record<string, number> = {};
      const qcCounts: Record<string, number> = { pass: 0, warn: 0, fail: 0, none: 0 };
      const qcMap: Record<string, "pass" | "warn" | "fail" | "none"> = {
        realistic: "pass",
        pass: "pass",
        critical: "warn",
        warn: "warn",
        not_financeable: "fail",
        fail: "fail",
        incomplete: "none",
        none: "none",
      };
      let submitted = 0;
      (dossiers.data ?? []).forEach((d: any) => {
        dossierCounts[d.dossier_status ?? "draft"] = (dossierCounts[d.dossier_status ?? "draft"] ?? 0) + 1;
        const raw = (d.quick_check_status ?? "none") as string;
        const qc = qcMap[raw] ?? "none";
        qcCounts[qc] = (qcCounts[qc] ?? 0) + 1;
        if (d.submitted_to_bank_at) submitted += 1;
      });
      return {
        clientCounts,
        dossierCounts,
        qcCounts,
        totalDossiers: (dossiers.data ?? []).length,
        submitted,
        approved: dossierCounts["approved"] ?? 0,
        rejected: dossierCounts["rejected"] ?? 0,
      };
    },
  });

  const matches = useQuery({
    queryKey: ["dashboard", "matches"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("matches")
        .select("id, score, status, reasons, client_id, property_id")
        .order("score", { ascending: false })
        .limit(5);
      // Wirft auch bei Backend-Unavailable -> globaler Retry mit Backoff greift.
      if (error) throw error;
      const list = data ?? [];
      if (list.length === 0) return [];
      const clientIds = [...new Set(list.map((m: any) => m.client_id).filter(Boolean))];
      const propIds = [...new Set(list.map((m: any) => m.property_id).filter(Boolean))];
      const [clients, props] = await Promise.all([
        clientIds.length ? supabase.from("clients").select("id, full_name").in("id", clientIds) : Promise.resolve({ data: [], error: null }),
        propIds.length ? supabase.from("properties").select("id, title, city, price").in("id", propIds) : Promise.resolve({ data: [], error: null }),
      ]);
      const cMap = new Map((clients.data ?? []).map((c: any) => [c.id, c]));
      const pMap = new Map((props.data ?? []).map((p: any) => [p.id, p]));
      return list.map((m: any) => ({ ...m, client: cMap.get(m.client_id), property: pMap.get(m.property_id) }));
    },
  });

  // Banner nur bei "echten" Fehlern – transiente Backend-Aussetzer werden
  // vom QueryClient automatisch retryed und sollen den User nicht alarmieren.
  const realError = (e: unknown) => e && !isBackendUnavailableError(e);
  const anyError = realError(kpis.error) || realError(today.error) || realError(pipeline.error) || realError(matches.error);

  return (
    <>
      <div className="mb-4 flex w-full items-center justify-between gap-3 rounded-2xl border border-border/60 bg-muted/50 px-5 py-4 shadow-sm backdrop-blur">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {t(getGreetingKey())}{displayName ? `, ${displayName}` : ""} 👋
          </h1>
          <p className="text-sm text-muted-foreground">
            {new Date().toLocaleDateString(i18n.language || "de-CH", { weekday: "long", day: "numeric", month: "long" })} · {t("dashboard.subtitle")}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" className="shrink-0">
              <Plus className="mr-1 h-4 w-4" />
              {t("dashboard.quickActions")}
              <ChevronDown className="ml-1 h-4 w-4 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>{t("dashboard.quickActionsLabel")}</DropdownMenuLabel>
            <DropdownMenuItem asChild>
              <Link to="/leads"><UserPlus className="mr-2 h-4 w-4" />{t("dashboard.quick.newLead")}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/clients"><Users className="mr-2 h-4 w-4" />{t("dashboard.quick.newClient")}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/properties"><Building2 className="mr-2 h-4 w-4" />{t("dashboard.quick.newProperty")}</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/appointments"><CalendarDays className="mr-2 h-4 w-4" />{t("dashboard.quick.newAppointment")}</Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link to="/tasks"><CheckSquare className="mr-2 h-4 w-4" />{t("dashboard.quick.newTask")}</Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link to="/documents"><Upload className="mr-2 h-4 w-4" />{t("dashboard.quick.uploadDocument")}</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {anyError && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{t("dashboard.errorLoading")}</span>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-3">
        <KpiCard icon={Users} label={t("dashboard.kpis.activeClients")} value={kpis.data?.clients ?? "—"} loading={kpis.isLoading} to="/clients" />
        <KpiCard icon={Building2} label={t("dashboard.kpis.activeProperties")} value={kpis.data?.activeProps ?? "—"} loading={kpis.isLoading} to="/properties" />
        <KpiCard icon={FileSignature} label={t("dashboard.kpis.activeReservations")} value={kpis.data?.activeRes ?? "—"} loading={kpis.isLoading} to="/reservations" />
      </div>
      {/* Fokus: Offene Aufgaben + bevorstehende Termine */}
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2 border-primary/30 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckSquare className="h-4 w-4 text-primary" />
              {t("dashboard.lists.openTasks", "Offene Aufgaben")}
              <Badge variant="secondary" className="ml-1 font-mono tabular-nums">{kpis.data?.openTasks ?? 0}</Badge>
            </CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/tasks">{t("dashboard.pipeline.details")} <ArrowRight className="ml-1 h-3 w-3" /></Link>
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {focus.isLoading ? (
              <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : (focus.data?.tasks ?? []).length === 0 ? (
              <EmptyState icon={CheckSquare} text={t("dashboard.lists.noOverdue")} />
            ) : (
              <div className="divide-y">
                {(focus.data?.tasks ?? []).map((tk: any) => {
                  const overdue = tk.due_date && new Date(tk.due_date) < new Date();
                  return (
                    <Link key={tk.id} to="/tasks" className="flex items-center justify-between gap-3 rounded px-1 py-2.5 first:pt-0 hover:bg-accent/40">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className={`h-2 w-2 shrink-0 rounded-full ${
                          tk.priority === "urgent" || tk.priority === "high" ? "bg-rose-500"
                          : tk.priority === "normal" ? "bg-amber-500" : "bg-slate-400"}`} />
                        <span className="truncate text-sm font-medium">{tk.title}</span>
                      </span>
                      {tk.due_date && (
                        <span className={`shrink-0 text-xs tabular-nums ${overdue ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                          {formatDate(tk.due_date)}
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarDays className="h-4 w-4 text-primary" />
              {t("dashboard.lists.upcomingAppts", "Bevorstehende Termine")}
            </CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <Link to="/appointments"><ArrowRight className="h-3 w-3" /></Link>
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            <UpcomingCalendarList emptyText={t("dashboard.lists.noAppts")} />
          </CardContent>
        </Card>
      </div>


      {/* Matching suggestions */}
      <Card className="mt-4">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            {t("dashboard.matching.title")}
          </CardTitle>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/matching" search={{ clientId: "", view: "all" as const, profileId: "" }}>{t("dashboard.matching.all")} <ArrowRight className="ml-1 h-3 w-3" /></Link>
          </Button>
        </CardHeader>
        <CardContent>
          {matches.isLoading ? (
            <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : (matches.data ?? []).length === 0 ? (
            <EmptyState icon={Sparkles} text={t("dashboard.matching.empty")} />
          ) : (
            <div className="divide-y">
              {(matches.data ?? []).map((m: any) => (
                <div key={m.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {m.client?.full_name ?? t("dashboard.matching.unknownClient")}{" "}
                      <span className="text-muted-foreground">↔</span>{" "}
                      {m.property?.title ?? t("dashboard.matching.unknownProperty")}
                    </p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[m.property?.city, m.property?.price ? formatCurrency(Number(m.property.price)) : null].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="hidden w-24 sm:block">
                      <Progress value={Math.min(100, Math.round(Number(m.score) * (Number(m.score) > 1 ? 1 : 100)))} className="h-2" />
                    </div>
                    <Badge variant="secondary" className="shrink-0">
                      {Math.round(Number(m.score) * (Number(m.score) > 1 ? 1 : 100))}%
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tagesübersicht – kompakt unten */}
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <CompactList
          title={t("dashboard.lists.newLeads")}
          icon={UserPlus}
          count={kpis.data?.newLeads ?? undefined}
          countHint={t("dashboard.lists.days7")}
          loading={today.isLoading}
          empty={t("dashboard.lists.noLeads")}
          to="/leads"
          items={(today.data?.leads ?? []).slice(0, 4)}
          render={(l: any) => (
            <Link key={l.id} to="/leads" className="flex items-center justify-between gap-2 rounded px-1.5 py-1 text-xs hover:bg-accent/40">
              <span className="truncate">{l.full_name}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">{formatDate(l.created_at)}</span>
            </Link>
          )}
        />
      </div>

    </>
  );
}

// ---------- subcomponents ----------
function TodayList({ title, icon: Icon, items, render, loading, empty, count, countHint }: {
  title: string; icon: any; items: any[]; render: (i: any) => React.ReactNode;
  loading?: boolean; empty: string; count?: number | null; countHint?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between gap-2 text-base">
          <span className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            {title}
          </span>
          {count != null && (
            <Badge variant="secondary" className="font-mono tabular-nums">
              {count}{countHint ? <span className="ml-1 font-sans text-[10px] font-normal opacity-70">{countHint}</span> : null}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)
        ) : items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          items.map(render)
        )}
      </CardContent>
    </Card>
  );
}

function PipelineCard({ title, to, counts, labels, order, loading, detailsLabel, emptyText }: {
  title: string; to: string; counts: Record<string, number>;
  labels: Record<string, string>; order: string[]; loading?: boolean;
  detailsLabel?: string; emptyText?: string;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const rows = order.filter((k) => labels[k] !== undefined);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="text-base">{title}</CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link to={to}>{detailsLabel ?? "Details"} <ArrowRight className="ml-1 h-3 w-3" /></Link>
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)
        ) : total === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{emptyText ?? "Noch keine Daten vorhanden."}</p>
        ) : (
          rows.map((key) => {
            const c = counts[key] ?? 0;
            const pct = total > 0 ? Math.round((c / total) * 100) : 0;
            return (
              <div key={key}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{labels[key]}</span>
                  <span className="font-medium tabular-nums">{c}</span>
                </div>
                <Progress value={pct} className="h-2" />
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function StatusStackCard({ title, icon: Icon, to, counts, rows, loading, footer, detailsLabel, emptyText }: {
  title: string; icon: any; to: string; counts: Record<string, number>;
  rows: { key: string; label: string; color: string }[]; loading?: boolean; footer?: React.ReactNode;
  detailsLabel?: string; emptyText?: string;
}) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-primary" />
          {title}
        </CardTitle>
        <Button variant="ghost" size="sm" asChild>
          <Link to={to}>{detailsLabel ?? "Details"} <ArrowRight className="ml-1 h-3 w-3" /></Link>
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-6 w-full" />)}</div>
        ) : total === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{emptyText ?? "Noch keine Daten vorhanden."}</p>
        ) : (
          <>
            <div className="mb-3 flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
              {rows.map((r) => {
                const c = counts[r.key] ?? 0;
                if (!c) return null;
                const pct = (c / total) * 100;
                return <div key={r.key} className={r.color} style={{ width: `${pct}%` }} title={`${r.label}: ${c}`} />;
              })}
            </div>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {rows.map((r) => {
                const c = counts[r.key] ?? 0;
                const pct = total > 0 ? Math.round((c / total) * 100) : 0;
                return (
                  <div key={r.key} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-xs hover:bg-accent/40">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${r.color}`} />
                      <span className="truncate text-muted-foreground">{r.label}</span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">
                      {c}<span className="ml-1 text-[10px] text-muted-foreground">{pct}%</span>
                    </span>
                  </div>
                );
              })}
            </div>
            {footer}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function CompactList({ title, icon: Icon, items, render, loading, empty, count, countHint, to }: {
  title: string; icon: any; items: any[]; render: (i: any) => React.ReactNode;
  loading?: boolean; empty: string; count?: number | null; countHint?: string; to: string;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between p-3 pb-2">
        <CardTitle className="flex items-center gap-1.5 text-xs font-medium">
          <Icon className="h-3.5 w-3.5 text-primary" />
          {title}
          {count != null && (
            <Badge variant="secondary" className="ml-1 h-4 px-1.5 font-mono text-[10px] tabular-nums">
              {count}{countHint ? <span className="ml-0.5 opacity-70">{countHint}</span> : null}
            </Badge>
          )}
        </CardTitle>
        <Button variant="ghost" size="sm" asChild className="h-6 px-1.5 text-[10px]">
          <Link to={to}><ArrowRight className="h-3 w-3" /></Link>
        </Button>
      </CardHeader>
      <CardContent className="p-2 pt-0">
        {loading ? (
          <div className="space-y-1">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
        ) : items.length === 0 ? (
          <p className="py-3 text-center text-[11px] text-muted-foreground">{empty}</p>
        ) : (
          <div className="space-y-0.5">{items.map(render)}</div>
        )}
      </CardContent>
    </Card>
  );
}

function EmptyState({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-accent text-muted-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}
