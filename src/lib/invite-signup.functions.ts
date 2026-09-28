/**
 * Phase 5.6.1 – Invite-only Kontoerstellung.
 * Öffentliche Registrierung bleibt gesperrt. Ein Konto entsteht hier nur, wenn der
 * Einladungslink serverseitig gültig ist; E-Mail kommt ausschliesslich aus der Einladung.
 * Firma, Rolle und Mitgliedschaft entstehen NICHT hier, sondern danach atomar in invitation_accept.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const Input = z.object({
  token: z.string().regex(/^[a-f0-9]{64}$/),
  password: z.string().min(8).max(200),
  fullName: z.string().trim().min(1).max(120),
});

export type InviteSignupResult =
  | { ok: true; email: string }
  | { ok: false; reason: "invalid" | "expired" | "revoked" | "accepted" | "unavailable" | "account_exists" | "failed"; email?: string };

export const signupWithInvitation = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) => Input.parse(d))
  .handler(async ({ data }): Promise<InviteSignupResult> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: t, error } = await (supabaseAdmin.rpc as any)("invitation_signup_target", { _token: data.token });
    if (error || !t) return { ok: false, reason: "failed" };
    const target = t as { status: string; email?: string; account_exists?: boolean };
    if (target.status !== "pending") return { ok: false, reason: (target.status as never) ?? "invalid" };
    if (target.account_exists) return { ok: false, reason: "account_exists", email: target.email };
    const { error: cErr } = await supabaseAdmin.auth.admin.createUser({
      email: target.email!,
      password: data.password,
      email_confirm: true,
      user_metadata: { full_name: data.fullName, invited: true },
    });
    if (cErr) {
      if (/already|registered|exists/i.test(cErr.message)) return { ok: false, reason: "account_exists", email: target.email };
      console.error("invite signup failed", cErr.message);
      return { ok: false, reason: "failed" };
    }
    return { ok: true, email: target.email! };
  });
