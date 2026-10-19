/**
 * Phase 4.4 – DNS-Prüfung einer Custom Domain durch den Platform Admin.
 * Gleiche TXT-Logik wie Phase 3C.5; Ergebnis wird nur vom Server gespeichert.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function lookupTxt(name: string): Promise<string[]> {
  const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=TXT`, {
    headers: { accept: "application/dns-json" },
  });
  if (!res.ok) throw new Error("DNS-Abfrage fehlgeschlagen");
  const json = (await res.json()) as { Answer?: { type: number; data: string }[] };
  return (json.Answer ?? []).filter((a) => a.type === 16).map((a) => a.data.replace(/"\s*"/g, "").replace(/^"|"$/g, "").trim());
}

export const platformVerifyDomain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }): Promise<{ status: string; message: string }> => {
    // platform_domain_dns_record prüft is_platform_admin() serverseitig.
    const { data: rec, error } = await context.supabase.rpc("platform_domain_dns_record" as never, { _id: data.id } as never);
    if (error) throw new Error("Keine Berechtigung");
    const r = rec as unknown as { name: string; value: string | null } | null;
    if (!r || !r.value) throw new Error("Keine Custom Domain zur Prüfung");
    let ok = false;
    let err = "";
    try {
      const values = await lookupTxt(r.name);
      ok = values.includes(r.value);
      if (!ok) err = values.length ? "Der TXT-Eintrag hat einen anderen Wert." : "Kein TXT-Eintrag gefunden.";
    } catch (e) {
      err = (e as Error).message;
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: st, error: e2 } = await supabaseAdmin.rpc("platform_domain_record_check" as never,
      { _actor: context.userId, _id: data.id, _ok: ok, _error: err } as never);
    if (e2) throw new Error("Prüfung konnte nicht gespeichert werden");
    return ok || st === "verified"
      ? { status: "verified", message: "Domain bestätigt" }
      : { status: "failed", message: `${err} DNS-Änderungen können bis zu 72 Stunden dauern.` };
  });
