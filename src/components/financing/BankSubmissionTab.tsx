import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePartnerCatalog, usePartnerContacts, partnerDisplayName } from "@/lib/partners";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Save, Banknote, Package, Download, Copy, Loader2, FileArchive, Trash2 } from "lucide-react";
import { DOSSIER_STATUS_LABELS, type DossierStatus } from "@/lib/financing";
import {
  buildBankPackage,
  listBankPackages,
  getBankPackageSignedUrl,
  fetchBankPackageBytes,
  createBankPackageShare,
  deleteBankPackage,
} from "@/lib/bank-package.functions";
import { useConfirm } from "@/components/confirm/ConfirmProvider";

const BANK_TYPES = [
  { value: "ubs", label: "UBS" },
  { value: "credit_suisse", label: "Credit Suisse" },
  { value: "raiffeisen", label: "Raiffeisen" },
  { value: "zkb", label: "Zürcher Kantonalbank (ZKB)" },
  { value: "postfinance", label: "PostFinance" },
  { value: "migros_bank", label: "Migros Bank" },
  { value: "bank_cler", label: "Bank Cler" },
  { value: "julius_baer", label: "Julius Bär" },
  { value: "vontobel", label: "Vontobel" },
  { value: "pictet", label: "Pictet" },
  { value: "lombard_odier", label: "Lombard Odier" },
  { value: "edmond_de_rothschild", label: "Edmond de Rothschild" },
  { value: "safra_sarasin", label: "J. Safra Sarasin" },
  { value: "ehypo", label: "EFG Bank" },
  { value: "bcv", label: "Banque Cantonale Vaudoise (BCV)" },
  { value: "bcge", label: "Banque Cantonale de Genève (BCGE)" },
  { value: "bcbe", label: "Berner Kantonalbank (BEKB)" },
  { value: "bcn", label: "Banque Cantonale Neuchâteloise (BCN)" },
  { value: "bcj", label: "Banque Cantonale du Jura (BCJ)" },
  { value: "bcf", label: "Banque Cantonale de Fribourg (BCF)" },
  { value: "bcvs", label: "Walliser Kantonalbank (WKB/BCVs)" },
  { value: "aargauer_kb", label: "Aargauische Kantonalbank (AKB)" },
  { value: "basler_kb", label: "Basler Kantonalbank (BKB)" },
  { value: "bl_kb", label: "Basellandschaftliche Kantonalbank (BLKB)" },
  { value: "luzerner_kb", label: "Luzerner Kantonalbank (LUKB)" },
  { value: "sg_kb", label: "St. Galler Kantonalbank (SGKB)" },
  { value: "thurgauer_kb", label: "Thurgauer Kantonalbank (TKB)" },
  { value: "graubuendner_kb", label: "Graubündner Kantonalbank (GKB)" },
  { value: "schwyzer_kb", label: "Schwyzer Kantonalbank (SZKB)" },
  { value: "zuger_kb", label: "Zuger Kantonalbank (ZGKB)" },
  { value: "obwaldner_kb", label: "Obwaldner Kantonalbank (OKB)" },
  { value: "nidwaldner_kb", label: "Nidwaldner Kantonalbank (NKB)" },
  { value: "urner_kb", label: "Urner Kantonalbank (UKB)" },
  { value: "glarner_kb", label: "Glarner Kantonalbank (GLKB)" },
  { value: "appenzeller_kb", label: "Appenzeller Kantonalbank (APPKB)" },
  { value: "schaffhauser_kb", label: "Schaffhauser Kantonalbank (SHKB)" },
  { value: "solothurner_kb", label: "Baloise Bank / Solothurner" },
  { value: "banca_stato", label: "Banca dello Stato del Cantone Ticino" },
  { value: "valiant", label: "Valiant Bank" },
  { value: "hypothekarbank_lenzburg", label: "Hypothekarbank Lenzburg" },
  { value: "clientis", label: "Clientis" },
  { value: "wir_bank", label: "WIR Bank" },
  { value: "bank_linth", label: "Bank Linth" },
  { value: "bank_avera", label: "Bank Avera" },
  { value: "acrevis", label: "Acrevis Bank" },
  { value: "regiobank", label: "Regiobank Solothurn" },
  { value: "cembra", label: "Cembra Money Bank" },
  { value: "bank_now", label: "Bank Now" },
  { value: "yuh", label: "Yuh" },
  { value: "neon", label: "Neon" },
  { value: "revolut", label: "Revolut" },
  { value: "other", label: "Andere Bank" },
];

const SUBMISSION_STATUSES: DossierStatus[] = [
  "ready_for_bank", "submitted_to_bank", "documents_missing", "approved", "rejected",
];

export function BankSubmissionTab({ dossierId }: { dossierId: string }) {
  const qc = useQueryClient();
  const bankCatalog = usePartnerCatalog("bank");
  const bankContacts = usePartnerContacts("bank");


  const { data: dossier, isLoading } = useQuery({
    queryKey: ["financing_dossier_bank", dossierId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financing_dossiers")
        .select("bank_type, bank_name, bank_contact, bank_email, bank_phone, bank_notes, dossier_status, submitted_to_bank_at, bank_decision_at")
        .eq("id", dossierId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [form, setForm] = useState<any>({});
  const merged = { ...(dossier ?? {}), ...form };

  const saveMutation = useMutation({
    mutationFn: async (patch: Record<string, any>) => {
      const { error } = await supabase.from("financing_dossiers").update(patch as any).eq("id", dossierId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["financing_dossier", dossierId] });
      qc.invalidateQueries({ queryKey: ["financing_dossier_bank", dossierId] });
      qc.invalidateQueries({ queryKey: ["financing_dossiers"] });
      toast.success("Gespeichert");
      setForm({});
    },
    onError: (e: any) => toast.error(e.message ?? "Fehler"),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Laden…</p>;

  const submittedDate = merged.submitted_to_bank_at
    ? new Date(merged.submitted_to_bank_at).toISOString().slice(0, 10)
    : "";

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-semibold flex items-center gap-2"><Banknote className="h-4 w-4" />Bankangaben</h3>
          <div>
            <Label className="text-xs">Bank auswählen</Label>
            <Select
              value=""
              onValueChange={(v) => {
                const [kind, id] = v.split(":");
                if (kind === "contact") {
                  const c = (bankContacts.data ?? []).find((x) => x.id === id);
                  if (!c) return;
                  setForm({
                    ...form,
                    bank_name: partnerDisplayName(c, bankCatalog.data ?? []),
                    bank_contact: c.contact_name ?? "",
                    bank_email: c.email ?? "",
                    bank_phone: c.phone ?? "",
                  });
                } else {
                  const p = (bankCatalog.data ?? []).find((x) => x.id === id);
                  if (!p) return;
                  setForm({ ...form, bank_name: p.name });
                }
              }}
            >
              <SelectTrigger><SelectValue placeholder="Eigener Ansprechpartner oder zentrale Bank" /></SelectTrigger>
              <SelectContent>
                {(bankContacts.data ?? []).length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Eigene Ansprechpartner</SelectLabel>
                    {(bankContacts.data ?? []).map((c) => (
                      <SelectItem key={c.id} value={`contact:${c.id}`}>
                        {partnerDisplayName(c, bankCatalog.data ?? [])}
                        {c.contact_name ? ` · ${c.contact_name}` : ""}
                        {c.branch_name ? ` (${c.branch_name})` : ""}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                <SelectGroup>
                  <SelectLabel>Zentrale Banken</SelectLabel>
                  {(bankCatalog.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={`partner:${p.id}`}>{p.name}</SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              Die Felder werden vorbefüllt und bleiben frei änderbar.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">

            <div>
              <Label className="text-xs">Banktyp</Label>
              <Select value={merged.bank_type ?? ""} onValueChange={(v) => setForm({ ...form, bank_type: v })}>
                <SelectTrigger><SelectValue placeholder="Banktyp" /></SelectTrigger>
                <SelectContent>
                  {BANK_TYPES.map((b) => (<SelectItem key={b.value} value={b.value}>{b.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </div>
            <Field label="Bankname" value={merged.bank_name ?? ""} onChange={(v) => setForm({ ...form, bank_name: v })} />
            <Field label="Kontaktperson" value={merged.bank_contact ?? ""} onChange={(v) => setForm({ ...form, bank_contact: v })} />
            <Field label="E-Mail" value={merged.bank_email ?? ""} onChange={(v) => setForm({ ...form, bank_email: v })} />
            <Field label="Telefon" value={merged.bank_phone ?? ""} onChange={(v) => setForm({ ...form, bank_phone: v })} />
            <div>
              <Label className="text-xs">Einreichungsdatum</Label>
              <Input
                type="date"
                value={submittedDate}
                onChange={(e) => setForm({
                  ...form,
                  submitted_to_bank_at: e.target.value ? new Date(e.target.value).toISOString() : null,
                })}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-semibold">Status & Notizen</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge>{DOSSIER_STATUS_LABELS[merged.dossier_status as DossierStatus] ?? "Entwurf"}</Badge>
          </div>
          <div>
            <Label className="text-xs">Status setzen</Label>
            <Select value={merged.dossier_status ?? "draft"} onValueChange={(v) => setForm({ ...form, dossier_status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SUBMISSION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>{DOSSIER_STATUS_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Notizen zur Einreichung</Label>
            <Textarea
              rows={4}
              value={merged.bank_notes ?? ""}
              onChange={(e) => setForm({ ...form, bank_notes: e.target.value })}
              placeholder="Nachforderungen, Kommunikation, Auflagen…"
            />
          </div>
        </CardContent>
      </Card>

      <BankPackageCard dossierId={dossierId} />

      <div className="flex justify-end">
        <Button
          onClick={() => saveMutation.mutate(form)}
          disabled={Object.keys(form).length === 0 || saveMutation.isPending}
        >
          <Save className="mr-2 h-4 w-4" />Speichern
        </Button>
      </div>
    </div>
  );
}

function formatBytes(n: number | null | undefined) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function BankPackageCard({ dossierId }: { dossierId: string }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const build = useServerFn(buildBankPackage);
  const list = useServerFn(listBankPackages);
  const getUrl = useServerFn(getBankPackageSignedUrl);
  const fetchBytes = useServerFn(fetchBankPackageBytes);
  const createShare = useServerFn(createBankPackageShare);
  const deletePkg = useServerFn(deleteBankPackage);

  const packages = useQuery({
    queryKey: ["bank_packages", dossierId],
    queryFn: () => list({ data: { dossierId } }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deletePkg({ data: { generatedDocumentId: id } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.message ?? "Löschen fehlgeschlagen.");
        return;
      }
      toast.success("Version gelöscht");
      qc.invalidateQueries({ queryKey: ["bank_packages", dossierId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const create = useMutation({
    mutationFn: () => build({ data: { dossierId, locale: "de" } }),
    onSuccess: (res) => {
      if (!res.ok) {
        toast.error(res.message ?? "Paket konnte nicht erstellt werden.");
        return;
      }
      toast.success(`Bank-Paket erstellt (${formatBytes(res.sizeBytes)}, ${res.attachmentCount} Anhänge)`);
      const sk = (res as { skipped?: Array<{ name: string; reason: string }> }).skipped ?? [];
      if (sk.length) {
        const why: Record<string, string> = { zu_gross: "über 25 MB", paketgrenze: "Paketgrösse von 45 MB erreicht", nicht_gefunden: "Datei nicht gefunden" };
        toast.warning(`${sk.length} Datei(en) nicht im Paket`, {
          description: sk.slice(0, 5).map((x) => `${x.name} (${why[x.reason] ?? x.reason})`).join(", ") + (sk.length > 5 ? " …" : ""),
          duration: 12000,
        });
      }
      qc.invalidateQueries({ queryKey: ["bank_packages", dossierId] });
      if (res.fileUrl) downloadViaProxy(res.filePath ?? "", res.fileUrl);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function downloadViaProxy(path: string, fallbackUrl: string) {
    try {
      const res = await fetchBytes({ data: { path } });
      if (res.ok && res.base64) {
        const bin = atob(res.base64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const blobUrl = URL.createObjectURL(new Blob([bytes], { type: "application/zip" }));
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = path.split("/").pop() ?? "bank-paket.zip";
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }
    } catch {
      // fall back
    }
    window.open(fallbackUrl, "_blank");
  }

  async function copyShareLink(generatedDocumentId: string) {
    const res = await createShare({ data: { generatedDocumentId } });
    if (res.ok && res.token) {
      const url = `${window.location.origin}/bank-paket/${res.token}`;
      await navigator.clipboard.writeText(url);
      toast.success("Öffentlicher Download-Link kopiert (7 Tage gültig)");
    } else {
      toast.error(res.message ?? "Link konnte nicht erstellt werden.");
    }
  }

  async function downloadPackage(path: string) {
    const res = await getUrl({ data: { path } });
    if (res.ok && res.fileUrl) downloadViaProxy(path, res.fileUrl);
    else toast.error(res.message ?? "Download fehlgeschlagen.");
  }

  const items = packages.data?.ok ? packages.data.packages : [];

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold flex items-center gap-2">
              <Package className="h-4 w-4" />Bank-Paket
            </h3>
            <p className="text-xs text-muted-foreground mt-1">
              Erstellt ein ZIP mit Master-Dossier (PDF) + allen Unterlagen von Kunde, Ehepartner, Objekt &
              Finanzierung. Kopierbarer Download-Link zur Weitergabe an die Bank.
            </p>
          </div>
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <FileArchive className="mr-2 h-4 w-4" />
            )}
            {create.isPending ? "Wird erstellt…" : "Bank-Paket erstellen"}
          </Button>
        </div>

        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">Noch keine Pakete erstellt.</p>
        ) : (
          <div className="space-y-2">
            <Label className="text-xs">Historie</Label>
            {items.map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-2 rounded-md border p-2 text-sm"
              >
                <FileArchive className="h-4 w-4 text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium">{p.title ?? "Bank-Paket"}</div>
                  <div className="text-xs text-muted-foreground">
                    {new Date(p.created_at).toLocaleString("de-CH")} · {formatBytes(p.bytes)} ·{" "}
                    {p.attachments ?? 0} Anhänge
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyShareLink(p.id)}
                  title="Öffentlichen Download-Link kopieren (7 Tage gültig)"
                >
                  <Copy className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => p.file_url && downloadPackage(p.file_url)}
                  title="Herunterladen"
                >
                  <Download className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={async () => {
                    const ok = await confirm({
                      title: "Version löschen?",
                      description: `Diese Version vom ${formatZurich(p.created_at)} wird unwiderruflich entfernt.`,
                      confirmText: "Löschen",
                    });
                    if (ok) remove.mutate(p.id);
                  }}
                  disabled={remove.isPending}
                  title="Version löschen"
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function formatZurich(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("de-CH", {
    timeZone: "Europe/Zurich",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
