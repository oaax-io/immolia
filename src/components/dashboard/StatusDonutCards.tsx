import { Link } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowRight, Users, Building2, UserPlus, Wallet,
  CheckCircle2, AlertTriangle, XCircle,
} from "lucide-react";
import { propertyStatusLabels, leadStatusLabels } from "@/lib/format";
import { useTranslation } from "react-i18next";

export type StatusCounts = Record<string, number>;
export type QcCounts = Record<string, number>;

export function DonutCard({ title, icon: Icon, to, counts, rows, loading, emptyText, footer }: {
  title: string; icon: any; to: string; counts: StatusCounts;
  rows: { key: string; label: string; color: string }[]; loading?: boolean; emptyText?: string;
  footer?: React.ReactNode;
}) {
  const total = rows.reduce((a, r) => a + (counts[r.key] ?? 0), 0);
  const R = 26, C = 2 * Math.PI * R;
  let offset = 0;
  const segments = rows.map((r) => {
    const c = counts[r.key] ?? 0;
    const frac = total > 0 ? c / total : 0;
    const seg = { ...r, c, dash: frac * C, off: offset };
    offset += frac * C;
    return seg;
  }).filter((s) => s.c > 0);
  const visible = rows.filter((r) => (counts[r.key] ?? 0) > 0);
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between p-3 pb-1">
        <CardTitle className="flex items-center gap-1.5 text-xs font-medium">
          <Icon className="h-3.5 w-3.5 text-primary" />
          {title}
        </CardTitle>
        <Button variant="ghost" size="sm" asChild className="h-6 w-6 p-0">
          <Link to={to}><ArrowRight className="h-3 w-3" /></Link>
        </Button>
      </CardHeader>
      <CardContent className="p-3 pt-1">
        {loading ? (
          <Skeleton className="mx-auto h-[70px] w-[70px] rounded-full" />
        ) : total === 0 ? (
          <p className="py-6 text-center text-[11px] text-muted-foreground">{emptyText ?? "Keine Daten"}</p>
        ) : (
          <div className="flex items-center gap-3">
            <svg viewBox="0 0 64 64" className="h-[70px] w-[70px] shrink-0 -rotate-90">
              <circle cx="32" cy="32" r={R} fill="none" className="stroke-muted" strokeWidth="9" />
              {segments.map((s) => (
                <circle key={s.key} cx="32" cy="32" r={R} fill="none" stroke={s.color} strokeWidth="9"
                  strokeDasharray={`${s.dash} ${C - s.dash}`} strokeDashoffset={-s.off}>
                  <title>{`${s.label}: ${s.c}`}</title>
                </circle>
              ))}
              <text x="32" y="34" transform="rotate(90 32 32)" textAnchor="middle" dominantBaseline="middle"
                className="fill-foreground font-semibold" fontSize="14">{total}</text>
            </svg>
            <div className="min-w-0 flex-1 space-y-0.5">
              {visible.slice(0, 5).map((r) => {
                const c = counts[r.key] ?? 0;
                return (
                  <div key={r.key} className="flex items-center justify-between gap-1.5 text-[11px]">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: r.color }} />
                      <span className="truncate text-muted-foreground">{r.label}</span>
                    </span>
                    <span className="shrink-0 font-medium tabular-nums">{c}</span>
                  </div>
                );
              })}
              {visible.length > 5 && (
                <p className="text-[10px] text-muted-foreground">+{visible.length - 5} weitere</p>
              )}
            </div>
          </div>
        )}
        {footer}
      </CardContent>
    </Card>
  );
}

/** Die vier Status-Ringdiagramme (Kunden, Immobilien, Leads, Finanzierungs-Dossiers).
 *  Wird auf dem Dashboard und in Analytics verwendet. */
export function StatusDonutGrid({ clientCounts, propCounts, leadCounts, dossierCounts, qcCounts, loading }: {
  clientCounts: StatusCounts;
  propCounts: StatusCounts;
  leadCounts: StatusCounts;
  dossierCounts: StatusCounts;
  qcCounts?: QcCounts;
  loading?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
      <DonutCard
        title={t("dashboard.clientStatus.title")}
        icon={Users}
        to="/clients"
        loading={loading}
        counts={clientCounts}
        emptyText={t("dashboard.pipeline.noData")}
        rows={[
          { key: "entwurf", label: t("dashboard.clientStatus.entwurf"), color: "#94a3b8" },
          { key: "pendent", label: t("dashboard.clientStatus.pendent"), color: "#f59e0b" },
          { key: "vollstaendig", label: t("dashboard.clientStatus.vollstaendig"), color: "#0ea5e9" },
          { key: "finanzierung", label: t("dashboard.clientStatus.finanzierung"), color: "#8b5cf6" },
          { key: "abgeschlossen", label: t("dashboard.clientStatus.abgeschlossen"), color: "#10b981" },
          { key: "abgelehnt", label: t("dashboard.clientStatus.abgelehnt"), color: "#f43f5e" },
          { key: "storniert", label: t("dashboard.clientStatus.storniert"), color: "#71717a" },
        ]}
      />
      <DonutCard
        title={t("dashboard.pipeline.properties")}
        icon={Building2}
        to="/properties"
        loading={loading}
        counts={propCounts}
        emptyText={t("dashboard.pipeline.noData")}
        rows={[
          { key: "draft", label: (propertyStatusLabels as Record<string, string>)["draft"] ?? "draft", color: "#94a3b8" },
          { key: "preparation", label: (propertyStatusLabels as Record<string, string>)["preparation"] ?? "preparation", color: "#f59e0b" },
          { key: "available", label: (propertyStatusLabels as Record<string, string>)["available"] ?? "available", color: "#10b981" },
          { key: "reserved", label: (propertyStatusLabels as Record<string, string>)["reserved"] ?? "reserved", color: "#6366f1" },
          { key: "sold", label: (propertyStatusLabels as Record<string, string>)["sold"] ?? "sold", color: "#0ea5e9" },
          { key: "rented", label: (propertyStatusLabels as Record<string, string>)["rented"] ?? "rented", color: "#14b8a6" },
          { key: "archived", label: (propertyStatusLabels as Record<string, string>)["archived"] ?? "archived", color: "#71717a" },
        ]}
      />
      <DonutCard
        title={t("dashboard.pipeline.leads")}
        icon={UserPlus}
        to="/leads"
        loading={loading}
        counts={leadCounts}
        emptyText={t("dashboard.pipeline.noData")}
        rows={[
          { key: "new", label: (leadStatusLabels as Record<string, string>)["new"] ?? "new", color: "#0ea5e9" },
          { key: "contacted", label: (leadStatusLabels as Record<string, string>)["contacted"] ?? "contacted", color: "#6366f1" },
          { key: "qualified", label: (leadStatusLabels as Record<string, string>)["qualified"] ?? "qualified", color: "#8b5cf6" },
          { key: "viewing_planned", label: (leadStatusLabels as Record<string, string>)["viewing_planned"] ?? "viewing_planned", color: "#f59e0b" },
          { key: "converted", label: (leadStatusLabels as Record<string, string>)["converted"] ?? "converted", color: "#10b981" },
          { key: "lost", label: (leadStatusLabels as Record<string, string>)["lost"] ?? "lost", color: "#f43f5e" },
        ]}
      />
      <DonutCard
        title={t("dashboard.dossierStatus.title")}
        icon={Wallet}
        to="/financing"
        loading={loading}
        counts={dossierCounts}
        emptyText={t("dashboard.pipeline.noData")}
        rows={[
          { key: "draft", label: t("dashboard.dossierStatus.draft"), color: "#94a3b8" },
          { key: "quick_check", label: t("dashboard.dossierStatus.quick_check"), color: "#06b6d4" },
          { key: "documents_missing", label: t("dashboard.dossierStatus.documents_missing"), color: "#f59e0b" },
          { key: "ready_for_bank", label: t("dashboard.dossierStatus.ready_for_bank"), color: "#6366f1" },
          { key: "submitted_to_bank", label: t("dashboard.dossierStatus.submitted_to_bank"), color: "#3b82f6" },
          { key: "approved", label: t("dashboard.dossierStatus.approved"), color: "#10b981" },
          { key: "rejected", label: t("dashboard.dossierStatus.rejected"), color: "#f43f5e" },
          { key: "cancelled", label: t("dashboard.dossierStatus.cancelled"), color: "#71717a" },
        ]}
        footer={qcCounts ? (
          <div className="mt-2 grid grid-cols-3 gap-1 border-t border-border/50 pt-2">
            <div className="flex flex-col items-center gap-0.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1 py-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
              <span className="font-display text-sm font-bold leading-none tabular-nums text-emerald-700 dark:text-emerald-400">{qcCounts.pass ?? 0}</span>
              <span className="text-[9px] text-emerald-700/80 dark:text-emerald-400/80">{t("dashboard.qc.realistic")}</span>
            </div>
            <div className="flex flex-col items-center gap-0.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-1 py-1">
              <AlertTriangle className="h-3 w-3 text-amber-600 dark:text-amber-400" />
              <span className="font-display text-sm font-bold leading-none tabular-nums text-amber-700 dark:text-amber-400">{qcCounts.warn ?? 0}</span>
              <span className="text-[9px] text-amber-700/80 dark:text-amber-400/80">{t("dashboard.qc.borderline")}</span>
            </div>
            <div className="flex flex-col items-center gap-0.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-1 py-1">
              <XCircle className="h-3 w-3 text-rose-600 dark:text-rose-400" />
              <span className="font-display text-sm font-bold leading-none tabular-nums text-rose-700 dark:text-rose-400">{qcCounts.fail ?? 0}</span>
              <span className="text-[9px] text-rose-700/80 dark:text-rose-400/80">{t("dashboard.qc.notFinanceable")}</span>
            </div>
          </div>
        ) : undefined}
      />
    </div>
  );
}
