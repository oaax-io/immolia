import { useModuleAccess, moduleForPath } from "@/hooks/useModuleAccess";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import {
  User, Bell, Building2, Palette, Banknote, Tags, Video, FileSignature, ChevronRight, Trash2, LayoutGrid, CalendarDays } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export const Route = createFileRoute("/_app/settings/")({ component: SettingsHome });

const TILES = [
  { to: "/settings/profile", icon: User, labelKey: "settings.tabs.profile", desc: "Name, Kontaktdaten und Sprache" },
  { to: "/settings/notifications", icon: Bell, labelKey: "settings.tabs.notifications", desc: "Benachrichtigungen und Kanäle" },
  { to: "/settings/company", icon: Building2, labelKey: "settings.tabs.company", desc: "Firmendaten und Adresse" },
  { to: "/settings/white-label", icon: Palette, labelKey: "", label: "White Label", desc: "Marke, Anmeldeseite und Domains" },
  { to: "/settings/modules", icon: LayoutGrid, labelKey: "", label: "Module", desc: "Verfügbare Bereiche ein- und ausschalten" },
  { to: "/settings/billing", icon: Banknote, labelKey: "", label: "Abo & Credits", desc: "Abo, Credits kaufen, Rechnungen" },
  { to: "/settings/banks", icon: Banknote, labelKey: "settings.tabs.banks", desc: "Bankkonten und Zahlungsangaben" },
  { to: "/settings/categories", icon: Tags, labelKey: "settings.tabs.categories", desc: "Kategorien im Dokumentencenter" },
  { to: "/settings/video", icon: Video, labelKey: "", label: "Video", desc: "LiveKit für Video-Meetings" },
  { to: "/settings/calendar", icon: CalendarDays, labelKey: "", label: "Microsoft-Kalender", desc: "Persönlichen Microsoft-365-Kalender verbinden" },
  { to: "/settings/esign", icon: FileSignature, labelKey: "settings.tabs.esign", desc: "PDF-Export und Signatur" },
  { to: "/settings/trash", icon: Trash2, labelKey: "", label: "Papierkorb", desc: "Gelöschtes ansehen und wiederherstellen" },
] as const;

function SettingsHome() {
  const { t } = useTranslation();
  const modAccess = useModuleAccess();
  return (
    <>
      <PageHeader i18nKey="settings" title={t("common.settings")} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {TILES.filter((tile) => modAccess.isEnabled(moduleForPath(tile.to))).map((tile) => (
          <Link key={tile.to} to={tile.to} className="group block">
            <Card className="h-full transition hover:border-primary/50 hover:shadow-md">
              <CardContent className="flex items-start gap-4 p-6">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary transition group-hover:bg-primary group-hover:text-primary-foreground">
                  <tile.icon className="h-6 w-6" />
                </span>
                <div className="min-w-0 flex-1">
                  <h2 className="flex items-center gap-1 font-semibold">
                    {tile.labelKey ? t(tile.labelKey) : (tile as { label?: string }).label}
                    <ChevronRight className="h-4 w-4 text-muted-foreground transition group-hover:translate-x-0.5" />
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">{tile.desc}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </>
  );
}
