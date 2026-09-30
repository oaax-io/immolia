import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { BankPicker } from "@/components/financing/BankPicker";
import { toast } from "sonner";
import {
  Save, Banknote, Package, Download, Copy, Loader2, FileArchive, Trash2, CheckCircle2, Circle,
  Sparkles, Mail, AlertTriangle, Info,
} from "lucide-react";
import { DOSSIER_STATUS_LABELS, type DossierStatus } from "@/lib/financing";
import {
  buildBankPackage,
  listBankPackages,
  getBankPackageSignedUrl,
  fetchBankPackageBytes,
  createBankPackageShare,
  deleteBankPackage,
} from "@/lib/bank-package.functions";
import { generateBankCoverLetter } from "@/lib/bank-letter.functions";
import { useConfirm } from "@/components/confirm/ConfirmProvider";
import { useIsMasterDataAdmin } from "@/hooks/useIsMasterDataAdmin";
import { useChecklistAutofill } from "@/hooks/useChecklistAutofill";
import { ChecklistReadinessCard } from "@/components/financing/ChecklistReadinessCard";

const SUBMISSION_STATUSES: DossierStatus[] = [
  "ready_for_bank", "submitted_to_bank", "documents_missing", "approved", "rejected",
];

export function BankSubmissionTab({ dossierId }: { dossierId: string }) {
  const qc = useQueryClient();
  const { canEdit: isAdmin } = useIsMasterDataAdmin();
  const genLetter = useServerFn(generateBankCoverLetter);
  const readiness = useChecklistAutofill(dossierId);

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
  const [letter, setLetter] = useState("");
  const [hint, setHint] = useState("");
  const merged = { ...(dossier ?? {}), ...form };

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["financing_dossier", dossierId] });
    qc.invalidateQueries({ queryKey: ["financing_dossier_bank", dossierId] });
    qc.invalidateQueries({ queryKey: ["financing_dossiers"] });
  };

  const saveMutation = useMutation({
    mutationFn: async (patch: Record<string, any>) => {
      const { error } = await supabase.from("financing_dossiers").update(patch as any).eq("id", dossierId);
      if (error) throw error;
    },
    onSuccess: () => { invalidate(); toast.success("Gespeichert"); setForm({}); },
    onError: (e: any) => toast.error(e.message ?? "Fehler"),
  });

  /** Status sofort speichern; Datum für Einreichung/Entscheid automatisch setzen. */
  const statusMutation = useMutation({
    mutationFn: async (s: DossierStatus) => {
      const patch: Record<string, any> = { dossier_status: s };
      const now = new Date().toISOString();
      if (s === "submitted_to_bank" && !merged.submitted_to_bank_at) patch.submitted_to_bank_at = now;
      if (s === "approved" || s === "rejected") {
        patch.bank_decision_at = now;
        if (!merged.submitted_to_bank_at) patch.submitted_to_bank_at = now;
      }
      const { error } = await supabase.from("financing_dossiers").update(patch as any).eq("id", dossierId);
      if (error) throw error;
      return s;
    },
    onSuccess: (s) => { invalidate(); toast.success(`Status: ${DOSSIER_STATUS_LABELS[s]}`); },
    onError: (e: any) => toast.error(e.message ?? "Status konnte nicht gesetzt werden"),
  });

  const letterMutation = useMutation({
    mutationFn: () => genLetter({ data: { dossierId, hint } }),
    onSuccess: (res: any) => {
      if (res?.ok === false) {
        toast.error(res.reason === "INSUFFICIENT_CREDITS" ? "Nicht genügend Credits für die KI-Nachricht." : "KI-Nachricht nicht möglich.");
        return;
      }
      const text = res?.result?.text ?? res?.text ?? "";
      setLetter(text);
      toast.success("Nachricht erstellt – bitte prüfen");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Laden…</p>;

  const hasContact = !!(merged.bank_contact || merged.bank_email || merged.bank_phone);
  const currentStatus = merged.dossier_status as DossierStatus | undefined;

  return (
    <div className="space-y-4">
      <ChecklistReadinessCard
        isReady={readiness.isReady}
        requiredPercent={readiness.stats.requiredPercent}
        requiredPresent={readiness.stats.requiredPresent}
        requiredTotal={readiness.stats.requiredTotal}
        missingRequired={readiness.missingRequired}
      />

      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-semibold flex items-center gap-2"><Banknote className="h-4 w-4" />Bankangaben</h3>
          <BankPicker
            currentName={merged.bank_name ?? ""}
            currentContact={merged.bank_contact ?? ""}
            currentEmail={merged.bank_email ?? ""}
            currentPhone={merged.bank_phone ?? ""}
            showContact={isAdmin}
            onSelect={(sel) => setForm({
              ...form,
              bank_name: sel.bank_name,
              ...(isAdmin ? {
                bank_contact: sel.bank_contact,
                bank_email: sel.bank_email,
                bank_phone: sel.bank_phone,
              } : {}),
            })}
          />

          {isAdmin && merged.bank_name && (
            <Accordion type="single" collapsible defaultValue={hasContact ? undefined : "contact"}>
              <AccordionItem value="contact" className="rounded-md border px-3">
                <AccordionTrigger className="py-3 text-sm hover:no-underline">
                  <span className="flex items-center gap-2">
                    {hasContact
                      ? <CheckCircle2 className="h-4 w-4 text-primary" />
                      : <AlertTriangle className="h-4 w-4 text-destructive" />}
                    Ansprechperson bei der Bank
                    {!hasContact && <span className="text-xs font-normal text-destructive">– noch nicht erfasst</span>}
                  </span>
                </AccordionTrigger>
                <AccordionContent>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Kontaktperson" value={merged.bank_contact ?? ""} onChange={(v) => setForm({ ...form, bank_contact: v })} />
                    <Field label="E-Mail" value={merged.bank_email ?? ""} onChange={(v) => setForm({ ...form, bank_email: v })} />
                    <Field label="Telefon" value={merged.bank_phone ?? ""} onChange={(v) => setForm({ ...form, bank_phone: v })} />
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Nur Inhaber und Admins sehen diese Angaben.</p>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          )}

          <SubmissionTimeline
            status={currentStatus}
            submittedAt={merged.submitted_to_bank_at}
            decisionAt={merged.bank_decision_at}
          />

          {Object.keys(form).length > 0 && (
            <div className="flex justify-end">
              <Button onClick={() => saveMutation.mutate(form)} disabled={saveMutation.isPending}>
                <Save className="mr-2 h-4 w-4" />Bankangaben speichern
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-4">
          <div>
            <h3 className="font-semibold">Status</h3>
            <p className="text-xs text-muted-foreground">Ein Klick speichert sofort; Einreichungs- und Entscheiddatum werden automatisch gesetzt.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {SUBMISSION_STATUSES.map((s) => (
              <Button
                key={s}
                size="sm"
                variant={currentStatus === s ? "default" : "outline"}
                disabled={statusMutation.isPending}
                onClick={() => currentStatus !== s && statusMutation.mutate(s)}
              >
                {currentStatus === s && <CheckCircle2 className="mr-1.5 h-4 w-4" />}
                {DOSSIER_STATUS_LABELS[s]}
              </Button>
            ))}
          </div>

          <div className="space-y-2 border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label className="text-sm font-semibold">Nachricht an die Bank</Label>
              <Button size="sm" variant="outline" onClick={() => letterMutation.mutate()} disabled={letterMutation.isPending}>
                {letterMutation.isPending
                  ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  : <Sparkles className="mr-1.5 h-4 w-4" />}
                {letter ? "Neu erstellen" : "Mit KI erstellen"}
              </Button>
            </div>
            <Input
              value={hint}
              onChange={(e) => setHint(e.target.value)}
              placeholder="Optionaler Hinweis für die KI, z. B. «Entscheid bis Ende Monat erwünscht»"
              maxLength={500}
            />
            <Textarea
              rows={8}
              value={letter}
              onChange={(e) => setLetter(e.target.value)}
              placeholder="Begleittext für die Bank – mit KI erstellen oder selbst schreiben."
            />
            {letter && (
              <div className="flex justify-end">
                <Button size="sm" variant="ghost" onClick={async () => { await navigator.clipboard.writeText(letter); toast.success("Nachricht kopiert"); }}>
                  <Copy className="mr-1.5 h-4 w-4" />Kopieren
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-1 border-t pt-4">
            <Label className="text-xs">Interne Notizen (gehen nicht an die Bank)</Label>
            <Textarea
              rows={3}
              value={merged.bank_notes ?? ""}
              onChange={(e) => setForm({ ...form, bank_notes: e.target.value })}
              onBlur={() => form.bank_notes !== undefined && saveMutation.mutate({ bank_notes: form.bank_notes })}
              placeholder="Nachforderungen, Auflagen…"
            />
          </div>
        </CardContent>
      </Card>

      <BankPackageCard
        dossierId={dossierId}
        bankEmail={isAdmin ? merged.bank_email ?? "" : ""}
        bankName={merged.bank_name ?? ""}
        letter={letter}
      />
    </div>
  );
}

/** Kompakte Zeitachse: Bereit → Eingereicht → Entscheid. */
function SubmissionTimeline({
  status, submittedAt, decisionAt,
}: { status?: DossierStatus; submittedAt?: string | null; decisionAt?: string | null }) {
  const submitted = !!submittedAt || status === "submitted_to_bank" || status === "approved" || status === "rejected";
  const decided = status === "approved" || status === "rejected";
  const steps = [
    { label: "Bereit für Bank", done: submitted || status === "ready_for_bank", note: "" },
    { label: "Eingereicht", done: submitted, note: submittedAt ? formatZurich(submittedAt) : "" },
    {
      label: status === "rejected" ? "Abgelehnt" : status === "approved" ? "Bewilligt" : "Entscheid offen",
      done: decided,
      note: decisionAt ? formatZurich(decisionAt) : "",
    },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-md border bg-muted/20 p-3">
      {steps.map((s, i) => (
        <div key={s.label} className="flex items-center gap-2">
          {s.done
            ? <CheckCircle2 className="h-4 w-4 text-primary" />
            : <Circle className="h-4 w-4 text-muted-foreground" />}
          <div className="text-sm">
            <span className={s.done ? "font-medium" : "text-muted-foreground"}>{s.label}</span>
            {s.note && <span className="ml-1 text-xs text-muted-foreground">{s.note}</span>}
          </div>
          {i < steps.length - 1 && <span className="text-muted-foreground">→</span>}
        </div>
      ))}
    </div>
  );
}

function formatBytes(n: number | null | undefined) {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function BankPackageCard({
  dossierId, bankEmail, bankName, letter,
}: { dossierId: string; bankEmail: string; bankName: string; letter: string }) {
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
      await markSubmitted();
    } else {
      toast.error(res.message ?? "Link konnte nicht erstellt werden.");
    }
  }

  /** Öffnet das eigene Mailprogramm mit Begleittext + Download-Link. */
  async function sendByEmail(generatedDocumentId: string) {
    const res = await createShare({ data: { generatedDocumentId } });
    if (!res.ok || !res.token) {
      toast.error(res.message ?? "Link konnte nicht erstellt werden.");
      return;
    }
    const url = `${window.location.origin}/bank-paket/${res.token}`;
    const body = `${letter.trim() || "Guten Tag\n\nAnbei erhalten Sie die Unterlagen zum Finanzierungsdossier."}\n\nDownload der Unterlagen (7 Tage gültig):\n${url}`;
    const subject = `Finanzierungsanfrage${bankName ? ` – ${bankName}` : ""}`;
    window.location.href = `mailto:${encodeURIComponent(bankEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    await markSubmitted();
  }

  /** Beim Teilen gilt das Dossier als eingereicht – nur setzen, wenn noch offen. */
  async function markSubmitted() {
    const { data } = await supabase
      .from("financing_dossiers")
      .select("dossier_status, submitted_to_bank_at")
      .eq("id", dossierId)
      .maybeSingle();
    if (!data || data.submitted_to_bank_at) return;
    if (data.dossier_status === "approved" || data.dossier_status === "rejected") return;
    const { error } = await supabase
      .from("financing_dossiers")
      .update({ dossier_status: "submitted_to_bank", submitted_to_bank_at: new Date().toISOString() })
      .eq("id", dossierId);
    if (error) return;
    qc.invalidateQueries({ queryKey: ["financing_dossier_bank", dossierId] });
    qc.invalidateQueries({ queryKey: ["financing_dossier", dossierId] });
    qc.invalidateQueries({ queryKey: ["financing_dossiers"] });
    toast.info("Status auf «Bei Bank eingereicht» gesetzt");
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

        <div className="flex gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            Viele Banken öffnen keine Links von unbekannten Absendern. Falls der Link blockiert wird: ZIP herunterladen
            und im Partnerportal der Bank hochladen oder über einen sicheren Mailkanal (z. B. IncaMail) senden.
          </p>
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
                  onClick={() => sendByEmail(p.id)}
                  title="Per E-Mail an die Bank senden (öffnet dein Mailprogramm)"
                >
                  <Mail className="h-4 w-4" />
                </Button>
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
