import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { propagateAttributes } from "@langfuse/tracing";
import { listActiveTenants } from "@bookmark-ai/db";
import { embedPending } from "@bookmark-ai/engine";
import {
  getApiContext,
  getGemini,
  getMasterContext,
  isMultiTenant,
  tenantDbFromRecord,
} from "@/lib/server/context";
import { flushObservability } from "@/lib/server/observability/flush";

export const maxDuration = 300;

// Fan-out safety caps (flag-on): never rack up unbounded Gemini calls, and stop
// well before maxDuration so the function returns cleanly.
const MAX_EMBEDDINGS = 200;
const MAX_ELAPSED_MS = 250_000;
const BATCH = 10;

/**
 * Daily straggler sweep (Vercel cron, see vercel.json): embeds bookmarks AND
 * saved sessions the post-save hooks missed (transient Gemini failures, deploys
 * mid-save, a rename/summary that cleared a vector, an imported bundle — the
 * embed columns are always regenerated, never exported). `embedPending` covers
 * both tables. Gated by CRON_SECRET, which Vercel attaches to cron invocations
 * automatically.
 *
 * Flag OFF → sweep the single shared DB (unchanged). Flag ON → iterate every
 * active tenant, sweeping each tenant's own DB, bounded by a total-embedding
 * cap and a wall-clock budget.
 */
/**
 * Constant-time string compare. `timingSafeEqual` throws on length-mismatched
 * buffers, so bail early when lengths differ (the secret's length is not itself
 * sensitive) before the timing-safe byte comparison.
 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (!secret || !header || !safeEqual(header, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const gemini = getGemini();
  if (!gemini) return NextResponse.json({ embedded: 0, ai: false });

  if (!isMultiTenant()) {
    // Drain in batches with a generous daily cap — a sweep should never rack
    // up unbounded Gemini calls if something upstream loops.
    const { db, ready } = getApiContext();
    await ready;
    // No user on a cron sweep — traces carry the route instead.
    const total = await propagateAttributes(
      { metadata: { route: "/api/cron/embed" } },
      async () => {
        let swept = 0;
        let batch: number;
        do {
          batch = await embedPending(gemini, db, BATCH);
          swept += batch;
        } while (batch === BATCH && swept < MAX_EMBEDDINGS);
        return swept;
      },
    );
    await flushObservability();
    return NextResponse.json({ embedded: total });
  }

  // Flag ON: fan out across all active tenants.
  const master = getMasterContext();
  if (!master) {
    return NextResponse.json({ error: "Master DB not configured" }, { status: 503 });
  }
  await master.ready;
  const tenants = await listActiveTenants(master.db);

  const startedAt = Date.now();
  const perTenant: Record<string, number> = {};
  let total = 0;
  for (const tenant of tenants) {
    if (total >= MAX_EMBEDDINGS || Date.now() - startedAt > MAX_ELAPSED_MS) break;
    const { db, ready } = tenantDbFromRecord(tenant);
    await ready;
    // No user on a cron sweep — each tenant's traces carry the route + tenant.
    const tenantTotal = await propagateAttributes(
      { metadata: { route: "/api/cron/embed", tenant: tenant.clerkUserId } },
      async () => {
        let swept = 0;
        let batch: number;
        do {
          batch = await embedPending(gemini, db, BATCH);
          swept += batch;
          total += batch;
        } while (
          batch === BATCH &&
          total < MAX_EMBEDDINGS &&
          Date.now() - startedAt < MAX_ELAPSED_MS
        );
        return swept;
      },
    );
    if (tenantTotal > 0) {
      perTenant[tenant.clerkUserId] = tenantTotal;
      console.log(`[cron/embed] tenant ${tenant.clerkUserId}: embedded ${tenantTotal}`);
    }
  }
  await flushObservability();
  return NextResponse.json({ embedded: total, tenants: perTenant });
}
