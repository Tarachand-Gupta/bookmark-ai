import { z } from "zod";

/**
 * Plans. There is exactly one today — everyone is on Free — but the plan is a
 * real, persisted attribute (master migration v3, `tenants.plan`, default
 * 'free') so a paid tier later is a data change, not a schema change. The
 * feature copy lives HERE so the marketing pricing card, Settings → Account and
 * the native apps all render from one list and can't drift.
 *
 * Honest footnote every surface carries: fair-use abuse caps still exist
 * (`enforceQuota` daily caps, the live server's per-device push cap) — "unlimited"
 * means "no plan limit", not "no abuse limit".
 */
export const planIdSchema = z.enum(["free"]);
export type PlanId = z.infer<typeof planIdSchema>;

export interface PlanFeature {
  key: string;
  label: string;
}

export interface PlanDefinition {
  name: string;
  /** USD per month. */
  price: number;
  features: readonly PlanFeature[];
}

export const PLAN_FEATURES = {
  free: {
    name: "Free",
    price: 0,
    features: [
      { key: "bookmarks", label: "Unlimited bookmarks" },
      { key: "live-sessions", label: "Unlimited live sessions" },
      { key: "ai-credits", label: "1,000 AI chat credits every week" },
      { key: "byok", label: "Bring your own key — unmetered AI on your provider" },
    ],
  },
} as const satisfies Record<PlanId, PlanDefinition>;

/** The small print under any pricing/plan card. */
export const PLAN_FAIR_USE_NOTE = "Fair-use limits apply";

/** GET /api/account → the caller's plan. `"free"` in single-tenant/open mode. */
export const accountResponseSchema = z.object({
  plan: planIdSchema,
});
export type AccountResponse = z.infer<typeof accountResponseSchema>;
