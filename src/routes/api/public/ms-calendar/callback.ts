// Zentraler Microsoft-OAuth-Callback. Firma/Benutzer kommen ausschliesslich aus dem
// serverseitig gespeicherten, einmaligen Verbindungsversuch – nie aus der URL.
import { createFileRoute } from "@tanstack/react-router";
import { GENERIC_APP_HOST } from "@/lib/workspaces";

function back(host: string | null, path: string | null, result: string) {
  const u = new URL(`https://${host || GENERIC_APP_HOST}${path || "/settings/calendar"}`);
  u.searchParams.set("ms", result);
  return new Response(null, { status: 302, headers: { Location: u.toString(), "Cache-Control": "no-store" } });
}

export const Route = createFileRoute("/api/public/ms-calendar/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const s = await import("@/lib/ms-calendar.server");
        const cfg = s.msConfig();
        const url = new URL(request.url);
        const state = url.searchParams.get("state");
        if (!cfg) return back(null, null, "configuration_required");
        if (!state || state.length > 200) return back(null, null, "invalid");

        const { supabaseAdmin: admin } = await import("@/integrations/supabase/client.server");
        const { data: rows } = await admin.rpc("calendar_oauth_consume", { _state_hash: s.sha256(state) });
        const att = (rows as any[] | null)?.[0];
        if (!att) return back(null, null, "expired");
        const ret = (r: string) => back(att.return_host, att.return_path, r);

        const upsertStatus = async (status: string, code: string) => {
          await admin.from("calendar_connections").upsert({
            agency_id: att.agency_id, user_id: att.user_id, provider: "microsoft", status,
            sync_enabled: false, last_error_code: code, last_error_at: new Date().toISOString(),
          } as never, { onConflict: "agency_id,user_id,provider" });
        };

        const err = url.searchParams.get("error");
        if (err) {
          const desc = url.searchParams.get("error_description") ?? "";
          if (/AADSTS65001|AADSTS90094|AADSTS90008|admin/i.test(desc) || err === "consent_required") {
            await upsertStatus("admin_approval_required", "admin_consent");
            return ret("admin_approval_required");
          }
          return ret(err === "access_denied" && /AADSTS65004/.test(desc) ? "denied" : "canceled");
        }
        const code = url.searchParams.get("code");
        if (!code) return ret("invalid");

        const { data: ok } = await admin.rpc("calendar_membership_active", { _agency_id: att.agency_id, _user_id: att.user_id });
        if (!ok) return ret("forbidden");

        try {
          const verifier = s.decrypt(att.code_verifier_ct, cfg.encKey);
          const t = await s.tokenRequest(cfg, { grant_type: "authorization_code", code, redirect_uri: cfg.redirectUri, code_verifier: verifier });
          if (!t.id_token || !t.refresh_token) return ret("error");
          const claims = s.decodeJwtPayload(t.id_token);
          const now = Date.now() / 1000;
          if (claims.aud !== cfg.clientId || !claims.nonce || s.sha256(String(claims.nonce)) !== att.nonce_hash
              || typeof claims.exp !== "number" || claims.exp < now || !claims.tid || !claims.oid
              || !String(claims.iss ?? "").startsWith("https://login.microsoftonline.com/")) {
            return ret("invalid");
          }
          // Identität zusätzlich über Graph mit dem frischen Token bestätigen
          const me = await s.graphGet<{ id: string; displayName?: string; userPrincipalName?: string; mail?: string }>(t.access_token, "/me?$select=id,displayName,userPrincipalName,mail");
          if (me.id !== claims.oid) return ret("invalid");

          const { data: prev } = await admin.from("calendar_connections").select("ms_user_id")
            .eq("agency_id", att.agency_id).eq("user_id", att.user_id).eq("provider", "microsoft").maybeSingle();
          const sameAccount = (prev as any)?.ms_user_id === me.id;
          const { data: conn, error } = await admin.from("calendar_connections").upsert({
            agency_id: att.agency_id, user_id: att.user_id, provider: "microsoft",
            ms_tenant_id: String(claims.tid), ms_user_id: me.id,
            account_display: me.mail || me.userPrincipalName || me.displayName || null,
            ...(sameAccount ? {} : { selected_calendar_id: null, selected_calendar_name: null, delta_link: null }),
            status: "connecting", sync_enabled: false, last_error_code: null, last_error_at: null,
            updated_at: new Date().toISOString(),
          } as never, { onConflict: "agency_id,user_id,provider" }).select("id, ms_user_id, selected_calendar_id").single();
          if (error || !conn) return ret("error");
          await s.saveTokens(admin, (conn as any).id, t, cfg.encKey);
          // War bereits ein Kalender gewählt (Reconnect mit demselben Konto) → direkt wieder verbunden
          if ((conn as any).selected_calendar_id) {
            await admin.from("calendar_connections").update({ status: "connected", sync_enabled: true } as never).eq("id", (conn as any).id);
            return ret("connected");
          }
          return ret("choose_calendar");
        } catch (e) {
          const c = e instanceof s.MsTokenError ? e.code : "other";
          if (c === "admin_consent") { await upsertStatus("admin_approval_required", "admin_consent"); return ret("admin_approval_required"); }
          console.error("ms-calendar callback failed:", c);
          return ret("error");
        }
      },
    },
  },
});
