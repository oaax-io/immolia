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

let switchInFlight = false;
export function isWorkspaceSwitching() { return switchInFlight; }

function showSwitchOverlay() {
  if (typeof document === "undefined" || document.getElementById("ws-switch-overlay")) return;
  const el = document.createElement("div");
  el.id = "ws-switch-overlay";
  el.setAttribute("role", "status");
  el.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:hsl(var(--background, 0 0% 100%) / 0.96);backdrop-filter:blur(2px);font:500 14px system-ui,sans-serif;color:inherit";
  el.textContent = "Unternehmen wird gewechselt …";
  document.body.appendChild(el);
}
function hideSwitchOverlay() {
  document.getElementById("ws-switch-overlay")?.remove();
}

/**
 * Einzige Wechsel-Transaktion (Hotfix Workspace-Switch):
 * Sperre gegen Doppelklick → Overlay → set_current_agency (Server prüft Mitgliedschaft)
 * → Server bestätigt via current_agency_id() → alle Queries abbrechen, Realtime-Kanäle
 * entfernen, Cache leeren → vollständiges Neuladen der Zielseite.
 * Das Neuladen ist bewusst: es verwirft deterministisch React-State, Router-State,
 * Kontexte, verspätete Antworten und Kanäle der alten Firma.
 * Bei Fehler bleibt die alte Firma aktiv und die Oberfläche unverändert.
 */
export async function switchWorkspace(qc: QueryClient, agencyId: string, opts: { host?: string; path?: string } = {}) {
  if (switchInFlight) return false;
  switchInFlight = true;
  showSwitchOverlay();
  try {
    await setCurrentWorkspace(agencyId);
    const { data: confirmed, error } = await (supabase.rpc as any)("current_agency_id");
    if (error) throw error;
    if (confirmed !== agencyId) throw new Error("Wechsel wurde vom Server nicht bestätigt.");
    await qc.cancelQueries();
    try { await supabase.removeAllChannels(); } catch { /* ignore */ }
    qc.clear();
    const path = opts.path ?? "/dashboard";
    window.location.assign(opts.host ? `https://${opts.host}${path}` : path);
    return true; // Overlay bleibt bis zum Neuladen; Sperre ebenso.
  } catch (e) {
    hideSwitchOverlay();
    switchInFlight = false;
    throw e;
  }
}
