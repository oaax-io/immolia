import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { checkDomainAccess } from "@/lib/public-domain-branding.functions";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { WorkspacePicker } from "@/components/WorkspaceSwitcher";
import { useMyWorkspaces, switchWorkspace } from "@/lib/workspaces";
import { setConfirmedAgencyId, notifyTenant, useTenantSwitching, beginTenantSwitch } from "@/lib/tenant-session";

export function useDomainAccess(enabled: boolean) {
  const { user } = useAuth();
  const fn = useServerFn(checkDomainAccess);
  const qc = useQueryClient();
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const switchedRef = useRef<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [switchFailed, setSwitchFailed] = useState(false);
  const q = useQuery({
    queryKey: ["domain-access", host, user?.id],
    queryFn: () => fn(),
    enabled: enabled && !!user,
    // Bestätigung nie aus altem Cache: bei jedem Fokus erneut prüfen.
    staleTime: 0,
    refetchOnWindowFocus: true,
    placeholderData: undefined,
  });
  // Firmen-Adresse einer Firma, in der die Person aktives Mitglied ist, aber aktive Firma
  // ist eine andere → einmalig auf die Firma der Adresse wechseln (Server prüft Mitgliedschaft).
  const target = q.data && !q.data.allowed ? q.data.hostAgencyId : null;
  useEffect(() => {
    if (!enabled || !target || switchedRef.current === target) return;
    switchedRef.current = target;
    setSwitching(true);
    switchWorkspace(qc, target, { path: window.location.pathname + window.location.search, reloadOnError: false })
      .catch(() => { setSwitching(false); setSwitchFailed(true); });
  }, [enabled, target, qc]);
  const pending = !switchFailed && (switching || !!target);
  return { ...q, switchFailed, isLoading: q.isLoading || pending, data: pending ? undefined : q.data };
}

/** 'active' | 'select' | 'unavailable' | 'none' – zentral aus der Datenbank (Mitgliedschaft + Firmenstatus). */
export function useWorkspaceStatus() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["workspace-status", user?.id],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("my_workspace_status");
      if (error) throw error;
      return data as "active" | "select" | "unavailable" | "none";
    },
    enabled: !!user,
    staleTime: 0,
    refetchOnWindowFocus: true,
    placeholderData: undefined,
  });
}

export function NoAccessMessage({ title = "Kein Zugriff", text = "Dein Benutzerkonto hat keinen Zugriff auf diesen Bereich." }: { title?: string; text?: string } = {}) {
  const { signOut } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md rounded-2xl border bg-card p-8 text-center shadow-soft">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{text}</p>
        <Button
          className="mt-6"
          onClick={async () => {
            await qc.cancelQueries();
            qc.clear();
            await signOut();
            navigate({ to: "/auth", search: { mode: "signin" }, replace: true });
          }}
        >
          Abmelden
        </Button>
      </div>
    </div>
  );
}

function NeutralScreen({ text = "Unternehmen wird geladen …" }: { text?: string }) {
  return (
    <div role="status" className="flex min-h-screen items-center justify-center bg-background p-6 text-sm text-muted-foreground">
      {text}
    </div>
  );
}

function NeutralError({ onRetry, onPick }: { onRetry: () => void; onPick?: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="max-w-md rounded-2xl border bg-card p-8 text-center shadow-soft">
        <h1 className="text-lg font-semibold">Unternehmen konnte nicht geöffnet werden.</h1>
        <p className="mt-2 text-sm text-muted-foreground">Aus Sicherheitsgründen werden keine Daten angezeigt. Bitte erneut versuchen.</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <Button onClick={onRetry}>Erneut versuchen</Button>
          {onPick && <Button variant="outline" onClick={onPick}>Unternehmen auswählen</Button>}
        </div>
      </div>
    </div>
  );
}

/** Tab zeigt eine andere Firma als serverseitig aktiv (z. B. Wechsel in anderem Tab) → neu laden. */
function hardReload(qc: ReturnType<typeof useQueryClient>) {
  beginTenantSwitch();
  void qc.cancelQueries();
  try { void supabase.removeAllChannels(); } catch { /* ignore */ }
  qc.clear();
  window.location.reload();
}

/**
 * Zentraler TenantRenderGate (fail-closed): Tenant-App rendert nur, wenn serverseitig
 * bestätigt ist, dass current_agency_id() gesetzt ist und – auf Firmen-Adressen – zur
 * Firma der Adresse passt. Der Tenant-Baum ist auf die bestätigte Firma gekeyed.
 */
export function DomainAccessGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useDomainAccess(true);
  const ws = useWorkspaceStatus();
  const list = useMyWorkspaces();
  const switching = useTenantSwitching();
  const confirmed = q.data && q.data.allowed && ws.data === "active" ? q.data.currentAgencyId : null;
  const renderedRef = useRef<string | null>(null);

  // Bestätigte Firma zentral setzen, bevor Kinder rendern (Cache-Keys, Branding).
  if (confirmed && !switching) setConfirmedAgencyId(confirmed, true);
  useEffect(() => { if (confirmed && !switching) notifyTenant(); }, [confirmed, switching]);

  // Andere Firma als bisher gerendert (anderer Tab, Server-Wechsel) → nie weiterzeigen.
  useEffect(() => {
    if (!confirmed) return;
    if (renderedRef.current && renderedRef.current !== confirmed) { hardReload(qc); return; }
    renderedRef.current = confirmed;
  }, [confirmed, qc]);

  // Tab wieder aktiv / regelmässig: serverseitige Firma erneut bestätigen (Wechsel in anderem Tab).
  useEffect(() => {
    const recheck = () => { if (document.visibilityState === "visible") { void q.refetch(); void ws.refetch(); } };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    const t = window.setInterval(recheck, 60_000);
    return () => { window.removeEventListener("focus", recheck); document.removeEventListener("visibilitychange", recheck); window.clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // BFCache: wiederhergestellte Seite nie als alten Snapshot zeigen.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => { if (e.persisted) hardReload(qc); };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, [qc]);

  const [picking, setPicking] = useState(false);
  if (switching) return <NeutralScreen text="Unternehmen wird gewechselt …" />;
  if (picking) return <WorkspacePicker />;
  if (q.switchFailed) return <NeutralError onRetry={() => window.location.reload()} onPick={() => setPicking(true)} />;
  if (q.isError || ws.isError) return <NeutralError onRetry={() => { void q.refetch(); void ws.refetch(); }} onPick={() => setPicking(true)} />;
  if (q.isLoading || ws.isLoading || !q.data || !ws.data) return <NeutralScreen />;
  if (ws.data === "select") return <WorkspacePicker />;
  if (ws.data === "unavailable")
    return <NoAccessMessage title="Unternehmen nicht verfügbar" text="Der Zugang zu diesem Unternehmen ist derzeit nicht verfügbar. Bitte wenden Sie sich an Ihre Administration." />;
  if (ws.data === "none") return <NoAccessMessage />;
  if (!q.data.allowed) {
    if (list.isLoading) return <NeutralScreen />;
    if ((list.data ?? []).length > 0)
      return <WorkspacePicker title="Unter dieser Adresse nicht verfügbar" text="Ihr aktives Unternehmen ist unter dieser Adresse nicht verfügbar. Wählen Sie ein Unternehmen." />;
    return <NoAccessMessage />;
  }
  if (!confirmed) return <NeutralScreen />;
  if (renderedRef.current && renderedRef.current !== confirmed) return <NeutralScreen text="Unternehmen wird gewechselt …" />;
  return <Fragment key={confirmed}>{children}</Fragment>;
}
