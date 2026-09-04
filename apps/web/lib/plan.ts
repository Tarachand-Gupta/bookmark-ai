import { PLAN_FEATURES, type PlanId, planIdSchema } from "@bookmark-ai/types";

/**
 * Plan helpers for the web app. The catalogue itself (`PLAN_FEATURES`) and the
 * `PlanId` enum come from `@bookmark-ai/types` (CONTRACT §2) so the marketing
 * pricing card, Settings → Account and the API render from one list. Everyone
 * is on Free today.
 */
export { PLAN_FEATURES, PLAN_FAIR_USE_NOTE, type PlanId } from "@bookmark-ai/types";

export const DEFAULT_PLAN: PlanId = "free";

/** Narrow an untrusted value (an API field that may be missing on older
 * servers) to a known plan id, defaulting to Free. */
export function toPlanId(value: unknown): PlanId {
  const parsed = planIdSchema.safeParse(value);
  return parsed.success && parsed.data in PLAN_FEATURES ? parsed.data : DEFAULT_PLAN;
}
