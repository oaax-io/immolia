import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type Att = { url?: string; path?: string; name?: string; mime?: string };

// Plattform-Zugriff auf Feedback-Anhänge: Berechtigung prüft platform_feedback_attachments (is_platform_admin)
// als aufrufender Benutzer; erst danach signiert der Server kurzlebige Links.
export const getPlatformFeedbackAttachments = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ feedbackId: z.string().uuid() }).parse(d))
  .handler(async ({ data, context }) => {
    const { data: list, error } = await (context.supabase.rpc as any)("platform_feedback_attachments", {
      _feedback_id: data.feedbackId,
    });
    if (error) throw new Error("forbidden");
    const atts = (Array.isArray(list) ? list : []) as Att[];
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const out: { name: string; mime: string; url: string | null }[] = [];
    for (const a of atts) {
      const path = a.path ?? a.url?.match(/\/feedback\/(.+)$/)?.[1];
      let url: string | null = null;
      if (path) {
        const { data: s } = await supabaseAdmin.storage.from("feedback").createSignedUrl(decodeURIComponent(path), 900);
        url = s?.signedUrl ?? null;
      }
      out.push({ name: a.name ?? "Anhang", mime: a.mime ?? "", url });
    }
    return out;
  });
