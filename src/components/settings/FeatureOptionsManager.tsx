import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/EmptyState";

type FeatureOption = {
  id: string;
  key: string;
  label_de: string;
  category: string | null;
  sort_order: number;
  is_active: boolean;
};

const slugify = (v: string) =>
  v
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

export function FeatureOptionsManager({ canEdit }: { canEdit: boolean }) {
  const qc = useQueryClient();
  const queryKey = ["property_feature_options"];
  const [newLabel, setNewLabel] = useState("");
  const [newCategory, setNewCategory] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("property_feature_options")
        .select("id,key,label_de,category,sort_order,is_active")
        .order("sort_order")
        .order("label_de");
      if (error) throw error;
      return (data ?? []) as FeatureOption[];
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey });

  const create = useMutation({
    mutationFn: async () => {
      const label = newLabel.trim();
      if (!label) throw new Error("Bitte einen Namen eingeben");
      const key = slugify(label);
      if (!key) throw new Error("Bezeichnung enthält keine gültigen Zeichen");
      const nextSort = (rows.at(-1)?.sort_order ?? 0) + 10;
      const { error } = await supabase.from("property_feature_options").insert([
        {
          key,
          label_de: label,
          category: newCategory.trim() || null,
          sort_order: nextSort,
        },
      ]);
      if (error) throw error;
    },
    onSuccess: () => {
      setNewLabel("");
      setNewCategory("");
      toast.success("Eigenschaft hinzugefügt");
      invalidate();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: Partial<FeatureOption> }) => {
      const { error } = await supabase.from("property_feature_options").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e: any) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("property_feature_options").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Eigenschaft gelöscht");
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
      <p className="text-sm text-muted-foreground">
        Diese Eigenschaften stehen später bei der Objekterfassung zur Auswahl.
      </p>

      {rows.length === 0 ? (
        <EmptyState title="Noch keine Eigenschaften" description="Lege die erste Eigenschaft an." />
      ) : (
        <div className="space-y-2">
          {rows.map((row) => (
            <div
              key={row.id}
              className="grid grid-cols-1 items-center gap-2 rounded-lg border bg-card p-3 sm:grid-cols-[1fr_1fr_5rem_auto_auto]"
            >
              <Input
                value={row.label_de}
                disabled={!canEdit}
                onChange={(e) =>
                  qc.setQueryData(queryKey, (old: FeatureOption[] = []) =>
                    old.map((r) => (r.id === row.id ? { ...r, label_de: e.target.value } : r)),
                  )
                }
                onBlur={(e) => {
                  const label = e.target.value.trim();
                  if (label) update.mutate({ id: row.id, patch: { label_de: label } });
                  else invalidate();
                }}
              />
              <Input
                value={row.category ?? ""}
                placeholder="Kategorie (optional)"
                disabled={!canEdit}
                onChange={(e) =>
                  qc.setQueryData(queryKey, (old: FeatureOption[] = []) =>
                    old.map((r) => (r.id === row.id ? { ...r, category: e.target.value } : r)),
                  )
                }
                onBlur={(e) =>
                  update.mutate({ id: row.id, patch: { category: e.target.value.trim() || null } })
                }
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
                aria-label="Eigenschaft löschen"
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
            <Label>Neue Eigenschaft</Label>
            <Input value={newLabel} placeholder="z. B. Seesicht" onChange={(e) => setNewLabel(e.target.value)} />
          </div>
          <div className="flex-1 space-y-1.5">
            <Label>Kategorie (optional)</Label>
            <Input value={newCategory} placeholder="z. B. Lage" onChange={(e) => setNewCategory(e.target.value)} />
          </div>
          <Button onClick={() => create.mutate()} disabled={create.isPending || !newLabel.trim()}>
            <Plus className="mr-1 h-4 w-4" /> Hinzufügen
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Sortierung mit lokalem Entwurf: speichert erst bei Verlassen des Feldes oder Enter,
 * nie pro Tastendruck. Leere/ungültige Eingaben werden verworfen (kein Speichern als 0).
 */
function SortOrderInput({
  value,
  disabled,
  onCommit,
}: {
  value: number;
  disabled?: boolean;
  onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(String(value));
  }, [value, editing]);
  const commit = () => {
    setEditing(false);
    const t = draft.trim();
    const n = Number(t);
    if (t === "" || !Number.isFinite(n) || !Number.isInteger(n)) {
      setDraft(String(value));
      return;
    }
    if (n !== value) onCommit(n);
  };
  return (
    <Input
      type="number"
      step={1}
      value={draft}
      disabled={disabled}
      onFocus={() => setEditing(true)}
      onChange={(e) => {
        setEditing(true);
        setDraft(e.target.value);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(String(value));
          setEditing(false);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}
