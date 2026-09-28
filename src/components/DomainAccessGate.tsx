import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { checkDomainAccess } from "@/lib/public-domain-branding.functions";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { WorkspacePicker } from "@/components/WorkspaceSwitcher";
import { useMyWorkspaces, setCurrentWorkspace, resetTenantCache } from "@/lib/workspaces";

export function useDomainAccess(enabled: boolean) {
  const { user } = useAuth();
  const fn = useServerFn(checkDomainAccess);
  const qc = useQueryClient();
  const host = typeof window !== "undefined" ? window.location.hostname : "";
  const switchedRef = useRef<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const q = useQuery({
    queryKey: ["domain-access", host, user?.id],
    queryFn: () => fn(),
    enabled: enabled && !!user,
    staleTime: 5 * 60_000,
  });
  // Firmen-Adresse einer Firma, in der die Person aktives Mitglied ist (hostAgencyId nur dann gesetzt),
  // aber gespeicherte aktive Firma ist eine andere → einmalig auf die Firma der Adresse wechseln.
  // set_current_agency prüft die Mitgliedschaft serverseitig; der Hostname allein gewährt nichts.
  const target = q.data && !q.data.allowed ? q.data.hostAgencyId : null;
  useEffect(() => {
    if (!target || switchedRef.current === target) return;
    switchedRef.current = target;
    setSwitching(true);
    setCurrentWorkspace(target)
      .then(() => resetTenantCache(qc))
      .catch(() => { /* bleibt abgelehnt → normale Anzeige */ })
      .finally(() => setSwitching(false));
  }, [target, qc]);
  const pending = switching || !!target;
  return { ...q, isLoading: q.isLoading || pending, data: pending ? undefined : q.data };
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
    staleTime: 60_000,
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
        <p className="mt-2 text-sm text-muted-foreground">
          {text}
        </p>
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

/** Zeigt die App nur, wenn die Domain keine andere Firma darstellt als die eigene. */
export function DomainAccessGate({ children }: { children: ReactNode }) {
  const q = useDomainAccess(true);
  const ws = useWorkspaceStatus();
  const list = useMyWorkspaces();
  // Nichts rendern, bevor Adresse und aktives Unternehmen geprüft sind (kein Daten-Flicker).
  if (q.isLoading || ws.isLoading) return null;
  if (ws.data === "select") return <WorkspacePicker />;
  if (ws.data === "unavailable")
    return <NoAccessMessage title="Unternehmen nicht verfügbar" text="Der Zugang zu diesem Unternehmen ist derzeit nicht verfügbar. Bitte wenden Sie sich an Ihre Administration." />;
  if (q.data && !q.data.allowed) {
    if (list.isLoading) return null;
    if ((list.data ?? []).length > 0)
      return <WorkspacePicker title="Unter dieser Adresse nicht verfügbar" text="Ihr aktives Unternehmen ist unter dieser Adresse nicht verfügbar. Wählen Sie ein Unternehmen." />;
    return <NoAccessMessage />;
  }
  return <>{children}</>;
}
