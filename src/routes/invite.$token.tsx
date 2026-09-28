import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import {
  acceptInvitation, clearPendingInvite, INVITE_ROLE_LABEL, previewInvitation, rememberPendingInvite,
} from "@/lib/invitations";
import { reachableHostOf, resetTenantCache, setCurrentWorkspace, type Workspace } from "@/lib/workspaces";
import { useServerFn } from "@tanstack/react-start";
import { signupWithInvitation } from "@/lib/invite-signup.functions";

export const Route = createFileRoute("/invite/$token")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Einladung – Immolia" },
      { name: "description", content: "Einladung zu Immolia annehmen." },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:title", content: "Einladung – Immolia" },
      { property: "og:description", content: "Einladung zu Immolia annehmen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: InvitePage,
});

const STATUS_TEXT: Record<string, string> = {
  invalid: "Dieser Einladungslink ist ungültig.",
  expired: "Diese Einladung ist abgelaufen. Bitte um eine neue Einladung bitten.",
  revoked: "Diese Einladung wurde widerrufen.",
  accepted: "Diese Einladung wurde bereits angenommen.",
  unavailable: "Dieses Unternehmen ist derzeit nicht verfügbar.",
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md"><CardContent className="space-y-4 p-6">{children}</CardContent></Card>
    </div>
  );
}

/** Nach Annahme: kanonische Adresse der Firma über die bestehende Logik (Custom → Immolia → neutral). */
async function goToTenant(agencyId: string | null, fallback: () => void) {
  if (!agencyId) return fallback();
  try {
    await setCurrentWorkspace(agencyId);
    const { data } = await (supabase.rpc as any)("my_workspaces");
    const ws = ((data ?? []) as Workspace[]).find((w) => w.agency_id === agencyId);
    const host = ws ? reachableHostOf(ws) : null;
    const here = window.location.hostname.toLowerCase();
    const isPreview = here.endsWith(".lovable.app") || here === "localhost" || here.endsWith(".lovableproject.com");
    if (host && host !== here && !isPreview) { window.location.href = `https://${host}/dashboard`; return; }
  } catch { /* Fallback: lokal weiter */ }
  fallback();
}

function InvitePage() {
  const { token } = Route.useParams();
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const signupFn = useServerFn(signupWithInvitation);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", password: "" });

  useEffect(() => { if (/^[a-f0-9]{64}$/.test(token)) rememberPendingInvite(token); }, [token]);

  const preview = useQuery({
    queryKey: ["invite-preview", token, user?.id ?? "anon"],
    enabled: !loading,
    queryFn: () => previewInvitation(token),
    retry: false,
  });

  const accept = async () => {
    setBusy(true);
    try {
      const r = await acceptInvitation(token);
      clearPendingInvite();
      await resetTenantCache(qc);
      toast.success(r.outcome === "accepted" ? "Einladung angenommen" :
        r.outcome === "already_member" ? "Sie sind bereits Mitglied dieses Unternehmens." : "Sie haben bereits einen Plattformzugang.");
      if (r.type === "platform_user") navigate({ to: "/platform" });
      else await goToTenant(r.agency_id, () => navigate({ to: "/dashboard" }));
    } catch (e) {
      toast.error((e as Error).message);
      void preview.refetch();
    } finally { setBusy(false); }
  };

  const p = preview.data;

  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!p?.email) return;
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: p.email, password: form.password });
    setBusy(false);
    if (error) toast.error("Anmeldung fehlgeschlagen. Bitte Passwort prüfen.");
  };

  const createAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!p?.email) return;
    if (form.password.length < 8) return toast.error("Passwort: mindestens 8 Zeichen");
    setBusy(true);
    try {
      const r = await signupFn({ data: { token, password: form.password, fullName: form.name } });
      if (!r.ok) {
        if (r.reason === "account_exists") { toast.info("Für diese Adresse besteht bereits ein Konto. Bitte anmelden."); }
        else toast.error(STATUS_TEXT[r.reason] ?? "Konto konnte nicht erstellt werden.");
        void preview.refetch();
        return;
      }
      const { error } = await supabase.auth.signInWithPassword({ email: r.email, password: form.password });
      if (error) toast.error("Konto erstellt, Anmeldung fehlgeschlagen. Bitte erneut anmelden.");
    } catch {
      toast.error("Konto konnte nicht erstellt werden.");
    } finally { setBusy(false); }
  };

  if (loading || preview.isLoading) return <Shell><p className="text-sm text-muted-foreground">Einen Moment …</p></Shell>;
  if (!p || p.status !== "pending") {
    clearPendingInvite();
    return <Shell><h1 className="text-lg font-semibold">Einladung</h1><p className="text-sm">{STATUS_TEXT[p?.status ?? "invalid"]}</p>
      <Button asChild variant="outline"><Link to="/auth" search={{ mode: "signin" }}>Zur Anmeldung</Link></Button></Shell>;
  }

  const role = p.role ? INVITE_ROLE_LABEL[p.role] ?? p.role : "";
  const summary = (
    <div className="rounded-md border p-3 text-sm">
      <div><span className="text-muted-foreground">{p.type === "platform_user" ? "Bereich" : "Unternehmen"}:</span> <span className="font-medium">{p.company_name ?? "–"}</span></div>
      <div><span className="text-muted-foreground">{p.type === "platform_user" ? "Plattformrolle" : "Rolle"}:</span> <span className="font-medium">{role}</span></div>
      <div><span className="text-muted-foreground">E-Mail:</span> <span className="font-medium">{p.email}</span></div>
    </div>
  );

  if (!user) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">Sie wurden zu Immolia eingeladen.</h1>
        {summary}
        <form className="space-y-3" onSubmit={p.account_exists ? signIn : createAccount}>
          <p className="text-sm text-muted-foreground">
            {p.account_exists ? "Für diese Adresse besteht bereits ein Konto. Melden Sie sich an, um die Einladung anzunehmen."
              : "Erstellen Sie Ihr Konto. Die E-Mail-Adresse ist durch die Einladung festgelegt."}
          </p>
          <div><Label>E-Mail</Label><Input type="email" value={p.email ?? ""} readOnly disabled /></div>
          {!p.account_exists && (
            <div><Label>Name</Label><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
          )}
          <div><Label>{p.account_exists ? "Passwort" : "Passwort festlegen (mind. 8 Zeichen)"}</Label>
            <Input type="password" autoComplete={p.account_exists ? "current-password" : "new-password"} value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })} required /></div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Einen Moment …" : p.account_exists ? "Anmelden" : "Konto erstellen"}
          </Button>
        </form>
      </Shell>
    );
  }

  return (
    <Shell>
      <h1 className="text-lg font-semibold">Einladung annehmen</h1>
      {summary}
      {p.email_match ? (
        <Button className="w-full" disabled={busy} onClick={accept}>{busy ? "Wird angenommen …" : "Einladung annehmen"}</Button>
      ) : (
        <>
          <p className="text-sm">Diese Einladung wurde für {p.email} erstellt. Bitte melden Sie sich mit dieser E-Mail-Adresse an. (Angemeldet: {user.email})</p>
          <Button variant="outline" onClick={() => { void signOut(); }}>Abmelden</Button>
        </>
      )}
    </Shell>
  );
}
