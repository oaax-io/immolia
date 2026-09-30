import { useState } from "react";
import { SortOrderInput } from "./SortOrderInput";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/EmptyState";

type MasterValue = {
  id: string;
  list_key: string;
  value: string;
  label_de: string;
  sort_order: number;
  is_active: boolean;
};

export function MasterListManager({
  listKey,
  description,
  canEdit,
}: {
  listKey: string;
  description?: string;
  canEdit: boolean;
}) {
  const qc = useQueryClient();
  const queryKey = ["master_list_values", listKey];
  const [newLabel, setNewLabel] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("master_list_values")
        .select("id,list_key,value,label_de,sort_order,is_active")
        .eq("list_key", listKey)
        .order("sort_order")
        .order("label_de");
      if (error) throw error;
      return (data ?? []) as MasterValue[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey });

  const create = useMutation({
    mutationFn: async () => {
      const label = newLabel.trim();
      if (!label) throw new Error("Bitte einen Namen eingeben");
      const nextSort = (rows.at(-1)?.sort_order ?? 0) + 10;
      const { error } = await supabase
        .from("master_list_values")
        .insert([{ list_key: listKey, value: label, label_de: label, sort_order: nextSort }]);
      if (error) throw error;
    },
    onSuccess: () => {
      setNewLabel("");
      toast.success("Eintrag hinzugefügt");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<MasterValue> }) => {
      const { error } = await supabase.from("master_list_values").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("master_list_values").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Eintrag gelöscht");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Wird geladen…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {description && <p className="text-sm text-muted-foreground">{description}</p>}

      {rows.length === 0 ? (
        <EmptyState title="Noch keine Einträge" description="Lege den ersten Wert für diese Liste an." />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-1 items-center gap-2 rounded-lg border bg-card p-3 sm:grid-cols-[1fr_5rem_auto_auto]"
            >
              <Input
                value={row.label_de}
                disabled={!canEdit}
                onChange={(e) => {
                  qc.setQueryData(queryKey, (old: MasterValue[] = []) =>
                    old.map((r) => (r.id === row.id ? { ...r, label_de: e.target.value } : r)),
                  );
                }}
                onBlur={(e) => {
                  const label = e.target.value.trim();
                  if (label) update.mutate({ id: row.id, patch: { label_de: label } });
                  else invalidate();
                }}
              />
              <SortOrderInput
                value={row.sort_order}
                disabled={!canEdit}
                onCommit={(v) => update.mutate({ id: row.id, patch: { sort_order: v } })}
              />
              <div className="flex items-center gap-2">
                <Switch
                  checked={row.is_active}
                  disabled={!canEdit}
                  onCheckedChange={(v) => update.mutate({ id: row.id, patch: { is_active: v } })}
                />
                <span className="text-xs text-muted-foreground">Aktiv</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                disabled={!canEdit}
                onClick={() => remove.mutate(row.id)}
                aria-label="Eintrag löschen"
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {canEdit && (
        <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label>Neuer Eintrag</Label>
            <Input
              value={newLabel}
              placeholder="Bezeichnung"
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") create.mutate();
              }}
            />
          </div>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !newLabel.trim()}>
            <Plus className="mr-1 h-4 w-4" /> Hinzufügen
          </Button>
        </div>
      )}
    </div>
  );
}
