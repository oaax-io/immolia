import { QueryClient } from "@tanstack/react-query";
import { isBackendUnavailableError } from "@/lib/backend-errors";
import { tenantQueryKeyHash } from "@/lib/tenant-session";

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Cache-Isolation pro bestätigter Firma (Hotfix Zero Stale Tenant Data).
        queryKeyHashFn: tenantQueryKeyHash,
        // Daten 60s als frisch behandeln und 5min im Cache halten – damit
        // Navigation zwischen Seiten ohne erneute Requests funktioniert,
        // selbst wenn das Backend kurz wackelt.
        staleTime: 60_000,
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        // Letzte erfolgreiche Daten weiter anzeigen, während im Hintergrund
        // refetched wird – kein "leeres Dashboard" während eines Aussetzers.
        placeholderData: (prev: unknown) => prev,
        // Backend-Unavailable (503, Recovery, Schema-Cache) sind transient:
        // bis zu 8x mit exponentiellem Backoff retryen, gedeckelt bei 10s.
        // Andere Fehler nur einmal.
        retry: (failureCount, error) => {
          if (isBackendUnavailableError(error)) return failureCount < 8;
          return failureCount < 1;
        },
        retryDelay: (attemptIndex) =>
          Math.min(1000 * 2 ** attemptIndex, 10_000),
      },
      mutations: {
        retry: false,
      },
    },
  });
}
