import { serverLogger } from "@/lib/server/observability/server-logs";
import { withRequestLogging } from "@/lib/server/observability/request-logging";
import { after, NextResponse, type NextRequest } from "next/server";
import { propagateAttributes } from "@langfuse/tracing";
import { createBookmarkSchema, listBookmarksQuerySchema } from "@bookmark-ai/types";
import { listBookmarks } from "@bookmark-ai/db";
import { enrichBookmark, saveBookmarkFast } from "@bookmark-ai/engine";
import { enforceQuota, getRequestApiContext } from "@/lib/server/api-context";
import { embedAfterSave } from "@/lib/server/post-save-embed";
import { flushObservability } from "@/lib/server/observability/flush";

async function GETHandler(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  const parsed = listBookmarksQuerySchema.safeParse(
    Object.fromEntries(new URL(req.url).searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid query" },
      { status: 400 },
    );
  }
  return NextResponse.json(await listBookmarks(db, parsed.data));
}

async function POSTHandler(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { userId, db, gemini, ready } = ctx;
  await ready;

  const parsed = createBookmarkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const overQuota = await enforceQuota(userId, "saves");
  if (overQuota) return overQuota;

  // Instant save → 201; OG scrape + AI categorization + embedding run after
  // the response is sent (fluid compute keeps the instance alive for it).
  const bookmark = await saveBookmarkFast(db, parsed.data);
  after(async () => {
    // Traces (categorize + embed, when those surfaces are on) carry the saver.
    await propagateAttributes(
      { userId: userId ?? undefined, metadata: { route: "/api/bookmarks" } },
      async () => {
        try {
          await enrichBookmark(db, gemini, bookmark.id, parsed.data);
        } catch (err) {
          serverLogger.log("error", "bookmark_enrichment_failed", { error: err });
          console.warn(`[enrich] ${bookmark.id}: ${(err as Error).message} — keeping instant-save data`);
        }
        // Embed either way: enrichment cleared the embedding, and even a failed
        // enrichment leaves heuristic text worth embedding. THIS save's own row
        // first — a plain oldest-first sweep here means N burst saves all embed
        // the same oldest rows in parallel and never reach the new ones (see
        // `embedAfterSave`).
        if (gemini) await embedAfterSave(gemini, db, bookmark.id);
      },
    );
    await flushObservability();
  });
  return NextResponse.json({ bookmark }, { status: 201 });
}

export const GET = withRequestLogging("/api/bookmarks", "GET", GETHandler);
export const POST = withRequestLogging("/api/bookmarks", "POST", POSTHandler);
