import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, AlertTriangle, Infinity as InfinityIcon } from "lucide-react";
import { toast } from "sonner";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { actionLabel, creditUxState, USAGE_LABELS } from "@/lib/credit-ux";
import { createPlanCheckout, createCreditTopupCheckout, createAgencyPortal } from "@/utils/billing.functions";

export const Route = createFileRoute("/_app/settings/billing")({
  head: () => ({ meta: [{ title: "Abo & Credits – Einstellungen" }, { name: "description", content: "Abo, Nutzung, Credit-Guthaben und Credit-Historie Ihrer Firma." }] }),
  component: BillingPage,
});

const STATE_LABEL: Record<string, string> = {
  trialing: "Testphase", active: "Aktiv", past_due: "Zahlung überfällig", unpaid: "Unbezahlt",
  canceled_until_period_end: "Gekündigt zum Periodenende", post_trial: "Kein aktives Abo",
  no_active_subscription: "Kein aktives Abo",
};
const SOURCE_LABEL: Record<string, string> = { stripe: "Stripe (Karte)", invoice: "Rechnung", bank_transfer: "Banküberweisung", manual: "Individueller Vertrag", complimentary: "Kostenlos" };
const PERIOD_LABEL: Record<string, string> = { monthly: "Monatlich", yearly: "Jährlich", custom: "Individuell" };
const BUCKET_LABEL: Record<string, string> = { subscription: "Abo-Credits", promotional: "Aktions-/Promo-Credits", adjustment: "Korrektur", purchased: "Gekaufte Credits" };
const BUCKET_ORDER = ["subscription", "promotional", "adjustment", "purchased"];
const UNIT_LABEL: Record<string, string> = { gb: "GB", user: "", request: "", domain: "" };

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("de-CH") : "–");
const fmtNum = (n: number) => n.toLocaleString("de-CH");
const fmtChf = (n: number | string, cur = "CHF") => `${cur} ${Number(n).toLocaleString("de-CH", { maximumFractionDigits: 2 })}`;

function historyLabel(e: any): { title: string; type: string } {
  if (e.delta < 0) {
    if (e.reference_type === "refund_of_entry" || e.source === "refund") return { title: "Rückbuchung", type: "Korrektur" };
    if (e.metadata?.reason === "usage_overage_reservation" || e.metadata?.reason?.startsWith?.("recurring")) return { title: actionLabel(e.action_key), type: "Verbrauch" };
    return { title: actionLabel(e.action_key, e.action_name), type: "Verbrauch" };
  }
  switch (e.source) {
    case "subscription": return { title: "Monatliches Abo-Kontingent", type: "Abo" };
    case "purchase": return { title: "Credit-Paket gekauft", type: "Kauf" };
    case "trial": return { title: "Test-Credits", type: "Aktion" };
    case "promotion": case "promotional": return { title: "Aktion / Promotion", type: "Aktion" };
    case "refund": return { title: "Rückerstattung", type: "Korrektur" };
    default: return { title: e.metadata?.reason === "platform_adjustment" ? "Korrektur durch Immolia" : "Gutschrift", type: BUCKET_LABEL[e.bucket] ?? "Gutschrift" };
  }
}

type Checkout = { kind: "plan" | "credits"; key: string } | null;

function BillingPage() {
  const [checkout, setCheckout] = useState<Checkout>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const returnUrl = typeof window !== "undefined" ? `${window.location.origin}/settings/billing?checkout=done` : "";
  const sb = supabase as any;

  // Aktive Firma immer serverseitig (current_agency_id) – nie aus URL/Browser.
  const agencyQ = useQuery({
    queryKey: ["billing", "agency"],
    staleTime: 0,
    queryFn: async () => (await sb.rpc("current_agency_id")).data as string | null,
  });
  const agencyId = agencyQ.data ?? null;

  const billingQ = useQuery({
    queryKey: ["billing", agencyId],
    enabled: !!agencyId,
    queryFn: async () => {
      const [state, catalog] = await Promise.all([
        sb.rpc("commercial_subscription_state", { _agency_id: agencyId }),
        sb.rpc("tenant_billing_catalog"),
      ]);
      // Fehler nicht als „leerer Katalog" verschlucken: React Query wiederholt, danach Hinweis
      if (catalog.error) throw new Error(catalog.error.message);
      return { state: state.data as any, catalog: (catalog.data ?? { plans: [], packages: [], action_costs: [] }) as any };
    },
  });
  const usageQ = useQuery({
    queryKey: ["usage", agencyId],
    enabled: !!agencyId,
    queryFn: async () => {
      const { data, error } = await sb.rpc("agency_commercial_state", { _agency_id: agencyId });
      if (error) return { forbidden: true, data: null as any };
      return { forbidden: false, data };
    },
  });
  const creditsQ = useQuery({
    queryKey: ["credits", agencyId],
    enabled: !!agencyId,
    queryFn: async () => {
      const [bd, ledger] = await Promise.all([
        sb.rpc("credit_balance_breakdown", { _agency_id: agencyId }),
        sb.from("credit_ledger").select("id,created_at,source,bucket,delta,action_key,expires_at,reference_type,metadata")
          .eq("agency_id", agencyId).order("created_at", { ascending: false }).limit(100),
      ]);
      if (bd.error) return { forbidden: true, breakdown: null as any, ledger: [] as any[] };
      return { forbidden: false, breakdown: bd.data, ledger: ledger.data ?? [] };
    },
  });

  const fetchClientSecret = async () => {
    if (!checkout) throw new Error("Kein Checkout");
    const env = getStripeEnvironment();
    const res = checkout.kind === "plan"
      ? await createPlanCheckout({ data: { planKey: checkout.key, returnUrl, environment: env } })
      : await createCreditTopupCheckout({ data: { packageKey: checkout.key, returnUrl, environment: env } });
    if ("error" in res) { toast.error(res.error); setCheckout(null); throw new Error(res.error); }
    return res.clientSecret;
  };

  const openPortal = async () => {
    setPortalBusy(true);
    try {
      const res = await createAgencyPortal({ data: { returnUrl: window.location.href, environment: getStripeEnvironment() } });
      if ("error" in res) throw new Error(res.error);
      window.open(res.url, "_blank");
    } catch (e: any) { toast.error(e.message); } finally { setPortalBusy(false); }
  };

  const loading = agencyQ.isLoading || (!!agencyId && billingQ.isLoading);
  const s = billingQ.data?.state as any;
  const catalog = billingQ.data?.catalog;
  const st = s?.state as string | undefined;
  const src = (s?.billing_source ?? (s?.source === "stripe" ? "stripe" : undefined)) as string | undefined;
  const isManual = !!src && src !== "stripe";
  const isStripe = src === "stripe";
  const plan = catalog?.plans.find((p: any) => p.id === s?.plan_id);
  const planName = plan?.name ?? s?.plan_name;
  const hasPaidSub = st === "active" || st === "past_due" || st === "canceled_until_period_end";
  const bd = creditsQ.data?.breakdown;
  const balance: number | null = bd ? Number(bd.available) : null;
  const actionNames = new Map<string, string>((catalog?.action_costs ?? []).map((a: any) => [a.key, a.name]));

  let nextLabel = "", nextDate: string | null = null;
  if (st === "trialing") { nextLabel = "Testphase endet"; nextDate = s?.trial_end; }
  else if (isManual) { nextLabel = "Bezahlt bis"; nextDate = s?.paid_until ?? s?.current_period_end; }
  else if (s?.cancel_at_period_end) { nextLabel = "Endet am"; nextDate = s?.current_period_end; }
  else if (isStripe && s?.current_period_end) { nextLabel = "Nächste Abrechnung"; nextDate = s.current_period_end; }

  const price = isManual
    ? (s?.contract_price != null ? `${fmtChf(s.contract_price, s.contract_currency ?? "CHF")}${s?.billing_period === "yearly" ? " / Jahr" : s?.billing_period === "monthly" ? " / Monat" : ""}` : null)
    : plan ? `${fmtChf(plan.price_monthly, plan.currency ?? "CHF")} / Monat` : null;

  if (!loading && !agencyId) {
    return <div className="p-6 text-sm text-muted-foreground">Bitte zuerst ein Unternehmen auswählen.</div>;
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-4 sm:p-6">
      <PaymentTestModeBanner />
      <Link to="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Einstellungen</Link>
      <div>
        <h1 className="text-2xl font-semibold">Abo & Credits</h1>
        <p className="mt-1 text-sm text-muted-foreground">Immolia beschränkt nicht die Arbeit. Zusätzlicher Verbrauch wird über Credits verrechnet.</p>
      </div>

      {billingQ.isError && (
        <Card className="flex items-center justify-between gap-3 p-4 text-sm">
          <span>Pläne und Credit-Pakete konnten nicht geladen werden.</span>
          <Button variant="outline" size="sm" onClick={() => billingQ.refetch()}>Erneut versuchen</Button>
        </Card>
      )}
      {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : checkout ? (
        <Card className="space-y-3 p-4">
          <Button variant="ghost" size="sm" onClick={() => setCheckout(null)}>Abbrechen</Button>
          <EmbeddedCheckoutProvider key={checkout.kind + checkout.key} stripe={getStripe()} options={{ fetchClientSecret }}>
            <EmbeddedCheckout />
          </EmbeddedCheckoutProvider>
          <p className="text-xs text-muted-foreground">Credits und Abo werden erst nach bestätigter Zahlung gutgeschrieben – das kann einige Sekunden dauern.</p>
        </Card>
      ) : (
        <>
          {/* 1. Cockpit */}
          <Card className="p-5">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
              <Kpi label="Plan" value={planName ?? "–"} />
              <Kpi label="Status" value={st ? STATE_LABEL[st] ?? "Kein aktives Abo" : "Status nicht verfügbar"} />
              <Kpi label="Abrechnungsart" value={src ? SOURCE_LABEL[src] ?? src : "–"} />
              <Kpi label="Periode" value={s?.billing_period ? PERIOD_LABEL[s.billing_period] ?? s.billing_period : "–"} />
              <Kpi label={nextLabel || "Nächster Termin"} value={fmtDate(nextDate)} />
              <Kpi label="Credit-Guthaben" value={balance !== null ? `${fmtNum(balance)} Credits` : "–"} />
            </div>
            {st === "past_due" && (
              <p className="mt-4 flex items-start gap-2 text-sm text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />Zahlung überfällig. Ihre Daten bleiben erhalten; bitte Zahlung aktualisieren.</p>
            )}
          </Card>

          {/* 2. Abo-Details */}
          <Card className="flex flex-wrap items-start justify-between gap-4 p-5">
            <div className="min-w-0">
              <h2 className="text-lg font-medium">Abonnement</h2>
              {!s?.subscription_id ? <p className="text-sm text-muted-foreground">Kein Abonnement vorhanden.</p> : (
                <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Plan</dt><dd>{planName ?? "–"}</dd>
                  <dt className="text-muted-foreground">Zahlungsweg</dt><dd>{src ? SOURCE_LABEL[src] ?? src : "–"}</dd>
                  {price && <><dt className="text-muted-foreground">Preis</dt><dd>{price}</dd></>}
                  {(s?.current_period_start || s?.current_period_end) && <><dt className="text-muted-foreground">{isManual ? "Vertragsperiode" : "Periode"}</dt><dd>{fmtDate(s?.current_period_start)} – {fmtDate(s?.current_period_end)}</dd></>}
                  {isManual && <><dt className="text-muted-foreground">Bezahlt bis</dt><dd>{fmtDate(s?.paid_until)}</dd></>}
                  {s?.cancel_at_period_end && <><dt className="text-muted-foreground">Kündigung</dt><dd>zum {fmtDate(s?.current_period_end)}</dd></>}
                </dl>
              )}
            </div>
            {isManual ? (
              <p className="max-w-sm text-sm text-muted-foreground">Dieses Abonnement wird direkt mit Immolia abgerechnet. Für Planänderungen kontaktieren Sie bitte Immolia.</p>
            ) : isStripe ? (
              <Button variant="outline" onClick={openPortal} disabled={portalBusy}>
                {portalBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Abo verwalten
              </Button>
            ) : null}
          </Card>

          {balance !== null && creditUxState(balance) !== "healthy" && (
            <Card className={`flex flex-wrap items-center justify-between gap-3 p-4 ${balance <= 0 ? "border-destructive/40 bg-destructive/5" : "border-amber-500/40 bg-amber-500/5"}`}>
              <div className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4 shrink-0" />{balance <= 0 ? "Kein Credit-Guthaben mehr. Inkludierte Leistungen funktionieren weiter; zusätzliche Nutzung braucht Credits." : `Dein Credit-Guthaben ist niedrig (${fmtNum(balance)} Credits).`}</div>
              <Button size="sm" asChild><a href="#credits">Credits kaufen</a></Button>
            </Card>
          )}

          {/* 3. Allowances */}
          <section className="space-y-3">
            <h2 className="text-lg font-medium">Enthaltene Ressourcen</h2>
            {usageQ.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : usageQ.data?.forbidden ? (
              <p className="text-sm text-muted-foreground">Nur Inhaber und Administratoren sehen die Nutzung.</p>
            ) : (
              <Allowances items={usageQ.data?.data?.allowances ?? []} monthlyCredits={plan?.monthly_credits} subscriptionBucket={bd?.buckets?.subscription} balance={balance} periodEnd={s?.current_period_end ?? null} />
            )}
          </section>

          {/* 4. Wallet */}
          <section className="space-y-3">
            <h2 className="text-lg font-medium">Credit-Guthaben</h2>
            {creditsQ.isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : creditsQ.data?.forbidden ? (
              <p className="text-sm text-muted-foreground">Nur Inhaber und Administratoren sehen das Credit-Guthaben.</p>
            ) : (
              <Card className="p-5">
                <div className="text-sm text-muted-foreground">Gesamt verfügbar</div>
                <div className="text-3xl font-semibold">{fmtNum(balance ?? 0)} <span className="text-base font-normal text-muted-foreground">Credits</span></div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {BUCKET_ORDER.map((b) => {
                    const x = bd?.buckets?.[b];
                    return (
                      <div key={b} className="rounded-md border p-3">
                        <div className="text-sm text-muted-foreground">{BUCKET_LABEL[b]}</div>
                        <div className="text-xl font-semibold">{fmtNum(Number(x?.available ?? 0))}</div>
                        <div className="text-xs text-muted-foreground">
                          {b === "purchased" ? "verfallen nicht" : x?.next_expiry ? `verfallen ab ${fmtDate(x.next_expiry)}` : "\u00a0"}
                        </div>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 text-xs text-muted-foreground">Verbrauchsreihenfolge: Abo-Credits → Aktions-Credits → Korrekturen → gekaufte Credits (zuerst ablaufende).</p>
              </Card>
            )}
          </section>

          {/* 5. History */}
          {!creditsQ.data?.forbidden && creditsQ.data && (
            <section className="space-y-3">
              <h2 className="text-lg font-medium">Credit-Historie</h2>
              {creditsQ.data.ledger.length === 0 ? <p className="text-sm text-muted-foreground">Noch keine Credit-Bewegungen.</p> : (
                <Card className="overflow-hidden">
                  <div className="hidden md:block">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left text-muted-foreground">
                        <tr><th className="p-3">Datum</th><th className="p-3">Aktion</th><th className="p-3">Typ</th><th className="p-3 text-right">Credits</th><th className="p-3">Topf / Ablauf</th></tr>
                      </thead>
                      <tbody>
                        {creditsQ.data.ledger.map((e: any) => {
                          const l = historyLabel({ ...e, action_name: e.action_key ? actionNames.get(e.action_key) : undefined });
                          return (
                            <tr key={e.id} className="border-t">
                              <td className="p-3 whitespace-nowrap">{fmtDate(e.created_at)}</td>
                              <td className="p-3">{l.title}</td>
                              <td className="p-3"><Badge variant="secondary">{l.type}</Badge></td>
                              <td className={`p-3 text-right font-medium tabular-nums ${e.delta < 0 ? "text-destructive" : ""}`}>{e.delta > 0 ? "+" : ""}{fmtNum(e.delta)}</td>
                              <td className="p-3 text-muted-foreground">{BUCKET_LABEL[e.bucket] ?? e.bucket}{e.delta > 0 && e.expires_at ? ` · verfällt ${fmtDate(e.expires_at)}` : ""}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <ul className="divide-y md:hidden">
                    {creditsQ.data.ledger.map((e: any) => {
                      const l = historyLabel({ ...e, action_name: e.action_key ? actionNames.get(e.action_key) : undefined });
                      return (
                        <li key={e.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                          <div className="min-w-0">
                            <div className="font-medium">{l.title}</div>
                            <div className="text-xs text-muted-foreground">{fmtDate(e.created_at)} · {BUCKET_LABEL[e.bucket] ?? e.bucket}{e.delta > 0 && e.expires_at ? ` · verfällt ${fmtDate(e.expires_at)}` : ""}</div>
                          </div>
                          <div className={`shrink-0 font-semibold tabular-nums ${e.delta < 0 ? "text-destructive" : ""}`}>{e.delta > 0 ? "+" : ""}{fmtNum(e.delta)}</div>
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              )}
            </section>
          )}

          {/* 6. Packages */}
          <section id="credits" className="scroll-mt-20 space-y-3">
            <h2 className="text-lg font-medium">Credits kaufen</h2>
            <p className="text-sm text-muted-foreground">Einmalkauf – Ihr Abo bleibt unverändert. Gekaufte Credits verfallen nicht.</p>
            {balance !== null && balance <= 0 && <p className="text-sm text-destructive">Nicht genügend Credits.</p>}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {(catalog?.packages ?? []).map((k: any) => (
                <Card key={k.key} className="space-y-2 p-5">
                  <div className="font-medium">{k.name}</div>
                  <div className="text-xl font-semibold">{fmtChf(k.price_amount, k.currency ?? "CHF")}</div>
                  <Badge variant="secondary">einmalig</Badge>
                  <Button variant="outline" className="w-full" onClick={() => setCheckout({ kind: "credits", key: k.key })}>Kaufen</Button>
                </Card>
              ))}
            </div>
          </section>

          {/* 7. Credit costs */}
          <section className="space-y-3">
            <h2 className="text-lg font-medium">Was kostet Credits?</h2>
            <Card className="p-5 text-sm">
              <p className="text-muted-foreground">Normale CRM-Arbeit (Immobilien, Leads, Kunden, Dokumente, Termine) ist kostenlos.</p>
              {(catalog?.action_costs ?? []).length === 0 ? (
                <p className="mt-2 text-muted-foreground">Aktuell sind keine kostenpflichtigen Aktionen aktiv.</p>
              ) : (
                <ul className="mt-3 divide-y">
                  {catalog.action_costs.map((a: any) => (
                    <li key={a.key} className="flex justify-between gap-3 py-2"><span>{a.name}</span><span className="font-medium tabular-nums">{fmtNum(a.credit_cost)} Credits</span></li>
                  ))}
                </ul>
              )}
            </Card>
          </section>

          {/* 8. Plans */}
          <section className="space-y-3">
            <h2 className="text-lg font-medium">Pläne</h2>
            <p className="text-sm text-muted-foreground">Alle Pläne enthalten alle Module sowie unbegrenzt Immobilien, Leads und Kunden. Unterschiede: enthaltene Benutzer, Speicher und Credits.</p>
            <div className="grid gap-4 md:grid-cols-3">
              {(catalog?.plans ?? []).filter((p: any) => !p.is_custom).map((p: any) => {
                const current = p.id === s?.plan_id;
                const lim = (k: string) => p.limits.find((l: any) => l.key === k);
                return (
                  <Card key={p.key} className={`space-y-2 p-5 ${current ? "border-primary" : ""}`}>
                    <div className="flex items-center justify-between"><div className="font-medium">{p.name}</div>{current && <Badge>Aktueller Plan</Badge>}</div>
                    <div className="text-2xl font-semibold">{fmtChf(p.price_monthly, p.currency ?? "CHF")}<span className="text-sm font-normal text-muted-foreground"> / Monat</span></div>
                    <ul className="space-y-1 text-sm text-muted-foreground">
                      <li>{lim("users")?.value ?? "–"} Benutzer inklusive</li>
                      <li>{lim("storage_gb")?.value ?? "–"} GB Speicher</li>
                      <li>{fmtNum(p.monthly_credits ?? 0)} Credits pro Monat</li>
                    </ul>
                    {isStripe || !src || !hasPaidSub ? (
                      <Button className="w-full" disabled={current || hasPaidSub || isManual || !p.checkout_available} onClick={() => setCheckout({ kind: "plan", key: p.key })}>
                        {current ? "Aktueller Plan" : hasPaidSub ? "Wechsel über «Abo verwalten»" : "Abo abschliessen"}
                      </Button>
                    ) : (
                      <Button className="w-full" variant="outline" disabled>{current ? "Aktueller Plan" : "Planänderung über Immolia"}</Button>
                    )}
                  </Card>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">Weitere Benutzer oder Speicher ohne Planwechsel: Zusatzverbrauch wird über Credits verrechnet. Enterprise: individuell auf Anfrage.</p>
          </section>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="truncate font-medium">{value}</div>
    </div>
  );
}

function Allowances({ items, monthlyCredits, subscriptionBucket, balance, periodEnd }: { items: any[]; monthlyCredits?: number; subscriptionBucket?: any; balance: number | null; periodEnd: string | null }) {
  const NAMES: Record<string, string> = { users: "Benutzer", storage_gb: "Speicher", domains: "Eigene Domains", properties: "Immobilien", leads: "Leads", clients: "Kunden",
    ...Object.fromEntries(Object.entries(USAGE_LABELS).map(([k, v]) => [k, v.plural])) };
  const order = ["users", "storage_gb", "ai_expose_generations", "market_analyses", "financing_requests", "ai_assistant_usage", "ai_image_generations", "domains", "properties", "leads", "clients"];
  // Nur aktive Kontingente zeigen (plus Kerndaten „unbegrenzt"); Zähler ohne Kontingent bleiben verborgen.
  const sorted = [...items].filter((a) => a.defined || a.core).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {monthlyCredits ? (
        <Card className="space-y-2 p-4">
          <div className="text-sm text-muted-foreground">Monatliche Credits</div>
          <div className="font-medium">{fmtNum(Number(subscriptionBucket?.available ?? 0))} / {fmtNum(monthlyCredits)} verfügbar</div>
          <Progress value={Math.min(100, (Number(subscriptionBucket?.available ?? 0) / monthlyCredits) * 100)} />
        </Card>
      ) : null}
      {sorted.map((a) => {
        const name = NAMES[a.key] ?? a.key;
        const unit = UNIT_LABEL[a.unit] ?? "";
        if (a.unlimited || a.core) {
          return (
            <Card key={a.key} className="space-y-2 p-4">
              <div className="text-sm text-muted-foreground">{name}</div>
              <div className="flex items-center gap-1 font-medium"><InfinityIcon className="h-4 w-4" /> Unbegrenzt</div>
            </Card>
          );
        }
        if (!a.defined) {
          return (
            <Card key={a.key} className="space-y-2 p-4">
              <div className="text-sm text-muted-foreground">{name}</div>
              <div className="font-medium">{a.used != null ? `${fmtNum(Number(a.used))} ${unit}` : "–"} <span className="text-sm font-normal text-muted-foreground">· kein Kontingent festgelegt</span></div>
            </Card>
          );
        }
        const used = Number(a.used ?? 0), value = Number(a.value ?? 0);
        const exhausted = value > 0 ? used >= value : used > 0;
        const overage = Math.max(0, used - value);
        if (a.key === "storage_gb" || a.key === "users") {
          return (
            <Card key={a.key} className="space-y-2 p-4">
              <div className="text-sm text-muted-foreground">{name}</div>
              <div className="font-medium">{fmtNum(used)} / {fmtNum(value)} {unit} inkludiert</div>
              <Progress value={value > 0 ? Math.min(100, (used / value) * 100) : 0} />
              <dl className="grid grid-cols-2 gap-x-2 text-xs text-muted-foreground">
                <dt>Inkludiert</dt><dd className="text-right">{fmtNum(value)} {unit}</dd>
                <dt>Verwendet</dt><dd className="text-right">{fmtNum(used)} {unit}</dd>
                <dt>Mehrverbrauch</dt><dd className="text-right">{fmtNum(overage)} {unit}</dd>
                {overage > 0 && <><dt>Nächste Abrechnung</dt><dd className="text-right">{a.overage_credit_cost != null ? fmtDate(periodEnd) : "noch kein Preis festgelegt"}</dd></>}
              </dl>
              {overage > 0 && a.overage_credit_cost == null && <p className="text-xs text-muted-foreground">Ohne festgelegten Preis wird nichts abgebucht.</p>}
            </Card>
          );
        }
        return (
          <Card key={a.key} className="space-y-2 p-4">
            <div className="text-sm text-muted-foreground">{name}</div>
            <div className="font-medium">{fmtNum(used)} / {fmtNum(value)} {unit} verwendet</div>
            <Progress value={value > 0 ? Math.min(100, (used / value) * 100) : 0} />
            <div className="text-xs text-muted-foreground">Verbleibend: {fmtNum(Math.max(0, value - used))}{overage > 0 ? ` · Über Credits: ${fmtNum(overage)}` : ""}</div>
            {exhausted && a.policy !== "hard_limit" && (
              <p className="text-xs text-muted-foreground">
                Kontingent aufgebraucht. Weitere Nutzung erfolgt über Credits.
                {balance !== null && balance <= 0 && <span className="block text-destructive">Nicht genügend Credits.</span>}
              </p>
            )}
          </Card>
        );
      })}
    </div>
  );
}
