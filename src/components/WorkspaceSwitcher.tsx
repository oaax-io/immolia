import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Building2, Check, Loader2, ArrowLeftRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";
import { useDomainAccess } from "@/components/DomainAccessGate";
import {
  useMyWorkspaces, planSwitch, switchWorkspace, resetTenantCache, isWorkspaceSwitching, type Workspace,
} from "@/lib/workspaces";

const ROLE_LABEL: Record<string, string> = {
  owner: "Inhaber", admin: "Admin", manager: "Manager", agent: "Makler",
  assistant: "Assistenz", employee: "Mitarbeitende", superadmin: "Mitglied",
};

function useSwitch() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const access = useDomainAccess(false);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (ws: Workspace) => {
    const plan = planSwitch(ws, !!access.data?.domainBranded, access.data?.hostAgencyId ?? null);
    if (plan.kind === "blocked") {
      toast.error("Dieses Unternehmen ist unter dieser Adresse nicht verfügbar, und es gibt noch keine andere erreichbare Adresse.");
      return;
    }
    if (busy || isWorkspaceSwitching()) return;
    setBusy(ws.agency_id);
    try {
      // Andere Adresse: keine Daten dieses Unternehmens unter fremdem Branding zeigen.
      await switchWorkspace(qc, ws.agency_id, plan.kind === "redirect" ? { host: plan.host } : {});
    } catch (e: any) {
      toast.error(e?.message ?? "Wechsel nicht möglich");
      setBusy(null);
    }
  };
  return { run, busy, access };
}

/** Vollbild-Auswahl: mehrere Unternehmen, noch keine gültige Auswahl (oder falsche Adresse). */
export function WorkspacePicker({ title = "Unternehmen wählen", text = "Sie sind Mitglied in mehreren Unternehmen. Wählen Sie, in welchem Sie arbeiten möchten." }: { title?: string; text?: string }) {
  const { data, isLoading } = useMyWorkspaces();
  const { run, busy, access } = useSwitch();
  const { signOut } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <div className="w-full max-w-md rounded-2xl border bg-card p-8 shadow-soft">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{text}</p>
        <div className="mt-6 space-y-2">
          {isLoading && <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />}
          {(data ?? []).map((ws) => {
            const plan = planSwitch(ws, !!access.data?.domainBranded, access.data?.hostAgencyId ?? null);
            return (
              <button
                key={ws.agency_id}
                type="button"
                disabled={!!busy || plan.kind === "blocked"}
                onClick={() => run(ws)}
                className="flex w-full items-center gap-3 rounded-lg border p-3 text-left transition hover:border-primary/50 hover:bg-muted/50 disabled:opacity-60"
              >
                {ws.logo_url ? (
                  <img src={ws.logo_url} alt="" className="h-8 w-8 rounded object-contain" />
                ) : (
                  <Building2 className="h-8 w-8 rounded bg-muted p-1.5 text-muted-foreground" />
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{ws.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {ROLE_LABEL[ws.role] ?? ws.role}
                    {plan.kind === "redirect" && ` · öffnet ${plan.host}`}
                    {plan.kind === "blocked" && " · unter dieser Adresse nicht verfügbar"}
                  </span>
                </span>
                {busy === ws.agency_id && <Loader2 className="h-4 w-4 animate-spin" />}
              </button>
            );
          })}
          {!isLoading && (data ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">Kein aktives Unternehmen verfügbar.</p>
          )}
        </div>
        <Button
          variant="ghost"
          className="mt-6 w-full"
          onClick={async () => {
            await resetTenantCache(qc);
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

/** Einträge im Kontomenü – nur bei mehr als einem Unternehmen. */
export function WorkspaceMenuItems() {
  const { data } = useMyWorkspaces();
  const { run, busy } = useSwitch();
  if (!data || data.length < 2) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="flex items-center gap-2 text-xs text-muted-foreground">
        <ArrowLeftRight className="h-3.5 w-3.5" />Unternehmen wechseln
      </DropdownMenuLabel>
      {data.map((ws) => (
        <DropdownMenuItem key={ws.agency_id} disabled={ws.is_current || !!busy} onClick={() => run(ws)}>
          <Building2 className="mr-2 h-4 w-4" />
          <span className="flex-1 truncate">{ws.name}</span>
          {ws.is_current && <Check className="ml-2 h-4 w-4 text-primary" />}
          {busy === ws.agency_id && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
        </DropdownMenuItem>
      ))}
    </>
  );
}
