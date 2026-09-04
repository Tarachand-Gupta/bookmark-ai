import { NextResponse, type NextRequest } from "next/server";
import { createSkill, SkillNameConflictError } from "@bookmark-ai/engine";
import { importSkillSchema, parseSkillMarkdown, type SkillResponse } from "@bookmark-ai/types";
import { getRequestApiContext } from "@/lib/server/api-context";

// Authed, per-user — never statically cache.
export const dynamic = "force-dynamic";

/**
 * POST /api/skills/import — create a skill from a SKILL.md document
 * (agentskills.io shape: YAML frontmatter `name`/`description`, body =
 * instructions; a `# Heading` + first paragraph works without frontmatter).
 * Body `{ markdown, enabled? }` → 201 { skill } · 400 { error } on a parse
 * failure (readable message) · 409 on a (case-insensitive) name conflict. Same
 * gate as /api/skills.
 */
export async function POST(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  const parsed = importSkillSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const skill = parseSkillMarkdown(parsed.data.markdown);
  if ("error" in skill) return NextResponse.json({ error: skill.error }, { status: 400 });
  const { warnings, ...fields } = skill;

  try {
    const body: SkillResponse & { warnings?: string[] } = {
      skill: await createSkill(db, { ...fields, enabled: parsed.data.enabled ?? true }),
      // e.g. "Description shortened from 342 to 200 characters" — the stored
      // skill is valid; the client may surface this next to the editor.
      ...(warnings?.length ? { warnings } : {}),
    };
    return NextResponse.json(body, { status: 201 });
  } catch (err) {
    if (err instanceof SkillNameConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    throw err;
  }
}
