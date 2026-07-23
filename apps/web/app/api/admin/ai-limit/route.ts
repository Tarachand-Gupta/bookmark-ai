import { NextResponse, type NextRequest } from "next/server";
import { updateAiLimitSchema } from "@bookmark-ai/types";
import { requireUser } from "@/lib/server/require-user";
import { getFreeAiWeeklyLimit, setFreeAiWeeklyLimit } from "@/lib/server/ai-limit";

// Authed admin control-plane endpoint — never statically cache.
export const dynamic = "force-dynamic";

/** Fallback owner id when ADMIN_USER_IDS is unset (Tara — see CLAUDE.md). */
const DEFAULT_ADMIN_ID = "user_3GIhPt5Na3tYRP3XaPPU3PpI55e";

function adminIds(): string[] {
  const csv = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return csv.length > 0 ? csv : [DEFAULT_ADMIN_ID];
}

/**
 * Gate: the standard requireUser() chain (rate-limit → open modes → Clerk), then
 * an admin allowlist. In OPEN mode (keyless self-host / dev bypass) there is no
 * Clerk user — the instance owner controls their own deployment, so allow it.
 * With a Clerk user, only ADMIN_USER_IDS (default: the known owner) may pass.
 */
async function gateAdmin(): Promise<{ response: NextResponse } | { ok: true }> {
  const gate = await requireUser();
  if (!gate.ok) return { response: gate.response };
  if (gate.userId === null) return { ok: true }; // open/dev mode
  if (!adminIds().includes(gate.userId)) {
    return {
      response: NextResponse.json(
        { error: "This account may not administer the platform", code: "forbidden" },
        { status: 403 },
      ),
    };
  }
  return { ok: true };
}

/** GET /api/admin/ai-limit → { limitTokens } (current global free-tier limit). */
export async function GET() {
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
export async function PATCH(req: NextRequest) {
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
