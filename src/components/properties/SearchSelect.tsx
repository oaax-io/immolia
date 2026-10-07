import { useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { cn } from "@/lib/utils";

export type SearchOption = { value: string; label: string; hint?: string; dotClass?: string };

/** Durchsuchbares Dropdown mit optionalem «+ Neu erfassen». */
export function SearchSelect({
  value, onChange, options, placeholder = "Auswählen…", searchPlaceholder = "Suchen…",
  emptyLabel = "Keine Treffer", noneLabel, onCreate, createLabel = "Neu erfassen", searchable = true,
}: {
  value: string | null;
  onChange: (v: string | null) => void;
  options: SearchOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  noneLabel?: string;
  onCreate?: (query: string) => void;
  createLabel?: string;
  searchable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const current = options.find((o) => o.value === value);
  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQ(""); }}>
      <PopoverTrigger asChild>
        <button type="button" role="combobox" aria-expanded={open}
          className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span className={cn("flex min-w-0 items-center gap-2", !current && "text-muted-foreground")}>
            {current?.dotClass && <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", current.dotClass)} />}
            <span className="truncate">{current?.label ?? (value === null && noneLabel ? noneLabel : placeholder)}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] min-w-64 p-0" align="start">
        <Command>
          {searchable && <CommandInput placeholder={searchPlaceholder} value={q} onValueChange={setQ} />}
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            {onCreate && (
              <CommandGroup>
                <CommandItem value={`__create__ ${q}`} onSelect={() => { setOpen(false); onCreate(q); }} className="font-medium text-primary">
                  <Plus className="mr-2 h-4 w-4" />{q ? `«${q}» ${createLabel.toLowerCase()}` : createLabel}
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {noneLabel && (
                <CommandItem value={`__none__ ${noneLabel}`} onSelect={() => { onChange(null); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === null ? "opacity-100" : "opacity-0")} />
                  <span className="text-muted-foreground">{noneLabel}</span>
                </CommandItem>
              )}
              {options.map((o) => (
                <CommandItem key={o.value} value={`${o.label} ${o.hint ?? ""} ${o.value}`} onSelect={() => { onChange(o.value); setOpen(false); }}>
                  <Check className={cn("mr-2 h-4 w-4", value === o.value ? "opacity-100" : "opacity-0")} />
                  {o.dotClass && <span className={cn("mr-2 h-2.5 w-2.5 shrink-0 rounded-full", o.dotClass)} />}
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.hint && <span className="ml-2 truncate text-xs text-muted-foreground">{o.hint}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
