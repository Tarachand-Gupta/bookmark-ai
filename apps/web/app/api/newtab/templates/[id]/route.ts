import { NextResponse, type NextRequest } from "next/server";
import { updateNewTabTemplateSchema } from "@bookmark-ai/types";
import { deleteNewTabTemplate, TemplatePresetReadOnlyError } from "@bookmark-ai/db";
import { saveNewTabTemplate } from "@bookmark-ai/engine";
import { enforceQuota, getRequestApiContext } from "@/lib/server/api-context";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function presetConflict(err: TemplatePresetReadOnlyError): NextResponse {
  return NextResponse.json({ error: err.message, code: "preset-read-only" }, { status: 409 });
}

/**
 * PATCH — rename/rewrite/re-config a CUSTOM template. Preset rows are
 * reference implementations (read-only) → 409. Goes through the engine's
 * saveNewTabTemplate (config merges partial-over-current there — the SAME path
 * the agent's write tool takes). Metered: an edit is a paid agent turn (§4.10).
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { userId, db, ready } = ctx;
  await ready;

  const parsed = updateNewTabTemplateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const overQuota = await enforceQuota(userId, "newtabTemplates");
  if (overQuota) return overQuota;

  try {
    const template = await saveNewTabTemplate(db, userId, {
      templateId: (await params).id,
      ...parsed.data,
      activate: false,
    });
    if (!template) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ template });
  } catch (err) {
    if (err instanceof TemplatePresetReadOnlyError) return presetConflict(err);
    if (err instanceof Error && err.name === "ZodError") {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
}

/**
 * DELETE — a custom template. Presets → 409. Deleting the ACTIVE template
 * re-activates the first remaining preset (§4.3.1 — never leave the user with
 * no active template).
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { userId, db, ready } = ctx;
  await ready;

  try {
    const deleted = await deleteNewTabTemplate(db, (await params).id, userId ?? "local");
    if (!deleted) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof TemplatePresetReadOnlyError) return presetConflict(err);
    throw err;
  }
}
