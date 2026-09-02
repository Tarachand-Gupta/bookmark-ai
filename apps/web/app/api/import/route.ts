import { after, NextResponse, type NextRequest } from "next/server";
import { propagateAttributes } from "@langfuse/tracing";
import { embedPending, importUserData } from "@bookmark-ai/engine";
import { enforceQuota, getRequestApiContext } from "@/lib/server/api-context";
import { flushObservability } from "@/lib/server/observability/flush";

// Authed, mutating, per-user — never statically cache.
export const dynamic = "force-dynamic";

/**
 * SECURITY: hard cap on the import body. An import bundle is fully user-supplied
 * and parsed into memory before validation, so bound it up front — first by the
 * declared Content-Length (cheap, rejects before we read), then by the actual
 * bytes read (covers chunked/absent Content-Length and a lying header). The
 * bundle's per-array item caps (packages/types export schema) are the second
 * line of defence at validation time.
 */
const MAX_IMPORT_BYTES = 20 * 1024 * 1024; // 20 MB

/**
 * Import a bundle produced by GET /api/export. `importUserData` validates and
 * version-upgrades the (untrusted) body internally, upserting bookmarks by URL
 * and preserving original timestamps — so re-importing the same file is a safe
 * no-op. A bad/unknown/newer bundle throws → 400 with the message.
 */
export async function POST(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, gemini, ready, userId } = ctx;
  await ready;

  // Reject an oversized body before reading it, when the client declares one.
  const declaredLength = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: "Import is too large (max 20 MB)" }, { status: 413 });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return NextResponse.json({ error: "Request body isn't valid JSON" }, { status: 400 });
  }
  // Guard the actual size too — covers chunked bodies and a lying Content-Length.
  if (Buffer.byteLength(raw, "utf8") > MAX_IMPORT_BYTES) {
    return NextResponse.json({ error: "Import is too large (max 20 MB)" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Request body isn't valid JSON" }, { status: 400 });
  }

  // Meter ONE quota unit per import (not per bookmark) — a legitimate restore can
  // carry thousands of rows, so charging per row would break it. Reuses the
  // "saves" bucket. No-op when multi-tenancy is off or in open mode.
  const overQuota = await enforceQuota(userId, "saves");
  if (overQuota) return overQuota;

  let imported: { bookmarks: number; sessions: number; conversations: number };
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
      await propagateAttributes(
        { userId: userId ?? undefined, metadata: { route: "/api/import" } },
        async () => {
          await embedPending(gemini, db, 20).catch((err: unknown) => {
            console.warn(`[embed] post-import sweep failed: ${(err as Error).message}`);
          });
        },
      );
      await flushObservability();
    });
  }

  return NextResponse.json({ imported });
}
