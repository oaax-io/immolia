import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, Star, Mail, Phone, Building2 } from "lucide-react";
import { useIsMasterDataAdmin } from "@/hooks/useIsMasterDataAdmin";
import {
  PARTNER_CATEGORIES, PARTNER_CATEGORY_LABEL, PARTNER_CATEGORY_SINGULAR,
  usePartnerCatalog, usePartnerContacts, partnerDisplayName, type AgencyPartnerContact,
} from "@/lib/partners";

type Draft = {
  id?: string;
  category: string;
  platform_partner_id: string | null;
  custom_partner_name: string;
  branch_name: string;
  contact_name: string;
  role_title: string;
  email: string;
  phone: string;
  website: string;
  notes: string;
  is_favorite: boolean;
};

const emptyDraft = (category: string): Draft => ({
  category, platform_partner_id: null, custom_partner_name: "", branch_name: "", contact_name: "",
  role_title: "", email: "", phone: "", website: "", notes: "", is_favorite: false,
});

const CUSTOM = "__custom__";

/** Einstellungen → Partner: eigene Ansprechpartner der Firma. */
export function PartnerContactsManager() {
  const qc = useQueryClient();
  const { canEdit } = useIsMasterDataAdmin();
  const catalog = usePartnerCatalog();
  const contacts = usePartnerContacts();
  const [category, setCategory] = useState<string>("bank");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [remove, setRemove] = useState<AgencyPartnerContact | null>(null);
  const [busy, setBusy] = useState(false);

  const all = contacts.data ?? [];
  const cat = catalog.data ?? [];
  const rows = useMemo(() => all.filter((c) => c.category === category), [all, category]);
  const catalogForCategory = useMemo(() => cat.filter((p) => p.category === category), [cat, category]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["partner-contacts"] });
    qc.invalidateQueries({ queryKey: ["financing_partner_contacts"] });
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.platform_partner_id && !draft.custom_partner_name.trim()) {
      toast.error("Bitte einen Partner wählen oder einen eigenen Namen erfassen.");
      return;
    }
    setBusy(true);
    const payload = {
      category: draft.category,
      platform_partner_id: draft.platform_partner_id,
      custom_partner_name: draft.platform_partner_id ? null : draft.custom_partner_name.trim(),
      branch_name: draft.branch_name.trim() || null,
      contact_name: draft.contact_name.trim() || null,
      role_title: draft.role_title.trim() || null,
      email: draft.email.trim() || null,
      phone: draft.phone.trim() || null,
      website: draft.website.trim() || null,
      notes: draft.notes.trim() || null,
      is_favorite: draft.is_favorite,
    };
    try {
      if (draft.id) {
        const { data, error } = await supabase.from("agency_partner_contacts").update(payload).eq("id", draft.id).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("Keine Berechtigung zum Ändern.");
      } else {
        // agency_id wird serverseitig gesetzt (Trigger), nie aus dem Browser.
        const { data, error } = await supabase
          .from("agency_partner_contacts")
          .insert({ ...payload, agency_id: "00000000-0000-0000-0000-000000000000" })
          .select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("Keine Berechtigung zum Erfassen.");
      }
      toast.success("Gespeichert");
      setDraft(null);
      refresh();
    } catch (e) {
      toast.error((e as Error).message ?? "Fehler");
    } finally { setBusy(false); }
  };

  const doRemove = async () => {
    if (!remove) return;
    setBusy(true);
    try {
      const { data, error } = await supabase.from("agency_partner_contacts").delete().eq("id", remove.id).select("id");
      if (error) throw error;
      if (!data?.length) throw new Error("Keine Berechtigung zum Löschen.");
      toast.success("Entfernt");
      setRemove(null);
      refresh();
    } catch (e) {
      toast.error((e as Error).message ?? "Fehler");
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-60"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PARTNER_CATEGORIES.map((c) => (
              <SelectItem key={c.key} value={c.key}>
                {c.label}{all.filter((r) => r.category === c.key).length ? ` (${all.filter((r) => r.category === c.key).length})` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {canEdit && (
          <Button className="ml-auto" onClick={() => setDraft(emptyDraft(category))}>
            <Plus className="mr-2 h-4 w-4" />Ansprechpartner erfassen
          </Button>
        )}
      </div>

      {!canEdit && (
        <p className="text-sm text-muted-foreground">
          Ansprechpartner erfassen und ändern dürfen Inhaber und Admins der Firma.
        </p>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((c) => (
          <Card key={c.id}>
            <CardContent className="space-y-2 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-semibold">
                    {c.is_favorite && <Star className="h-4 w-4 fill-amber-400 text-amber-400" />}
                    <span className="truncate">{partnerDisplayName(c, cat)}</span>
                  </div>
                  {c.branch_name && <div className="text-sm text-muted-foreground">{c.branch_name}</div>}
                </div>
                {canEdit && (
                  <div className="flex shrink-0">
                    <Button variant="ghost" size="icon" onClick={() => setDraft({
                      id: c.id, category: c.category, platform_partner_id: c.platform_partner_id,
                      custom_partner_name: c.custom_partner_name ?? "", branch_name: c.branch_name ?? "",
                      contact_name: c.contact_name ?? "", role_title: c.role_title ?? "", email: c.email ?? "",
                      phone: c.phone ?? "", website: c.website ?? "", notes: c.notes ?? "", is_favorite: c.is_favorite,
                    })}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="icon" onClick={() => setRemove(c)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                  </div>
                )}
              </div>
              {c.contact_name && (
                <div className="text-sm">{c.contact_name}{c.role_title ? <span className="text-muted-foreground"> · {c.role_title}</span> : null}</div>
              )}
              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                {c.email && <span className="inline-flex items-center gap-1"><Mail className="h-3.5 w-3.5" />{c.email}</span>}
                {c.phone && <span className="inline-flex items-center gap-1"><Phone className="h-3.5 w-3.5" />{c.phone}</span>}
              </div>
              {c.notes && <p className="text-sm text-muted-foreground">{c.notes}</p>}
              {!c.custom_partner_name && <Badge variant="secondary" className="text-xs">Zentraler Partner</Badge>}
              {c.custom_partner_name && <Badge variant="outline" className="text-xs">Eigener Partner</Badge>}
            </CardContent>
          </Card>
        ))}
        {rows.length === 0 && (
          <Card className="md:col-span-2">
            <CardContent className="flex flex-col items-center gap-2 py-10 text-center">
              <Building2 className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">
                Noch keine eigenen Ansprechpartner in «{PARTNER_CATEGORY_LABEL[category]}».
                Der zentrale Katalog mit {catalogForCategory.length} Einträgen steht trotzdem überall zur Auswahl.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      <Dialog open={!!draft} onOpenChange={(o) => !o && setDraft(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Ansprechpartner bearbeiten" : "Ansprechpartner erfassen"}</DialogTitle>
            <DialogDescription>Nur in Ihrer Firma sichtbar. Der zentrale Katalog bleibt unverändert.</DialogDescription>
          </DialogHeader>
          {draft && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>Kategorie</Label>
                <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v, platform_partner_id: null })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PARTNER_CATEGORIES.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{PARTNER_CATEGORY_SINGULAR[draft.category] ?? "Partner"}</Label>
                <Select
                  value={draft.platform_partner_id ?? CUSTOM}
                  onValueChange={(v) => setDraft({ ...draft, platform_partner_id: v === CUSTOM ? null : v })}
                >
                  <SelectTrigger><SelectValue placeholder="Auswählen" /></SelectTrigger>
                  <SelectContent>
                    {cat.filter((p) => p.category === draft.category).map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    <SelectItem value={CUSTOM}>Eigener Partner (nicht in der Liste)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!draft.platform_partner_id && (
                <div className="space-y-1.5">
                  <Label>Name des Partners</Label>
                  <Input value={draft.custom_partner_name} onChange={(e) => setDraft({ ...draft, custom_partner_name: e.target.value })} placeholder="z. B. Schreinerei Müller AG" />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>Filiale / Standort</Label><Input value={draft.branch_name} onChange={(e) => setDraft({ ...draft, branch_name: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Funktion</Label><Input value={draft.role_title} onChange={(e) => setDraft({ ...draft, role_title: e.target.value })} placeholder="z. B. Hypothekarberater" /></div>
              </div>
              <div className="space-y-1.5"><Label>Ansprechperson</Label><Input value={draft.contact_name} onChange={(e) => setDraft({ ...draft, contact_name: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5"><Label>E-Mail</Label><Input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Telefon</Label><Input value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></div>
              </div>
              <div className="space-y-1.5"><Label>Notizen</Label><Textarea rows={2} value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} /></div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={draft.is_favorite} onCheckedChange={(v) => setDraft({ ...draft, is_favorite: v })} />
                Als bevorzugten Kontakt markieren
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>Abbrechen</Button>
            <Button onClick={save} disabled={busy}>Speichern</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!remove} onOpenChange={(o) => !o && setRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Ansprechpartner entfernen?</AlertDialogTitle>
            <AlertDialogDescription>Der Eintrag wird aus Ihrer Firma gelöscht. Der zentrale Partner bleibt bestehen.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); doRemove(); }}>Entfernen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
