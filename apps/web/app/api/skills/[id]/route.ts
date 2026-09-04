import { NextResponse, type NextRequest } from "next/server";
import {
  deleteSkill,
  getSkillRecord,
  SkillNameConflictError,
  SkillNotFoundError,
  updateSkill,
} from "@bookmark-ai/engine";
import { updateSkillSchema, type SkillResponse } from "@bookmark-ai/types";
import { getRequestApiContext } from "@/lib/server/api-context";

// Authed, per-user — never statically cache.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const NOT_FOUND = () => NextResponse.json({ error: "Skill not found" }, { status: 404 });

/** GET /api/skills/:id → { skill } | 404. */
export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  const skill = await getSkillRecord(db, (await params).id);
  if (!skill) return NOT_FOUND();
  const body: SkillResponse = { skill };
  return NextResponse.json(body);
}

/** PUT /api/skills/:id — partial update → { skill } | 400 | 404 | 409 (rename collision). */
export async function PUT(req: NextRequest, { params }: Params) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  const parsed = updateSkillSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  try {
    const body: SkillResponse = { skill: await updateSkill(db, (await params).id, parsed.data) };
    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof SkillNotFoundError) return NOT_FOUND();
    if (err instanceof SkillNameConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}

/** DELETE /api/skills/:id → 204 | 404. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  const removed = await deleteSkill(db, (await params).id);
  if (!removed) return NOT_FOUND();
  return new NextResponse(null, { status: 204 });
}
