import { NextResponse } from "next/server";
import { bumpUsage, type Db, type UsageField } from "@bookmark-ai/db";
import type { GeminiClient } from "@bookmark-ai/engine";
import {
  getApiContext,
  getGemini,
  getMasterContext,
  getTenantDb,
  isMultiTenant,
  MultiTenantConfigError,
  TenantNotProvisionedError,
} from "@/lib/server/context";
import { requireUser } from "@/lib/server/require-user";

/**
 * Per-request API context: the gate (rate-limit → open-modes → Clerk) composed
 * with DB routing.
 *  - `{ response }` → return it as-is (gate denial, or 503 while a tenant's DB is
 *    still being provisioned).
 *  - otherwise → the resolved `userId` (null in open modes), the DB the request
 *    should use, the shared Gemini client, and a `ready` promise to await before
 *    the first query.
 *
 * DB routing rules:
 *  - flag OFF → the shared single DB (identical to today).
 *  - flag ON + Clerk user → that user's tenant DB.
 *  - open mode (userId null), flag ON or OFF → the shared/local DB. The
 *    desktop/local path has no Clerk user and never routes to a tenant.
 */
export type RequestApiContext =
  | { response: NextResponse }
  | {
      userId: string | null;
      db: Db;
      gemini: GeminiClient | null;
      ready: Promise<void>;
    };

export async function getRequestApiContext(): Promise<RequestApiContext> {
  const gate = await requireUser();
  if (!gate.ok) return { response: gate.response };

  const gemini = getGemini();

  // Open mode: no Clerk user, so no tenant — always the shared/local DB.
  if (gate.userId === null) {
    const { db, ready } = getApiContext();
    return { userId: null, db, gemini, ready };
  }

  try {
    const { db, ready } = await getTenantDb(gate.userId);
    return { userId: gate.userId, db, gemini, ready };
  } catch (err) {
    if (err instanceof TenantNotProvisionedError) {
      return {
        response: NextResponse.json({ error: "Account not provisioned yet" }, { status: 503 }),
      };
    }
    if (err instanceof MultiTenantConfigError) {
      console.error("[api]", err.message);
      return {
        response: NextResponse.json({ error: "Account not provisioned yet" }, { status: 503 }),
      };
    }
    throw err;
  }
}

// ── Per-day usage quotas (flag-on only) ──

const QUOTA_ENV: Record<UsageField, string> = {
  saves: "QUOTA_SAVES_PER_DAY",
  sessions: "QUOTA_SESSIONS_PER_DAY",
  chats: "QUOTA_CHATS_PER_DAY",
  searches: "QUOTA_SEARCHES_PER_DAY",
};
const QUOTA_DEFAULT: Record<UsageField, number> = {
  saves: 200,
  sessions: 50,
  chats: 100,
  searches: 500,
};

function quotaFor(field: UsageField): number {
  const raw = process.env[QUOTA_ENV[field]];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : QUOTA_DEFAULT[field];
}

/**
 * Enforce a tenant's per-day quota for one metered action, bumping the counter
 * as a side effect. Returns a 429 response when the day's limit is reached, or
 * null to proceed. No-op (returns null, makes no master call) when the flag is
 * off or in open mode — quotas are a multi-tenant, per-Clerk-user concern only.
 * Call after validation, before the mutating work.
 */
export async function enforceQuota(
  userId: string | null,
  field: UsageField,
): Promise<NextResponse | null> {
  if (!isMultiTenant()) return null; // flag OFF: no quota calls at all
  if (!userId) return null; // open mode: no Clerk user to meter

  const master = getMasterContext();
  if (!master) return null; // config error already surfaced during DB routing
  await master.ready;

  const day = new Date().toISOString().slice(0, 10);
  const { allowed } = await bumpUsage(master.db, userId, day, field, quotaFor(field));
  if (!allowed) {
    return NextResponse.json(
      { error: `Daily limit reached (${field}). Resets at midnight UTC.` },
      { status: 429 },
    );
  }
  return null;
}
