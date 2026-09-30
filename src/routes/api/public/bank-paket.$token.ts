import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/bank-paket/$token")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const token = String(params.token ?? "").trim();
        if (!token || token.length < 10 || token.length > 80 || !/^[a-zA-Z0-9]+$/.test(token)) {
          return new Response("Invalid token", { status: 400 });
        }
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data: share, error } = await supabaseAdmin
          .from("bank_package_shares")
          .select("storage_path, expires_at, client_name")
          .eq("token", token)
          .maybeSingle();
        if (error || !share) return new Response("Not found", { status: 404 });
        // Phase 4.8.1: gesperrte/archivierte Firma → neutral «nicht gefunden»
        const { data: active } = await (supabaseAdmin.rpc as any)("bank_package_share_active", { _token: token });
        if (active !== true) return new Response("Not found", { status: 404 });
        if (new Date(share.expires_at).getTime() < Date.now()) {
          return new Response("Link expired", { status: 410 });
        }

        // Datei direkt durchreichen (Stream), nie komplett in den Server-Speicher laden.
        const { data: signed } = await supabaseAdmin.storage
          .from("bank-packages")
          .createSignedUrl(share.storage_path, 60);
        if (!signed?.signedUrl) return new Response("File not found", { status: 404 });
        const upstream = await fetch(signed.signedUrl);
        if (!upstream.ok || !upstream.body) return new Response("File not found", { status: 404 });
        const safeName =
          (share.client_name ?? "Dossier")
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .replace(/[^a-zA-Z0-9._ -]/g, "_")
            .slice(0, 80) || "Dossier";
        const filename = `Bank-Paket_${safeName}.zip`;

        const len = upstream.headers.get("content-length");
        return new Response(upstream.body, {
          status: 200,
          headers: {
            ...(len ? { "Content-Length": len } : {}),
            "Content-Type": "application/zip",
            "Content-Disposition": `attachment; filename="${filename}"`,
            "Cache-Control": "private, no-store",
          },
        });
      },
    },
  },
});
