import { NextResponse, type NextRequest } from "next/server";
import { createSkill, listSkills, SkillNameConflictError } from "@bookmark-ai/engine";
import { createSkillSchema, type ListSkillsResponse, type SkillResponse } from "@bookmark-ai/types";
import { getRequestApiContext } from "@/lib/server/api-context";

// Authed, per-user — never statically cache.
export const dynamic = "force-dynamic";

/**
 * Skills — the user's reusable Ask AI instructions. Clerk-session-gated like
 * /api/settings (a device token is refused by requireUser's route scoping; in an
 * open/self-host install the rows live in the shared local DB). Thin adapter
 * over the engine's skills module, which owns the case-insensitive uniqueness
 * rule.
 */

/** GET /api/skills → every skill (enabled or not), newest updated first. */
export async function GET() {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  const body: ListSkillsResponse = { skills: await listSkills(db) };
  return NextResponse.json(body);
}

/** POST /api/skills → 201 { skill }; 409 when the name (case-insensitively) exists. */
export async function POST(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  const parsed = createSkillSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  try {
    const body: SkillResponse = { skill: await createSkill(db, parsed.data) };
    return NextResponse.json(body, { status: 201 });
  } catch (err) {
    if (err instanceof SkillNameConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
