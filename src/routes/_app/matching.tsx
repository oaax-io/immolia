import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { matchClientToProperties, buildCityPostalIndex, type PropertyMatch, type FinancialCapacity, type CheckStatus } from "@/lib/matching";
import { formatCurrency, clientTypeLabels, propertyTypeLabels } from "@/lib/format";
import { ExternalLink, Users, Search, Target, Plus, Pencil, Bell, BellRing, TrendingUp, CalendarPlus, Send, Sparkles, Bookmark, Copy, Mail } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { SearchProfileDialog, type SearchProfile } from "@/components/matching/SearchProfileDialog";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { EmptyState } from "@/components/EmptyState";
import type { Tables } from "@/integrations/supabase/types";

/** Wandelt einen Storage-Pfad in eine öffentliche URL um (URLs bleiben unverändert). */
function toPublicUrl(path?: string | null): string | undefined {
  if (!path) return undefined;
  if (/^https?:\/\//i.test(path) || path.startsWith("data:") || path.startsWith("blob:")) return path;
  return supabase.storage.from("media").getPublicUrl(path).data.publicUrl;
}


type Client = Tables<"clients">;
type Property = Tables<"properties">;

export const Route = createFileRoute("/_app/matching")({
  validateSearch: (s: Record<string, unknown>) => ({
    clientId: (s.clientId as string) || "",
    view: (["client", "profile"].includes(s.view as string) ? (s.view as string) : "all") as
      | "all"
      | "client"
      | "profile",
    profileId: (s.profileId as string) || "",
  }),
  component: MatchingPage,
});


function MatchingPage() {
  const { clientId, view, profileId } = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const { user } = useAuth();
  const [query, setQuery] = useState("");
  const [minScore, setMinScore] = useState(50);
  const [filter, setFilter] = useState<FilterValue>("all");
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [editProfile, setEditProfile] = useState<SearchProfile | null>(null);
  const [disclosureClient, setDisclosureClient] = useState<Client | null>(null);
  const [apptTarget, setApptTarget] = useState<{ client: Client; property: Property } | null>(null);

  const { data: clients = [] } = useQuery({
    queryKey: ["clients"],
    queryFn: async () => (await supabase.from("clients").select("*").order("full_name")).data ?? [],
  });
  const { data: properties = [] } = useQuery({
    queryKey: ["properties"],
    queryFn: async () => (await supabase.from("properties").select("*")).data ?? [],
  });
  const { data: searchProfiles = [] } = useQuery({
    queryKey: ["search_profiles"],
    queryFn: async () =>
      (await supabase
        .from("client_search_profiles")
        .select("*")
        .order("created_at", { ascending: false })
      ).data ?? [],
  });
  const { data: subscriptions = [] } = useQuery({
    queryKey: ["search_profile_subscriptions", user?.id],
    enabled: !!user?.id,
    queryFn: async () =>
      (await supabase
        .from("search_profile_subscriptions")
        .select("id,profile_id")
        .eq("user_id", user!.id)
      ).data ?? [],
  });
  const subscribedIds = useMemo(
    () => new Set((subscriptions as any[]).map((s) => s.profile_id)),
    [subscriptions],
  );
  const toggleSubscription = useMutation({
    mutationFn: async (pid: string) => {
      if (subscribedIds.has(pid)) {
        const { error } = await supabase
          .from("search_profile_subscriptions")
          .delete()
          .eq("profile_id", pid)
          .eq("user_id", user!.id);
        if (error) throw error;
        return false;
      }
      const { error } = await supabase
        .from("search_profile_subscriptions")
        .insert({ profile_id: pid, user_id: user!.id });
      if (error) throw error;
      return true;
    },
    onSuccess: (subscribed) => {
      qc.invalidateQueries({ queryKey: ["search_profile_subscriptions"] });
      toast.success(subscribed ? "Suchprofil abonniert" : "Abo entfernt");
    },
    onError: (e: any) => toast.error(e.message ?? "Fehler"),
  });
  const { data: media = [] } = useQuery({
    queryKey: ["property_media_min"],
    queryFn: async () =>
      (await supabase
        .from("property_media")
        .select("property_id,file_url,is_cover,sort_order")
        .order("is_cover", { ascending: false })
        .order("sort_order", { ascending: true })
      ).data ?? [],
  });
  const coverByProperty = useMemo(() => {
    const map = new Map<string, string>();
    for (const m of media as any[]) {
      if (!m.file_url) continue;
      if (!map.has(m.property_id)) map.set(m.property_id, toPublicUrl(m.file_url)!);
    }
    return map;
  }, [media]);

  const { data: disclosures = [] } = useQuery({
    queryKey: ["self_disclosures_all"],
    queryFn: async () =>
      (await supabase
        .from("client_self_disclosures")
        .select("client_id,total_income_monthly,salary_net_monthly,additional_income,income_job_two,income_rental,annual_net_salary")
      ).data ?? [],
  });
  const { data: relationships = [] } = useQuery({
    queryKey: ["client_relationships_all"],
    queryFn: async () =>
      (await supabase
        .from("client_relationships")
        .select("client_id,related_client_id,relationship_type")
        .in("relationship_type", ["spouse", "co_applicant"])
      ).data ?? [],
  });

  // Map: clientId → finanzielle Tragfähigkeit (inkl. Ehepartner/Mitantragsteller)
  const capacityMap = useMemo(() => {
    const incomeYearly = new Map<string, number>();
    for (const d of disclosures as any[]) {
      const monthly =
        Number(d.total_income_monthly ?? 0) ||
        (Number(d.salary_net_monthly ?? 0) +
          Number(d.additional_income ?? 0) +
          Number(d.income_job_two ?? 0) +
          Number(d.income_rental ?? 0));
      const yearly = monthly > 0 ? monthly * 12 : Number(d.annual_net_salary ?? 0);
      if (yearly > 0) incomeYearly.set(d.client_id as string, (incomeYearly.get(d.client_id as string) ?? 0) + yearly);
    }
    const equityById = new Map<string, number>();
    for (const c of clients) {
      const eq = Number((c as any).equity ?? 0);
      if (eq > 0) equityById.set(c.id, eq);
    }
    // Partner-Links beide Richtungen
    const partnersOf = new Map<string, string[]>();
    for (const r of relationships as any[]) {
      const a = r.client_id as string;
      const b = r.related_client_id as string;
      partnersOf.set(a, [...(partnersOf.get(a) ?? []), b]);
      partnersOf.set(b, [...(partnersOf.get(b) ?? []), a]);
    }

    const out = new Map<string, FinancialCapacity>();
    for (const c of clients) {
      const partners = partnersOf.get(c.id) ?? [];
      const ownIncome = incomeYearly.get(c.id) ?? 0;
      const ownEquity = equityById.get(c.id) ?? 0;
      const partnerIncome = partners.reduce((s, pid) => s + (incomeYearly.get(pid) ?? 0), 0);
      const partnerEquity = partners.reduce((s, pid) => s + (equityById.get(pid) ?? 0), 0);
      const gross = ownIncome + partnerIncome;
      const equity = ownEquity + partnerEquity;
      if (gross > 0 || equity > 0) {
        out.set(c.id, {
          grossIncomeYearly: gross,
          equity,
          hasPartner: partners.length > 0 && partnerIncome > 0,
        });
      }
    }
    return out;
  }, [disclosures, relationships, clients]);

  const cityPostalIndex = useMemo(() => buildCityPostalIndex(properties), [properties]);
  const clientById = useMemo(() => new Map(clients.map((c) => [c.id, c])), [clients]);

  /**
   * Suchende: aktive Suchprofile sind die Hauptbasis. Kunden ohne aktives Profil
   * (Käufer/Mieter/Investoren mit eigenen Kriterien) laufen als Fallback mit.
   */
  const seekers = useMemo<Seeker[]>(() => {
    const now = new Date();
    const out: Seeker[] = [];
    const withProfile = new Set<string>();
    for (const p of searchProfiles as SearchProfile[]) {
      const base = clientById.get(p.client_id);
      if (!base || !p.is_active || (p.expires_at && new Date(p.expires_at) <= now)) continue;
      withProfile.add(p.client_id);
      const investor =
        (p.yield_target != null && Number(p.yield_target) > 0) ||
        (p.usage_types ?? []).some((u) => /invest|anlage|rendite/i.test(u)) ||
        p.role_type === "investor";
      out.push({
        key: `p:${p.id}`,
        client: base,
        profile: p,
        investor,
        criteria: {
          ...base,
          budget_min: p.budget_min,
          budget_max: p.budget_max,
          rooms_min: p.rooms_min,
          area_min: p.area_min,
          area_max: p.area_max,
          preferred_cities: p.preferred_cities,
          preferred_types: (p.preferred_property_types ?? []) as Client["preferred_types"],
          preferred_listing: p.listing_type,
        } as Client,
      });
    }
    for (const c of clients) {
      if (withProfile.has(c.id)) continue;
      if (c.client_type !== "buyer" && c.client_type !== "tenant" && c.client_type !== "investor") continue;
      out.push({ key: `c:${c.id}`, client: c, profile: null, investor: c.client_type === "investor", criteria: c });
    }
    return out;
  }, [searchProfiles, clients, clientById]);

  const matchesBySeeker = useMemo(() => {
    const m = new Map<string, PropertyMatch[]>();
    for (const s of seekers) {
      m.set(
        s.key,
        matchClientToProperties(s.criteria, properties, minScore, capacityMap.get(s.client.id) ?? null, {
          investor: s.investor,
          cityPostalIndex,
        }),
      );
    }
    return m;
  }, [seekers, properties, minScore, capacityMap, cityPostalIndex]);

  const kpis = useMemo(() => {
    let total = 0, top = 0, good = 0, withHits = 0;
    const yields: number[] = [];
    for (const s of seekers) {
      const list = matchesBySeeker.get(s.key) ?? [];
      if (list.length) withHits++;
      for (const m of list) {
        total++;
        if (m.score >= 80) top++;
        else if (m.score >= 65) good++;
        if (m.isInvestment && m.property.gross_yield != null) yields.push(Number(m.property.gross_yield));
      }
    }
    const subscribed = seekers.filter((s) => s.profile && subscribedIds.has(s.profile.id)).length;
    const avgYield = yields.length ? yields.reduce((a, b) => a + b, 0) / yields.length : null;
    return { total, top, good, rest: total - top - good, withHits, subscribed, avgYield };
  }, [seekers, matchesBySeeker, subscribedIds]);

  const visibleSeekers = useMemo(() => {
    const q = query.trim().toLowerCase();
    return seekers
      .filter((s) => {
        const list = matchesBySeeker.get(s.key) ?? [];
        if (filter === "subscribed" && !(s.profile && subscribedIds.has(s.profile.id))) return false;
        if (filter === "sale" && s.criteria.preferred_listing === "rent") return false;
        if (filter === "rent" && s.criteria.preferred_listing !== "rent") return false;
        if (filter === "investor" && !s.investor) return false;
        if (filter === "top" && !list.some((m) => m.score >= 80)) return false;
        if (q && !s.client.full_name?.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => {
        const la = matchesBySeeker.get(a.key) ?? [], lb = matchesBySeeker.get(b.key) ?? [];
        return (lb[0]?.score ?? 0) - (la[0]?.score ?? 0) || lb.length - la.length;
      });
  }, [seekers, matchesBySeeker, filter, query, subscribedIds]);

  const selectedSeeker =
    seekers.find((s) => (profileId ? s.profile?.id === profileId : clientId && s.client.id === clientId)) ??
    (profileId || clientId ? undefined : visibleSeekers[0]);
  const selectedMatches = selectedSeeker ? matchesBySeeker.get(selectedSeeker.key) ?? [] : [];

  const selectSeeker = (s: Seeker) =>
    navigate({ search: { clientId: s.client.id, view: s.profile ? "profile" : "client", profileId: s.profile?.id ?? "" } });

  const save = useMutation({
    mutationFn: async (m: { client_id: string; property_id: string; score: number; reasons: string[] }) => {
      const { error } = await supabase.from("matches").upsert(
        { client_id: m.client_id, property_id: m.property_id, score: m.score, reasons: m.reasons, status: "shortlisted" },
        { onConflict: "client_id,property_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Match vorgemerkt");
      qc.invalidateQueries({ queryKey: ["matches"] });
    },
    onError: (e: any) => toast.error(e.message),
  });

  const criteriaChips = (s: Seeker) =>
    [
      s.criteria.preferred_listing === "rent" ? "Miete" : s.criteria.preferred_listing === "sale" ? "Kauf" : null,
      s.criteria.budget_max ? `bis ${formatCurrency(Number(s.criteria.budget_max))}` : null,
      s.criteria.rooms_min ? `≥ ${s.criteria.rooms_min} Zi` : null,
      s.criteria.area_min ? `≥ ${s.criteria.area_min} m²` : null,
      ...(s.criteria.preferred_cities ?? []),
      ...((s.criteria.preferred_types ?? []) as string[]).map((t) => propertyTypeLabels[t as keyof typeof propertyTypeLabels] ?? t),
    ].filter(Boolean) as string[];

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-2.5">
            <Target className="h-8 w-8 text-primary" />
            Matching
          </span>
        }
        action={
          <Button onClick={() => { setEditProfile(null); setProfileDialogOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" />
            Suchprofil erstellen
          </Button>
        }
      />

      <SearchProfileDialog
        open={profileDialogOpen}
        onOpenChange={setProfileDialogOpen}
        profile={editProfile}
        defaultClientId={selectedSeeker?.client.id}
      />

      {clients.length === 0 ? (
        <EmptyState
          title="Noch keine Kunden"
          description="Erstelle zuerst einen Kunden mit Suchprofil."
          action={<Button asChild><Link to="/clients">Zu Kunden</Link></Button>}
        />
      ) : (
        <>
          {/* KPI-Leiste */}
          <DisclosureDialog client={disclosureClient} userId={user?.id} onClose={() => setDisclosureClient(null)} />
          <AppointmentDialog target={apptTarget} userId={user?.id} onClose={() => setApptTarget(null)} />
          <div className="mb-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardContent className="flex items-center gap-2.5 p-2.5">
                <MatchDonut top={kpis.top} good={kpis.good} rest={kpis.rest} />
                <div className="min-w-0">
                  <p className="text-[11px] text-muted-foreground">Matches</p>
                  <p className="font-display text-lg font-bold leading-tight tabular-nums">
                    {kpis.total}
                    <span className="ml-1.5 text-[11px] font-medium" style={{ color: "var(--chart-2)" }}>{kpis.top} Volltreffer</span>
                  </p>
                </div>
              </CardContent>
            </Card>
            <KpiCard icon={Users} label="Suchende mit Treffern" value={`${kpis.withHits} / ${seekers.length}`} hint="sofort bedienbar" />
            <KpiCard icon={BellRing} label="Abonnierte Suchprofile" value={String(kpis.subscribed)} hint="du wirst bei neuen Treffern benachrichtigt" />
            <KpiCard
              icon={TrendingUp}
              label="Ø Bruttorendite Anlage-Matches"
              value={kpis.avgYield != null ? `${kpis.avgYield.toFixed(1)} %` : "–"}
              hint="nur Anlageobjekte & Investoren"
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
            {/* Links: Suchende */}
            <Card className="h-fit lg:sticky lg:top-4">
              <CardContent className="space-y-3 p-3">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Kunde suchen…" className="h-9 pl-8" />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {FILTERS.map((f) => (
                    <button
                      key={f.value}
                      onClick={() => setFilter(f.value)}
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition ${
                        filter === f.value ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-accent"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
                <div className="max-h-[calc(100vh-320px)] space-y-1.5 overflow-y-auto pr-1">
                  {visibleSeekers.length === 0 ? (
                    <p className="p-3 text-center text-xs text-muted-foreground">Keine Suchenden für diesen Filter.</p>
                  ) : (
                    visibleSeekers.map((s) => {
                      const list = matchesBySeeker.get(s.key) ?? [];
                      const best = list[0]?.score ?? 0;
                      const active = selectedSeeker?.key === s.key;
                      const subscribed = !!s.profile && subscribedIds.has(s.profile.id);
                      return (
                        <div
                          key={s.key}
                          role="button"
                          tabIndex={0}
                          onClick={() => selectSeeker(s)}
                          onKeyDown={(e) => e.key === "Enter" && selectSeeker(s)}
                          className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2.5 transition ${
                            active ? "border-primary bg-primary/10" : "bg-background hover:bg-accent/60"
                          }`}
                        >
                          <MiniGauge value={best} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{s.client.full_name}</p>
                            <p className="truncate text-[11px] text-muted-foreground">
                              {s.profile ? "Suchprofil" : "Kundenangaben"}
                              {s.investor ? " · Investor" : ""}
                              {s.criteria.budget_max ? ` · bis ${formatCurrency(Number(s.criteria.budget_max))}` : ""}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <Badge variant={list.length ? "default" : "secondary"} className="tabular-nums text-[10px]">
                              {list.length}
                            </Badge>
                            {s.profile && (
                              <button
                                title={subscribed ? "Abo beenden" : "Treffer abonnieren"}
                                disabled={!user?.id || toggleSubscription.isPending}
                                onClick={(e) => { e.stopPropagation(); toggleSubscription.mutate(s.profile!.id); }}
                                className={subscribed ? "text-primary" : "text-muted-foreground hover:text-foreground"}
                              >
                                {subscribed ? <BellRing className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Rechts: Treffer */}
            <div className="min-w-0 space-y-3">
              {!selectedSeeker ? (
                <EmptyState title="Suchende auswählen" description="Wähle links einen Kunden oder ein Suchprofil." />
              ) : (
                <>
                  <Card>
                    <CardContent className="flex flex-wrap items-center gap-3 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Link to="/clients/$id" params={{ id: selectedSeeker.client.id }} className="truncate font-display text-lg font-semibold hover:underline">
                            {selectedSeeker.client.full_name}
                          </Link>
                          <Badge variant="outline" className="text-[10px]">
                            {selectedSeeker.profile ? "Suchprofil" : clientTypeLabels[selectedSeeker.client.client_type as keyof typeof clientTypeLabels]}
                          </Badge>
                          {capacityMap.has(selectedSeeker.client.id) ? (
                            <Badge variant="secondary" className="text-[10px]">Selbstauskunft vorhanden</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">Keine Selbstauskunft</Badge>
                          )}
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {criteriaChips(selectedSeeker).length === 0 ? (
                            <span className="text-xs text-muted-foreground">Keine Suchkriterien hinterlegt</span>
                          ) : (
                            criteriaChips(selectedSeeker).map((c) => <Badge key={c} variant="secondary" className="text-[10px]">{c}</Badge>)
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground">Min.</span>
                        <Select value={String(minScore)} onValueChange={(v) => setMinScore(Number(v))}>
                          <SelectTrigger className="h-9 w-20"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[40, 50, 60, 70, 80].map((n) => <SelectItem key={n} value={String(n)}>{n}%</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {selectedSeeker.profile && (
                          <Button size="sm" variant="outline" onClick={() => { setEditProfile(selectedSeeker.profile); setProfileDialogOpen(true); }}>
                            <Pencil className="mr-1.5 h-3.5 w-3.5" />Profil
                          </Button>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {selectedMatches.length === 0 ? (
                    <EmptyState
                      title="Keine passenden Objekte"
                      description="Kauf/Miete, Verfügbarkeit oder Budget (max. +10 %) schliessen alle Objekte aus. Senke den Mindestwert oder passe die Kriterien an."
                    />
                  ) : (
                    <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
                      {selectedMatches.map((m) => (
                        <MatchCard
                          key={m.property.id}
                          match={m}
                          hasDisclosure={capacityMap.has(selectedSeeker.client.id)}
                          onSave={() => save.mutate({ client_id: selectedSeeker.client.id, property_id: m.property.id, score: m.score, reasons: m.reasons })}
                          onAppointment={() => setApptTarget({ client: selectedSeeker.client, property: m.property })}
                          onDisclosure={() => setDisclosureClient(selectedSeeker.client)}
                          onImprove={() => { setEditProfile(selectedSeeker.profile); setProfileDialogOpen(true); }}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}

const FILTERS = [
  { value: "all", label: "Alle" },
  { value: "subscribed", label: "Abonniert" },
  { value: "sale", label: "Kauf" },
  { value: "rent", label: "Miete" },
  { value: "investor", label: "Investoren" },
  { value: "top", label: "≥ 80 %" },
] as const;
type FilterValue = (typeof FILTERS)[number]["value"];

interface Seeker {
  key: string;
  client: Client;
  profile: SearchProfile | null;
  investor: boolean;
  criteria: Client;
}

const scoreColor = (v: number) => (v >= 80 ? "var(--chart-2)" : v >= 65 ? "var(--chart-1)" : "var(--chart-4)");

function KpiCard({ icon: Icon, label, value, hint }: { icon: typeof Users; label: string; value: string; hint: string }) {
  return (
    <Card title={hint}>
      <CardContent className="flex items-center gap-2.5 p-2.5">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-[11px] text-muted-foreground">{label}</p>
          <p className="font-display text-lg font-bold leading-tight tabular-nums">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function MatchDonut({ top, good, rest }: { top: number; good: number; rest: number }) {
  const total = top + good + rest || 1;
  const r = 20, c = 2 * Math.PI * r;
  let off = 0;
  const segs = [
    { v: top, color: "var(--chart-2)" },
    { v: good, color: "var(--chart-1)" },
    { v: rest, color: "var(--chart-4)" },
  ];
  return (
    <svg viewBox="0 0 50 50" className="h-14 w-14 shrink-0 -rotate-90">
      <circle cx="25" cy="25" r={r} fill="none" strokeWidth="7" style={{ stroke: "var(--muted)" }} />
      {segs.map((s, i) => {
        const len = (s.v / total) * c;
        const el = (
          <circle key={i} cx="25" cy="25" r={r} fill="none" strokeWidth="7" strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-off} style={{ stroke: s.color }} />
        );
        off += len;
        return el;
      })}
    </svg>
  );
}

function MiniGauge({ value }: { value: number }) {
  const r = 15, c = 2 * Math.PI * r;
  return (
    <div className="relative h-10 w-10 shrink-0">
      <svg viewBox="0 0 40 40" className="h-10 w-10 -rotate-90">
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" style={{ stroke: "var(--muted)" }} />
        <circle cx="20" cy="20" r={r} fill="none" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(value / 100) * c} ${c}`} style={{ stroke: scoreColor(value) }} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums">{value || "–"}</span>
    </div>
  );
}

function ScoreGauge({ value }: { value: number }) {
  const r = 34, half = Math.PI * r;
  return (
    <div className="relative h-12 w-20 shrink-0">
      <svg viewBox="0 0 80 46" className="h-12 w-20">
        <path d="M6 42 A34 34 0 0 1 74 42" fill="none" strokeWidth="7" strokeLinecap="round" style={{ stroke: "var(--muted)" }} />
        <path d="M6 42 A34 34 0 0 1 74 42" fill="none" strokeWidth="7" strokeLinecap="round" strokeDasharray={`${(value / 100) * half} ${half}`} style={{ stroke: scoreColor(value) }} />
      </svg>
      <span className="absolute inset-x-0 bottom-0 text-center text-sm font-bold tabular-nums">{value}%</span>
    </div>
  );
}

const statusDot: Record<CheckStatus, string> = {
  ok: "var(--chart-2)",
  partial: "var(--chart-1)",
  miss: "var(--destructive)",
  na: "var(--muted-foreground)",
};

function MatchCard({
  match: m,
  onSave,
  hasDisclosure,
  onAppointment,
  onDisclosure,
  onImprove,
}: {
  match: PropertyMatch;
  onSave: () => void;
  hasDisclosure: boolean;
  onAppointment: () => void;
  onDisclosure: () => void;
  onImprove: () => void;
}) {
  const p = m.property;
  const isRent = p.listing_type === "rent";
  const a = m.affordability;
  const misses = m.checks.filter((c) => c.status === "na" || c.status === "miss");
  return (
    <Card className="transition hover:shadow-glow">
      <CardContent className="space-y-2 p-3">
        <div className="flex items-start gap-2">
          <MiniGauge value={m.score} />
          <div className="min-w-0 flex-1">
            <Link to="/properties/$id" params={{ id: p.id }} className="line-clamp-1 text-sm font-semibold hover:underline">
              {p.title}
            </Link>
            <p className="truncate text-[11px] text-muted-foreground">
              {[p.postal_code && p.city ? `${p.postal_code} ${p.city}` : p.city, propertyTypeLabels[p.property_type as keyof typeof propertyTypeLabels]].filter(Boolean).join(" · ")}
            </p>
          </div>
          <p className="shrink-0 text-sm font-bold tabular-nums">
            {isRent ? `${formatCurrency(p.rent ? Number(p.rent) : null)}/Mt.` : formatCurrency(p.price ? Number(p.price) : null)}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
          {m.checks.map((c) => (
            <span key={c.key} title={`${c.label}: ${c.detail}`} className="inline-flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: statusDot[c.status] }} />
              {c.label}
            </span>
          ))}
        </div>
        {(a || (m.isInvestment && p.gross_yield != null)) && (
          <div className="flex flex-wrap items-center gap-x-3 text-[11px]">
            {a && (
              <span className={financeTextClass(a.status)} title="Tragbarkeit · Belehnung (kalkulatorisch)">
                {a.ratio != null ? `Tragbarkeit ${a.ratio.toFixed(0)} %` : ""}
                {a.ratio != null && a.ltv != null ? " · " : ""}
                {a.ltv != null ? `Belehnung ${a.ltv.toFixed(0)} %` : ""}
              </span>
            )}
            {m.isInvestment && p.gross_yield != null && (
              <span className="font-medium text-primary">{Number(p.gross_yield).toFixed(1)} % Rendite</span>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-1 border-t border-border/60 pt-2">
          <Button size="sm" variant="outline" className="h-7 border-primary/30 px-2.5 text-[11px] text-primary hover:bg-primary/5 hover:text-primary" onClick={onAppointment}>
            <CalendarPlus className="mr-1 h-3.5 w-3.5" />Besichtigung
          </Button>
          {!hasDisclosure && !isRent && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground" onClick={onDisclosure}>
              <Send className="mr-1 h-3.5 w-3.5" />Selbstauskunft
            </Button>
          )}
          {misses.length > 0 && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground" onClick={onImprove} title={`Fehlt: ${misses.map((c) => c.label).join(", ")}`}>
              <Sparkles className="mr-1 h-3.5 w-3.5" />Profil ergänzen
            </Button>
          )}
          <div className="ml-auto flex">
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" title="Vormerken" onClick={onSave}>
              <Bookmark className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" title="Objekt öffnen" asChild>
              <Link to="/properties/$id" params={{ id: p.id }}><ExternalLink className="h-3.5 w-3.5" /></Link>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function generateToken() {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function DisclosureDialog({ client, userId, onClose }: { client: Client | null; userId?: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!client || !userId) return;
    setBusy(true);
    try {
      const token = generateToken();
      const { error } = await supabase.from("financing_links").insert({
        token, client_id: client.id, link_type: "self_disclosure", created_by: userId, dossier_id: null,
      } as any);
      if (error) throw error;
      setUrl(`${window.location.origin}/selbstauskunft/${token}`);
      toast.success("Link erstellt");
    } catch (e: any) {
      toast.error(e.message ?? "Fehler");
    } finally {
      setBusy(false);
    }
  };
  const mail = () => {
    if (!url || !client) return;
    const body = encodeURIComponent(`Guten Tag\n\nbitte füllen Sie Ihre Selbstauskunft über folgenden Link aus:\n\n${url}\n\nFreundliche Grüsse`);
    window.location.href = `mailto:${client.email ?? ""}?subject=${encodeURIComponent("Ihre Selbstauskunft")}&body=${body}`;
  };
  return (
    <Dialog open={!!client} onOpenChange={(o) => { if (!o) { setUrl(null); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Selbstauskunft anfordern</DialogTitle>
          <DialogDescription>
            Ohne Selbstauskunft kann {client?.full_name} nicht auf Tragbarkeit geprüft werden.
          </DialogDescription>
        </DialogHeader>
        {url ? (
          <div className="space-y-2">
            <Input readOnly value={url} className="text-xs" />
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => { navigator.clipboard.writeText(url); toast.success("Link kopiert"); }}>
                <Copy className="mr-1.5 h-4 w-4" />Kopieren
              </Button>
              <Button className="flex-1" onClick={mail}><Mail className="mr-1.5 h-4 w-4" />Per E-Mail</Button>
            </div>
          </div>
        ) : (
          <DialogFooter>
            <Button onClick={create} disabled={busy || !userId}><Send className="mr-1.5 h-4 w-4" />Sicheren Link erstellen</Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AppointmentDialog({
  target, userId, onClose,
}: { target: { client: Client; property: Property } | null; userId?: string; onClose: () => void }) {
  const p = target?.property;
  const defaultLocation = p ? [p.address, [p.postal_code, p.city].filter(Boolean).join(" ")].filter(Boolean).join(", ") : "";
  const [date, setDate] = useState("");
  const [time, setTime] = useState("10:00");
  const [duration, setDuration] = useState("60");
  const [location, setLocation] = useState("");
  const [note, setNote] = useState("");
  const [sendMail, setSendMail] = useState(true);
  useEffect(() => {
    if (target) {
      const d = new Date(); d.setDate(d.getDate() + 1);
      setDate(d.toISOString().slice(0, 10)); setTime("10:00"); setDuration("60");
      setLocation(defaultLocation); setNote(""); setSendMail(!!target.client.email);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  const save = useMutation({
    mutationFn: async () => {
      if (!target || !userId || !date || !time) throw new Error("Bitte Datum und Uhrzeit wählen");
      const s = new Date(`${date}T${time}`);
      const e = new Date(s.getTime() + Number(duration) * 60000);
      const { error } = await supabase.from("appointments").insert({
        owner_id: userId, client_id: target.client.id, property_id: target.property.id,
        title: `Besichtigung ${target.property.title}`, appointment_type: "viewing",
        starts_at: s.toISOString(), ends_at: e.toISOString(),
        location: location || null, notes: note || null,
      } as any);
      if (error) throw error;
      return { s, e };
    },
    onSuccess: ({ s, e }) => {
      toast.success("Besichtigung im Kalender eingetragen");
      if (sendMail && target) {
        const fmtD = s.toLocaleDateString("de-CH", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
        const fmtT = `${s.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })} – ${e.toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })} Uhr`;
        const body = [
          `Guten Tag ${target.client.full_name ?? ""}`.trim(), "",
          `gerne bestätige ich Ihnen den Besichtigungstermin für «${target.property.title}»:`, "",
          `Datum: ${fmtD}`, `Zeit: ${fmtT}`, location ? `Treffpunkt: ${location}` : "",
          note ? `\n${note}` : "", "", "Bei Verhinderung bitte ich um kurze Rückmeldung.", "", "Freundliche Grüsse",
        ].filter((l) => l !== null).join("\n");
        window.location.href = `mailto:${target.client.email ?? ""}?subject=${encodeURIComponent(`Besichtigung ${target.property.title} – ${fmtD}`)}&body=${encodeURIComponent(body)}`;
      }
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Besichtigung planen</DialogTitle>
          <DialogDescription>{target?.client.full_name} · {target?.property.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_100px_100px] gap-2">
            <div><Label className="text-xs">Datum</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div><Label className="text-xs">Uhrzeit</Label><Input type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} /></div>
            <div>
              <Label className="text-xs">Dauer</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["30", "45", "60", "90"].map((d) => <SelectItem key={d} value={d}>{d} Min.</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div><Label className="text-xs">Treffpunkt</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Adresse der Liegenschaft" /></div>
          <div><Label className="text-xs">Nachricht an den Kunden (optional)</Label><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Bitte Ausweis mitbringen, Parkplatz vor dem Haus" /></div>
          <label className="flex cursor-pointer items-center gap-2 rounded-md border border-border/60 p-2.5 text-sm">
            <input type="checkbox" checked={sendMail} onChange={(e) => setSendMail(e.target.checked)} className="h-4 w-4 accent-[var(--primary)]" />
            <Mail className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1">Einladung per E-Mail an den Kunden</span>
            {!target?.client.email && <span className="text-[11px] text-muted-foreground">keine E-Mail hinterlegt</span>}
          </label>
        </div>
        <DialogFooter>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>
            <CalendarPlus className="mr-1.5 h-4 w-4" />{sendMail ? "Eintragen & E-Mail öffnen" : "Eintragen"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function financeTextClass(s: "ok" | "warn" | "fail"): string {
  if (s === "ok") return "font-medium text-emerald-700 dark:text-emerald-400";
  if (s === "warn") return "font-medium text-orange-700 dark:text-orange-400";
  return "font-medium text-destructive";
}

function financeChipClass(s: "ok" | "warn" | "fail"): string {
  if (s === "ok") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 ring-1 ring-emerald-500/30";
  if (s === "warn") return "bg-amber-500/15 text-amber-700 dark:text-amber-400 ring-1 ring-amber-500/30";
  return "bg-destructive/15 text-destructive ring-1 ring-destructive/30";
}
