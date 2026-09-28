import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InvitationTable, InviteLinkBox } from "@/components/invitations/InvitationUI";
import { inviteTenantOwner, usePlatformInvitations } from "@/lib/invitations";

/** Inhaber-Einladungen eines Unternehmens: offene Einladungen verwalten und neue ausstellen. */
export function TenantOwnerInvitations({ agencyId }: { agencyId: string }) {
  const qc = useQueryClient();
  const invites = usePlatformInvitations("tenant_owner", agencyId);
  const [email, setEmail] = useState("");
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => { void qc.invalidateQueries({ queryKey: ["platform"] }); };

  const submit = async () => {
    setBusy(true);
    try {
      const r = await inviteTenantOwner(agencyId, email.trim(), first.trim(), last.trim());
      setToken(r.token);
      setHint(r.account_exists
        ? "Für diese E-Mail besteht bereits ein Konto. Die Person meldet sich mit ihrem bestehenden Konto an und öffnet den Link – es wird kein zweites Konto erstellt."
        : "Für diese E-Mail besteht noch kein Konto. Hinweis: Neue Registrierungen sind derzeit gesperrt, die Annahme ist daher erst möglich, wenn ein Konto existiert.");
      setEmail(""); setFirst(""); setLast("");
      refresh();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <div className="text-sm font-semibold">Inhaber-Einladungen</div>
      <InvitationTable rows={invites.data ?? []} canManage={(r) => r.status === "pending"} onChanged={refresh} />
      <div className="grid gap-2 sm:grid-cols-4">
        <Input placeholder="E-Mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input placeholder="Vorname" value={first} onChange={(e) => setFirst(e.target.value)} />
        <Input placeholder="Nachname" value={last} onChange={(e) => setLast(e.target.value)} />
        <Button onClick={submit} disabled={busy || !email.trim()}>Inhaber einladen</Button>
      </div>
      {token && (
        <div className="space-y-2">
          {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
          <InviteLinkBox token={token} />
        </div>
      )}
    </div>
  );
}
