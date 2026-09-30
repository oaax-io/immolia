import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ArrowRight, Banknote, Building2, CheckCircle2, Gavel, Radar, UserPlus, Users, Zap,
} from "lucide-react";
import {
  buildRadar, buildBriefing, balancedItems, GROUP_LABELS,
  type RadarGroup, type RadarItem, type RadarSeverity,
} from "@/lib/dashboard-radar";
import { useDashboardRealtime } from "@/hooks/useDashboardRealtime";

const GROUP_ICON: Record<RadarGroup, any> = {
  financing: Banknote,
  closing: Gavel,
  clients: Users,
  properties: Building2,
  leads: UserPlus,
};

const SEV_STYLE: Record<RadarSeverity, { dot: string; badge: string; label: string }> = {
  urgent: { dot: "bg-rose-500", badge: "border-rose-500/40 bg-rose-500/10 text-rose-600", label: "Dringend" },
  warn: { dot: "bg-amber-500", badge: "border-amber-500/40 bg-amber-500/10 text-amber-600", label: "Zu erledigen" },
  ready: { dot: "bg-emerald-500", badge: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600", label: "Bereit" },
  info: { dot: "bg-sky-500", badge: "border-sky-500/40 bg-sky-500/10 text-sky-600", label: "Hinweis" },
};

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); };
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.toISOString(); };

export function ActionRadar({ displayName }: { displayName?: string }) {
  useDashboardRealtime();
  const [group, setGroup] = useState<RadarGroup | "all">("all");
  const [expanded, setExpanded] = useState(false);

  const radar = useQuery({
    queryKey: ["dashboard", "radar"],
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    queryFn: async () => {
      const soon = new Date(Date.now() + 21 * 86_400_000).toISOString();
      const [
        dossiers, clients, disclosures, leads, properties, media, exposeDocs, appointments, reservations, todayAppts,
      ] = await Promise.all([
        supabase.from("financing_dossiers")
          .select("id, dossier_status, submitted_to_bank_at, bank_decision_at, bank_name, client_id, property_id, updated_at"),
        supabase.from("clients")
          .select("id, full_name, status, pipeline_stage, financing_status").eq("is_archived", false),
        supabase.from("client_self_disclosures").select("client_id, status"),
        supabase.from("leads").select("id, full_name, status, created_at")
          .order("created_at", { ascending: false }).limit(200),
        supabase.from("properties").select("id, title, status, price, address, city, description, area, rooms")
          .in("status", ["available", "active", "preparation"]),
        supabase.from("property_media").select("property_id"),
        supabase.from("generated_documents").select("related_id").eq("related_type", "property"),
        supabase.from("appointments").select("id, title, starts_at, location, notes")
          .gte("starts_at", new Date().toISOString()).lte("starts_at", soon).order("starts_at"),
        supabase.from("reservations").select("id, status, client_id, property_id, created_at")
          .in("status", ["draft", "sent"]),
        supabase.from("appointments").select("id", { count: "exact", head: true })
          .gte("starts_at", startOfToday()).lte("starts_at", endOfToday()),
      ]);

      const items = buildRadar({
        dossiers: dossiers.data ?? [],
        clients: clients.data ?? [],
        disclosures: disclosures.data ?? [],
        leads: leads.data ?? [],
        properties: properties.data ?? [],
        media: media.data ?? [],
        exposeDocs: exposeDocs.data ?? [],
        appointments: appointments.data ?? [],
        reservations: reservations.data ?? [],
      });
      return { items, todayAppts: todayAppts.count ?? 0 };
    },
  });

  const items = radar.data?.items ?? [];
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: items.length };
    for (const i of items) c[i.group] = (c[i.group] ?? 0) + 1;
    return c;
  }, [items]);

  const filtered = group === "all" ? balancedItems(items) : items.filter((i) => i.group === group);
  const visible = expanded ? filtered.slice(0, 40) : filtered.slice(0, 6);
  const briefing = buildBriefing(items, radar.data?.todayAppts ?? 0);
  const urgent = items.filter((i) => i.severity === "urgent").length;

  const greet = (() => {
    const h = new Date().getHours();
    if (h < 5) return "Gute Nacht";
    if (h < 12) return "Guten Morgen";
    if (h < 18) return "Guten Tag";
    return "Guten Abend";
  })();

  return (
    <Card className="mt-4 overflow-hidden border-primary/30">
      <CardHeader className="flex flex-row items-start justify-between gap-3 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent pb-4">
        <div className="min-w-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Radar className="h-4 w-4 text-primary" />
            Was jetzt zu tun ist
            <span className="ml-1 flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-600">
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-70" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              live
            </span>
          </CardTitle>
          {radar.isLoading ? (
            <Skeleton className="mt-2 h-4 w-72" />
          ) : (
            <p className="mt-1 text-sm text-muted-foreground">
              {briefing.length === 0
                ? `${greet}${displayName ? `, ${displayName}` : ""} – alles auf Kurs, keine dringenden Pendenzen.`
                : `${greet}${displayName ? `, ${displayName}` : ""}: ${briefing.slice(0, 4).join(" · ")}.`}
            </p>
          )}
        </div>
        {urgent > 0 && (
          <Badge variant="outline" className="shrink-0 border-rose-500/40 bg-rose-500/10 text-rose-600">
            <Zap className="mr-1 h-3 w-3" /> {urgent} dringend
          </Badge>
        )}
      </CardHeader>

      <CardContent className="pt-4">
        {/* Filter */}
        <div className="mb-3 flex flex-wrap gap-1.5">
          <FilterChip active={group === "all"} onClick={() => setGroup("all")} label="Alle" count={counts.all ?? 0} />
          {(Object.keys(GROUP_LABELS) as RadarGroup[]).map((g) => (
            <FilterChip
              key={g} icon={GROUP_ICON[g]} active={group === g} onClick={() => setGroup(g)}
              label={GROUP_LABELS[g]} count={counts[g] ?? 0}
            />
          ))}
        </div>

        {radar.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <p className="text-sm font-medium">Alles erledigt</p>
            <p className="text-xs text-muted-foreground">In diesem Bereich wartet gerade nichts auf dich.</p>
          </div>
        ) : (
          <>
            <div className="space-y-1.5">
              {visible.map((item) => <RadarRow key={item.id} item={item} />)}
            </div>
            {filtered.length > visible.length && (
              <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setExpanded(true)}>
                {filtered.length - visible.length} weitere anzeigen
              </Button>
            )}
            {expanded && filtered.length > 6 && (
              <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setExpanded(false)}>
                Weniger anzeigen
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function FilterChip({ label, count, active, onClick, icon: Icon }: {
  label: string; count: number; active: boolean; onClick: () => void; icon?: any;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-accent",
        count === 0 && !active && "opacity-50",
      )}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {label}
      <span className={cn("rounded-full px-1.5 text-[10px] font-semibold tabular-nums",
        active ? "bg-primary-foreground/20" : "bg-muted")}>{count}</span>
    </button>
  );
}

function RadarRow({ item }: { item: RadarItem }) {
  const sev = SEV_STYLE[item.severity];
  const Icon = GROUP_ICON[item.group];
  return (
    <Link
      to={item.to as any}
      params={item.params as any}
      className="group flex items-center gap-3 rounded-lg border border-transparent px-2 py-2 transition hover:border-border hover:bg-accent/50"
    >
      <span className={cn("h-8 w-8 shrink-0 rounded-lg flex items-center justify-center", sev.badge, "border")}>
        <Icon className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", sev.dot)} />
          <span className="truncate text-sm font-medium">{item.title}</span>
        </span>
        {item.subtitle && <span className="mt-0.5 block truncate pl-3.5 text-xs text-muted-foreground">{item.subtitle}</span>}
      </span>
      <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground group-hover:text-primary sm:flex">
        {item.actionLabel ?? "Öffnen"} <ArrowRight className="h-3 w-3" />
      </span>
    </Link>
  );
}
