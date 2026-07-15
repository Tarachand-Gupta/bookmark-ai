import { NextResponse, type NextRequest } from "next/server";
import { searchQuerySchema } from "@bookmark-ai/types";
import { performSearch } from "@bookmark-ai/engine";
import { enforceQuota, getRequestApiContext } from "@/lib/server/api-context";

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

  return NextResponse.json(await performSearch(db, gemini, parsed.data));
}
