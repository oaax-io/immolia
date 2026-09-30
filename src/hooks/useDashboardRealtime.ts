import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const TABLES = [
  "financing_dossiers",
  "clients",
  "leads",
  "properties",
  "appointments",
  "reservations",
  "client_self_disclosures",
  "generated_documents",
  "property_media",
  "tasks",
] as const;

/**
 * Live-Aktualisierung: sobald jemand im Team Daten ändert, werden die
 * Dashboard-Abfragen neu geladen. Bewusst nur Invalidierung (kein Patchen des
 * Caches), damit RLS immer erneut serverseitig entscheidet, was sichtbar ist.
 */
export function useDashboardRealtime() {
  const qc = useQueryClient();
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        qc.invalidateQueries({ queryKey: ["dashboard"] });
      }, 600);
    };

    const channel = supabase.channel("dashboard-live");
    for (const table of TABLES) {
      channel.on("postgres_changes", { event: "*", schema: "public", table }, bump);
    }
    channel.subscribe();

    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [qc]);
}
