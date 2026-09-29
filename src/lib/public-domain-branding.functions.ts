/**
 * Phase 3C.1 – Öffentliche Domain-Auflösung (nur Darstellung).
 *
 * hostname (aus der Anfrage, nie vom Browser als Parameter)
 *   → tenant_domains (nur verification_status = 'verified')
 *   → Agency → öffentlich sichere Branding-Felder.
 *
 * Liefert NIE Zugriff, IDs oder CRM-Daten. Autorisierung bleibt
 * Auth → aktive agency_membership → current_agency_id() → RLS.
 * Unbekannte/nicht verifizierte Domains → null → Immolia-Branding.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PublicDomainBranding = {
  company_name: string | null;
  logo_url: string | null;
  logo_alt_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  accent_color: string | null;
  login_title?: string | null;
  login_subtitle?: string | null;
};

export const resolvePublicDomainBranding = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ hostname: string; branding: PublicDomainBranding | null }> => {
    const raw = getRequestHeader("x-forwarded-host") || getRequestHeader("host") || "";
    const hostname = raw.split(",")[0].trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
    if (!hostname || hostname.length > 253) return { hostname: "", branding: null };

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc(
      "resolve_public_tenant_branding" as never,
      { _hostname: hostname } as never,
    );
    if (error || !data) return { hostname, branding: null };
    return { hostname, branding: data as unknown as PublicDomainBranding };
  },
);

/** Query-Key berücksichtigt den Hostname → keine Vermischung verschiedener Domains. */
export const publicDomainBrandingKey = (hostname: string) => ["public-domain-branding", hostname] as const;

function requestHostname(): string {
  const raw = getRequestHeader("x-forwarded-host") || getRequestHeader("host") || "";
  return raw.split(",")[0].trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

/**
 * Phase 3C.2 – Passt die angemeldete Person zur Firma der aufgerufenen Domain?
 * Nur Darstellung/Hinweis: gewährt NIE Zugriff, erzeugt keine Mitgliedschaft,
 * setzt keine Firma. Datenzugriff entscheiden weiterhin Mitgliedschaft + RLS.
 */
export const checkDomainAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ domainBranded: boolean; allowed: boolean; hostAgencyId: string | null; currentAgencyId: string | null }> => {
    // Serverseitig bestätigte aktive Firma (Quelle für den zentralen Render-Gate).
    const { data: currentRaw, error: curErr } = await context.supabase.rpc("current_agency_id");
    if (curErr) throw new Error("current_agency_id nicht bestätigt");
    const current = (currentRaw as string | null) ?? null;
    const hostname = requestHostname();
    if (!hostname) return { domainBranded: false, allowed: true, hostAgencyId: null, currentAgencyId: current };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pub } = await supabaseAdmin.rpc(
      "resolve_public_tenant_branding" as never,
      { _hostname: hostname } as never,
    );
    if (!pub) return { domainBranded: false, allowed: true, hostAgencyId: null, currentAgencyId: current }; // generische Domain
    const { data: rows } = await supabaseAdmin
      .from("tenant_domains")
      .select("agency_id, domain, domain_type, activated_at")
      .eq("verification_status", "verified")
      .ilike("domain", hostname);
    const row = (rows ?? []).find(
      (r: any) => r.domain.toLowerCase() === hostname && (r.domain_type === "subdomain" || r.activated_at),
    ) as { agency_id: string } | undefined;
    if (!row) return { domainBranded: true, allowed: false, hostAgencyId: null, currentAgencyId: current };
    const { data: ws } = await context.supabase.rpc("my_workspaces" as never);
    const isMember = ((ws ?? []) as { agency_id: string }[]).some((w) => w.agency_id === row.agency_id);
    return { domainBranded: true, allowed: !!current && current === row.agency_id, hostAgencyId: isMember ? row.agency_id : null, currentAgencyId: current };
  });
