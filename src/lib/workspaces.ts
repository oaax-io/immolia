/**
 * Phase 4.6A – Workspace-Kontext.
 * Eine Sitzung arbeitet immer in genau EINEM Unternehmen (current_agency_id()).
 * Liste/Wechsel ausschliesslich über my_workspaces() / set_current_agency();
 * nie direkte Schreibzugriffe auf profiles.
 */
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { IMMOLIA_WILDCARD_READY } from "@/lib/platform-admin";

export type Workspace = {
  agency_id: string;
  name: string;
  role: string;
  logo_url: string | null;
  favicon_url: string | null;
  custom_domain: string | null;
  subdomain: string | null;
  is_current: boolean;
};

/**
 * Generische, technisch erreichbare App-Adresse ohne Firmen-Branding
 * (kein tenant_domains-Eintrag → Immolia-Darstellung). Geprüft: liefert «Anmelden – Immolia».
 */
export const GENERIC_APP_HOST = "asimos.lovable.app";

export const WORKSPACES_KEY = ["my-workspaces"] as const;

export function useMyWorkspaces() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...WORKSPACES_KEY, user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("my_workspaces");
      if (error) throw error;
      return (data ?? []) as Workspace[];
    },
  });
}

/**
 * Kanonische Adresse eines Unternehmens (nie erfunden), zentrale Priorität:
 * 1. aktive, verifizierte Custom Domain
 * 2. verifizierte Immolia-Hauptadresse (my_workspaces liefert nur die primäre, einzeln verbundene)
 * 3. null → Aufrufer nutzt GENERIC_APP_HOST
 */
export function reachableHostOf(ws: Workspace): string | null {
  if (ws.custom_domain) return ws.custom_domain;
  if (ws.subdomain) return ws.subdomain;
  return null;
}
void IMMOLIA_WILDCARD_READY;

export type SwitchPlan =
  | { kind: "local" }
  | { kind: "redirect"; host: string }
  | { kind: "blocked" };

/**
 * Darf das Unternehmen unter der aktuellen Adresse genutzt werden?
 * hostBranded = aktuelle Adresse gehört eindeutig einer Firma; hostAgencyId nur bekannt,
 * wenn die Person dort Mitglied ist.
 */
export function planSwitch(ws: Workspace, hostBranded: boolean, hostAgencyId: string | null): SwitchPlan {
  const here = typeof window !== "undefined" ? window.location.hostname.toLowerCase() : "";
  if (!hostBranded || hostAgencyId === ws.agency_id) return { kind: "local" };
  const target = reachableHostOf(ws) ?? GENERIC_APP_HOST;
  if (!target || target === here) return { kind: "blocked" };
  return { kind: "redirect", host: target };
}

export async function setCurrentWorkspace(agencyId: string) {
  const { error } = await (supabase.rpc as any)("set_current_agency", { _agency_id: agencyId });
  if (error) throw error;
}

/** Nach Wechsel: kein alter Firmen-Cache (Daten, Branding, Module, Rollen, Navigation). */
export async function resetTenantCache(qc: QueryClient) {
  await qc.cancelQueries();
  qc.clear();
}
