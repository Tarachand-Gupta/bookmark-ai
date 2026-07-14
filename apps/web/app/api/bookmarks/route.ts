import { after, NextResponse, type NextRequest } from "next/server";
import { createBookmarkSchema, listBookmarksQuerySchema } from "@bookmark-ai/types";
import { listBookmarks } from "@bookmark-ai/db";
import { embedPending, enrichBookmark, saveBookmarkFast } from "@bookmark-ai/engine";
import { getApiContext } from "@/lib/server/context";
import { requireUser } from "@/lib/server/require-user";

export async function GET(req: NextRequest) {
  const denied = await requireUser();
  if (denied) return denied;
  const { db, ready } = getApiContext();
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

export async function POST(req: NextRequest) {
  const denied = await requireUser();
  if (denied) return denied;
  const { db, gemini, ready } = getApiContext();
  await ready;

  const parsed = createBookmarkSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  // Instant save → 201; OG scrape + AI categorization + embedding run after
  // the response is sent (fluid compute keeps the instance alive for it).
  const bookmark = await saveBookmarkFast(db, parsed.data);
  after(async () => {
    try {
      await enrichBookmark(db, gemini, bookmark.id, parsed.data);
    } catch (err) {
      console.warn(`[enrich] ${bookmark.url}: ${(err as Error).message} — keeping instant-save data`);
    }
    // Embed either way: enrichment cleared the embedding, and even a failed
    // enrichment leaves heuristic text worth embedding.
    if (gemini) {
      await embedPending(gemini, db, 5).catch((err: unknown) => {
        console.warn(`[embed] post-save sweep failed: ${(err as Error).message}`);
      });
    }
  });
  return NextResponse.json({ bookmark }, { status: 201 });
}
