import { createFileRoute } from "@tanstack/react-router";
import { PlatformPage } from "@/components/platform/PlatformLayout";
import { PartnerCenter } from "@/components/platform/PartnerCenter";

export const Route = createFileRoute("/platform/partners")({
  head: () => ({
    meta: [
      { title: "Partner Center – Immolia Platform" },
      { name: "description", content: "Zentraler Partnerkatalog für alle Unternehmen: Banken, Versicherungen, Handwerker und Portale." },
      { property: "og:title", content: "Partner Center – Immolia Platform" },
      { property: "og:description", content: "Zentraler Partnerkatalog für alle Unternehmen." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: () => (
    <PlatformPage title="Partner Center" description="Zentraler Katalog für alle Unternehmen: Banken, Versicherungen, Handwerker, Inserateplattformen. Keine CRM-Daten.">
      <PartnerCenter />
    </PlatformPage>
  ),
});
