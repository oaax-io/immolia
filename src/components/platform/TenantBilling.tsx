import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { QueryState } from "@/components/platform/PlatformLayout";

// Abrechnung einer Firma: nur über platform_* RPCs (serverseitig is_platform_admin + Audit)
const rpc = (fn: string, args: Record<string, unknown>) => (supabase.rpc as any)(fn, args);

const SOURCE: Record<string, string> = { stripe: "Stripe", invoice: "Rechnung", bank_transfer: "Banküberweisung", manual: "Manuell", complimentary: "Kostenlos" };
const PERIOD: Record<string, string> = { monthly: "Monatlich", yearly: "Jährlich", custom: "Individuell" };
const STATUS: Record<string, string> = { active: "Aktiv", past_due: "Zahlung offen", trialing: "Testphase", canceled: "Gekündigt", expired: "Abgelaufen", unpaid: "Unbezahlt", incomplete: "Unvollständig" };
const ERR: Record<string, string> = {
  active_subscription_exists: "Es gibt bereits ein laufendes Abo. Zuerst kündigen bzw. Beginn nach dessen Ende wählen.",
  reason_required: "Bitte eine Begründung angeben (mind. 3 Zeichen).",
  invalid_period: "Vertragsende muss nach dem Beginn liegen.",
  price_required: "Bitte einen Preis angeben.",
};
const errMsg = (e: any) => { const m = String(e?.message ?? ""); const k = Object.keys(ERR).find((x) => m.includes(x)); return k ? ERR[k] : "Aktion fehlgeschlagen."; };
const d = (v?: string | null) => (v ? new Date(v).toLocaleDateString("de-CH") : "–");
const toIso = (date: string) => (date ? new Date(date + "T00:00:00").toISOString() : null);

type Sub = Record<string, any>;

export function TenantBilling({ agencyId }: { agencyId: string }) {
  const qc = useQueryClient();
  const key = ["platform", "billing", agencyId];
  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      const [b, p] = await Promise.all([
        rpc("platform_get_agency_billing", { _agency_id: agencyId }),
        supabase.from("plans").select("id,name,status").in("status", ["active", "draft"]).order("sort_order"),
      ]);
      if (b.error) throw b.error;
      return { billing: b.data as { credits: number; subscriptions: Sub[] }, plans: (p.data ?? []) as { id: string; name: string; status: string }[] };
    },
  });
  const [dlg, setDlg] = useState<null | { kind: "create" | "edit" | "pay" | "cancel"; sub?: Sub }>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const subs = q.data?.billing.subscriptions ?? [];
  const current = subs.find((s) => ["active", "past_due", "trialing"].includes(s.status) && (!s.current_period_end || new Date(s.current_period_end) > new Date())) ?? subs[0];
  const manual = current && current.source === "internal" && current.billing_source && current.billing_source !== "stripe" ? current : null;

  return (
    <div className="space-y-4">
      <QueryState isLoading={q.isLoading} error={q.error} />
      {q.data && (
        <>
          <div className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Info k="Plan" v={current?.plan_name ?? "–"} />
            <Info k="Status" v={current ? STATUS[current.status] ?? current.status : "Kein Abo"} />
            <Info k="Zahlungsweg" v={current?.billing_source ? SOURCE[current.billing_source] : current?.status === "trialing" ? "Testphase" : "–"} />
            <Info k="Abrechnungsperiode" v={current?.billing_period ? PERIOD[current.billing_period] : "–"} />
            <Info k="Vertragszeitraum" v={current ? `${d(current.current_period_start)} – ${d(current.current_period_end)}` : "–"} />
            <Info k="Vereinbarter Preis" v={current?.contract_price != null ? `${current.contract_currency ?? "CHF"} ${Number(current.contract_price).toLocaleString("de-CH")}` : "–"} />
            <Info k="Bezahlt bis" v={d(current?.paid_until)} />
            <Info k="Letzte Zahlung" v={current?.paid_at ? `${d(current.paid_at)} · ${current.contract_currency ?? "CHF"} ${Number(current.last_payment_amount ?? 0).toLocaleString("de-CH")}` : "–"} />
            <Info k="Automatische Verlängerung" v={current?.auto_renew == null ? "–" : current.auto_renew ? "Ja" : "Nein"} />
            <Info k="Rechnung" v={current?.invoice_number ? `${current.invoice_number}${current.payment_due_date ? ` · fällig ${d(current.payment_due_date)}` : ""}` : "–"} />
            {current?.is_stripe && <Info k="Stripe-Status" v={`${current.status}${current.cancel_at_period_end ? " (Kündigung vorgemerkt)" : ""}`} />}
            <Info k="Credits" v={String(q.data.billing.credits ?? 0)} />
            {manual?.internal_note && <div className="sm:col-span-2"><Info k="Interne Notiz" v={manual.internal_note} /></div>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setDlg({ kind: "create" })}>Manuelles Abo anlegen</Button>
            {manual && <Button size="sm" variant="outline" onClick={() => setDlg({ kind: "edit", sub: manual })}>Bearbeiten / verlängern</Button>}
            {manual && manual.billing_source !== "complimentary" && <Button size="sm" variant="outline" onClick={() => setDlg({ kind: "pay", sub: manual })}>Zahlung erfassen</Button>}
            {manual && <Button size="sm" variant="outline" onClick={() => setDlg({ kind: "cancel", sub: manual })}>Kündigen</Button>}
          </div>
          {current?.is_stripe && <p className="text-xs text-muted-foreground">Stripe-Abo: Änderungen laufen über Stripe. Für einen Wechsel auf Rechnung das Stripe-Abo zuerst zum Periodenende kündigen und das manuelle Abo ab diesem Datum anlegen.</p>}
          {subs.length > 1 && (
            <div className="text-xs text-muted-foreground">
              <div className="mb-1 font-medium">Verlauf</div>
              {subs.map((s) => <div key={s.id}>{d(s.created_at)} · {s.plan_name ?? "–"} · {SOURCE[s.billing_source] ?? (s.status === "trialing" || s.trial_end ? "Test" : "intern")} · {STATUS[s.status] ?? s.status}</div>)}
            </div>
          )}
        </>
      )}
      {dlg?.kind === "create" && <CreateDialog agencyId={agencyId} plans={q.data?.plans ?? []} onClose={() => setDlg(null)} onDone={refresh} />}
      {dlg?.kind === "edit" && dlg.sub && <EditDialog sub={dlg.sub} plans={q.data?.plans ?? []} onClose={() => setDlg(null)} onDone={refresh} />}
      {dlg?.kind === "pay" && dlg.sub && <PayDialog sub={dlg.sub} onClose={() => setDlg(null)} onDone={refresh} />}
      {dlg?.kind === "cancel" && dlg.sub && <CancelDialog sub={dlg.sub} onClose={() => setDlg(null)} onDone={refresh} />}
    </div>
  );
}

function Info({ k, v }: { k: string; v: React.ReactNode }) {
  return <div><span className="text-muted-foreground">{k}: </span><span className="font-medium">{v}</span></div>;
}

function useAction(fn: string, onDone: () => void, onClose: () => void) {
  return useMutation({
    mutationFn: async (args: Record<string, unknown>) => { const { error } = await rpc(fn, args); if (error) throw error; },
    onSuccess: () => { toast.success("Gespeichert"); onDone(); onClose(); },
    onError: (e) => toast.error(errMsg(e)),
  });
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1"><Label>{label}</Label>{children}</div>;
}

function CreateDialog({ agencyId, plans, onClose, onDone }: { agencyId: string; plans: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ plan: "", source: "invoice", period: "yearly", start: "", end: "", status: "past_due", price: "", currency: "CHF", renew: "no", note: "", inv: "", invDate: "", due: "", reason: "" });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const act = useAction("platform_create_manual_subscription", onDone, onClose);
  const comp = f.source === "complimentary";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Manuelles Abo anlegen</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Plan"><Sel value={f.plan} onChange={set("plan")} items={plans.map((p) => [p.id, p.name])} /></Field>
          <Field label="Zahlungsweg"><Sel value={f.source} onChange={set("source")} items={[["invoice", "Rechnung"], ["bank_transfer", "Banküberweisung"], ["manual", "Manuell"], ["complimentary", "Kostenlos"]]} /></Field>
          <Field label="Abrechnungsperiode"><Sel value={f.period} onChange={set("period")} items={[["monthly", "Monatlich"], ["yearly", "Jährlich"], ["custom", "Individuell"]]} /></Field>
          {!comp && <Field label="Status"><Sel value={f.status} onChange={set("status")} items={[["past_due", "Zahlung offen"], ["active", "Aktiv (bezahlt)"]]} /></Field>}
          <Field label="Vertragsbeginn"><Input type="date" value={f.start} onChange={(e) => set("start")(e.target.value)} /></Field>
          <Field label="Vertragsende"><Input type="date" value={f.end} onChange={(e) => set("end")(e.target.value)} /></Field>
          {!comp && <Field label="Vereinbarter Preis"><Input type="number" min="0" step="0.05" value={f.price} onChange={(e) => set("price")(e.target.value)} /></Field>}
          {!comp && <Field label="Währung"><Input value={f.currency} onChange={(e) => set("currency")(e.target.value)} /></Field>}
          <Field label="Automatische Verlängerung"><Sel value={f.renew} onChange={set("renew")} items={[["no", "Nein"], ["yes", "Ja"]]} /></Field>
          {!comp && <Field label="Rechnungsnummer (optional)"><Input value={f.inv} onChange={(e) => set("inv")(e.target.value)} /></Field>}
          {!comp && <Field label="Rechnungsdatum (optional)"><Input type="date" value={f.invDate} onChange={(e) => set("invDate")(e.target.value)} /></Field>}
          {!comp && <Field label="Zahlungsziel (optional)"><Input type="date" value={f.due} onChange={(e) => set("due")(e.target.value)} /></Field>}
          <div className="sm:col-span-2"><Field label="Interne Notiz (nur Plattform)"><Textarea rows={2} value={f.note} onChange={(e) => set("note")(e.target.value)} /></Field></div>
          <div className="sm:col-span-2"><Field label="Begründung (Protokoll)"><Input value={f.reason} onChange={(e) => set("reason")(e.target.value)} /></Field></div>
        </div>
        <DialogFooter>
          <Button disabled={act.isPending || !f.plan || !f.start || !f.end} onClick={() => act.mutate({
            _agency_id: agencyId, _plan_id: f.plan, _billing_source: f.source, _billing_period: f.period,
            _start: toIso(f.start), _end: toIso(f.end), _status: comp ? "active" : f.status,
            _price: comp ? 0 : f.price === "" ? null : Number(f.price), _currency: f.currency, _auto_renew: f.renew === "yes",
            _note: f.note || null, _invoice_number: f.inv || null, _invoice_date: f.invDate || null, _payment_due_date: f.due || null, _reason: f.reason,
          })}>Anlegen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditDialog({ sub, plans, onClose, onDone }: { sub: Sub; plans: { id: string; name: string }[]; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({
    plan: sub.plan_id ?? "", source: sub.billing_source, period: sub.billing_period ?? "yearly",
    end: sub.current_period_end ? sub.current_period_end.slice(0, 10) : "", price: sub.contract_price != null ? String(sub.contract_price) : "",
    currency: sub.contract_currency ?? "CHF", renew: sub.auto_renew ? "yes" : "no", note: sub.internal_note ?? "",
    inv: sub.invoice_number ?? "", invDate: sub.invoice_date ?? "", due: sub.payment_due_date ?? "", reason: "",
  });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const act = useAction("platform_update_manual_subscription", onDone, onClose);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Abo bearbeiten / verlängern</DialogTitle></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Plan"><Sel value={f.plan} onChange={set("plan")} items={plans.map((p) => [p.id, p.name])} /></Field>
          <Field label="Zahlungsweg"><Sel value={f.source} onChange={set("source")} items={[["invoice", "Rechnung"], ["bank_transfer", "Banküberweisung"], ["manual", "Manuell"], ["complimentary", "Kostenlos"]]} /></Field>
          <Field label="Abrechnungsperiode"><Sel value={f.period} onChange={set("period")} items={[["monthly", "Monatlich"], ["yearly", "Jährlich"], ["custom", "Individuell"]]} /></Field>
          <Field label="Vertragsende"><Input type="date" value={f.end} onChange={(e) => set("end")(e.target.value)} /></Field>
          <Field label="Vereinbarter Preis"><Input type="number" min="0" step="0.05" value={f.price} onChange={(e) => set("price")(e.target.value)} /></Field>
          <Field label="Währung"><Input value={f.currency} onChange={(e) => set("currency")(e.target.value)} /></Field>
          <Field label="Automatische Verlängerung"><Sel value={f.renew} onChange={set("renew")} items={[["no", "Nein"], ["yes", "Ja"]]} /></Field>
          <Field label="Rechnungsnummer"><Input value={f.inv} onChange={(e) => set("inv")(e.target.value)} /></Field>
          <Field label="Rechnungsdatum"><Input type="date" value={f.invDate} onChange={(e) => set("invDate")(e.target.value)} /></Field>
          <Field label="Zahlungsziel"><Input type="date" value={f.due} onChange={(e) => set("due")(e.target.value)} /></Field>
          <div className="sm:col-span-2"><Field label="Interne Notiz (nur Plattform)"><Textarea rows={2} value={f.note} onChange={(e) => set("note")(e.target.value)} /></Field></div>
          <div className="sm:col-span-2"><Field label="Begründung (Protokoll)"><Input value={f.reason} onChange={(e) => set("reason")(e.target.value)} /></Field></div>
        </div>
        <DialogFooter>
          <Button disabled={act.isPending} onClick={() => act.mutate({
            _subscription_id: sub.id, _plan_id: f.plan || null, _billing_source: f.source, _billing_period: f.period,
            _end: f.end ? toIso(f.end) : null, _price: f.price === "" ? null : Number(f.price), _currency: f.currency,
            _auto_renew: f.renew === "yes", _note: f.note, _invoice_number: f.inv || null, _invoice_date: f.invDate || null,
            _payment_due_date: f.due || null, _reason: f.reason,
          })}>Speichern</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PayDialog({ sub, onClose, onDone }: { sub: Sub; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ amount: sub.contract_price != null ? String(sub.contract_price) : "", paidAt: new Date().toISOString().slice(0, 10), inv: sub.invoice_number ?? "", until: sub.current_period_end?.slice(0, 10) ?? "", reason: "" });
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  const act = useAction("platform_record_manual_payment", onDone, onClose);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Zahlung erfassen</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label={`Betrag (${sub.contract_currency ?? "CHF"})`}><Input type="number" min="0" step="0.05" value={f.amount} onChange={(e) => set("amount")(e.target.value)} /></Field>
          <Field label="Bezahlt am"><Input type="date" value={f.paidAt} onChange={(e) => set("paidAt")(e.target.value)} /></Field>
          <Field label="Rechnungsnummer"><Input value={f.inv} onChange={(e) => set("inv")(e.target.value)} /></Field>
          <Field label="Bezahlt bis"><Input type="date" value={f.until} onChange={(e) => set("until")(e.target.value)} /></Field>
          <Field label="Bemerkung (Protokoll)"><Input value={f.reason} onChange={(e) => set("reason")(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button disabled={act.isPending || f.amount === ""} onClick={() => act.mutate({
            _subscription_id: sub.id, _amount: Number(f.amount), _paid_at: toIso(f.paidAt), _invoice_number: f.inv || null,
            _paid_until: f.until ? toIso(f.until) : null, _reason: f.reason || null,
          })}>Als bezahlt markieren</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ sub, onClose, onDone }: { sub: Sub; onClose: () => void; onDone: () => void }) {
  const [immediate, setImmediate] = useState("no");
  const [reason, setReason] = useState("");
  const act = useAction("platform_cancel_manual_subscription", onDone, onClose);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Abo kündigen</DialogTitle></DialogHeader>
        <div className="grid gap-3">
          <Field label="Zeitpunkt"><Sel value={immediate} onChange={setImmediate} items={[["no", `Zum Vertragsende (${d(sub.current_period_end)})`], ["yes", "Sofort"]]} /></Field>
          <p className="text-xs text-muted-foreground">Daten, Benutzer und gekaufte Credits bleiben erhalten.</p>
          <Field label="Begründung (Protokoll)"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
        <DialogFooter>
          <Button variant="destructive" disabled={act.isPending} onClick={() => act.mutate({ _subscription_id: sub.id, _immediate: immediate === "yes", _reason: reason })}>Kündigen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Sel({ value, onChange, items }: { value: string; onChange: (v: string) => void; items: [string, string][] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="Auswählen" /></SelectTrigger>
      <SelectContent>{items.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
    </Select>
  );
}

