/**
 * Zentrale Einladungen (Phase 4.7). Alle Zugriffe über geprüfte RPCs;
 * der Klartext-Code existiert nur im einmalig angezeigten Link.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)(fn, args);
  if (error) throw new Error(invitationErrorText(error.message));
  return data as T;
}

export type InvitationRow = {
  id: string; email: string; first_name: string | null; last_name: string | null;
  invitation_type: "tenant_owner" | "tenant_member" | "platform_user";
  tenant_role?: string | null; role?: string | null; agency_name?: string | null;
  status: "pending" | "accepted" | "expired" | "revoked";
  created_at: string; expires_at: string; accepted_at: string | null; email_delivery_status: string;
};
export type IssuedInvitation = { invitation_id: string; token: string; email_delivery_status: string };
export type InvitationPreview = {
  status: "pending" | "accepted" | "expired" | "revoked" | "invalid" | "unavailable";
  type?: InvitationRow["invitation_type"]; company_name?: string | null; role?: string;
  email?: string; account_exists?: boolean; email_match?: boolean | null;
};

export const INVITATION_STATUS_LABEL: Record<string, string> = {
  pending: "Ausstehend", accepted: "Angenommen", expired: "Abgelaufen", revoked: "Widerrufen",
};
export const INVITE_ROLE_LABEL: Record<string, string> = {
  owner: "Inhaber", admin: "Administrator", manager: "Manager", agent: "Makler", assistant: "Assistenz", employee: "Mitarbeitende",
  platform_admin: "Platform Admin", platform_support: "Platform Support", system_owner: "System Owner",
};
export const TENANT_INVITE_ROLES = ["admin", "manager", "agent", "assistant", "employee"] as const;

const ERRORS: Record<string, string> = {
  already_pending: "Für diese E-Mail besteht bereits eine offene Einladung. Nutzen Sie «Neu senden».",
  already_member: "Diese Person ist bereits Mitglied dieses Unternehmens.",
  already_platform_user: "Diese Person hat bereits einen Plattformzugang.",
  invalid_email: "Bitte eine gültige E-Mail-Adresse eingeben.",
  invalid_role: "Diese Rolle ist nicht erlaubt.",
  forbidden_owner: "Nur Inhaber dürfen weitere Inhaber einladen.",
  forbidden: "Dafür fehlt Ihnen die Berechtigung.",
  no_workspace: "Kein aktives Unternehmen ausgewählt.",
  not_found: "Einladung nicht gefunden.",
  not_pending: "Diese Einladung ist nicht mehr offen.",
  invalid: "Dieser Einladungslink ist ungültig.",
  expired: "Diese Einladung ist abgelaufen. Bitte um eine neue Einladung bitten.",
  revoked: "Diese Einladung wurde widerrufen.",
  used: "Diese Einladung wurde bereits angenommen.",
  email_mismatch: "Diese Einladung gilt für eine andere E-Mail-Adresse. Bitte mit der eingeladenen Adresse anmelden.",
  unavailable: "Dieses Unternehmen ist derzeit nicht verfügbar.",
  not_authenticated: "Bitte zuerst anmelden.",
};
export function invitationErrorText(msg: string) {
  const key = Object.keys(ERRORS).find((k) => msg === k || msg.includes(k));
  return key ? ERRORS[key] : msg;
}

export const inviteLink = (token: string) => `${window.location.origin}/invite/${token}`;

// Tenant
export const useTenantInvitations = (enabled = true) => useQuery({
  queryKey: ["invitations", "tenant"], enabled,
  queryFn: () => rpc<InvitationRow[]>("invitation_list_tenant"),
});
export const createTenantInvitation = (a: { email: string; role: string; firstName?: string; lastName?: string }) =>
  rpc<IssuedInvitation>("invitation_create_tenant_member", { _email: a.email, _role: a.role, _first_name: a.firstName ?? null, _last_name: a.lastName ?? null });

// Plattform
export const usePlatformInvitations = (type?: string, agencyId?: string) => useQuery({
  queryKey: ["platform", "invitations", type ?? "all", agencyId ?? "all"],
  queryFn: () => rpc<InvitationRow[]>("platform_list_invitations", { _type: type ?? null, _agency_id: agencyId ?? null }),
});
export const invitePlatformUser = (email: string, role: string) => rpc<IssuedInvitation>("platform_invite_user", { _email: email, _role: role });
export const inviteTenantOwner = (agencyId: string, email: string, firstName?: string, lastName?: string) =>
  rpc<IssuedInvitation & { account_exists: boolean }>("platform_invite_tenant_owner", {
    _agency_id: agencyId, _email: email, _first_name: firstName || null, _last_name: lastName || null,
  });

// Gemeinsam
export const revokeInvitation = (id: string) => rpc<void>("invitation_revoke", { _invitation_id: id });
export const resendInvitation = (id: string) => rpc<IssuedInvitation>("invitation_resend", { _invitation_id: id });
export const previewInvitation = (token: string) => rpc<InvitationPreview>("invitation_preview", { _token: token });
export const acceptInvitation = (token: string) =>
  rpc<{ outcome: "accepted" | "already_member" | "already_platform_user"; type: string; agency_id: string | null }>("invitation_accept", { _token: token });

// Einladung über Anmeldung/Registrierung hinweg merken (nur lokal, max. 7 Tage)
const PENDING_KEY = "immolia_pending_invite";
export function rememberPendingInvite(token: string) {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ token, at: Date.now() })); } catch { /* ignore */ }
}
export function readPendingInvite(): string | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const { token, at } = JSON.parse(raw) as { token: string; at: number };
    if (!/^[a-f0-9]{64}$/.test(token) || Date.now() - at > 7 * 864e5) { localStorage.removeItem(PENDING_KEY); return null; }
    return token;
  } catch { return null; }
}
export function clearPendingInvite() { try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ } }
