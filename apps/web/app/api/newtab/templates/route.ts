import { NextResponse, type NextRequest } from "next/server";
import { createNewTabTemplateSchema } from "@bookmark-ai/types";
import { listNewTabTemplates } from "@bookmark-ai/db";
import { saveNewTabTemplate, ensureNewTabPresets } from "@bookmark-ai/engine";
import { enforceQuota, getRequestApiContext } from "@/lib/server/api-context";

export const dynamic = "force-dynamic";

/**
 * GET — list every template (presets first-class rows included). Seeds the six
 * presets on the FIRST read of an empty table (docs/features/newtab-canvas.md
 * §4.6) so the table is the single source of truth from the start.
 */
export async function GET() {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  await ensureNewTabPresets(db);
  return NextResponse.json({ templates: await listNewTabTemplates(db) });
}

/**
 * POST — create a custom template from {html, config, name?, activate}.
 * Metered as "newtabTemplates": creation is a paid agent turn (§4.10).
 */
export async function POST(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { userId, db, ready } = ctx;
  await ready;

  const parsed = createNewTabTemplateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const overQuota = await enforceQuota(userId, "newtabTemplates");
  if (overQuota) return overQuota;

  const template = await saveNewTabTemplate(db, userId, parsed.data);
  return NextResponse.json({ template }, { status: 201 });
}
