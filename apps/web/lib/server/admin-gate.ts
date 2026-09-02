import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/require-user";

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
 * Gate for the /api/admin/* control-plane routes: the standard requireUser()
 * chain (rate-limit → open modes → Clerk), then an admin allowlist. In OPEN
 * mode (keyless self-host / dev bypass) there is no Clerk user — the instance
 * owner controls their own deployment, so allow it. With a Clerk user, only
 * ADMIN_USER_IDS (default: the known owner) may pass.
 */
export async function gateAdmin(): Promise<{ response: NextResponse } | { ok: true }> {
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
