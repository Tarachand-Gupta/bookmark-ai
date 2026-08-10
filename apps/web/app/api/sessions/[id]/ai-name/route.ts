import { NextResponse, type NextRequest } from "next/server";
import { summarizeSessionById } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/sessions/:id/ai-name — summarize the session's tabs in ONE Gemini
 * call and APPLY the result: a title (comma-separated when the window spans
 * several themes) plus a 1-2 sentence description of what it was about. This is
 * the "Summarize" affordance in the UI; the same engine call runs post-save via
 * `after()` in POST /api/sessions.
 *
 * The route keeps its original path and its top-level `name` for back-compat
 * (it started life as AI-rename-only) and adds `description`. Never 500s on an
 * AI failure: the engine degrades to a heuristic name and flags it via `fallback`.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, gemini, ready } = ctx;
  await ready;

  const result = await summarizeSessionById(db, gemini, (await params).id);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({
    session: result.session,
    name: result.session.name,
    description: result.session.description,
    fallback: result.fallback,
  });
}
