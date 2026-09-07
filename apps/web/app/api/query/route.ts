import { NextResponse, type NextRequest } from "next/server";
import { chatQueryPageSchema } from "@bookmark-ai/types";
import { runReadOnlySql } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";

/**
 * POST /api/query — one page of a read-only SELECT, for the CHAT CARD's paging.
 *
 * The `queryDatabase` tool answers with a page; the card's "Load more" fetches
 * the next one WITHOUT spending a model turn, and it must go through the exact
 * same engine path the tool used so page N+1 is consistent with page N. That's
 * this route: `runReadOnlySql` applies the identical guards (single statement,
 * SELECT/WITH only, keyword blocklist, wrapped LIMIT/OFFSET, timeout, blob and
 * long-cell clipping) against the CALLER'S OWN tenant DB, so it exposes nothing
 * the chat did not already expose. `countTotal` is off here — the first page
 * already told the card the total.
 *
 * POST (not GET) because the SQL is a body, not a URL: it keeps a query out of
 * access logs, history and referrers.
 */
export async function POST(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = chatQueryPageSchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const { sql, limit, offset } = parsed.data;
  try {
    const res = await runReadOnlySql(db, sql, { limit, offset });
    return NextResponse.json({
      columns: res.columns,
      rows: res.rows,
      rowCount: res.rowCount,
      truncated: res.truncated,
      page: {
        total: null,
        offset: res.offset,
        limit: res.limit,
        hasMore: res.hasMore,
        nextOffset: res.nextOffset,
      },
    });
  } catch (err) {
    // A guard violation or a bad SELECT is the caller's problem to read, exactly
    // as the chat tool surfaces it.
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
