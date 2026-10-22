import { after, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  bookmarkImportRequestSchema,
  BOOKMARK_IMPORT_BATCH_SIZE,
  BOOKMARK_IMPORT_MAX_BYTES,
  BOOKMARK_IMPORT_MAX_ITEMS,
} from "@bookmark-ai/types";
import {
  applyBookmarkImportBatch,
  embedBookmarkById,
  BookmarkImportConflictError,
  getBookmarkImportReceipt,
  previewBookmarkImport,
} from "@bookmark-ai/engine";
import { enforceQuota, getRequestApiContext } from "@/lib/server/api-context";
import { flushObservability } from "@/lib/server/observability/flush";
import { withRequestLogging } from "@/lib/server/observability/request-logging";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function GETHandler(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  await ctx.ready;
  const id = req.nextUrl.searchParams.get("requestId");
  if (id) {
    if (!z.string().uuid().safeParse(id).success)
      return NextResponse.json({ error: "Invalid import request." }, { status: 400 });
    const result = await getBookmarkImportReceipt(ctx.db, id);
    return result
      ? NextResponse.json({ result })
      : NextResponse.json({ error: "This import batch has not been saved." }, { status: 404 });
  }
  return NextResponse.json({
    capabilities: { bookmarkImport: 1, preservesFolders: true, existingUnchanged: true },
    limits: {
      maxBytes: BOOKMARK_IMPORT_MAX_BYTES,
      maxItems: BOOKMARK_IMPORT_MAX_ITEMS,
      batchSize: BOOKMARK_IMPORT_BATCH_SIZE,
    },
  });
}

async function POSTHandler(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  await ctx.ready;
  // JSON escaping may double the size of a valid 5 MB text file.
  const maxBody = BOOKMARK_IMPORT_MAX_BYTES * 2 + 1024 * 1024;
  if (Number(req.headers.get("content-length")) > maxBody)
    return NextResponse.json({ error: "Import is too large." }, { status: 413 });
  let body: unknown;
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > maxBody)
      return NextResponse.json({ error: "Import is too large." }, { status: 413 });
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Import request is not valid JSON." }, { status: 400 });
  }
  const parsed = bookmarkImportRequestSchema.safeParse(body);
  if (!parsed.success)
    return NextResponse.json(
      {
        error:
          "Import has invalid fields or exceeds the supported limits. Review the source and try again.",
      },
      { status: 400 },
    );
  try {
    if (parsed.data.action === "preview")
      return NextResponse.json({ preview: await previewBookmarkImport(ctx.db, parsed.data) });
    // Replays do not consume another quota unit. The engine still checks the payload hash.
    const receipt = await getBookmarkImportReceipt(ctx.db, parsed.data.requestId);
    if (!receipt) {
      const quota = await enforceQuota(ctx.userId, "saves");
      if (quota) return quota;
    }
    const result = await applyBookmarkImportBatch(ctx.db, parsed.data);
    const gemini = ctx.gemini;
    if (!receipt && gemini) {
      // Text search is ready immediately. Bound semantic indexing; the daily
      // pending-embedding sweep handles larger imports without rewriting metadata.
      const ids = result.items
        .filter((item) => item.status === "imported" && item.bookmarkId)
        .slice(0, 3);
      if (ids.length)
        after(async () => {
          for (const item of ids) {
            try {
              await embedBookmarkById(gemini, ctx.db, item.bookmarkId!);
            } catch {
              /* The existing sweep retries missing embeddings. */
            }
          }
          await flushObservability();
        });
    }
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof BookmarkImportConflictError)
      return NextResponse.json({ error: error.message }, { status: 409 });
    if (parsed.data.action === "preview")
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "This source could not be read." },
        { status: 400 },
      );
    return NextResponse.json(
      { error: "The import could not be confirmed. Retry to check the same batch safely." },
      { status: 503 },
    );
  }
}

export const GET = withRequestLogging("/api/import/bookmarks", "GET", GETHandler);
export const POST = withRequestLogging("/api/import/bookmarks", "POST", POSTHandler);
