import { after, NextResponse, type NextRequest } from "next/server";
import { propagateAttributes } from "@langfuse/tracing";
import { embedSession, summarizeSessionById } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";
import { flushObservability } from "@/lib/server/observability/flush";

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
  const { userId, db, gemini, ready } = ctx;
  await ready;

  // The summarize call runs IN the request; its trace (when the surface is on)
  // still carries the user. The flush rides the after() below.
  const { id } = await params;
  const result = await propagateAttributes(
    { userId: userId ?? undefined, metadata: { route: "/api/sessions/[id]/ai-name" } },
    () => summarizeSessionById(db, gemini, id),
  );
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Applying the summary cleared the session's embedding (its text changed, and
  // the description is the bulk of what gets embedded) — recompute after the
  // response so the new summary is searchable by meaning immediately.
  if (gemini) {
    const session = result.session;
    after(async () => {
      await propagateAttributes(
        { userId: userId ?? undefined, metadata: { route: "/api/sessions/[id]/ai-name" } },
        async () => {
          await embedSession(gemini, db, session).catch((err: unknown) => {
            console.warn(`[embed] session ${session.id}: ${(err as Error).message}`);
          });
        },
      );
      await flushObservability();
    });
  } else {
    after(() => flushObservability());
  }
  return NextResponse.json({
    session: result.session,
    name: result.session.name,
    description: result.session.description,
    fallback: result.fallback,
  });
}
