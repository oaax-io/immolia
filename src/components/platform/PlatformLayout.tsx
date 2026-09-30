import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard, Building2, Users, Globe, Blocks, Activity, ShieldCheck, Settings, LogOut, ArrowLeft, CreditCard,
  MessageSquare, Handshake,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import type { ReactNode } from "react";

/** Immolia Platform Admin – immer Plattform-Branding, nie Tenant-Branding. */
const NAV = [
  { section: null, items: [{ to: "/platform", label: "Übersicht", icon: LayoutDashboard, exact: true }] },
  { section: "Kunden", items: [
    { to: "/platform/tenants", label: "Unternehmen", icon: Building2 },
    { to: "/platform/users", label: "Benutzer", icon: Users },
  ] },
  { section: "Zugriff", items: [
    { to: "/platform/domains", label: "Domains", icon: Globe },
    { to: "/platform/modules", label: "Module", icon: Blocks },
    { to: "/platform/commercial", label: "Commercial", icon: CreditCard },
  ] },
  { section: "System", items: [
    { to: "/platform/feedback", label: "Feedback", icon: MessageSquare },
    { to: "/platform/activity", label: "Aktivität", icon: Activity },
    { to: "/platform/security", label: "Sicherheit", icon: ShieldCheck },
  ] },
  { section: "Konfiguration", items: [{ to: "/platform/settings", label: "Plattform", icon: Settings }] },
] as const;

export function PlatformLayout() {
  const { pathname } = useLocation();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="flex min-h-screen w-full bg-muted/30">
      <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r bg-background">
        <div className="flex h-16 flex-col justify-center border-b px-5">
          <span className="font-display text-base font-semibold">Immolia</span>
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">Platform Admin</span>
        </div>
        <nav className="flex-1 space-y-4 overflow-y-auto p-3">
          {NAV.map((g, i) => (
            <div key={i}>
              {g.section && <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{g.section}</div>}
              {g.items.map((it) => {
                const active = "exact" in it && it.exact ? pathname === it.to || pathname === it.to + "/" : pathname.startsWith(it.to);
                return (
                  <Link key={it.to} to={it.to}
                    className={`flex h-8 items-center gap-2 rounded-md px-2 text-sm ${active ? "bg-primary text-primary-foreground" : "text-foreground/80 hover:bg-muted"}`}>
                    <it.icon className="h-4 w-4" />{it.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="space-y-1 border-t p-3">
          <div className="truncate px-2 text-xs text-muted-foreground">{user?.email}</div>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => navigate({ to: "/dashboard" })}>
            <ArrowLeft className="mr-2 h-4 w-4" />Zur Firmen-App
          </Button>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={async () => { await signOut(); navigate({ to: "/auth", search: { mode: "signin" }, replace: true }); }}>
            <LogOut className="mr-2 h-4 w-4" />Abmelden
          </Button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6 lg:p-8"><Outlet /></main>
    </div>
  );
}

export function PlatformPage({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

export function QueryState({ isLoading, error }: { isLoading: boolean; error: unknown }) {
  if (isLoading) return <div className="text-sm text-muted-foreground">Wird geladen …</div>;
  if (error) return <div className="text-sm text-destructive">Daten konnten nicht geladen werden.</div>;
  return null;
}
