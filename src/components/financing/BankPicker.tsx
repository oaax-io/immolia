import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { PartnerLogo } from "@/components/partners/PartnerLogo";
import { usePartnerCatalog, usePartnerContacts, partnerDisplayName, type PlatformPartner, type AgencyPartnerContact } from "@/lib/partners";
import { Building2, Mail, Phone, Search, Star, RefreshCw, Check } from "lucide-react";

export type BankSelection = {
  bank_name: string;
  bank_contact: string;
  bank_email: string;
  bank_phone: string;
  logo_url?: string | null;
  branch_name?: string | null;
  role_title?: string | null;
};

/** Meistgenutzte Schweizer Banken – Reihenfolge der Schnellwahl-Kacheln. */
const QUICK_BANKS = ["UBS", "Raiffeisen", "Zürcher Kantonalbank", "PostFinance", "Valiant"];

function matchQuick(catalog: PlatformPartner[]) {
  return QUICK_BANKS.map((q) =>
    catalog.find((p) => p.name.toLowerCase().startsWith(q.toLowerCase())),
  ).filter(Boolean) as PlatformPartner[];
}

/**
 * Bankauswahl im Finanzierungsdossier.
 * Eigene hinterlegte Bankberater zuerst, danach Schnellwahl und Suche im
 * zentralen Katalog. Die Auswahl füllt die Felder nur vor – änderbar bleiben sie.
 */
export function BankPicker({
  currentName,
  currentContact,
  currentEmail,
  currentPhone,
  onSelect,
  showContact = true,
}: {
  currentName: string;
  currentContact: string;
  currentEmail: string;
  currentPhone: string;
  onSelect: (sel: BankSelection) => void;
  showContact?: boolean;
}) {
  const catalogQ = usePartnerCatalog("bank");
  const contactsQ = usePartnerContacts("bank");
  const catalog = useMemo(() => catalogQ.data ?? [], [catalogQ.data]);
  const contacts = useMemo(() => (showContact ? contactsQ.data ?? [] : []), [contactsQ.data, showContact]);
  const [open, setOpen] = useState(false);
  const [changing, setChanging] = useState(false);

  const quick = useMemo(() => matchQuick(catalog), [catalog]);
  const logoFor = (name: string) =>
    catalog.find((p) => p.name.toLowerCase() === name.trim().toLowerCase())?.logo_url ?? null;

  const pickContact = (c: AgencyPartnerContact) => {
    onSelect({
      bank_name: partnerDisplayName(c, catalog),
      bank_contact: c.contact_name ?? "",
      bank_email: c.email ?? "",
      bank_phone: c.phone ?? "",
      logo_url: catalog.find((p) => p.id === c.platform_partner_id)?.logo_url ?? null,
      branch_name: c.branch_name,
      role_title: c.role_title,
    });
    setChanging(false);
    setOpen(false);
  };

  const pickPartner = (p: PlatformPartner) => {
    onSelect({ bank_name: p.name, bank_contact: "", bank_email: "", bank_phone: "", logo_url: p.logo_url });
    setChanging(false);
    setOpen(false);
  };

  // Ausgewählte Bank als Visitenkarte
  if (currentName && !changing) {
    return (
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="flex items-start gap-3">
          <PartnerLogo name={currentName} url={logoFor(currentName)} size={48} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{currentName}</div>
            {showContact && (
              <div className="text-sm text-muted-foreground">
                {currentContact || "Keine Kontaktperson hinterlegt"}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-2">
              {showContact && currentEmail && (
                <Button asChild size="sm" variant="outline">
                  <a href={`mailto:${currentEmail}`}><Mail className="mr-1.5 h-4 w-4" />E-Mail senden</a>
                </Button>
              )}
              {showContact && currentPhone && (
                <Button asChild size="sm" variant="outline">
                  <a href={`tel:${currentPhone.replace(/\s/g, "")}`}><Phone className="mr-1.5 h-4 w-4" />Anrufen</a>
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setChanging(true)}>
                <RefreshCw className="mr-1.5 h-4 w-4" />Bank wechseln
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {contacts.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Eigene Bankberater</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {contacts.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pickContact(c)}
                className="flex items-center gap-2 rounded-md border p-2 text-left transition-colors hover:border-primary hover:bg-accent"
              >
                <PartnerLogo name={partnerDisplayName(c, catalog)} url={catalog.find((p) => p.id === c.platform_partner_id)?.logo_url} size={32} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 truncate text-sm font-medium">
                    {partnerDisplayName(c, catalog)}
                    {c.is_favorite && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {[c.contact_name, c.branch_name].filter(Boolean).join(" · ") || "Ohne Kontaktperson"}
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {quick.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">Häufig genutzt</div>
          <div className="flex flex-wrap gap-2">
            {quick.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => pickPartner(p)}
                className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:border-primary hover:bg-accent"
              >
                <PartnerLogo name={p.name} url={p.logo_url} size={24} />
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" className="w-full justify-start sm:w-80">
              <Search className="mr-2 h-4 w-4" />Bank suchen …
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-[22rem] p-0">
            <Command>
              <CommandInput placeholder="Bank oder Berater suchen …" />
              <CommandList>
                <CommandEmpty>Keine Bank gefunden.</CommandEmpty>
                {contacts.length > 0 && (
                  <CommandGroup heading="Eigene Ansprechpartner">
                    {contacts.map((c) => (
                      <CommandItem
                        key={c.id}
                        value={`${partnerDisplayName(c, catalog)} ${c.contact_name ?? ""} ${c.branch_name ?? ""}`}
                        onSelect={() => pickContact(c)}
                      >
                        <Check className="mr-2 h-4 w-4 opacity-0" />
                        {partnerDisplayName(c, catalog)}
                        {c.contact_name ? ` · ${c.contact_name}` : ""}
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
                <CommandGroup heading="Zentrale Banken">
                  {catalog.map((p) => (
                    <CommandItem key={p.id} value={`${p.name} ${p.legal_name ?? ""}`} onSelect={() => pickPartner(p)}>
                      <PartnerLogo name={p.name} url={p.logo_url} size={20} className="mr-2" />
                      {p.name}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {changing && (
          <Button variant="ghost" size="sm" onClick={() => setChanging(false)}>Abbrechen</Button>
        )}
      </div>

      {catalog.length === 0 && !catalogQ.isLoading && (
        <Badge variant="secondary" className="gap-1">
          <Building2 className="h-3 w-3" />Noch keine zentralen Banken erfasst
        </Badge>
      )}
    </div>
  );
}
