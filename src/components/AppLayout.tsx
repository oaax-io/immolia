import { Link, useLocation, useNavigate, Outlet } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import {
  LayoutDashboard, Users, UserPlus, Building2, Calendar, Target,
  Settings, LogOut, Search, Shield, Users2, CheckSquare, FileText,
  Image as ImageIcon,
  Banknote, BarChart3, MessageSquarePlus, BookOpen, Percent,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useMyProfile } from "@/hooks/useMyProfile";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
  SidebarProvider, SidebarTrigger, SidebarInset, useSidebar,
} from "@/components/ui/sidebar";
import { useTenantBranding } from "@/lib/tenant-branding";

import { GlobalSearch } from "@/components/GlobalSearch";
import { NotificationCenter } from "@/components/NotificationCenter";
import { TeamInbox } from "@/components/TeamInbox";
import { ChatDockProvider } from "@/components/chat/ChatDock";
import { LanguageBootstrap } from "@/components/LanguageBootstrap";
import { PresenceSubMenu, useMyPresence } from "@/components/presence/PresenceSubMenu";
import { PresenceDot } from "@/components/presence/PresenceDot";
import { useAutoPresence } from "@/hooks/useAutoPresence";

import { useTranslation } from "react-i18next";
import { useModuleAccess, moduleForPath } from "@/hooks/useModuleAccess";
import { WorkspaceMenuItems } from "@/components/WorkspaceSwitcher";

function MyPresenceDot() {
  const { data: presence } = useMyPresence();
  return (
    <PresenceDot
      status={presence?.status}
      updatedAt={presence?.updatedAt}
      className="absolute -bottom-0.5 -right-0.5"
    />
  );
}
// touch

const NAV_GROUPS = [
  {
    labelKey: "nav.groups.main",
    items: [
      { to: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard },
      { to: "/leads", labelKey: "nav.leads", icon: UserPlus },
      { to: "/clients", labelKey: "nav.clients", icon: Users },
      { to: "/properties", labelKey: "nav.properties", icon: Building2 },
      { to: "/matching", labelKey: "nav.matching", icon: Target },
      { to: "/financing", labelKey: "nav.financing", icon: Banknote },
      { to: "/appointments", labelKey: "nav.appointments", icon: Calendar },
      { to: "/tasks", labelKey: "nav.tasks", icon: CheckSquare },
      { to: "/analytics", labelKey: "nav.analytics", icon: BarChart3 },
      { to: "/commissions", labelKey: "nav.commissions", icon: Percent },

    ],
  },
  {
    labelKey: "nav.groups.admin",
    items: [
      { to: "/documents", labelKey: "nav.documents", icon: FileText },
      { to: "/media", labelKey: "nav.media", icon: ImageIcon },
    ],
  },
] as const;


function AppSidebar() {
  const { pathname } = useLocation();
  const { state } = useSidebar();
  const { t } = useTranslation();
  const collapsed = state === "collapsed";
  const brand = useTenantBranding();
  const modules = useModuleAccess();
  const fullLogo = brand.alternativeLogoUrl ?? brand.logoUrl;
  const iconLogo = brand.faviconUrl && brand.hasTenantContext ? brand.faviconUrl : null;

  return (
    <Sidebar collapsible="icon" className="border-r border-sidebar-border">
      <SidebarHeader className="h-16 border-b border-sidebar-border p-0">
        <Link
          to="/dashboard"
          className={`flex h-16 items-center isolate ${collapsed ? "justify-center px-0" : "justify-start pl-4"}`}
        >
          {collapsed ? (
            iconLogo ? (
              <img src={iconLogo} alt={brand.companyName} className="h-7 w-7 shrink-0 object-contain" />
            ) : (
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-sidebar-primary text-xs font-bold text-sidebar-primary-foreground">
                {brand.companyName.charAt(0)}
              </span>
            )
          ) : fullLogo ? (
            <img src={fullLogo} alt={brand.companyName} className="h-6 w-auto" />
          ) : (
            <span className="font-display text-base font-semibold text-sidebar-foreground">{brand.companyName}</span>
          )}
        </Link>
      </SidebarHeader>

      <SidebarContent className="gap-0 overflow-y-auto">
        {NAV_GROUPS.map((group) => (
          <SidebarGroup key={group.labelKey} className="px-2 py-1.5">
            <SidebarGroupContent>
              <SidebarMenu className="gap-1">
                {group.items.filter((item) => modules.isEnabled(moduleForPath(item.to))).map((item) => {
                  const active =
                    item.to === "/dashboard"
                      ? pathname === "/dashboard"
                      : pathname.startsWith(item.to);
                  const label = t(item.labelKey);
                  return (
                    <SidebarMenuItem key={item.to}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={label}
                        size="sm"
                        className="h-8 text-sm text-sidebar-foreground/90 hover:bg-brand-deep hover:text-brand-deep-foreground data-[active=true]:bg-brand-deep data-[active=true]:text-brand-deep-foreground"
                      >
                        <Link to={item.to}>
                          <item.icon className="h-[18px] w-[18px]" />
                          <span>{label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border p-1">
        {!collapsed && (
          <p className="px-2 text-[9px] uppercase tracking-wider text-sidebar-foreground/40">
            {brand.hasTenantContext ? brand.companyName : "Immolia"}
          </p>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}

function ModuleGate({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const { isEnabled, loaded } = useModuleAccess();
  const mod = moduleForPath(pathname);
  if (mod && !loaded) return null; // keine Daten laden, bevor Freischaltung bekannt ist
  if (mod && loaded && !isEnabled(mod)) {
    return (
      <div className="mx-auto mt-16 max-w-md text-center">
        <h1 className="font-display text-xl font-semibold">Modul nicht freigeschaltet</h1>
        <p className="mt-2 text-sm text-muted-foreground">Dieser Bereich ist für Ihr Unternehmen nicht verfügbar.</p>
        <Button asChild className="mt-6"><Link to="/dashboard">Zum Dashboard</Link></Button>
      </div>
    );
  }
  return <>{children}</>;
}

export default function AppLayout({ children }: { children?: ReactNode }) {
  const { user, loading, signOut, isSuperadmin } = useAuth();
  const modAccess = useModuleAccess();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const { avatarUrl, fullName, initials } = useMyProfile();
  const { data: isPlatformAdmin } = useQuery({
    queryKey: ["is_platform_admin", user?.id],
    enabled: !!user,
    queryFn: async () => (await supabase.rpc("is_platform_admin")).data === true,
  });

  useAutoPresence();



  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!loading && !user) navigate({ to: "/auth", search: { mode: "signin" } });
  }, [user, loading, navigate]);

  if (loading || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-soft">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }


  return (
    <ChatDockProvider>
    <SidebarProvider defaultOpen>
      <LanguageBootstrap />
      <div className="flex min-h-screen w-full bg-background">
        <AppSidebar />
        <SidebarInset className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b bg-background/80 px-4 backdrop-blur lg:px-6">
            <SidebarTrigger />

            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="relative hidden h-9 max-w-md flex-1 items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted-foreground transition hover:border-primary/50 hover:text-foreground md:flex"
            >
              <Search className="h-4 w-4" />
              <span className="flex-1 text-left">{t("common.search")}</span>
              <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium lg:inline">⌘K</kbd>
            </button>
            <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />


            <div className="ml-auto flex items-center gap-2">
              {modAccess.isEnabled("feedback") && (
                <Button variant="outline" size="sm" className="gap-2" onClick={() => navigate({ to: "/feedback" })}>
                  <MessageSquarePlus className="h-4 w-4" />
                  <span className="hidden sm:inline">{t("common.feedback")}</span>
                </Button>
              )}
              <TeamInbox />
              <NotificationCenter />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" className="gap-2 px-2">
                    <span className="relative">
                      <Avatar className="h-8 w-8">
                        {avatarUrl ? (
                          <AvatarImage src={avatarUrl} alt={fullName || "Profilbild"} />
                        ) : null}
                        <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                          {initials}
                        </AvatarFallback>
                      </Avatar>
                      <MyPresenceDot />
                    </span>
                    <span className="hidden text-sm font-medium md:block">
                      {fullName}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>{t("common.myAccount")}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {user.email && (
                    <div className="px-2 pb-1 text-xs text-muted-foreground truncate">
                      {user.email}
                    </div>
                  )}
                  <DropdownMenuSeparator />
                  <PresenceSubMenu />
                  <WorkspaceMenuItems />
                  {/* Phase 4.8: altes OAAX-Center stillgelegt – Plattform-Admin nur über /platform */}
                  {false && isSuperadmin && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
                        {t("common.switchTo")}
                      </DropdownMenuLabel>
                      <DropdownMenuItem onClick={() => navigate({ to: "/oaax" })}>
                        <Shield className="mr-2 h-4 w-4 text-primary" />
                        <span className="flex-1">OAAX Admin Center</span>
                        <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold uppercase tracking-wider text-primary">
                          Admin
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  {isPlatformAdmin && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => navigate({ to: "/platform" })}>
                        <Shield className="mr-2 h-4 w-4" />Immolia Platform Admin
                      </DropdownMenuItem>
                    </>
                  )}
                  <DropdownMenuSeparator />
                  {modAccess.isEnabled("employees") && (
                  <DropdownMenuItem onClick={() => navigate({ to: "/team" })}>
                    <Users2 className="mr-2 h-4 w-4" />{t("nav.team")}
                  </DropdownMenuItem>
                  )}
                  {modAccess.isEnabled("feedback") && (
                  <DropdownMenuItem onClick={() => navigate({ to: "/feedback" })}>
                    <MessageSquarePlus className="mr-2 h-4 w-4" />{t("nav.feedback")}
                  </DropdownMenuItem>
                  )}
                  {modAccess.isEnabled("docs") && (
                  <DropdownMenuItem onClick={() => navigate({ to: "/docs" })}>
                    <BookOpen className="mr-2 h-4 w-4" />{t("nav.docs")}
                  </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate({ to: "/settings" })}>
                    <Settings className="mr-2 h-4 w-4" />{t("common.settings")}
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={async () => { await signOut(); navigate({ to: "/" }); }}>
                    <LogOut className="mr-2 h-4 w-4" />{t("common.logout")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <main className="flex-1 p-4 lg:p-8"><ModuleGate>{children ?? <Outlet />}</ModuleGate></main>
        </SidebarInset>
      </div>
    </SidebarProvider>
    </ChatDockProvider>
  );
}
