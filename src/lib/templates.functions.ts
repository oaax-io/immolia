import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

// Kein ASIMO-Seeding mehr (Core Consolidation 1): Vorlagen werden nie als
// Seiteneffekt eingespielt. Neutrale Immolia-Defaults siehe src/lib/template-catalog.ts.

/**
 * Sets a given template as default for its type. Atomically clears the
 * previous default via the SQL helper `set_default_template`.
 */
export const setDefaultTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ templateId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    // Als Benutzer aufrufen, damit die Rollenprüfung in set_default_template greift
    // (mit Vollzugriff wäre auth.uid() leer und die Prüfung wirkungslos).
    const { error } = await (context as any).supabase.rpc("set_default_template", { _template_id: data.templateId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });
