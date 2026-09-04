import { getTenant } from "@bookmark-ai/db";
import { planIdSchema, type PlanId } from "@bookmark-ai/types";
import { getMasterContext, isMultiTenant } from "@/lib/server/context";

/**
 * The caller's plan, from the master `tenants.plan` column (master migration
 * v3). Literal `"free"` — the only plan — in single-tenant/open mode, when no
 * master DB is configured, or on any read failure: the plan badge must never
 * take Settings down, and Free is the truthful default for everyone today.
 */
export async function resolveAccountPlan(userId: string | null): Promise<PlanId> {
  if (!userId || !isMultiTenant()) return "free";
  const master = getMasterContext();
  if (!master) return "free";
  try {
    await master.ready;
    const tenant = await getTenant(master.db, userId);
    const parsed = planIdSchema.safeParse(tenant?.plan);
    return parsed.success ? parsed.data : "free";
  } catch (err) {
    console.warn("[account] plan read failed, defaulting to free:", (err as Error).message);
    return "free";
  }
}
