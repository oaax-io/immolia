import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Mail, Phone, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { supabase } from "@/integrations/supabase/client";

export const PIPELINE_STAGES = [
  { value: "expose_sent", label: "Exposé verschickt", dot: "bg-sky-500" },
  { value: "viewed", label: "Besichtigt", dot: "bg-indigo-500" },
  { value: "self_disclosure", label: "Selbstauskunft", dot: "bg-amber-500" },
  { value: "financing", label: "Finanzierung", dot: "bg-orange-500" },
  { value: "notary", label: "Notartermin", dot: "bg-violet-500" },
  { value: "sold", label: "Verkauft", dot: "bg-emerald-500" },
] as const;

const NONE = "__none__";

/** Gespeicherte Phase, sonst automatisch aus Status bzw. Selbstauskunft abgeleitet. */
export function effectiveStage(c: any, disclosureIds: Set<string>): string {
  if (c.pipeline_stage) return c.pipeline_stage;
  if (c.status === "abgeschlossen") return "sold";
  if (c.status === "finanzierung") return "financing";
  if (disclosureIds.has(c.id)) return "self_disclosure";
  return NONE;
}

export function ClientKanban({ clients, disclosureIds, onOpen }: { clients: any[]; disclosureIds: Set<string>; onOpen: (id: string) => void }) {
  const qc = useQueryClient();
  const [over, setOver] = useState<string | null>(null);
  const columns = PIPELINE_STAGES;
  const [addOpen, setAddOpen] = useState<string | null>(null);

  const move = async (id: string, stage: string) => {
    const next = stage === NONE ? null : stage;
    const current = clients.find((c) => c.id === id);
    if (!current || current.pipeline_stage === next) return;
    qc.setQueryData(["clients"], (old: any) =>
      Array.isArray(old) ? old.map((c) => (c.id === id ? { ...c, pipeline_stage: next } : c)) : old,
    );
    const { data, error } = await supabase.from("clients").update({ pipeline_stage: next } as any).eq("id", id).select("id");
    if (error || !data?.length) {
      toast.error("Phase konnte nicht gespeichert werden");
    }
    qc.invalidateQueries({ queryKey: ["clients"] });
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {columns.map((col) => {
        const items = clients.filter((c) => effectiveStage(c, disclosureIds) === col.value);
        return (
          <div
            key={col.value}
            onDragOver={(e) => { e.preventDefault(); setOver(col.value); }}
            onDragLeave={() => setOver((o) => (o === col.value ? null : o))}
            onDrop={(e) => { e.preventDefault(); setOver(null); const id = e.dataTransfer.getData("text/plain"); if (id) move(id, col.value); }}
            className={`flex w-64 shrink-0 flex-col rounded-xl border bg-muted/30 transition ${over === col.value ? "ring-2 ring-primary" : ""}`}
          >
            <div className="flex items-center justify-between border-b px-3 py-2">
              <span className="flex items-center gap-2 text-sm font-semibold">
                <span className={`h-2 w-2 rounded-full ${col.dot}`} />
                {col.label}
              </span>
              <div className="flex items-center gap-1">
                <span className="rounded-full bg-background px-2 text-xs text-muted-foreground">{items.length}</span>
                <Popover open={addOpen === col.value} onOpenChange={(o) => setAddOpen(o ? col.value : null)}>
                  <PopoverTrigger asChild>
                    <button type="button" className="rounded-md p-1 text-muted-foreground hover:bg-background hover:text-foreground" aria-label="Kunde hinzufügen">
                      <Plus className="h-4 w-4" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-72 p-0" align="end">
                    <Command>
                      <CommandInput placeholder="Kunde suchen…" />
                      <CommandList>
                        <CommandEmpty>Keine Kunden gefunden</CommandEmpty>
                        {clients.filter((c) => effectiveStage(c, disclosureIds) !== col.value).map((c) => (
                          <CommandItem key={c.id} value={`${c.full_name ?? ""} ${c.email ?? ""} ${c.id}`} onSelect={() => { setAddOpen(null); move(c.id, col.value); }}>
                            <span className="truncate">{c.full_name}</span>
                          </CommandItem>
                        ))}
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="flex max-h-[70vh] min-h-24 flex-col gap-2 overflow-y-auto p-2">
              {items.map((c) => (
                <div
                  key={c.id}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData("text/plain", c.id)}
                  onClick={() => onOpen(c.id)}
                  className="cursor-grab rounded-lg border bg-card p-3 text-sm shadow-sm transition hover:border-primary active:cursor-grabbing"
                >
                  <p className="truncate font-medium">{c.full_name}</p>
                  {c.email && <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground"><Mail className="h-3 w-3" />{c.email}</p>}
                  {c.phone && <p className="flex items-center gap-1.5 truncate text-xs text-muted-foreground"><Phone className="h-3 w-3" />{c.phone}</p>}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
