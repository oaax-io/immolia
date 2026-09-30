// Microsoft 365 Kalender – serverseitige Helfer (nie im Browser importieren).
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export const MS_SCOPES = ["openid", "profile", "offline_access", "User.Read", "Calendars.ReadWrite"];
const AUTH_BASE = "https://login.microsoftonline.com/organizations/oauth2/v2.0";
export const GRAPH = "https://graph.microsoft.com/v1.0";

export function msConfig() {
  const clientId = process.env["MS_CLIENT_ID"];
  const clientSecret = process.env["MS_CLIENT_SECRET"];
  const redirectUri = process.env["MS_REDIRECT_URI"];
  const encKey = process.env["MS_TOKEN_ENCRYPTION_KEY"];
  if (!clientId || !clientSecret || !redirectUri || !encKey) return null;
  return { clientId, clientSecret, redirectUri, encKey };
}

export const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (n = 32) => b64url(randomBytes(n));

function key(raw: string) { return createHash("sha256").update(raw).digest(); }
export function encrypt(plain: string, raw: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(raw), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
export function decrypt(stored: string, raw: string) {
  const b = Buffer.from(stored, "base64");
  const d = createDecipheriv("aes-256-gcm", key(raw), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}

export function buildAuthorizeUrl(cfg: NonNullable<ReturnType<typeof msConfig>>, state: string, challenge: string, nonce: string, prompt?: string) {
  const u = new URL(`${AUTH_BASE}/authorize`);
  u.searchParams.set("client_id", cfg.clientId);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("redirect_uri", cfg.redirectUri);
  u.searchParams.set("response_mode", "query");
  u.searchParams.set("scope", MS_SCOPES.join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("nonce", nonce);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  if (prompt) u.searchParams.set("prompt", prompt);
  return u.toString();
}

export class MsTokenError extends Error {
  constructor(public code: "invalid_grant" | "admin_consent" | "transient" | "other", msg: string) { super(msg); }
}

export async function tokenRequest(cfg: NonNullable<ReturnType<typeof msConfig>>, params: Record<string, string>) {
  let res: Response;
  try {
    res = await fetch(`${AUTH_BASE}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: cfg.clientId, client_secret: cfg.clientSecret, scope: MS_SCOPES.join(" "), ...params }),
    });
  } catch { throw new MsTokenError("transient", "network"); }
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = String(j.error ?? "");
    const desc = String(j.error_description ?? "");
    if (res.status >= 500 || res.status === 429) throw new MsTokenError("transient", `http_${res.status}`);
    if (/AADSTS65001|AADSTS90094|AADSTS90008/.test(desc)) throw new MsTokenError("admin_consent", err);
    if (err === "invalid_grant" || err === "interaction_required") throw new MsTokenError("invalid_grant", err);
    throw new MsTokenError("other", err || `http_${res.status}`);
  }
  return j as { access_token: string; refresh_token?: string; expires_in: number; id_token?: string; scope?: string };
}

export function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const p = jwt.split(".")[1];
  return JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
}

type Admin = Awaited<typeof import("@/integrations/supabase/client.server")>["supabaseAdmin"];

export async function saveTokens(admin: Admin, connectionId: string, t: { access_token: string; refresh_token?: string; expires_in: number; scope?: string }, encKey: string) {
  const row: Record<string, unknown> = {
    connection_id: connectionId,
    access_token_ct: encrypt(t.access_token, encKey),
    access_token_expires_at: new Date(Date.now() + (t.expires_in - 60) * 1000).toISOString(),
    scopes: t.scope ? t.scope.split(" ") : null,
    refresh_lock_until: null,
    updated_at: new Date().toISOString(),
  };
  if (t.refresh_token) row.refresh_token_ct = encrypt(t.refresh_token, encKey);
  const { error } = await admin.from("calendar_connection_tokens").upsert(row as never, { onConflict: "connection_id" });
  if (error) throw new Error("token_store_failed");
}

/** Liefert ein gültiges Access Token; erneuert bei Bedarf mit Sperre. */
export async function getAccessToken(admin: Admin, connectionId: string): Promise<string> {
  const cfg = msConfig();
  if (!cfg) throw new MsTokenError("other", "configuration_required");
  for (let attempt = 0; attempt < 6; attempt++) {
    const { data: tok } = await admin.from("calendar_connection_tokens").select("*").eq("connection_id", connectionId).maybeSingle();
    if (!tok?.refresh_token_ct) throw new MsTokenError("invalid_grant", "no_token");
    if (tok.access_token_ct && tok.access_token_expires_at && new Date(tok.access_token_expires_at).getTime() > Date.now() + 60_000) {
      return decrypt(tok.access_token_ct, cfg.encKey);
    }
    const { data: locked } = await admin.rpc("calendar_token_try_lock", { _connection_id: connectionId, _seconds: 30 });
    if (!locked) { await new Promise((r) => setTimeout(r, 700)); continue; }
    try {
      const t = await tokenRequest(cfg, { grant_type: "refresh_token", refresh_token: decrypt(tok.refresh_token_ct, cfg.encKey) });
      await saveTokens(admin, connectionId, t, cfg.encKey); // gibt Sperre frei
      return t.access_token;
    } catch (e) {
      await admin.from("calendar_connection_tokens").update({ refresh_lock_until: null } as never).eq("connection_id", connectionId);
      if (e instanceof MsTokenError && (e.code === "invalid_grant" || e.code === "admin_consent")) {
        await admin.from("calendar_connections").update({
          status: e.code === "admin_consent" ? "admin_approval_required" : "reconnect_required",
          sync_enabled: false, last_error_code: e.code, last_error_at: new Date().toISOString(),
        } as never).eq("id", connectionId);
      } else {
        await admin.from("calendar_connections").update({ last_error_code: "token_refresh_transient", last_error_at: new Date().toISOString() } as never).eq("id", connectionId);
      }
      throw e;
    }
  }
  throw new MsTokenError("transient", "lock_timeout");
}

export async function graphGet<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`graph_${res.status}`);
  return (await res.json()) as T;
}
