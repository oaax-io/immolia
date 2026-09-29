import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type UsagePreview = {
  result: "free" | "included" | "credit_required" | "insufficient_credits" | "hard_blocked" | "not_available" | string;
  used: number | null;
  included: number | null;
  creditCost: number;
  balance: number | null;
  priceMissing: boolean;
};

/** Vorschau vor einer gezählten Aktion – reine Leseabfrage, Firma = aktive Firma des Benutzers. */
export const getUsagePreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ usageKey: z.string().regex(/^[a-z_]{2,60}$/) }).parse(d))
  .handler(async ({ data, context }): Promise<UsagePreview> => {
    const { data: d, error } = await (context.supabase as any).rpc("commercial_usage_decision", { _usage_key: data.usageKey, _requested_quantity: 1 });
    if (error) throw new Error("Nutzung konnte nicht geladen werden");
    const num = (v: unknown) => (v == null ? null : Number(v));
    return {
      result: d?.result ?? "free",
      used: num(d?.used),
      included: num(d?.included),
      creditCost: Number(d?.credit_cost ?? 0),
      balance: num(d?.credit_balance),
      priceMissing: d?.reason === "overage_cost_not_set",
    };
  });
