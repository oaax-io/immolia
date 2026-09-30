import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";

/**
 * Sortierung mit lokalem Entwurf: speichert erst bei Verlassen des Feldes oder Enter,
 * nie pro Tastendruck. Leere/ungültige Eingaben werden verworfen (kein Speichern als 0).
 */
export function SortOrderInput({
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
      }}
    />
  );
}
