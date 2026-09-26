import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Pflege nur über platform_upsert_* RPCs (Plattform-Admin, Audit-Eintrag). Keine erfundenen Werte. */
const CATEGORIES = [
  ["ai", "KI"], ["financing", "Finanzierung"], ["communication", "Kommunikation"], ["documents", "Dokumente"],
  ["data", "Daten"], ["media", "Medien"], ["publishing", "Publikation"], ["storage", "Speicher"],
  ["users", "Benutzer"], ["marketing", "Marketing"],
] as const;
const STATUSES = [["draft", "Entwurf"], ["active", "Aktiv"], ["archived", "Archiviert"]] as const;

const errText = (m: string) =>
  m.includes("check constraint") || m.includes("violates") ? "Ungültige Eingabe (Format, Werte oder aktiver Status ohne Menge/Preis)." :
  m.includes("forbidden") ? "Keine Berechtigung." : "Speichern nicht möglich.";

export type ActionRow = { action_key: string; name: string; description: string | null; category: string; credit_cost: number | null; active: boolean };
export type PackageRow = { key: string; name: string; credits: number | null; price_amount: number | null; currency: string; status: string; sort_order: number };

export function CreditActionForm({ initial, onDone }: { initial?: ActionRow | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<ActionRow>(initial ?? { action_key: "", name: "", description: "", category: "ai", credit_cost: null, active: false });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await (supabase.rpc as any)("platform_upsert_credit_action", {
      _action_key: f.action_key.trim(), _name: f.name.trim(), _description: f.description || null,
      _category: f.category, _credit_cost: f.credit_cost, _active: f.active,
    });
    setBusy(false);
    if (error) return toast.error(errText(error.message));
    toast.success("Aktion gespeichert");
    await qc.invalidateQueries({ queryKey: ["platform-commercial"] });
    onDone();
  };
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Schlüssel</Label><Input value={f.action_key} disabled={!!initial} placeholder="ai.dossier" onChange={(e) => setF({ ...f, action_key: e.target.value })} /></div>
        <div><Label>Name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><Label>Kategorie</Label>
          <Select value={f.category} onValueChange={(v) => setF({ ...f, category: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{CATEGORIES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Kosten (Credits)</Label><Input type="number" min={0} value={f.credit_cost ?? ""} placeholder="leer = kostenlos"
          onChange={(e) => setF({ ...f, credit_cost: e.target.value === "" ? null : Math.max(0, parseInt(e.target.value, 10) || 0) })} /></div>
      </div>
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm"><Switch checked={f.active} onCheckedChange={(v) => setF({ ...f, active: v })} />Aktiv</label>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onDone}>Abbrechen</Button>
          <Button size="sm" disabled={busy || !f.action_key || !f.name} onClick={save}>Speichern</Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground">Nur aktive Aktionen mit Kosten grösser 0 verbrauchen Credits.</p>
    </div>
  );
}

export function CreditPackageForm({ initial, onDone }: { initial?: PackageRow | null; onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState<PackageRow>(initial ?? { key: "", name: "", credits: null, price_amount: null, currency: "CHF", status: "draft", sort_order: 0 });
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    const { error } = await (supabase.rpc as any)("platform_upsert_credit_package", {
      _key: f.key.trim(), _name: f.name.trim(), _credits: f.credits, _price_amount: f.price_amount,
      _currency: f.currency.trim().toUpperCase() || "CHF", _status: f.status, _sort_order: f.sort_order,
    });
    setBusy(false);
    if (error) return toast.error(errText(error.message));
    toast.success("Paket gespeichert");
    await qc.invalidateQueries({ queryKey: ["platform-commercial"] });
    onDone();
  };
  const num = (v: string) => (v === "" ? null : Number(v));
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <div className="grid grid-cols-2 gap-3">
        <div><Label>Schlüssel</Label><Input value={f.key} disabled={!!initial} placeholder="credits-s" onChange={(e) => setF({ ...f, key: e.target.value })} /></div>
        <div><Label>Name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
        <div><Label>Credits</Label><Input type="number" min={1} value={f.credits ?? ""} onChange={(e) => setF({ ...f, credits: num(e.target.value) })} /></div>
        <div className="grid grid-cols-[1fr_80px] gap-2">
          <div><Label>Preis</Label><Input type="number" min={0} step="0.05" value={f.price_amount ?? ""} onChange={(e) => setF({ ...f, price_amount: num(e.target.value) })} /></div>
          <div><Label>Währung</Label><Input value={f.currency} maxLength={3} onChange={(e) => setF({ ...f, currency: e.target.value })} /></div>
        </div>
        <div><Label>Status</Label>
          <Select value={f.status} onValueChange={(v) => setF({ ...f, status: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{STATUSES.map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>Abbrechen</Button>
        <Button size="sm" disabled={busy || !f.key || !f.name} onClick={save}>Speichern</Button>
      </div>
      <p className="text-xs text-muted-foreground">Aktiv nur mit Credits und Preis möglich. Stripe wird später verbunden.</p>
    </div>
  );
}
