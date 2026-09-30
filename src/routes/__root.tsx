import { Outlet, createRootRoute, HeadContent, Scripts, Link, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import appCss from "../styles.css?url";
import { AuthProvider } from "@/lib/auth";
import { makeQueryClient } from "@/lib/queryClient";
import { Toaster } from "@/components/ui/sonner";
import { TenantBrandingProvider } from "@/lib/tenant-branding";
import { ConfirmProvider } from "@/components/confirm/ConfirmProvider";
import "@/i18n";
import { resolvePublicDomainBranding, type PublicDomainBranding } from "@/lib/public-domain-branding.functions";

/** Öffentliches Branding der aufgerufenen Domain (nur Darstellung, keine Rechte). */
async function loadDomainBranding(): Promise<{ branding: PublicDomainBranding | null }> {
  try {
    const r = await resolvePublicDomainBranding();
    return { branding: r.branding };
  } catch {
    return { branding: null };
  }
}

function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-soft px-4">
      <div className="max-w-md text-center">
        <div className="text-7xl font-bold text-gradient-brand">404</div>
        <h2 className="mt-4 text-xl font-semibold">Seite nicht gefunden</h2>
        <p className="mt-2 text-sm text-muted-foreground">Die gesuchte Seite existiert nicht.</p>
        <Link to="/" className="mt-6 inline-flex rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground shadow-soft hover:opacity-90">
          Zur Startseite
        </Link>
      </div>
    </div>
  );
}

export const Route = createRootRoute({
  loader: () => loadDomainBranding(),
  staleTime: Infinity,
  shouldReload: false,
  head: ({ loaderData, matches }) => {
    // Platform Admin Center: immer Immolia, nie Domain-Branding.
    const isPlatform = matches.some((m) => /^\/platform(\/|$)/.test(String(m.routeId)));
    const favicon = (!isPlatform && loaderData?.branding?.favicon_url) || "/favicon.png";
    return {
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Immolia" },
      { name: "description", content: "Leads, Kunden, Immobilien, Finanzierung, Matching, Termine und Exposés in einem modernen, benutzerfreundlichen CRM." },
      { property: "og:title", content: "Immolia" },
      { name: "twitter:title", content: "Immolia" },
      { property: "og:description", content: "Leads, Kunden, Immobilien, Finanzierung, Matching, Termine und Exposés in einem modernen, benutzerfreundlichen CRM." },
      { name: "twitter:description", content: "Leads, Kunden, Immobilien, Finanzierung, Matching, Termine und Exposés in einem modernen, benutzerfreundlichen CRM." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/73a4c230-8589-4ad4-af23-38cce2cf105b/id-preview-ca4066a3--4e795f2c-5909-4255-a6b0-36cc8098ec55.lovable.app-1777392627602.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/73a4c230-8589-4ad4-af23-38cce2cf105b/id-preview-ca4066a3--4e795f2c-5909-4255-a6b0-36cc8098ec55.lovable.app-1777392627602.png" },
      { name: "twitter:card", content: "summary_large_image" },
      { property: "og:type", content: "website" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: favicon },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap" },
      { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap" },
    ],
  };
  },
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFound,
});

function RootShell({ children }: { children: React.ReactNode }) {
  const domainB = Route.useLoaderData({ select: (d) => d?.branding ?? null }) as PublicDomainBranding | null;
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  // /platform: Immolia-Plattform-Branding schon im ersten Bild, auch auf Firmen-Domains.
  const b = /^\/platform(\/|$)/.test(pathname) ? null : domainB;
  // Auf Firmen-Domains Farben und Tab-Titel schon im ersten Bild setzen (kein Immolia-Flash).
  const style = b
    ? ({
        ...(b.primary_color ? { "--tenant-primary": b.primary_color } : {}),
        ...(b.secondary_color ? { "--tenant-secondary": b.secondary_color } : {}),
        ...((b.accent_color || b.primary_color) ? { "--tenant-accent": b.accent_color || b.primary_color } : {}),
      } as React.CSSProperties)
    : undefined;
  const titleScript = b?.company_name
    ? `(function(){var n=${JSON.stringify(b.company_name).replace(/</g, "\\u003c")};document.title=document.title.replace(/Immolia/g,n);})();`
    : null;
  return (
    <html lang="de" style={style} data-domain-branded={b ? "1" : undefined} suppressHydrationWarning>
      <head>
        <HeadContent />
        {titleScript && <script dangerouslySetInnerHTML={{ __html: titleScript }} />}
      </head>
      <body>{children}<Scripts /></body>
    </html>
  );
}

function RootComponent() {
  const [qc] = useState(() => makeQueryClient());
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <TenantBrandingProvider>
          <ConfirmProvider>
            <Outlet />
            <Toaster richColors position="bottom-right" offset={{ bottom: "var(--chat-toast-offset, 24px)", right: "24px" }} mobileOffset={{ bottom: "var(--chat-toast-offset, 16px)" }} />
          </ConfirmProvider>
        </TenantBrandingProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
