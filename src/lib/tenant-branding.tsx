/**
 * White-Label-Runtime: einziger Ort, an dem die App Branding bezieht.
 * Komponenten nutzen useTenantBranding() – keine direkten Abfragen auf
 * brand_settings/company. Branding ist Darstellung, keine Autorisierung.
 */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDomainAccess } from "@/components/DomainAccessGate";
import { useRouterState, useLoaderData } from "@tanstack/react-router";
import type { PublicDomainBranding } from "@/lib/public-domain-branding.functions";
import { useAuth } from "@/lib/auth";
import { useTenantConfig, TENANT_CONFIG_QUERY_KEY, type TenantCompany, type TenantBranding } from "@/lib/tenant-config";
import { useConfirmedAgencyId } from "@/lib/tenant-session";

/** Neutraler Plattform-Fallback (kein Tenant-Kontext). Keine ASIMO-Werte. */
export const PLATFORM_BRANDING = {
  productName: "Immolia",
  primaryColor: "#334155",
  secondaryColor: "#64748b",
  accentColor: "#0ea5e9",
  faviconUrl: "/favicon.png",
} as const;

export type TenantBrandingValue = {
  agencyId: string | null;
  agencyName: string | null;
  companyName: string;
  logoUrl: string | null;
  alternativeLogoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  fontFamily: string | null;
  companyEmail: string | null;
  companyWebsite: string | null;
  companyAddress: string | null;
  company: TenantCompany | null;
  /** Rohdaten für Berichte/PDFs (null ohne Tenant). */
  raw: TenantBranding | null;
  isLoading: boolean;
  hasTenantContext: boolean;
};

const FALLBACK: TenantBrandingValue = {
  agencyId: null,
  agencyName: null,
  companyName: PLATFORM_BRANDING.productName,
  logoUrl: null,
  alternativeLogoUrl: null,
  faviconUrl: PLATFORM_BRANDING.faviconUrl,
  primaryColor: PLATFORM_BRANDING.primaryColor,
  secondaryColor: PLATFORM_BRANDING.secondaryColor,
  accentColor: PLATFORM_BRANDING.accentColor,
  fontFamily: null,
  companyEmail: null,
  companyWebsite: null,
  companyAddress: null,
  company: null,
  raw: null,
  isLoading: false,
  hasTenantContext: false,
};

const Ctx = createContext<TenantBrandingValue>(FALLBACK);

export function TenantBrandingProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const qc = useQueryClient();
  const q = useTenantConfig(!!user);
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  // Plattform-Bereiche verwenden nie Tenant-Branding.
  // Öffentliche Seiten (Login, Token-Links) nie mit dem Branding der Session:
  // dort gilt Immolia bzw. das serverseitig über Token → Agency ermittelte Branding.
  const isPlatformArea =
    /^\/(oaax|platform|admin)(\/|$)/.test(pathname) ||
    /^\/(auth|set-password|p|bank-paket|finanzierung|selbstauskunft)(\/|$)/.test(pathname);

  // Öffentliches Branding der aufgerufenen Domain (serverseitig über den Hostname ermittelt).
  const domainBrand = useLoaderData({ strict: false, from: "__root__" as never, select: (d: any) => d?.branding ?? null }) as PublicDomainBranding | null;
  // Ergebnis der Domain-Prüfung aus dem Cache (DomainAccessGate lädt es). Nur Darstellung.
  const access = useDomainAccess(false);
  const confirmedAgencyId = useConfirmedAgencyId();
  const accessAllowed = access.data?.allowed === true && !!confirmedAgencyId && access.data?.currentAgencyId === confirmedAgencyId;

  // Bei Benutzerwechsel/Logout keine fremde Konfiguration im Cache behalten.
  useEffect(() => {
    qc.removeQueries({ queryKey: TENANT_CONFIG_QUERY_KEY });
  }, [user?.id, qc]);

  const value = useMemo<TenantBrandingValue>(() => {
    const base = computeValue();
    // Auf einer Firmen-Domain: solange nicht bestätigt ist, dass die Session zu dieser
    // Firma gehört (Laden, Kein Zugriff), nur das öffentliche Domain-Branding zeigen –
    // weder Immolia noch das Branding der eigenen Firma.
    if (domainBrand && !isPlatformArea && !(accessAllowed && base.hasTenantContext)) {
      return {
        ...FALLBACK,
        isLoading: base.isLoading,
        companyName: domainBrand.company_name || PLATFORM_BRANDING.productName,
        logoUrl: domainBrand.logo_url,
        alternativeLogoUrl: domainBrand.logo_alt_url,
        faviconUrl: domainBrand.favicon_url || PLATFORM_BRANDING.faviconUrl,
        primaryColor: domainBrand.primary_color || PLATFORM_BRANDING.primaryColor,
        secondaryColor: domainBrand.secondary_color || PLATFORM_BRANDING.secondaryColor,
        accentColor: domainBrand.accent_color || domainBrand.primary_color || PLATFORM_BRANDING.accentColor,
        hasTenantContext: true,
      };
    }
    return base;

    function computeValue(): TenantBrandingValue {
    const cfg = user && !isPlatformArea ? q.data : null;
    const b = cfg?.branding ?? null;
    // Branding nur aus demselben bestätigten Tenant-Kontext wie die Daten.
    if (!cfg || !b || (!!cfg.agency_id && confirmedAgencyId !== cfg.agency_id)) {
      return { ...FALLBACK, isLoading: authLoading || (!!user && q.isLoading) };
    }
    return {
      agencyId: cfg.agency_id,
      agencyName: cfg.agency_name ?? null,
      companyName: b.company_name || cfg.agency_name || PLATFORM_BRANDING.productName,
      logoUrl: b.logo_url,
      alternativeLogoUrl: b.logo_alt_url,
      faviconUrl: b.favicon_url || PLATFORM_BRANDING.faviconUrl,
      primaryColor: b.app_primary_color || b.primary_color || PLATFORM_BRANDING.primaryColor,
      secondaryColor: b.app_secondary_color || b.secondary_color || PLATFORM_BRANDING.secondaryColor,
      accentColor: b.app_accent_color || b.accent_color || b.app_primary_color || b.primary_color || PLATFORM_BRANDING.accentColor,
      fontFamily: b.font_family,
      companyEmail: b.company_email,
      companyWebsite: b.company_website,
      companyAddress: b.company_address,
      company: b.company ?? null,
      raw: b,
      isLoading: false,
      hasTenantContext: true,
    };
    }
  }, [user, q.data, q.isLoading, authLoading, isPlatformArea, domainBrand, accessAllowed, confirmedAgencyId]);

  // Zentrale CSS-Variablen + Favicon
  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.style.setProperty("--tenant-primary", value.primaryColor);
    root.style.setProperty("--tenant-secondary", value.secondaryColor);
    root.style.setProperty("--tenant-accent", value.accentColor);
    root.dataset.tenantContext = value.hasTenantContext ? "tenant" : "platform";
    // Login auf einer Firmen-Domain setzt sein Tab-Icon selbst.
    if (value.faviconUrl && root.dataset.domainBranding !== "1") {
      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      if (link.getAttribute("href") !== value.faviconUrl) link.href = value.faviconUrl;
    }
  }, [value.primaryColor, value.secondaryColor, value.accentColor, value.faviconUrl, value.hasTenantContext, pathname]);

  // Browser-Titel: Plattformname in Seitentiteln durch den Tenant-Namen ersetzen.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const name = value.hasTenantContext ? value.companyName : PLATFORM_BRANDING.productName;
    const apply = () => {
      const t = document.title;
      if (!t) return;
      const next = value.hasTenantContext
        ? t.replace(/Immolia/g, name)
        : t;
      if (next !== t) document.title = next;
    };
    apply();
    const el = document.querySelector("title");
    if (!el) return;
    const obs = new MutationObserver(apply);
    obs.observe(el, { childList: true, characterData: true, subtree: true });
    return () => obs.disconnect();
  }, [value.hasTenantContext, value.companyName, pathname]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useTenantBranding(): TenantBrandingValue {
  return useContext(Ctx);
}

/** Briefkopf-Daten für Finanzierungsberichte (gleiche Form wie bisher brand_settings). */
export function reportBrandFrom(b: TenantBrandingValue) {
  if (!b.raw) return null;
  return {
    company_name: b.raw.company_name,
    company_address: b.raw.company_address,
    company_email: b.raw.company_email,
    company_website: b.raw.company_website,
    logo_url: b.raw.logo_url,
    primary_color: b.raw.primary_color,
    secondary_color: b.raw.secondary_color,
    font_family: b.raw.font_family,
  };
}
