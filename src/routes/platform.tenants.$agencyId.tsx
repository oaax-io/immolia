import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlatformPage, QueryState } from "@/components/platform/PlatformLayout";
import { ActivityList } from "@/components/platform/ActivityList";
import { AuditLogList } from "@/components/platform/AuditLogList";
import { TenantAdministration } from "@/components/platform/TenantAdministration";
import { DomainCenter, WhiteLabelSummary } from "@/components/platform/DomainCenter";
import { TenantModules } from "@/components/platform/ModuleCenter";
import { TenantOwnerInvitations } from "@/components/platform/TenantOwnerInvitations";
import { MembersTable } from "@/components/platform/tables";
import {
  usePlatformTenants, usePlatformMembers, usePlatformActivity, usePlatformBranding, usePlatformAuditLogs, useOwnerInvitations, OWNER_STATUS_LABEL,
  TENANT_STATUS_LABEL, domainStatusLabel, fmtDate,
} from "@/lib/platform-admin";

export const Route = createFileRoute("/platform/tenants/$agencyId")({ component: TenantDetail });

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex gap-4 border-b py-2 text-sm last:border-0"><span className="w-48 shrink-0 text-muted-foreground">{k}</span><span className="min-w-0 break-all">{v}</span></div>;
}

function OwnerInfo({ agencyId }: { agencyId: string }) {
  const members = usePlatformMembers(agencyId);
  const inv = useOwnerInvitations(agencyId);
  const owners = (members.data ?? []).filter((m) => m.tenant_role === "owner");
  const pending = (inv.data ?? []).filter((i) => i.status !== "accepted" && i.status !== "cancelled");
  if (members.isLoading || inv.isLoading) return <>…</>;
  if (!owners.length && !pending.length) return <>–</>;
  return (
    <div className="space-y-1">
      {owners.map((o) => <div key={o.user_id}>{o.full_name ?? "–"} · {o.email} <Badge variant={o.is_active ? "default" : "secondary"} className="ml-1">{o.is_active ? "Aktiv" : "Inaktiv"}</Badge></div>)}
      {pending.map((i) => <div key={i.email}>{i.first_name} {i.last_name} · {i.email} <Badge variant="secondary" className="ml-1">{OWNER_STATUS_LABEL[i.status] ?? i.status}</Badge></div>)}
    </div>
  );
}

function TenantDetail() {
  const { agencyId } = Route.useParams();
  const tenants = usePlatformTenants();
  const members = usePlatformMembers(agencyId);
  const activity = usePlatformActivity(agencyId, 50);
  const branding = usePlatformBranding(agencyId);
  const audit = usePlatformAuditLogs(agencyId, 50);
  const t = tenants.data?.find((x) => x.id === agencyId);

  return (
    <PlatformPage title={t?.name ?? "Unternehmen"} description="Administrative Metadaten. Keine CRM-Daten.">
      <Link to="/platform/tenants" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="mr-1 h-4 w-4" />Alle Unternehmen</Link>
      <QueryState isLoading={tenants.isLoading} error={tenants.error} />
      {!tenants.isLoading && !t && <div className="text-sm text-muted-foreground">Unternehmen nicht gefunden.</div>}
      {t && (
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Übersicht</TabsTrigger><TabsTrigger value="users">Benutzer</TabsTrigger>
            <TabsTrigger value="domains">Domains</TabsTrigger><TabsTrigger value="modules">Module</TabsTrigger>
            <TabsTrigger value="branding">Branding</TabsTrigger><TabsTrigger value="activity">Aktivität</TabsTrigger>
          </TabsList>
          <TabsContent value="overview"><Card><CardContent className="p-5">
            <Row k="Firmenname" v={t.name} />
            <Row k="Tenant-ID" v={<code className="text-xs">{t.id}</code>} />
            <Row k="Status" v={<Badge variant={t.status === "active" ? "default" : "secondary"}>{TENANT_STATUS_LABEL[t.status]}</Badge>} />
            <Row k="Erstellt am" v={fmtDate(t.created_at)} />
            <Row k="Aktive Mitglieder" v={t.members} />
            <Row k="Owner" v={<OwnerInfo agencyId={t.id} />} />
            <Row k="Immolia-Adresse" v={t.subdomain ? <span>{t.subdomain}{t.subdomain.endsWith(".immolia.ch") && <span className="block text-xs text-muted-foreground">Domain technisch noch nicht verbunden (*.immolia.ch nicht eingerichtet)</span>}</span> : "–"} />
            <Row k="Custom Domain" v={t.custom_domain ? `${t.custom_domain} (${domainStatusLabel({ verification_status: t.custom_domain_status, activated_at: t.custom_domain_active ? "x" : null, domain_type: "custom" })})` : "–"} />
            <Row k="Branding vorhanden" v={t.has_branding ? "Ja" : "Nein"} />
            <Row k="Aktivierte Module" v={t.modules_active} />
            <div className="mt-6 border-t pt-5"><TenantOwnerInvitations agencyId={t.id} /></div>
            <div className="mt-6 border-t pt-5"><TenantAdministration key={t.id + t.name + t.status} tenant={t} /></div>
          </CardContent></Card></TabsContent>
          <TabsContent value="users"><Card><QueryState isLoading={members.isLoading} error={members.error} /><MembersTable rows={members.data ?? []} /></Card></TabsContent>
          <TabsContent value="domains"><DomainCenter agencyId={agencyId} /></TabsContent>
          <TabsContent value="modules"><TenantModules agencyId={agencyId} /></TabsContent>
          <TabsContent value="branding"><Card><CardContent className="p-5">
            <div className="mb-3 text-sm font-semibold">White Label</div><WhiteLabelSummary agencyId={agencyId} /><div className="my-5 border-t" />
            <QueryState isLoading={branding.isLoading} error={branding.error} />
            {branding.data ? (
              <div className="space-y-4">
                {branding.data.logo_url && <img src={branding.data.logo_url} alt="Logo" className="h-10 w-auto" />}
                <Row k="Firmenname (Branding)" v={branding.data.company_name ?? "–"} />
                <Row k="Login-Titel" v={branding.data.login_title ?? "–"} />
                <div className="flex flex-wrap gap-3 pt-2">
                  {(["primary_color", "secondary_color", "accent_color", "app_primary_color", "app_secondary_color", "app_accent_color"] as const).map((k) =>
                    branding.data?.[k] ? (
                      <div key={k} className="flex items-center gap-2 text-xs">
                        <span className="h-5 w-5 rounded border" style={{ background: branding.data[k] ?? undefined }} />{k.replace(/_/g, " ")}
                      </div>
                    ) : null)}
                </div>
                <Row k="Zuletzt geändert" v={fmtDate(branding.data.updated_at)} />
              </div>
            ) : !branding.isLoading && <div className="text-sm text-muted-foreground">Kein Branding hinterlegt.</div>}
          </CardContent></Card></TabsContent>
          <TabsContent value="activity"><Card><CardContent className="space-y-6 p-5"><div className="text-sm font-semibold">Audit-Aktionen</div><QueryState isLoading={audit.isLoading} error={audit.error} /><AuditLogList items={audit.data ?? []} hideTenant /><div className="text-sm font-semibold">Systemereignisse</div><QueryState isLoading={activity.isLoading} error={activity.error} /><ActivityList items={activity.data ?? []} hideTenant /></CardContent></Card></TabsContent>
        </Tabs>
      )}
    </PlatformPage>
  );
}
