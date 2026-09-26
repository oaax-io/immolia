import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createPlanCheckout, createCreditTopupCheckout, createAgencyPortal } from "@/utils/billing.functions";

export const Route = createFileRoute("/_app/settings/billing")({
  head: () => ({ meta: [{ title: "Abo & Credits – Einstellungen" }, { name: "description", content: "Abo abschliessen, Credits kaufen und Rechnungen verwalten." }] }),
  component: BillingPage,
});

const STATE_LABEL: Record<string, string> = {
  trialing: "Testphase", active: "Aktiv", past_due: "Zahlung offen (Frist läuft)", unpaid: "Zahlung offen",
  canceled_until_period_end: "Gekündigt per Periodenende", post_trial: "Testphase beendet – Nutzung über Credits",
  no_active_subscription: "Kein Abo – Nutzung über Credits",
};

type Checkout = { kind: "plan" | "credits"; key: string } | null;

function BillingPage() {
  const [checkout, setCheckout] = useState<Checkout>(null);
  const [portalBusy, setPortalBusy] = useState(false);
  const returnUrl = typeof window !== "undefined" ? `${window.location.origin}/settings/billing?checkout=done` : "";

  const q = useQuery({
    queryKey: ["billing-overview"],
    queryFn: async () => {
      const sb = supabase as any;
      const { data: agencyId } = await sb.rpc("current_agency_id");
      const [plans, packs, state, balance] = await Promise.all([
        sb.from("plans").select("key,name,price_monthly,monthly_credits,stripe_price_key,status,is_custom").eq("status", "active").order("sort_order"),
        sb.from("credit_packages").select("key,name,credits,price_amount,status").eq("status", "active").order("sort_order"),
        agencyId ? sb.rpc("commercial_subscription_state", { _agency_id: agencyId }) : Promise.resolve({ data: null }),
        agencyId ? sb.rpc("credit_balance", { _agency_id: agencyId }) : Promise.resolve({ data: null }),
      ]);
      return { plans: plans.data ?? [], packs: packs.data ?? [], state: state.data, balance: balance.data };
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

  const st = (q.data?.state as any)?.state as string | undefined;
  const hasPaidSub = st === "active" || st === "past_due" || st === "canceled_until_period_end";
  const balance = typeof q.data?.balance === "number" ? q.data.balance : (q.data?.balance as any)?.total ?? null;

  return (
    <div className="space-y-6 p-6 max-w-5xl">
      <PaymentTestModeBanner />
      <Link to="/settings" className="inline-flex items-center gap-1 text-sm text-muted-foreground"><ArrowLeft className="h-4 w-4" /> Einstellungen</Link>
      <h1 className="text-2xl font-semibold">Abo & Credits</h1>

      {q.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : (
        <>
          <Card className="p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-sm text-muted-foreground">Status</div>
              <div className="font-medium">{st ? STATE_LABEL[st] ?? st : "–"}</div>
              {balance !== null && <div className="text-sm text-muted-foreground mt-1">Guthaben: {balance} Credits</div>}
            </div>
            <Button variant="outline" onClick={openPortal} disabled={portalBusy}>
              {portalBusy && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Zahlungsmethode, Rechnungen & Abo verwalten
            </Button>
          </Card>

          {checkout ? (
            <Card className="p-4 space-y-3">
              <Button variant="ghost" size="sm" onClick={() => setCheckout(null)}>Abbrechen</Button>
              <EmbeddedCheckoutProvider key={checkout.kind + checkout.key} stripe={getStripe()} options={{ fetchClientSecret }}>
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
              <p className="text-xs text-muted-foreground">Credits und Abo werden erst nach bestätigter Zahlung gutgeschrieben – das kann einige Sekunden dauern.</p>
            </Card>
          ) : (
            <>
              <section className="space-y-3">
                <h2 className="text-lg font-medium">Abo</h2>
                <p className="text-sm text-muted-foreground">Alle Pläne enthalten alle Module und unbegrenzt Objekte, Leads und Kunden.</p>
                <div className="grid gap-4 md:grid-cols-3">
                  {q.data!.plans.filter((p: any) => p.stripe_price_key && !p.is_custom).map((p: any) => (
                    <Card key={p.key} className="p-5 space-y-2">
                      <div className="font-medium">{p.name}</div>
                      <div className="text-2xl font-semibold">CHF {Number(p.price_monthly).toFixed(0)}<span className="text-sm font-normal text-muted-foreground"> / Monat</span></div>
                      <div className="text-sm text-muted-foreground">{p.monthly_credits ?? 0} Credits pro Monat</div>
                      <Button className="w-full" disabled={hasPaidSub} onClick={() => setCheckout({ kind: "plan", key: p.key })}>
                        {hasPaidSub ? "Wechsel über «verwalten»" : "Abo abschliessen"}
                      </Button>
                    </Card>
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Enterprise: individuell auf Anfrage.</p>
              </section>

              <section className="space-y-3">
                <h2 className="text-lg font-medium">Credits kaufen</h2>
                <p className="text-sm text-muted-foreground">Einmalkauf – Ihr Abo bleibt unverändert. Gekaufte Credits verfallen nicht.</p>
                <div className="grid gap-4 md:grid-cols-4">
                  {q.data!.packs.map((k: any) => (
                    <Card key={k.key} className="p-5 space-y-2">
                      <div className="font-medium">{k.name}</div>
                      <div className="text-xl font-semibold">CHF {Number(k.price_amount).toFixed(0)}</div>
                      <Badge variant="secondary">einmalig</Badge>
                      <Button variant="outline" className="w-full" onClick={() => setCheckout({ kind: "credits", key: k.key })}>Kaufen</Button>
                    </Card>
                  ))}
                </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
