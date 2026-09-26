import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PlatformPage, QueryState } from "@/components/platform/PlatformLayout";
import { CreditActionForm, CreditPackageForm, type ActionRow, type PackageRow } from "@/components/platform/CreditCatalogForms";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Phase 5.1/5.2 – Commercial.
 * Pläne/Add-ons: Ansicht. Credit-Pakete und Credit-Aktionen: Pflege über platform_* RPCs.
 * Keine Preise vorgegeben; kein Stripe.
 */
export const Route = createFileRoute("/platform/commercial")({
  head: () => ({ meta: [{ title: "Commercial – Immolia Platform Admin" }, { name: "robots", content: "noindex" }] }),
  component: CommercialPage,
});

type Row = Record<string, any> & { id: string; name: string };

function useList(table: "plans" | "credit_packages" | "credit_action_costs" | "addons") {
  return useQuery({
    queryKey: ["platform-commercial", table],
    queryFn: async () => {
      const { data, error } = await (supabase.from(table as never) as any).select("*").order("name");
      if (error) throw error;
      return (data ?? []) as Row[];
    },
  });
}

function Section({ title, hint, q, render, action, children }: {
  title: string; hint: string; q: ReturnType<typeof useList>; render: (r: Row) => React.ReactNode; action?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div><h2 className="font-medium">{title}</h2><p className="text-xs text-muted-foreground">{hint}</p></div>
        {action}
      </div>
      {children}
      <QueryState isLoading={q.isLoading} error={q.error} />
      {q.data && q.data.length === 0 && <p className="text-sm text-muted-foreground">Noch nichts definiert.</p>}
      {q.data && q.data.length > 0 && (
        <div className="divide-y">{q.data.map((r) => <div key={r.id} className="flex items-center justify-between gap-4 py-2 text-sm">{render(r)}</div>)}</div>
      )}
    </Card>
  );
}

function CommercialPage() {
  const plans = useList("plans");
  const packs = useList("credit_packages");
  const actions = useList("credit_action_costs");
  const addons = useList("addons");
  const [actionEdit, setActionEdit] = useState<ActionRow | null | "new">(null);
  const [packEdit, setPackEdit] = useState<PackageRow | null | "new">(null);
  const statusLabel: Record<string, string> = { draft: "Entwurf", active: "Aktiv", archived: "Archiviert" };

  return (
    <PlatformPage title="Commercial" description="Pläne, Freischaltungen, Limits, Credits und Add-ons. Noch keine Preise festgelegt, keine Zahlungen. Bestehende Module der Unternehmen bleiben massgeblich.">
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Pläne" hint="Produktpakete mit Freischaltungen und Limits." q={plans}
          render={(r) => (<><span>{r.name} <span className="text-muted-foreground">({r.key})</span></span><Badge variant="outline">{statusLabel[r.status] ?? r.status}</Badge></>)} />
        <Section title="Add-ons" hint="Dauerhafte Zusatzleistungen, erweitern Limits oder Freischaltungen." q={addons}
          render={(r) => (<><span>{r.name}</span><Badge variant="outline">{statusLabel[r.status] ?? r.status}</Badge></>)} />
      </div>

      <h2 className="pt-2 font-display text-lg font-semibold">Credits</h2>
      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Credit-Pakete" hint="Kaufbare Credits. Stripe folgt später." q={packs}
          action={packEdit === null && <Button size="sm" variant="outline" onClick={() => setPackEdit("new")}>Neues Paket</Button>}
          render={(r) => (
            <>
              <button className="text-left hover:underline" onClick={() => setPackEdit(r as unknown as PackageRow)}>{r.name} <span className="text-muted-foreground">({r.key})</span></button>
              <span className="flex items-center gap-2 text-muted-foreground">
                {r.credits != null ? `${r.credits} Credits` : "–"} · {r.price_amount != null ? `${r.currency} ${Number(r.price_amount).toFixed(2)}` : "kein Preis"}
                <Badge variant="outline">{statusLabel[r.status] ?? r.status}</Badge>
              </span>
            </>
          )}>
          {packEdit !== null && <div className="mb-3"><CreditPackageForm key={packEdit === "new" ? "new" : packEdit.key} initial={packEdit === "new" ? null : packEdit} onDone={() => setPackEdit(null)} /></div>}
        </Section>

        <Section title="Creditpflichtige Aktionen" hint="Ohne aktiven Wert grösser 0 ist eine Aktion kostenlos." q={actions}
          action={actionEdit === null && <Button size="sm" variant="outline" onClick={() => setActionEdit("new")}>Neue Aktion</Button>}
          render={(r) => (
            <>
              <button className="text-left hover:underline" onClick={() => setActionEdit(r as unknown as ActionRow)}>{r.name} <span className="text-muted-foreground">({r.action_key})</span></button>
              <span className="text-muted-foreground">{r.active && Number(r.credit_cost) > 0 ? `${r.credit_cost} Credits` : "kostenlos"}{!r.active && " · inaktiv"}</span>
            </>
          )}>
          {actionEdit !== null && <div className="mb-3"><CreditActionForm key={actionEdit === "new" ? "new" : actionEdit.action_key} initial={actionEdit === "new" ? null : actionEdit} onDone={() => setActionEdit(null)} /></div>}
        </Section>
      </div>
    </PlatformPage>
  );
}
