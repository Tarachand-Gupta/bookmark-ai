import { NextResponse, type NextRequest } from "next/server";
import { suggestSessionName } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/sessions/:id/ai-name — suggest a concise title for the session's
 * tabs (Gemini when configured, heuristic otherwise) and APPLY it. Never 500s on
 * an AI failure: the engine degrades to a heuristic and flags it via `fallback`.
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, gemini, ready } = ctx;
  await ready;

  const result = await suggestSessionName(db, gemini, (await params).id);
  if (!result) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ session: result.session, fallback: result.fallback });
}
