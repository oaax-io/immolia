import { createFileRoute } from "@tanstack/react-router";
import { PartnerContactsManager } from "@/components/settings/PartnerContactsManager";
import { SettingsPageShell } from "@/components/settings/SettingsPageShell";

export const Route = createFileRoute("/_app/settings/partners")({ component: PartnerSettings });

function PartnerSettings() {
  return (
    <SettingsPageShell
      title="Partner"
      description="Zentrale Partner stehen allen Firmen zur Verfügung. Hier erfassen Sie zusätzlich Ihre eigenen Ansprechpartner."
    >
      <PartnerContactsManager />
    </SettingsPageShell>
  );
}
