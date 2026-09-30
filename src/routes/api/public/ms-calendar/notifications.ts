// Microsoft Graph Change- und Lifecycle-Notifications. Inhalte werden nie als Autorisierung genutzt:
// Zuordnung nur über gespeicherte subscription_id + clientState-Hash, danach nur ein Queue-Eintrag.
import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";

const Note = z.object({
  subscriptionId: z.string().max(200),
  clientState: z.string().max(256).optional().nullable(),
  lifecycleEvent: z.string().max(64).optional(),
  changeType: z.string().max(64).optional(),
}).passthrough();

export const Route = createFileRoute("/api/public/ms-calendar/notifications")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const url = new URL(request.url);
        const validation = url.searchParams.get("validationToken");
        if (validation) return new Response(validation.slice(0, 1024), { status: 200, headers: { "Content-Type": "text/plain" } });

        let body: unknown;
        try { body = await request.json(); } catch { return new Response("bad request", { status: 400 }); }
        const parsed = z.object({ value: z.array(Note).max(200) }).safeParse(body);
        if (!parsed.success) return new Response("bad request", { status: 400 });

        const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
        const { sha256 } = await import("@/lib/ms-calendar.server");
        const ids = [...new Set(parsed.data.value.map((n) => n.subscriptionId))];
        const { data: conns } = await admin.from("calendar_connections")
          .select("id, agency_id, status, sync_enabled, subscription_id, subscription_client_state_hash").in("subscription_id", ids);
        const minute = new Date().toISOString().slice(0, 16);
        const jobs: any[] = [];
        for (const n of parsed.data.value) {
          const c = (conns ?? []).find((x: any) => x.subscription_id === n.subscriptionId) as any;
          if (!c || !c.subscription_client_state_hash || !n.clientState) continue;
          const a = Buffer.from(sha256(n.clientState)), b = Buffer.from(c.subscription_client_state_hash);
          if (a.length !== b.length || !timingSafeEqual(a, b)) continue;
          if (c.status !== "connected" || !c.sync_enabled) continue;
          if (n.lifecycleEvent) {
            // reauthorizationRequired / subscriptionRemoved / missed → Subscription sichern + Delta nachholen
            jobs.push({ agency_id: c.agency_id, connection_id: c.id, job_type: "ensure_subscription", idempotency_key: `life:${n.lifecycleEvent}:${minute}` });
            if (n.lifecycleEvent !== "reauthorizationRequired") {
              if (n.lifecycleEvent === "subscriptionRemoved") await admin.from("calendar_connections").update({ subscription_id: null } as never).eq("id", c.id);
              jobs.push({ agency_id: c.agency_id, connection_id: c.id, job_type: "delta", idempotency_key: `life-delta:${minute}` });
            }
          } else {
            // Mehrfach-/ungeordnete Meldungen fallen auf einen Delta-Job pro Minute zusammen
            jobs.push({ agency_id: c.agency_id, connection_id: c.id, job_type: "delta", idempotency_key: `notify:${minute}` });
          }
        }
        if (jobs.length) {
          await admin.from("calendar_sync_jobs").upsert(jobs as never, { onConflict: "connection_id,idempotency_key", ignoreDuplicates: true });
          await admin.rpc("calendar_kick_worker" as never).then(() => {}, () => {});
        }
        return new Response(null, { status: 202 });
      },
    },
  },
});
