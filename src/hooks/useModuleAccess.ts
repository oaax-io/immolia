import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useConfirmedAgencyId } from "@/lib/tenant-session";

/** Pfad → Modul. Ohne Eintrag gilt eine Seite als nicht modulgebunden. */
export const PATH_MODULE: Array<[string, string]> = [
  ["/leads", "leads"], ["/clients", "clients"], ["/properties", "properties"], ["/matching", "matching"],
  ["/financing", "financing"], ["/appointments", "appointments"], ["/tasks", "tasks"], ["/analytics", "analytics"],
  ["/documents", "documents"], ["/generated-documents", "documents"], ["/media", "media"], ["/mandates", "mandates"],
  ["/reservations", "reservations"], ["/ndas", "ndas"], ["/checklists", "checklists"], ["/exposes", "exposes"],
  ["/team", "employees"], ["/settings/company", "company_settings"], ["/feedback", "feedback"], ["/docs", "docs"],
];
export const moduleForPath = (p: string) => PATH_MODULE.find(([pre]) => p === pre || p.startsWith(pre + "/"))?.[1] ?? null;

/**
 * Nur Anzeige: Die eigentliche Sperre liegt serverseitig (RESTRICTIVE-Policies
 * module_gate_* + agency_module_enabled). Fehlt ein Eintrag, gilt das Modul als gesperrt
 * (gleiche Regel wie agency_module_enabled, Phase 4.5).
 */
export function useModuleAccess() {
  const { user } = useAuth();
  const agencyId = useConfirmedAgencyId();
  const q = useQuery({
    queryKey: ["agency-modules", agencyId, user?.id ?? null],
    enabled: !!user && !!agencyId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.from("agency_modules").select("module, is_entitled, is_enabled").eq("agency_id", agencyId!);
      if (error) throw error;
      return data ?? [];
    },
  });
  const isEnabled = (module: string | null) => {
    if (!module || !q.data) return true;
    const row = q.data.find((r) => r.module === module);
    return row ? row.is_entitled && row.is_enabled : false;
  };
  return { isEnabled, loaded: q.isSuccess };
}
