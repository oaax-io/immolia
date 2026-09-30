import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/lib/auth";
import { formatDateTime, formatDate } from "@/lib/format";
import { holidayMap } from "@/lib/swiss-holidays";

// Gleiche Ebenen-Auswahl wie im Kalender (localStorage "cal.layers"); Aufgaben bewusst ausgenommen.
const DEFAULT_LAYERS = ["holidays", "birthdays", "tasks", "all", "busy"];
const HORIZON_DAYS = 60;

type Item = { id: string; title: string; at: Date; allDay: boolean; sub?: string | null; kind: "appt" | "busy" | "holiday" | "birthday"; cancelled?: boolean };

export function UpcomingCalendarList({ emptyText }: { emptyText: string }) {
  const { user } = useAuth();
  const [layers, setLayers] = useState<string[]>(DEFAULT_LAYERS);
  const [canton, setCanton] = useState("ZH");
  useEffect(() => {
    try { const s = localStorage.getItem("cal.layers"); if (s) setLayers(JSON.parse(s)); } catch { /* ignore */ }
    setCanton(localStorage.getItem("cal.canton") || "ZH");
  }, []);
  const has = (k: string) => layers.includes(k);

  const nowIso = new Date().toISOString();
  const untilIso = new Date(Date.now() + HORIZON_DAYS * 86400_000).toISOString();

  const appts = useQuery({
    queryKey: ["dashboard", "upcoming-appts"],
    queryFn: async () => (await supabase.from("appointments")
      .select("id, title, starts_at, location, status, assigned_to, owner_id, extra_assignee_ids, is_online")
      .gte("starts_at", nowIso).lte("starts_at", untilIso).order("starts_at").limit(50)).data ?? [],
  });
  const busy = useQuery({
    queryKey: ["dashboard", "upcoming-busy"],
    enabled: has("busy"),
    queryFn: async () => (await supabase.from("calendar_busy_blocks")
      .select("id, subject, is_private, is_cancelled, starts_at, is_all_day")
      .gte("starts_at", nowIso).lte("starts_at", untilIso).order("starts_at").limit(50)).data ?? [],
  });
  const birthdays = useQuery({
    queryKey: ["client-birthdays"],
    enabled: has("birthdays"),
    queryFn: async () => (await supabase.from("client_self_disclosures")
      .select("client_id, birth_date, first_name, last_name, clients(full_name)")
      .not("birth_date", "is", null)).data ?? [],
  });

  const items = useMemo(() => {
    const out: Item[] = [];
    const now = new Date(); const today = new Date(now); today.setHours(0, 0, 0, 0);
    const until = new Date(today.getTime() + HORIZON_DAYS * 86400_000);
    const inRange = (d: Date) => d >= today && d <= until;

    for (const a of (appts.data ?? []) as any[]) {
      const mine = user && (a.assigned_to === user.id || a.owner_id === user.id || (a.extra_assignee_ids ?? []).includes(user.id));
      if (!(has("all") || (has("mine") && mine) || (has("online") && a.is_online))) continue;
      out.push({ id: a.id, title: a.title, at: new Date(a.starts_at), allDay: false, sub: a.location, kind: "appt", cancelled: a.status === "cancelled" });
    }
    if (has("busy")) for (const b of (busy.data ?? []) as any[]) {
      out.push({ id: `busy:${b.id}`, title: b.is_private || !b.subject ? "Beschäftigt (Outlook)" : b.subject, at: new Date(b.starts_at), allDay: !!b.is_all_day, sub: "Outlook", kind: "busy", cancelled: b.is_cancelled });
    }
    if (has("holidays")) {
      const y = now.getFullYear();
      for (const [k, list] of Object.entries(holidayMap([y, y + 1], canton, true))) {
        const d = new Date(`${k}T00:00:00`);
        if (inRange(d)) for (const h of list) out.push({ id: `hol:${k}:${h.name}`, title: h.name, at: d, allDay: true, sub: "Feiertag", kind: "holiday" });
      }
    }
    if (has("birthdays")) {
      const seen = new Set<string>(); const y = now.getFullYear();
      for (const b of (birthdays.data ?? []) as any[]) {
        if (!b.birth_date || seen.has(b.client_id)) continue;
        seen.add(b.client_id);
        const name = b.clients?.full_name || [b.first_name, b.last_name].filter(Boolean).join(" ") || "Kunde";
        const md = String(b.birth_date).slice(5, 10);
        for (const yy of [y, y + 1]) {
          const d = new Date(`${yy}-${md}T00:00:00`);
          if (inRange(d)) out.push({ id: `bd:${b.client_id}:${yy}`, title: `🎂 ${name}`, at: d, allDay: true, sub: "Geburtstag", kind: "birthday" });
        }
      }
    }
    return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, 8);
  }, [appts.data, busy.data, birthdays.data, layers, canton, user]);

  if (appts.isLoading) return <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>;
  if (items.length === 0) return (
    <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
      <CalendarDays className="h-6 w-6" />{emptyText}
    </div>
  );

  const dot: Record<Item["kind"], string> = { appt: "bg-primary", busy: "bg-muted-foreground", holiday: "bg-destructive", birthday: "bg-warning" };
  return (
    <div className="divide-y">
      {items.map((i) => (
        <Link key={i.id} to="/appointments" className="flex items-start gap-2 rounded px-1 py-2 first:pt-0 hover:bg-accent/40">
          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot[i.kind]}`} />
          <div className="min-w-0">
            <p className={`truncate text-sm font-medium ${i.cancelled ? "line-through text-muted-foreground" : ""}`}>{i.title}</p>
            <p className="truncate text-xs text-muted-foreground">
              {i.allDay ? formatDate(i.at.toISOString()) : formatDateTime(i.at.toISOString())}{i.sub ? ` · ${i.sub}` : ""}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}
