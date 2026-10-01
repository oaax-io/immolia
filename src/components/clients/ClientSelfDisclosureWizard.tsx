import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/lib/auth";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Loader2,
  Save,
  Upload,
  ChevronLeft,
  ChevronRight,
  Check,
  Sparkles,
  FileText,
} from "lucide-react";
import { toast } from "sonner";
import {
  calculateBenchmark,
  employmentStatusOptions,
  expenseFields,
  expenseLabels,
  incomeFields,
  incomeLabels,
  maritalStatusOptions,
  salutationOptions,
  type ExpenseField,
  type IncomeField,
} from "@/lib/self-disclosure";
import { BenchmarkCard } from "@/components/clients/BenchmarkCard";
import { cn } from "@/lib/utils";

type DisclosureRow = Record<string, unknown> & { id?: string };
type EmployeeOption = { id: string; full_name: string | null; email: string | null };

interface Props {
  clientId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: DisclosureRow | null;
}

const STEPS = [
  { id: 1, title: "Personendaten", description: "Wer ist die antragstellende Person?" },
  { id: 2, title: "Beruf", description: "Beschäftigung und Jahresgehalt" },
  { id: 3, title: "Einnahmen", description: "Monatliche Einnahmen" },
  { id: 4, title: "Ausgaben", description: "Monatliche Ausgaben" },
  { id: 5, title: "Abschluss", description: "Berater, Datum, Notizen" },
] as const;

const DATE_FIELDS = new Set([
  "birth_date",
  "employed_since",
  "resident_since",
  "disclosure_date",
]);

const NUMERIC_FIELDS = new Set([
  "salary_net_monthly",
  "additional_income",
  "income_job_two",
  "income_rental",
  "annual_net_salary",
  "total_income_monthly",
  "mortgage_expense",
  "rent_expense",
  "leasing_expense",
  "credit_expense",
  "life_insurance_expense",
  "alimony_expense",
  "health_insurance_expense",
  "property_insurance_expense",
  "utilities_expense",
  "telecom_expense",
  "living_costs_expense",
  "taxes_expense",
  "miscellaneous_expense",
  "total_expenses_monthly",
  "reserve_total",
  "reserve_ratio",
]);

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: unknown): boolean {
  return typeof value === "string" && UUID_RE.test(value.trim());
}

function isLikelyNetworkError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return (
    !navigator.onLine ||
    /failed to fetch|networkerror|network request failed|load failed|fetch/i.test(message)
  );
}

function normalizeAdvisorId(value: unknown, employees: EmployeeOption[]): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (isUuid(trimmed)) return trimmed;
  const normalizedInput = trimmed.toLowerCase();

  const match = employees.find((employee) => {
    const fullName = typeof employee.full_name === "string"
      ? employee.full_name.trim().toLowerCase()
      : null;
    const email = typeof employee.email === "string"
      ? employee.email.trim().toLowerCase()
      : null;
    return fullName === normalizedInput || email === normalizedInput;
  });

  return match?.id ?? null;
}

function getDraftStorageKey(clientId: string) {
  return `client-self-disclosure-draft:${clientId}`;
}

function buildPersistPayload(
  form: DisclosureRow,
  clientId: string,
  benchmark: ReturnType<typeof calculateBenchmark>,
  employees: EmployeeOption[],
) {
  const cleaned = sanitize(form);
  const {
    id: _id,
    created_at: _createdAt,
    updated_at: _updatedAt,
    reviewed_at: _reviewedAt,
    reviewed_by: _reviewedBy,
    sent_at: _sentAt,
    submitted_at: _submittedAt,
    client_id: _clientId,
    total_income_monthly: _totalIncome,
    total_expenses_monthly: _totalExpenses,
    reserve_total: _reserveTotal,
    reserve_ratio: _reserveRatio,
    benchmark_status: _benchmarkStatus,
    ...rest
  } = cleaned;

  const normalizedAdvisorId = normalizeAdvisorId(cleaned.advisor_id, employees);
  const advisorPatch = normalizedAdvisorId !== null || cleaned.advisor_id == null
    ? { advisor_id: normalizedAdvisorId }
    : {};

  return {
    ...rest,
    client_id: clientId,
    ...advisorPatch,
    status: typeof cleaned.status === "string" ? cleaned.status : "draft",
    total_income_monthly: benchmark.totalIncome,
    total_expenses_monthly: benchmark.totalExpenses,
    reserve_total: benchmark.reserveTotal,
    reserve_ratio: Number(benchmark.reserveRatio.toFixed(2)),
    benchmark_status: benchmark.status,
  };
}

function sanitize(src: DisclosureRow): DisclosureRow {
  const out: DisclosureRow = {};
  for (const [k, v] of Object.entries(src)) {
    if (v === "" || v === undefined) {
      out[k] = null;
      continue;
    }
    if (DATE_FIELDS.has(k)) {
      // Accept YYYY or YYYY-MM-DD; pass YYYY through as null if not parseable date
      if (typeof v === "string" && /^\d{4}$/.test(v)) {
        out[k] = `${v}-01-01`;
      } else {
        out[k] = v;
      }
      continue;
    }
    if (NUMERIC_FIELDS.has(k)) {
      const n = Number(v);
      out[k] = Number.isFinite(n) ? n : null;
      continue;
    }
    out[k] = v;
  }
  return out;
}

export function ClientSelfDisclosureWizard({
  clientId,
  open,
  onOpenChange,
  initial,
}: Props) {
  const qc = useQueryClient();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState<DisclosureRow>(initial ?? {});
  const [parsing, setParsing] = useState(false);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [autosaveState, setAutosaveState] = useState<
    "idle" | "saving" | "saved" | "offline" | "error"
  >("idle");
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [pendingSync, setPendingSync] = useState(false);
  const [coApplicantPrompt, setCoApplicantPrompt] = useState<
    null | { fields: Record<string, unknown>; creating: boolean }
  >(null);
  const [importedChildren, setImportedChildren] = useState<
    Array<{ full_name: string; birth_date?: string }>
  >([]);
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastSyncedSnapshotRef = useRef("{}");
  const savingRef = useRef(false);
  const queuedSaveRef = useRef(false);
  const connectionToastStateRef = useRef<"online" | "offline" | null>(null);

  const { data: employees = [] } = useQuery({
    queryKey: ["self_disclosure_advisors"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return (data ?? []) as EmployeeOption[];
    },
    staleTime: 5 * 60 * 1000,
  });

  const wasOpenRef = useRef(false);
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const baseForm = initial ?? {};
      let nextForm = baseForm;

      try {
        const rawDraft = localStorage.getItem(getDraftStorageKey(clientId));
        if (rawDraft) {
          const parsed = JSON.parse(rawDraft) as { form?: DisclosureRow; step?: number };
          if (parsed.form && typeof parsed.form === "object") {
            nextForm = { ...baseForm, ...parsed.form };
            setPendingSync(true);
            setAutosaveState(navigator.onLine ? "idle" : "offline");
          }
          if (typeof parsed.step === "number") setStep(parsed.step);
          else setStep(1);
        } else {
          setStep(1);
          setPendingSync(false);
          setAutosaveState("idle");
        }
      } catch {
        setStep(1);
      }

      setForm(nextForm);
      const nextBenchmark = calculateBenchmark(
        nextForm as Record<string, number | string | null>,
      );
      lastSyncedSnapshotRef.current = JSON.stringify(
        buildPersistPayload(nextForm, clientId, nextBenchmark, employees),
      );
      setLastSavedAt(null);
    }
    wasOpenRef.current = open;
  }, [open, initial, clientId, employees]);

  const set = (k: string, v: unknown) => setForm((p) => ({ ...p, [k]: v }));

  const benchmark = useMemo(
    () => calculateBenchmark(form as Record<string, number | string | null>),
    [form],
  );

  const persistPayload = useMemo(
    () => buildPersistPayload(form, clientId, benchmark, employees),
    [form, clientId, benchmark, employees],
  );
  const persistSnapshot = useMemo(
    () => JSON.stringify(persistPayload),
    [persistPayload],
  );

  useEffect(() => {
    if (!employees.length) return;
    const current = form.advisor_id;
    if (isUuid(current) || typeof current !== "string" || !current.trim()) return;
    const normalized = normalizeAdvisorId(current, employees);
    if (!normalized) return;
    setForm((prev) =>
      prev.advisor_id === current ? { ...prev, advisor_id: normalized } : prev,
    );
  }, [employees, form.advisor_id]);

  useEffect(() => {
    if (!open) return;
    try {
      localStorage.setItem(
        getDraftStorageKey(clientId),
        JSON.stringify({ form, step, updated_at: new Date().toISOString() }),
      );
    } catch {
      // ignore local draft storage issues
    }
  }, [open, clientId, form, step]);

  async function persistDisclosure({
    manual = false,
    closeOnSuccess = false,
  }: {
    manual?: boolean;
    closeOnSuccess?: boolean;
  } = {}) {
    if (!open) return { ok: false };
    if (savingRef.current) {
      queuedSaveRef.current = true;
      return { ok: false };
    }
    if (!isOnline) {
      setPendingSync(true);
      setAutosaveState("offline");
      if (manual) {
        throw new Error(
          "Keine Verbindung – Ihre Eingaben bleiben lokal gespeichert und werden nach Wiederverbindung synchronisiert.",
        );
      }
      return { ok: false };
    }

    savingRef.current = true;
    setAutosaveState("saving");
    try {
      const { error } = await supabase
        .from("client_self_disclosures")
        .upsert(persistPayload, { onConflict: "client_id" });
      if (error) throw error;

      // Kunden-Stammdaten (full_name) aus der Selbstauskunft synchronisieren,
      // damit Vor- und Nachname überall korrekt erscheinen.
      try {
        const sdFirst = (form.first_name as string | undefined)?.trim() ?? "";
        const sdLast = (form.last_name as string | undefined)?.trim() ?? "";
        const fullName = [sdFirst, sdLast].filter(Boolean).join(" ");
        if (sdFirst && sdLast) {
          await supabase
            .from("clients")
            .update({
              full_name: fullName,
              contact_first_name: sdFirst,
              contact_last_name: sdLast,
            })
            .eq("id", clientId);
          qc.invalidateQueries({ queryKey: ["client", clientId] });
          qc.invalidateQueries({ queryKey: ["clients"] });
        }
      } catch {
        // Sync ist best-effort – Fehler hier nicht fatal
      }

      lastSyncedSnapshotRef.current = persistSnapshot;
      setPendingSync(false);
      setAutosaveState("saved");
      setLastSavedAt(Date.now());
      try {
        localStorage.removeItem(getDraftStorageKey(clientId));
      } catch {
        // ignore
      }
      qc.invalidateQueries({ queryKey: ["client_self_disclosure", clientId] });
      qc.invalidateQueries({ queryKey: ["client_benchmark", clientId] });

      if (manual) toast.success("Selbstauskunft gespeichert");
      if (closeOnSuccess) onOpenChange(false);
      return { ok: true };
    } catch (error) {
      if (isLikelyNetworkError(error)) {
        setPendingSync(true);
        setAutosaveState("offline");
        throw new Error(
          "Keine Verbindung – Ihre Eingaben bleiben lokal gespeichert und werden nach Wiederverbindung synchronisiert.",
        );
      }

      setAutosaveState("error");
      throw error;
    } finally {
      savingRef.current = false;
      if (queuedSaveRef.current && isOnline) {
        queuedSaveRef.current = false;
        queueMicrotask(() => {
          void persistDisclosure();
        });
      }
    }
  }

  useEffect(() => {
    if (!open) return;
    if (persistSnapshot === lastSyncedSnapshotRef.current) return;

    setPendingSync(true);
    if (!isOnline) {
      setAutosaveState("offline");
      return;
    }

    const timeout = window.setTimeout(() => {
      void persistDisclosure();
    }, 1200);

    return () => window.clearTimeout(timeout);
  }, [open, isOnline, persistSnapshot]);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      if (connectionToastStateRef.current !== "online") {
        toast.success("Verbindung wiederhergestellt – Änderungen werden weiter synchronisiert.");
        connectionToastStateRef.current = "online";
      }
      if (pendingSync || persistSnapshot !== lastSyncedSnapshotRef.current) {
        void persistDisclosure().catch(() => undefined);
      }
    };

    const handleOffline = () => {
      setIsOnline(false);
      setPendingSync(true);
      setAutosaveState("offline");
      if (connectionToastStateRef.current !== "offline") {
        toast.error("Keine Verbindung – Änderungen werden lokal weiter gespeichert.");
        connectionToastStateRef.current = "offline";
      }
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [pendingSync, persistSnapshot]);

  const handlePdfUpload = async (file: File) => {
    if (!file) return;
    if (file.type !== "application/pdf") {
      toast.error("Bitte eine PDF-Datei hochladen");
      return;
    }
    setParsing(true);
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = "";
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(
          null,
          Array.from(bytes.subarray(i, i + chunkSize)),
        );
      }
      const base64 = btoa(binary);

      const { data, error } = await supabase.functions.invoke(
        "parse-self-disclosure",
        { body: { pdf_base64: base64, mime_type: file.type } },
      );
      if (error) throw error;
      if (data?.error) {
        toast.error(String(data.error));
        return;
      }
      const fields = (data?.fields ?? {}) as Record<string, unknown>;
      const cleaned: DisclosureRow = {};
      for (const [k, v] of Object.entries(fields)) {
        if (v === null || v === undefined || v === "") continue;
        cleaned[k] = v;
      }
      setForm((prev) => ({ ...prev, ...cleaned }));
      const count = Object.keys(cleaned).length;
      if (data?.review_required) {
        toast.warning(
          "Unbekanntes Formular: Nur Personen- und Kontaktangaben übernommen. Finanzangaben bitte manuell erfassen und alles prüfen.",
        );
      }
      toast.success(
        count > 0
          ? `${count} Felder erkannt – bitte prüfen.`
          : `Keine zuordenbaren Felder erkannt (${data?.form_fields_count ?? 0} Formularfelder gelesen).`,
      );

      const coFields = (data?.co_applicant_fields ?? null) as
        | Record<string, unknown>
        | null;
      if (data?.has_co_applicant && coFields && Object.keys(coFields).length > 0) {
        setCoApplicantPrompt({ fields: coFields, creating: false });
      }

      // Kinder aus PDF (Kind01.. / Geb01..) für Hauptantragsteller speichern
      // und zwischenspeichern, um sie ggf. dem Mitantragsteller hinzuzufügen.
      const parsedChildren = Array.isArray(data?.children)
        ? (data.children as Array<{ full_name?: string; birth_date?: string }>)
            .filter((c) => c?.full_name?.trim())
            .map((c) => ({
              full_name: c.full_name!.trim(),
              birth_date: c.birth_date,
            }))
        : [];
      if (parsedChildren.length > 0) {
        setImportedChildren(parsedChildren);
        try {
          // Bestehende Kinder dieses Kunden lesen, um Duplikate (gleicher Name
          // + Geburtsdatum) zu vermeiden.
          const { data: existing } = await supabase
            .from("client_children")
            .select("full_name, birth_date")
            .eq("client_id", clientId);
          const existingKeys = new Set(
            (existing ?? []).map(
              (c) => `${(c.full_name ?? "").toLowerCase()}|${c.birth_date ?? ""}`,
            ),
          );
          const toInsert = parsedChildren
            .filter(
              (c) =>
                !existingKeys.has(
                  `${c.full_name.toLowerCase()}|${c.birth_date ?? ""}`,
                ),
            )
            .map((c, idx) => ({
              client_id: clientId,
              full_name: c.full_name,
              birth_date: c.birth_date ?? null,
              is_shared_child: true,
              sort_order: (existing?.length ?? 0) + idx,
            }));
          if (toInsert.length > 0) {
            const { error: childErr } = await supabase
              .from("client_children")
              .insert(toInsert);
            if (childErr) throw childErr;
            qc.invalidateQueries({ queryKey: ["client_children", clientId] });
            toast.success(
              `${toInsert.length} Kind${toInsert.length === 1 ? "" : "er"} aus PDF übernommen.`,
            );
          }
        } catch (childError) {
          console.warn("could not persist children", childError);
        }
      }
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "PDF konnte nicht gelesen werden",
      );
    } finally {
      setParsing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const save = useMutation({
    mutationFn: async () => {
      await persistDisclosure({ manual: true, closeOnSuccess: true });
    },
    onSuccess: () => {
      // handled in persistDisclosure
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen"),
  });

  const isLast = step === STEPS.length;

  async function createCoApplicantClient() {
    if (!coApplicantPrompt) return;
    if (!user?.id) {
      toast.error("Sie müssen angemeldet sein.");
      return;
    }
    setCoApplicantPrompt({ ...coApplicantPrompt, creating: true });
    try {
      const f = coApplicantPrompt.fields;
      const first = (f.first_name as string | undefined)?.trim() ?? "";
      const last = (f.last_name as string | undefined)?.trim() ?? "";
      const fullName = [first, last].filter(Boolean).join(" ") || "Mitantragsteller";

      // 1) Mitantragsteller als Kunden anlegen.
      // Owner/Assigned vom Hauptantragsteller übernehmen, damit beide
      // Kunden für denselben Berater sichtbar sind (sonst greift RLS und
      // die Beziehung erscheint als „Unbekannt" in der Übersicht).
      const { data: mainClient } = await supabase
        .from("clients")
        .select("owner_id, assigned_to, agency_id")
        .eq("id", clientId)
        .maybeSingle();
      const ownerId = mainClient?.owner_id ?? user.id;
      const assignedTo = mainClient?.assigned_to ?? user.id;

      const { data: newClient, error: ce } = await supabase
        .from("clients")
        .insert({
          full_name: fullName,
          contact_first_name: first || null,
          contact_last_name: last || null,
          email: (f.email as string) ?? null,
          phone: (f.phone as string) ?? (f.mobile as string) ?? null,
          address: [f.street, f.street_number].filter(Boolean).join(" ") || null,
          postal_code: (f.postal_code as string) ?? null,
          city: (f.city as string) ?? null,
          country: (f.country as string) ?? "CH",
          client_type: "buyer" as const,
          entity_type: "person",
          owner_id: ownerId,
          assigned_to: assignedTo,
          agency_id: mainClient?.agency_id ?? null,
        })
        .select("id")
        .single();
      if (ce) throw ce;


      // 2) Beziehung erfassen (Mitantragsteller / Ehepartner falls verheiratet)
      const marital = (form.marital_status as string | undefined)?.toLowerCase() ?? "";
      const relType = marital.includes("verheirat") || marital.includes("partner")
        ? "spouse"
        : "co_applicant";
      await supabase.from("client_relationships").insert([
        { client_id: clientId, related_client_id: newClient.id, relationship_type: relType },
        { client_id: newClient.id, related_client_id: clientId, relationship_type: relType },
      ]);

      // 3) Eigene Selbstauskunft für Mitantragsteller anlegen.
      // Haushalts-Einnahmen/-Ausgaben werden in der ASIMO-PDF oft nur einmal
      // erfasst – als Fallback übernehmen wir sie aus dem Hauptantragsteller.
      const coRaw: DisclosureRow = {};
      // Personendaten + ggf. eigene Beruf-/Finanzdaten aus MI-Block
      for (const [k, v] of Object.entries(f)) {
        if (v === null || v === undefined || v === "") continue;
        coRaw[k] = v;
      }
      // Fallback: Einnahmen/Ausgaben aus Hauptantragsteller-Form übernehmen,
      // wenn im MI-Block nicht vorhanden.
      const sharedFields = [
        ...incomeFields,
        ...expenseFields,
        "marital_status",
        "disclosure_date",
        "disclosure_place",
        "advisor_id",
      ] as const;
      for (const k of sharedFields) {
        if (coRaw[k] === undefined || coRaw[k] === null || coRaw[k] === "") {
          const v = (form as DisclosureRow)[k];
          if (v !== undefined && v !== null && v !== "") coRaw[k] = v;
        }
      }
      const coBenchmark = calculateBenchmark(
        coRaw as Record<string, number | string | null>,
      );
      const coPayload = buildPersistPayload(coRaw, newClient.id, coBenchmark, employees);
      const { error: coErr } = await supabase
        .from("client_self_disclosures")
        .upsert(coPayload as never, { onConflict: "client_id" });
      if (coErr) throw coErr;

      // 4) Kinder auch dem Mitantragsteller hinzufügen (gemeinsame Kinder).
      if (importedChildren.length > 0) {
        const childRows = importedChildren.map((c, idx) => ({
          client_id: newClient.id,
          full_name: c.full_name,
          birth_date: c.birth_date ?? null,
          is_shared_child: true,
          sort_order: idx,
        }));
        const { error: cErr } = await supabase
          .from("client_children")
          .insert(childRows);
        if (cErr) console.warn("could not insert co-applicant children", cErr);
        else qc.invalidateQueries({ queryKey: ["client_children", newClient.id] });
      }

      toast.success(`Mitantragsteller «${fullName}» angelegt und verknüpft.`);
      qc.invalidateQueries({ queryKey: ["clients"] });
      qc.invalidateQueries({ queryKey: ["client_relationships", clientId] });
      setCoApplicantPrompt(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Mitantragsteller konnte nicht angelegt werden");
      setCoApplicantPrompt((prev) => (prev ? { ...prev, creating: false } : prev));
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-hidden p-0">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] max-h-[92vh]">
          {/* Main */}
          <div className="flex flex-col overflow-hidden">
            <DialogHeader className="border-b p-6">
              <DialogTitle className="font-display text-2xl">
                Selbstauskunft – Schritt {step} von {STEPS.length}
              </DialogTitle>
              <DialogDescription>{STEPS[step - 1].description}</DialogDescription>
              <Stepper current={step} onJump={setStep} />
            </DialogHeader>

            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* PDF Upload only on Step 1 */}
              {step === 1 && (
                <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/5 p-5">
                  <div className="flex items-start gap-4">
                    <div className="rounded-lg bg-primary/10 p-2.5">
                      <Sparkles className="h-5 w-5 text-primary" />
                    </div>
                    <div className="flex-1">
                      <h4 className="font-semibold">
                        Bestehende Selbstauskunft hochladen
                      </h4>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        ASIMO-PDF hochladen – die KI erkennt Felder und befüllt
                        das Formular automatisch. Checkliste wird ignoriert.
                      </p>
                      <div className="mt-3 flex items-center gap-2">
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="application/pdf"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handlePdfUpload(f);
                          }}
                        />
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={parsing}
                        >
                          {parsing ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Upload className="mr-2 h-4 w-4" />
                          )}
                          PDF auswählen
                        </Button>
                        <span className="text-xs text-muted-foreground">
                          oder Felder unten manuell ausfüllen
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {step === 1 && <PersonStep form={form} set={set} />}
              {step === 2 && <JobStep form={form} set={set} />}
              {step === 3 && <IncomeStep form={form} set={set} />}
              {step === 4 && <ExpenseStep form={form} set={set} />}
              {step === 5 && <ClosingStep form={form} set={set} employees={employees} />}
            </div>

            <div className="flex items-center justify-between border-t p-4 bg-muted/30">
              <div className="text-xs text-muted-foreground">
                {autosaveState === "saving" && "Speichert automatisch…"}
                {autosaveState === "saved" && lastSavedAt && `Automatisch gespeichert · ${new Date(lastSavedAt).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" })}`}
                {autosaveState === "offline" && "Offline – Änderungen werden lokal gesichert und später synchronisiert."}
                {autosaveState === "error" && "Automatisches Speichern pausiert – bitte manuell speichern."}
                {autosaveState === "idle" && pendingSync && "Änderungen stehen zur Synchronisierung bereit."}
              </div>
              <Button
                variant="ghost"
                onClick={() => setStep((s) => Math.max(1, s - 1))}
                disabled={step === 1}
              >
                <ChevronLeft className="mr-1 h-4 w-4" />
                Zurück
              </Button>
              {!isLast ? (
                <Button onClick={() => setStep((s) => Math.min(STEPS.length, s + 1))}>
                  Weiter
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              ) : (
                <Button onClick={() => save.mutate()} disabled={save.isPending || parsing}>
                  {save.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Selbstauskunft speichern
                </Button>
              )}
            </div>
          </div>

          {/* Live Benchmark Sidebar */}
          <div className="hidden lg:flex flex-col border-l bg-muted/20 p-5 overflow-y-auto">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              Live Finanz-Benchmark
            </div>
            <BenchmarkCard benchmark={benchmark} />
            <p className="mt-4 text-xs text-muted-foreground">
              Aktualisiert sich live, sobald Einnahmen oder Ausgaben geändert
              werden. Wird beim Speichern dauerhaft hinterlegt.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
    <AlertDialog
      open={!!coApplicantPrompt}
      onOpenChange={(o) => {
        if (!o && !coApplicantPrompt?.creating) setCoApplicantPrompt(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Mitantragsteller erkannt</AlertDialogTitle>
          <AlertDialogDescription>
            Im hochgeladenen PDF wurde ein zweiter Antragsteller gefunden
            {coApplicantPrompt?.fields
              ? ` (${[coApplicantPrompt.fields.first_name, coApplicantPrompt.fields.last_name]
                  .filter(Boolean)
                  .join(" ") || "ohne Namen"})`
              : ""}
            . Soll dafür ein eigener Kunde angelegt und als
            {" "}Mitantragsteller verknüpft werden? Die Selbstauskunft des
            Mitantragstellers wird dabei automatisch übernommen.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={coApplicantPrompt?.creating}>
            Nein, ignorieren
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              void createCoApplicantClient();
            }}
            disabled={coApplicantPrompt?.creating}
          >
            {coApplicantPrompt?.creating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Anlegen…
              </>
            ) : (
              "Ja, anlegen"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}

function Stepper({
  current,
  onJump,
}: {
  current: number;
  onJump: (n: number) => void;
}) {
  return (
    <div className="mt-4 flex items-center gap-1.5">
      {STEPS.map((s) => {
        const done = s.id < current;
        const active = s.id === current;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onJump(s.id)}
            className={cn(
              "group flex flex-1 flex-col items-start gap-1 rounded-md px-2 py-1.5 text-left transition",
              "hover:bg-muted",
            )}
          >
            <div className="flex w-full items-center gap-2">
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold",
                  done && "bg-primary text-primary-foreground",
                  active && "bg-primary text-primary-foreground ring-2 ring-primary/30",
                  !done && !active && "bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="h-3 w-3" /> : s.id}
              </span>
              <span
                className={cn(
                  "h-0.5 flex-1 rounded",
                  done ? "bg-primary" : "bg-muted",
                )}
              />
            </div>
            <span
              className={cn(
                "text-[11px] font-medium",
                active ? "text-foreground" : "text-muted-foreground",
              )}
            >
              {s.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/* ---------- Steps ---------- */

function PersonStep({
  form,
  set,
}: {
  form: DisclosureRow;
  set: (k: string, v: unknown) => void;
}) {
  const fields: { key: string; label: string; type?: string }[] = [
    { key: "first_name", label: "Vorname" },
    { key: "last_name", label: "Name" },
    { key: "birth_name", label: "Ledigname" },
    { key: "street", label: "Strasse" },
    { key: "street_number", label: "Nr." },
    { key: "postal_code", label: "PLZ" },
    { key: "city", label: "Ort" },
    { key: "country", label: "Land" },
    { key: "resident_since", label: "Wohnhaft seit", type: "date" },
    { key: "phone", label: "Telefon" },
    { key: "mobile", label: "Mobil" },
    { key: "email", label: "E-Mail", type: "email" },
    { key: "birth_date", label: "Geburtsdatum", type: "date" },
    { key: "nationality", label: "Staatsbürgerschaft" },
    { key: "birth_place", label: "Geburtsort" },
    { key: "birth_country", label: "Geburtsland" },
    { key: "tax_id_ch", label: "Steuer-ID-Nr. CH" },
  ];
  return (
    <Grid>
      <FieldBox label="Anrede">
        <Select
          value={(form.salutation as string) ?? ""}
          onValueChange={(v) => set("salutation", v)}
        >
          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            {salutationOptions.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldBox>
      <FieldBox label="Titel">
        <Input
          value={(form.title as string) ?? ""}
          onChange={(e) => set("title", e.target.value)}
        />
      </FieldBox>
      <FieldBox label="Familienstand">
        <Select
          value={(form.marital_status as string) ?? ""}
          onValueChange={(v) => set("marital_status", v)}
        >
          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            {maritalStatusOptions.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldBox>
      {fields.map((f) => (
        <FieldBox key={f.key} label={f.label}>
          <Input
            type={f.type ?? "text"}
            value={(form[f.key] as string) ?? ""}
            onChange={(e) => set(f.key, e.target.value)}
          />
        </FieldBox>
      ))}
    </Grid>
  );
}

function JobStep({
  form,
  set,
}: {
  form: DisclosureRow;
  set: (k: string, v: unknown) => void;
}) {
  return (
    <Grid>
      <FieldBox label="Status">
        <Select
          value={(form.employment_status as string) ?? ""}
          onValueChange={(v) => set("employment_status", v)}
        >
          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            {employmentStatusOptions.map((o) => (
              <SelectItem key={o} value={o}>{o}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FieldBox>
      <FieldBox label="Arbeitgeber">
        <Input value={(form.employer_name as string) ?? ""} onChange={(e) => set("employer_name", e.target.value)} />
      </FieldBox>
      <FieldBox label="Adresse Arbeitgeber">
        <Input value={(form.employer_address as string) ?? ""} onChange={(e) => set("employer_address", e.target.value)} />
      </FieldBox>
      <FieldBox label="Telefon Arbeitgeber">
        <Input value={(form.employer_phone as string) ?? ""} onChange={(e) => set("employer_phone", e.target.value)} />
      </FieldBox>
      <FieldBox label="Beschäftigt als">
        <Input value={(form.employed_as as string) ?? ""} onChange={(e) => set("employed_as", e.target.value)} />
      </FieldBox>
      <FieldBox label="Beschäftigt seit">
        <Input
          type="date"
          value={(form.employed_since as string) ?? ""}
          onChange={(e) => set("employed_since", e.target.value)}
        />
      </FieldBox>
      <FieldBox label="Gehaltstyp">
        <Select
          value={(form.salary_type as string) ?? ""}
          onValueChange={(v) => set("salary_type", v)}
        >
          <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="Fixum">Fixum</SelectItem>
            <SelectItem value="Provision">Provision</SelectItem>
            <SelectItem value="Fixum + Provision">Fixum + Provision</SelectItem>
          </SelectContent>
        </Select>
      </FieldBox>
      <FieldBox label="Jahresgehalt netto (Lohnausweis)">
        <CHFInput
          value={form.annual_net_salary as number | null}
          onChange={(n) => set("annual_net_salary", n)}
        />
      </FieldBox>
    </Grid>
  );
}

function IncomeStep({
  form,
  set,
}: {
  form: DisclosureRow;
  set: (k: string, v: unknown) => void;
}) {
  return (
    <Grid>
      {incomeFields.map((f: IncomeField) => (
        <FieldBox key={f} label={incomeLabels[f]}>
          <CHFInput
            value={form[f] as number | null}
            onChange={(n) => set(f, n)}
          />
        </FieldBox>
      ))}
    </Grid>
  );
}

function ExpenseStep({
  form,
  set,
}: {
  form: DisclosureRow;
  set: (k: string, v: unknown) => void;
}) {
  return (
    <Grid>
      {expenseFields.map((f: ExpenseField) => (
        <FieldBox key={f} label={expenseLabels[f]}>
          <CHFInput
            value={form[f] as number | null}
            onChange={(n) => set(f, n)}
          />
        </FieldBox>
      ))}
    </Grid>
  );
}

function ClosingStep({
  form,
  set,
  employees,
}: {
  form: DisclosureRow;
  set: (k: string, v: unknown) => void;
  employees: EmployeeOption[];
}) {
  return (
    <div className="space-y-4">
      <Grid>
        <FieldBox label="Berater">
          <Select
            value={((form.advisor_id as string) ?? "") || "unassigned"}
            onValueChange={(value) => set("advisor_id", value === "unassigned" ? null : value)}
          >
            <SelectTrigger>
              <SelectValue placeholder="Berater auswählen" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unassigned">Kein Berater</SelectItem>
              {employees.map((employee) => (
                <SelectItem key={employee.id} value={employee.id}>
                  {employee.full_name || employee.email || "Ohne Name"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FieldBox>
        <FieldBox label="Datum">
          <Input
            type="date"
            value={(form.disclosure_date as string) ?? ""}
            onChange={(e) => set("disclosure_date", e.target.value)}
          />
        </FieldBox>
        <FieldBox label="Ort">
          <Input
            value={(form.disclosure_place as string) ?? ""}
            onChange={(e) => set("disclosure_place", e.target.value)}
          />
        </FieldBox>
      </Grid>
      <div>
        <Label className="mb-1 block text-xs text-muted-foreground">
          Interne Notizen
        </Label>
        <Textarea
          rows={4}
          value={(form.internal_notes as string) ?? ""}
          onChange={(e) => set("internal_notes", e.target.value)}
        />
      </div>
    </div>
  );
}

/* ---------- Helpers ---------- */

function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2">{children}</div>;
}

function FieldBox({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <Label className="mb-1 block text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function CHFInput({
  value,
  onChange,
}: {
  value: number | null | undefined;
  onChange: (n: number | null) => void;
}) {
  return (
    <Input
      type="number"
      inputMode="decimal"
      step="0.01"
      placeholder="0"
      value={value === null || value === undefined ? "" : String(value)}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "") onChange(null);
        else {
          const n = Number(v);
          onChange(Number.isFinite(n) ? n : null);
        }
      }}
    />
  );
}
