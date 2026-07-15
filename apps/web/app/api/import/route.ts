import { after, NextResponse, type NextRequest } from "next/server";
import { embedPending, importUserData } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";

// Authed, mutating, per-user — never statically cache.
export const dynamic = "force-dynamic";

/**
 * Import a bundle produced by GET /api/export. `importUserData` validates and
 * version-upgrades the (untrusted) body internally, upserting bookmarks by URL
 * and preserving original timestamps — so re-importing the same file is a safe
 * no-op. A bad/unknown/newer bundle throws → 400 with the message.
 */
export async function POST(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, gemini, ready } = ctx;
  await ready;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Request body isn't valid JSON" }, { status: 400 });
  }

  let imported: { bookmarks: number; sessions: number };
  try {
    imported = await importUserData(db, body);
  } catch (err) {
    // migrateExportBundle / validation throws land here (invalid, unknown, or
    // newer-than-supported schemaVersion) — all client-fixable → 400.
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }

  // Imported rows land with null embeddings; kick off a bounded post-response
  // sweep so they become searchable without waiting for the daily cron. Best
  // effort — the cron backfills whatever a single sweep doesn't reach.
  if (gemini && imported.bookmarks > 0) {
    after(async () => {
      await embedPending(gemini, db, 20).catch((err: unknown) => {
        console.warn(`[embed] post-import sweep failed: ${(err as Error).message}`);
      });
    });
  }

  return NextResponse.json({ imported });
}
