import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useChecklistAutofill } from "@/hooks/useChecklistAutofill";
import { ChecklistReadinessCard } from "@/components/financing/ChecklistReadinessCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { CheckCircle2, AlertTriangle, MinusCircle, Circle, Sparkles, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  CHECKLIST_TEMPLATE, SECTION_LABELS, SECTION_ORDER, STATUS_LABELS,
  buildDefaultChecklist, checklistStats,
  type ChecklistRow, type ChecklistItemStatus, type ChecklistSection,
} from "@/lib/financing-checklist";

type Props = { dossierId: string };

export function UbsChecklistTab({ dossierId }: Props) {
  const qc = useQueryClient();
  const [openSections, setOpenSections] = useState<string[]>(SECTION_ORDER.slice(0, 3));

  const { rows, stats, missing, missingRequired, isReady, isLoading } = useChecklistAutofill(dossierId);

  const seedMutation = useMutation({
    mutationFn: async () => {
      const seed = buildDefaultChecklist(dossierId);
      const { error } = await supabase.from("financing_checklist_items").insert(seed as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["financing_checklist", dossierId] });
      toast.success("Checkliste initialisiert");
    },
    onError: (e: any) => toast.error(e.message ?? "Fehler"),
  });

  // Auto-seed beim ersten Öffnen
  useEffect(() => {
    if (!isLoading && rows.length === 0 && !seedMutation.isPending) {
      seedMutation.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading, rows.length]);

  const updateMutation = useMutation({
    mutationFn: async (input: { id: string; patch: Partial<ChecklistRow> }) => {
      const { error } = await supabase
        .from("financing_checklist_items")
        .update(input.patch as any)
        .eq("id", input.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["financing_checklist", dossierId] }),
    onError: (e: any) => toast.error(e.message ?? "Fehler"),
  });

  const resetManual = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("financing_checklist_items")
        .update({ manual_override: false } as any)
        .eq("dossier_id", dossierId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["financing_checklist", dossierId] });
      toast.success("Automatische Prüfung übernimmt wieder alle Punkte");
    },
    onError: (e: any) => toast.error(e.message ?? "Fehler"),
  });

  const grouped = useMemo(() => {
    const map = new Map<ChecklistSection, ChecklistRow[]>();
    SECTION_ORDER.forEach((s) => map.set(s, []));
    rows.forEach((r) => map.get(r.section)?.push(r));
    return map;
  }, [rows]);

  const missingOptional = missing.filter((m) => !m.required);

  if (isLoading) return <p className="text-sm text-muted-foreground">Laden…</p>;

  return (
    <div className="space-y-4">
      <ChecklistReadinessCard
        isReady={isReady}
        requiredPercent={stats.requiredPercent}
        requiredPresent={stats.requiredPresent}
        requiredTotal={stats.requiredTotal}
        missingRequired={missingRequired}
        missingOptional={missingOptional}
        onJump={(section) => setOpenSections((prev) => (prev.includes(section) ? prev : [...prev, section]))}
      />

      <Card>
        <CardContent className="p-4 grid gap-3 sm:grid-cols-4">
          <Stat label="Vollständigkeit" value={`${stats.completionPercent}%`} hint={`${stats.present} von ${stats.total}`} />
          <Stat label="Pflichtdokumente" value={`${stats.requiredPercent}%`} hint={`${stats.requiredPresent} von ${stats.requiredTotal}`} />
          <Stat label="Fehlend" value={String(stats.missing)} hint="noch nicht vorhanden" />
          <div className="flex items-end">
            <Button variant="outline" size="sm" onClick={() => resetManual.mutate()} disabled={resetManual.isPending}>
              <RotateCcw className="mr-2 h-4 w-4" />Automatik neu anwenden
            </Button>
          </div>
        </CardContent>
      </Card>

      {rows.length === 0 && (
        <Button onClick={() => seedMutation.mutate()} disabled={seedMutation.isPending}>
          <Sparkles className="mr-2 h-4 w-4" />Checkliste initialisieren
        </Button>
      )}

      <Accordion type="multiple" value={openSections} onValueChange={setOpenSections} className="space-y-2">
        {SECTION_ORDER.map((section) => {
          const list = grouped.get(section) ?? [];
          const presentCount = list.filter((r) => r.is_present || r.status === "present").length;
          return (
            <AccordionItem key={section} value={section} className="rounded-lg border bg-card px-3">
              <AccordionTrigger className="hover:no-underline">
                <div className="flex items-center gap-3">
                  <span className="font-medium">{SECTION_LABELS[section]}</span>
                  <Badge variant="secondary">{presentCount} / {list.length}</Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent>
                <div className="space-y-2">
                  {list.map((r) => (
                    <ItemRow
                      key={r.id}
                      row={r}
                      onChange={(patch) => updateMutation.mutate({ id: r.id!, patch: { ...patch, manual_override: true } as any })}
                    />
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}

function ItemRow({ row, onChange }: { row: ChecklistRow; onChange: (patch: Partial<ChecklistRow>) => void }) {
  const [note, setNote] = useState(row.note ?? "");
  const required = CHECKLIST_TEMPLATE[row.section].find((t) => t.key === row.item_key)?.required;
  const auto = row as any;

  return (
    <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-[24px_1fr_180px_auto]">
      <div className="pt-1">
        <Checkbox
          checked={row.is_present}
          onCheckedChange={(v) => {
            const present = v === true;
            onChange({
              is_present: present,
              status: present ? "present" : (row.status === "present" ? "open" : row.status),
            });
          }}
        />
      </div>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{row.label}</span>
          {required && <Badge variant="outline" className="text-[10px]">Pflicht</Badge>}
          {auto.manual_override
            ? <Badge variant="outline" className="text-[10px]">von Hand</Badge>
            : auto.auto_detected && <Badge variant="secondary" className="gap-1 text-[10px]"><Sparkles className="h-2.5 w-2.5" />automatisch</Badge>}
          <StatusIcon status={row.status} />
        </div>
        {auto.auto_reason && !auto.manual_override && (
          <p className="text-xs text-muted-foreground">{auto.auto_reason}</p>
        )}
        <Input
          placeholder="Bemerkung"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => { if (note !== (row.note ?? "")) onChange({ note }); }}
          className="h-8 text-xs"
        />
      </div>
      <div>
        <Select value={row.status} onValueChange={(v) => onChange({ status: v as ChecklistItemStatus })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(STATUS_LABELS) as ChecklistItemStatus[]).map((s) => (
              <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function StatusIcon({ status }: { status: ChecklistItemStatus }) {
  if (status === "present") return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  if (status === "missing") return <AlertTriangle className="h-4 w-4 text-red-600" />;
  if (status === "not_relevant") return <MinusCircle className="h-4 w-4 text-muted-foreground" />;
  return <Circle className="h-4 w-4 text-muted-foreground" />;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold">{value}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export { Textarea, checklistStats }; // placeholder export to avoid tree-shake noise
