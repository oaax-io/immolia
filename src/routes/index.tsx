import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { isBackendUnavailableError } from "@/lib/backend-errors";

export const Route = createFileRoute("/")({
  head: () => ({ meta: [
    { title: "Immolia CRM – Anmeldung" },
    { name: "description", content: "Immolia CRM für Immobilien und Kunden." },
    { property: "og:title", content: "Immolia CRM – Anmeldung" },
    { property: "og:description", content: "Immolia CRM für Immobilien und Kunden." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
  ] }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session) {
      // Phase 4.8: kein Legacy-Superadmin-Ziel mehr; Plattform-Admin über das Kontomenü (/platform).
      void isBackendUnavailableError;
      throw redirect({ to: "/dashboard" });
    }
    throw redirect({ to: "/auth", search: { mode: "signin" } });
  },
  component: () => null,
});
