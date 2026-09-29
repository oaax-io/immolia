/**
 * Hotfix Zero Stale Tenant Data – zentraler Zustand der bestätigten Firma im Browser.
 * Nur Cache-/Render-Isolation (Defense in Depth). Sicherheit bleibt serverseitig:
 * auth → current_agency_id() → Mitgliedschaft → RLS.
 */
import { useSyncExternalStore } from "react";
import { hashKey, type QueryKey } from "@tanstack/react-query";

let confirmedAgencyId: string | null = null;
let switching = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function getConfirmedAgencyId() { return confirmedAgencyId; }
/** silent: während Render setzen (Cache-Keys der Kinder), Benachrichtigung danach per notifyTenant(). */
export function setConfirmedAgencyId(id: string | null, silent = false) {
  if (confirmedAgencyId === id) return;
  confirmedAgencyId = id;
  if (!silent) emit();
}
export function notifyTenant() { emit(); }

/** Ab Klick auf eine andere Firma: Tenant-Oberfläche sofort ausblenden (fail-closed). */
export function beginTenantSwitch() { switching = true; confirmedAgencyId = null; emit(); }
export function abortTenantSwitch() { switching = false; emit(); }

function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function useTenantSwitching() { return useSyncExternalStore(subscribe, () => switching, () => false); }
export function useConfirmedAgencyId() { return useSyncExternalStore(subscribe, () => confirmedAgencyId, () => null); }

/**
 * Jeder Query-Key wird zentral mit der bestätigten Firma präfixiert → Tenant-Daten liegen
 * nie unter tenant-unabhängigen Cache-Keys, auch wenn eine Seite agencyId vergisst.
 */
const TENANT_INDEPENDENT = new Set(["domain-access", "workspace-status", "my-workspaces"]);
export function tenantQueryKeyHash(key: QueryKey) {
  if (typeof key[0] === "string" && TENANT_INDEPENDENT.has(key[0])) return `*|${hashKey(key)}`;
  return `${confirmedAgencyId ?? "-"}|${hashKey(key)}`;
}
