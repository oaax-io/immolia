import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Plus, Pencil, Trash2, ExternalLink, Upload, Loader2, X } from "lucide-react";
import { QueryState } from "@/components/platform/PlatformLayout";
import { PartnerLogo } from "@/components/partners/PartnerLogo";
import {
  PARTNER_CATEGORIES, PARTNER_CATEGORY_LABEL, usePlatformPartners, savePlatformPartner,
  setPlatformPartnerActive, removePlatformPartner, uploadPartnerLogo, type PlatformPartner, type SavePartnerInput,
} from "@/lib/partners";

const EMPTY: SavePartnerInput = { category: "bank", name: "", website: "", description: "", country: "CH", sort_order: 0, is_active: true };

/** /platform/partners – zentraler Partnerkatalog für alle Unternehmen. */
export function PartnerCenter() {
  const qc = useQueryClient();
  const q = usePlatformPartners();
  const [category, setCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [edit, setEdit] = useState<SavePartnerInput | null>(null);
  const [remove, setRemove] = useState<PlatformPartner | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const pickLogo = async (file: File | null | undefined) => {
    if (!file || !edit) return;
    if (!file.type.startsWith("image/")) { toast.error("Bitte eine Bilddatei wählen (PNG, JPG oder SVG)."); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("Das Logo darf höchstens 2 MB gross sein."); return; }
    setUploading(true);
    try {
      const url = await uploadPartnerLogo(file);
      setEdit((cur) => (cur ? { ...cur, logo_url: url } : cur));
      toast.success("Logo hochgeladen");
    } catch (e) {
      toast.error((e as Error).message ?? "Upload fehlgeschlagen");
    } finally { setUploading(false); }
  };

  const rows = q.data ?? [];
  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) =>
      (category === "all" || r.category === category) &&
      (!s || r.name.toLowerCase().includes(s) || (r.legal_name ?? "").toLowerCase().includes(s)));
  }, [rows, category, search]);

  const refresh = () => qc.invalidateQueries({ queryKey: ["platform", "partners"] });

  const save = async () => {
    if (!edit || !edit.name.trim()) return;
    setBusy(true);
    try {
      await savePlatformPartner(edit);
      toast.success("Partner gespeichert");
      setEdit(null);
      refresh();
    } catch (e) {
      toast.error((e as Error).message ?? "Fehler");
    } finally { setBusy(false); }
  };

  const toggle = async (p: PlatformPartner, active: boolean) => {
    try {
      await setPlatformPartnerActive(p.id, active);
      refresh();
    } catch (e) { toast.error((e as Error).message ?? "Fehler"); }
  };

  const doRemove = async () => {
    if (!remove) return;
    setBusy(true);
    try {
      await removePlatformPartner(remove.id);
      toast.success("Partner entfernt");
      setRemove(null);
      refresh();
    } catch (e) {
      const msg = (e as { code?: string; message?: string });
      toast.error(msg.code === "23503" || msg.message?.includes("partner_in_use")
        ? "Dieser Partner wird von Unternehmen verwendet. Deaktivieren statt löschen."
        : msg.message ?? "Fehler");
    } finally { setBusy(false); }
  };

  const counts = PARTNER_CATEGORIES.map((c) => [c.label, rows.filter((r) => r.category === c.key).length] as const)
    .filter(([, n]) => n > 0);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Partner gesamt</div><div className="text-2xl font-semibold">{rows.length}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Aktiv</div><div className="text-2xl font-semibold">{rows.filter((r) => r.is_active).length}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Kategorien</div><div className="text-2xl font-semibold">{counts.length}</div></CardContent></Card>
        <Card><CardContent className="p-4"><div className="text-xs text-muted-foreground">Von Firmen genutzt</div><div className="text-2xl font-semibold">{rows.reduce((a, r) => a + (r.tenant_contacts ?? 0), 0)}</div></CardContent></Card>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Alle Kategorien</SelectItem>
            {PARTNER_CATEGORIES.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Input className="w-64" placeholder="Suchen …" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Button className="ml-auto" onClick={() => setEdit({ ...EMPTY, category: category === "all" ? "bank" : category })}>
          <Plus className="mr-2 h-4 w-4" />Partner erfassen
        </Button>
      </div>

      <QueryState isLoading={q.isLoading} error={q.error} />

      <Card className="overflow-x-auto">
        <Table>
          <TableHeader><TableRow>
            <TableHead>Name</TableHead><TableHead>Kategorie</TableHead><TableHead>Website</TableHead>
            <TableHead className="text-center">Firmenkontakte</TableHead><TableHead className="text-center">Aktiv</TableHead><TableHead />
          </TableRow></TableHeader>
          <TableBody>
            {filtered.map((p) => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.name}{p.legal_name && <div className="text-xs text-muted-foreground">{p.legal_name}</div>}</TableCell>
                <TableCell><Badge variant="secondary">{PARTNER_CATEGORY_LABEL[p.category] ?? p.category}</Badge></TableCell>
                <TableCell className="text-sm">
                  {p.website
                    ? <a href={p.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">{p.website.replace(/^https?:\/\//, "")}<ExternalLink className="h-3 w-3" /></a>
                    : <span className="text-muted-foreground">–</span>}
                </TableCell>
                <TableCell className="text-center text-sm">{p.tenant_contacts ?? 0}</TableCell>
                <TableCell className="text-center"><Switch checked={p.is_active} onCheckedChange={(v) => toggle(p, v)} /></TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon" onClick={() => setEdit({
                    id: p.id, category: p.category, name: p.name, legal_name: p.legal_name, website: p.website,
                    logo_url: p.logo_url, description: p.description, country: p.country, sort_order: p.sort_order, is_active: p.is_active,
                  })}><Pencil className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => setRemove(p)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                </TableCell>
              </TableRow>
            ))}
            {!q.isLoading && filtered.length === 0 && (
              <TableRow><TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">Keine Partner gefunden.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>{edit?.id ? "Partner bearbeiten" : "Partner erfassen"}</DialogTitle></DialogHeader>
          {edit && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Kategorie</Label>
                  <Select value={edit.category} onValueChange={(v) => setEdit({ ...edit, category: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{PARTNER_CATEGORIES.map((c) => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5"><Label>Land</Label><Input value={edit.country ?? ""} onChange={(e) => setEdit({ ...edit, country: e.target.value })} /></div>
              </div>
              <div className="space-y-1.5"><Label>Name</Label><Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Firmenname (optional)</Label><Input value={edit.legal_name ?? ""} onChange={(e) => setEdit({ ...edit, legal_name: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Website</Label><Input value={edit.website ?? ""} onChange={(e) => setEdit({ ...edit, website: e.target.value })} placeholder="https://" /></div>
              <div className="space-y-1.5"><Label>Logo-URL (optional)</Label><Input value={edit.logo_url ?? ""} onChange={(e) => setEdit({ ...edit, logo_url: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Beschreibung</Label><Textarea rows={2} value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} /></div>
              <div className="grid grid-cols-2 items-end gap-3">
                <div className="space-y-1.5"><Label>Sortierung</Label><Input type="number" value={edit.sort_order ?? 0} onChange={(e) => setEdit({ ...edit, sort_order: Number(e.target.value) })} /></div>
                <label className="flex items-center gap-2 pb-2 text-sm"><Switch checked={edit.is_active ?? true} onCheckedChange={(v) => setEdit({ ...edit, is_active: v })} />Für alle Unternehmen sichtbar</label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Abbrechen</Button>
            <Button onClick={save} disabled={busy || !edit?.name.trim()}>Speichern</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!remove} onOpenChange={(o) => !o && setRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Partner entfernen?</AlertDialogTitle>
            <AlertDialogDescription>
              «{remove?.name}» wird aus dem zentralen Katalog gelöscht. Wird der Partner von Unternehmen verwendet, ist nur Deaktivieren möglich.
            </AlertDialogDescription>
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
