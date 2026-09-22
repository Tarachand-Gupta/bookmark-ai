import { withRequestLogging } from "@/lib/server/observability/request-logging";
import { NextResponse, type NextRequest } from "next/server";
import { updateAiLimitSchema } from "@bookmark-ai/types";
import { gateAdmin } from "@/lib/server/admin-gate";
import { getFreeAiWeeklyLimit, setFreeAiWeeklyLimit } from "@/lib/server/ai-limit";

// Authed admin control-plane endpoint — never statically cache.
export const dynamic = "force-dynamic";

/** GET /api/admin/ai-limit → { limitTokens } (current global free-tier limit). */
async function GETHandler() {
  const gate = await gateAdmin();
  if ("response" in gate) return gate.response;

  const limitTokens = await getFreeAiWeeklyLimit();
  return NextResponse.json({ limitTokens });
}

/**
 * PATCH /api/admin/ai-limit { limitTokens } → { limitTokens }. Persists the new
 * global limit to the master control-plane DB; the change is effective within
 * the ~60s read cache (enforcement compares live). 503 when no master DB is
 * configured (admin-adjusting is a control-plane operation).
 */
async function PATCHHandler(req: NextRequest) {
  const gate = await gateAdmin();
  if ("response" in gate) return gate.response;

  const parsed = updateAiLimitSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  try {
    const limitTokens = await setFreeAiWeeklyLimit(parsed.data.limitTokens);
    return NextResponse.json({ limitTokens });
  } catch (err) {
    console.error("[admin/ai-limit]", (err as Error).message);
    return NextResponse.json(
      { error: "Limit store unavailable (master DB not configured)" },
      { status: 503 },
    );
  }
}

export const GET = withRequestLogging("/api/admin/ai-limit", "GET", GETHandler);
export const PATCH = withRequestLogging("/api/admin/ai-limit", "PATCH", PATCHHandler);
