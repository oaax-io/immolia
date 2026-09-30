/**
 * Partner-Verwaltung (zentral + firmeneigen).
 *
 * Zwei Ebenen:
 *  - platform_partners: zentraler Katalog, nur Plattform-Admins pflegen ihn
 *    (platform_* RPCs mit Audit). Alle Firmen lesen die aktiven Einträge.
 *  - agency_partner_contacts: eigene Ansprechpartner je Firma, streng über
 *    RLS an die aktive Firma gebunden.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const PARTNER_CATEGORIES = [
  { key: "bank", label: "Banken" },
  { key: "insurance", label: "Versicherungen" },
  { key: "craftsman", label: "Handwerker" },
  { key: "portal", label: "Inserateplattformen" },
  { key: "notary", label: "Notariate & Recht" },
  { key: "appraiser", label: "Schätzer & Gutachter" },
  { key: "marketing", label: "Marketing & Fotografie" },
  { key: "service", label: "Dienstleister" },
  { key: "other", label: "Sonstige" },
] as const;

export type PartnerCategory = (typeof PARTNER_CATEGORIES)[number]["key"];
export const PARTNER_CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  PARTNER_CATEGORIES.map((c) => [c.key, c.label]),
);
/** Singular-Bezeichnung für Formulare und Hinweise. */
export const PARTNER_CATEGORY_SINGULAR: Record<string, string> = {
  bank: "Bank", insurance: "Versicherung", craftsman: "Handwerker", portal: "Inserateplattform",
  notary: "Notariat", appraiser: "Schätzer", marketing: "Marketing", service: "Dienstleister", other: "Partner",
};

export type PlatformPartner = {
  id: string;
  category: string;
  name: string;
  legal_name: string | null;
  website: string | null;
  logo_url: string | null;
  description: string | null;
  country: string | null;
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
  tenant_contacts?: number;
};

export type AgencyPartnerContact = {
  id: string;
  agency_id: string;
  platform_partner_id: string | null;
  custom_partner_name: string | null;
  category: string;
  branch_name: string | null;
  contact_name: string | null;
  role_title: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  notes: string | null;
  is_favorite: boolean;
  is_active: boolean;
  created_at: string;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(fn, args);
  if (error) throw error;
  return data as T;
}

// ---------- Plattform (Admin Center) ----------
export const usePlatformPartners = (category?: string) =>
  useQuery({
    queryKey: ["platform", "partners", category ?? null],
    queryFn: () => rpc<PlatformPartner[]>("platform_list_partners", { _category: category ?? null }),
  });

export type SavePartnerInput = {
  id?: string | null;
  category: string;
  name: string;
  legal_name?: string | null;
  website?: string | null;
  logo_url?: string | null;
  description?: string | null;
  country?: string | null;
  sort_order?: number;
  is_active?: boolean;
};

export const savePlatformPartner = (p: SavePartnerInput) =>
  rpc<string>("platform_save_partner", {
    _id: p.id ?? null, _category: p.category, _name: p.name, _legal_name: p.legal_name ?? null,
    _website: p.website ?? null, _logo_url: p.logo_url ?? null, _description: p.description ?? null,
    _country: p.country ?? "CH", _sort_order: p.sort_order ?? 0, _is_active: p.is_active ?? true,
  });

export const setPlatformPartnerActive = (id: string, active: boolean) =>
  rpc<boolean>("platform_set_partner_active", { _id: id, _active: active });

export const removePlatformPartner = (id: string) => rpc<void>("platform_remove_partner", { _id: id });

/**
 * Logo-Upload für den zentralen Katalog.
 * Liegt im öffentlichen Marken-Speicher unter «partner-logos/»; schreiben
 * dürfen laut Storage-Policy nur Plattform-Admins.
 */
export async function uploadPartnerLogo(file: File): Promise<string> {
  const ext = (file.name.split(".").pop() ?? "png").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `partner-logos/${crypto.randomUUID()}.${ext || "png"}`;
  const { error } = await supabase.storage.from("brand-assets").upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
    cacheControl: "31536000",
  });
  if (error) throw error;
  return supabase.storage.from("brand-assets").getPublicUrl(path).data.publicUrl;
}


// ---------- Tenant ----------
/** Zentraler Katalog, wie ihn eine Firma sieht (nur aktive Einträge, RLS). */
export function usePartnerCatalog(category?: string) {
  return useQuery({
    queryKey: ["partner-catalog", category ?? null],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      let q = supabase
        .from("platform_partners")
        .select("id, category, name, legal_name, website, logo_url, description, country, is_active, sort_order")
        .eq("is_active", true);
      if (category) q = q.eq("category", category);
      const { data, error } = await q.order("sort_order").order("name");
      if (error) throw error;
      return (data ?? []) as PlatformPartner[];
    },
  });
}

/** Eigene Ansprechpartner der aktiven Firma. */
export function usePartnerContacts(category?: string) {
  return useQuery({
    queryKey: ["partner-contacts", category ?? null],
    queryFn: async () => {
      let q = supabase.from("agency_partner_contacts").select("*");
      if (category) q = q.eq("category", category);
      const { data, error } = await q.order("is_favorite", { ascending: false }).order("created_at");
      if (error) throw error;
      return (data ?? []) as AgencyPartnerContact[];
    },
  });
}

/** Anzeigename: eigener Name oder Name des zentralen Partners. */
export function partnerDisplayName(c: AgencyPartnerContact, catalog: PlatformPartner[]) {
  if (c.custom_partner_name) return c.custom_partner_name;
  return catalog.find((p) => p.id === c.platform_partner_id)?.name ?? "Partner";
}
