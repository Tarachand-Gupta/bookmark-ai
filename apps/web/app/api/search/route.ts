import { after, NextResponse, type NextRequest } from "next/server";
import { propagateAttributes } from "@langfuse/tracing";
import { searchQuerySchema } from "@bookmark-ai/types";
import { performSearch } from "@bookmark-ai/engine";
import { enforceQuota, getRequestApiContext } from "@/lib/server/api-context";
import { flushObservability } from "@/lib/server/observability/flush";

export async function GET(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { userId, db, gemini, ready } = ctx;
  await ready;

  const parsed = searchQuerySchema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query" },
      { status: 400 },
    );
  }

  // Only the Gemini-costed modes (hybrid + ai both embed the query) count against
  // the per-user daily search quota; plain `text` mode is FTS-only, no Gemini
  // call, so it stays unmetered. Mirrors /api/chat's enforceQuota gate.
  if (parsed.data.mode === "hybrid" || parsed.data.mode === "ai") {
    const overQuota = await enforceQuota(userId, "searches");
    if (overQuota) return overQuota;
  }

  // `parsed.data` carries `offset` only when the client actually sent one, which
  // is what keeps the paging fields (and the extra row they cost) off the web
  // grid's requests while giving a paging client — MCP, scripts — the same
  // surface. Everything else about the page is the engine's business.
  // The search trace (when that surface is on) carries the user; spans export
  // after the response.
  after(() => flushObservability());
  const response = await propagateAttributes(
    { userId: userId ?? undefined, metadata: { route: "/api/search" } },
    () => performSearch(db, gemini, parsed.data),
  );
  return NextResponse.json(response);
}
