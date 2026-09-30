// Hintergrund-Worker für die Kalendersynchronisation. Wird von der Datenbank angestossen.
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

export const Route = createFileRoute("/api/public/ms-calendar/worker")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const provided = request.headers.get("x-worker-token") ?? "";
        const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
        const { data: cfg } = await admin.from("calendar_worker_config").select("token").eq("id", 1).maybeSingle();
        const expected = (cfg as any)?.token ?? "";
        const a = Buffer.from(provided), b = Buffer.from(expected);
        if (!expected || a.length !== b.length || !timingSafeEqual(a, b)) return new Response("Unauthorized", { status: 401 });
        const { runCalendarWorker } = await import("@/lib/ms-calendar-sync.server");
        const r = await runCalendarWorker(admin);
        return Response.json(r);
      },
    },
  },
});
