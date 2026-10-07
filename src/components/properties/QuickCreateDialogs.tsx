import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";

/** Eigentümer schnell erfassen, ohne den Immobilien-Assistenten zu verlassen. */
export function QuickOwnerDialog({ open, onOpenChange, initialName, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; initialName: string;
  onCreated: (c: { id: string; full_name: string }) => void;
}) {
  const [f, setF] = useState({ first: "", last: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const [first, ...rest] = initialName.trim().split(/\s+/);
    setF({ first: first ?? "", last: rest.join(" "), email: "", phone: "" });
  }, [open, initialName]);
  const save = async () => {
    const full_name = `${f.first} ${f.last}`.trim();
    if (!full_name) return toast.error("Bitte einen Namen erfassen.");
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { data, error } = await supabase.from("clients").insert({
        full_name, email: f.email || null, phone: f.phone || null, client_type: "seller",
        owner_id: u.user?.id ?? null, assigned_to: u.user?.id ?? null,
      } as any).select("id, full_name").single();
      if (error) throw error;
      await supabase.from("client_roles").insert({ client_id: data.id, role_type: "owner" as any, status: "active", start_date: new Date().toISOString().slice(0, 10) });
      toast.success("Eigentümer erfasst und ausgewählt.");
      onCreated(data as any);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Eigentümer konnte nicht gespeichert werden.");
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Neuer Eigentümer</DialogTitle><DialogDescription>Wird als Kunde gespeichert und direkt verknüpft.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Vorname</Label><Input autoFocus value={f.first} onChange={(e) => setF({ ...f, first: e.target.value })} /></div>
          <div><Label>Nachname</Label><Input value={f.last} onChange={(e) => setF({ ...f, last: e.target.value })} /></div>
          <div className="col-span-2"><Label>E-Mail</Label><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div className="col-span-2"><Label>Telefon</Label><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+41 …" /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button onClick={save} disabled={busy}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Speichern & auswählen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Liegenschaft (Gebäude) schnell anlegen, um eine Einheit zuzuordnen. */
export function QuickBuildingDialog({ open, onOpenChange, initialName, onCreated }: {
  open: boolean; onOpenChange: (o: boolean) => void; initialName: string;
  onCreated: (b: { id: string; title: string; address: string | null; postal_code: string | null; city: string | null }) => void;
}) {
  const [f, setF] = useState({ title: "", address: "", postal_code: "", city: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setF({ title: initialName, address: "", postal_code: "", city: "" }); }, [open, initialName]);
  const save = async () => {
    if (!f.title.trim()) return toast.error("Bitte einen Namen erfassen.");
    setBusy(true);
    try {
      const { data: u } = await supabase.auth.getUser();
      const { data, error } = await supabase.from("properties").insert({
        title: f.title.trim(), address: f.address || null, postal_code: f.postal_code || null, city: f.city || null,
        property_type: "mixed_use", status: "draft", owner_id: u.user?.id,
      } as any).select("id, title, address, postal_code, city").single();
      if (error) throw error;
      toast.success("Liegenschaft angelegt und ausgewählt.");
      onCreated(data as any);
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Liegenschaft konnte nicht gespeichert werden.");
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>Neue Liegenschaft</DialogTitle><DialogDescription>Wird als Entwurf angelegt – Details später ergänzbar.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-3"><Label>Name</Label><Input autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="z.B. MFH Bahnhofstrasse 12" /></div>
          <div className="col-span-3"><Label>Strasse</Label><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
          <div><Label>PLZ</Label><Input value={f.postal_code} onChange={(e) => setF({ ...f, postal_code: e.target.value })} /></div>
          <div className="col-span-2"><Label>Ort</Label><Input value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button onClick={save} disabled={busy}>{busy && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}Anlegen & auswählen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
