import { scheduleOrganizationIndexing } from "@/lib/server/organization-indexing";
import { updateBookmarkSchema } from "@bookmark-ai/types";
import { editBookmark } from "@bookmark-ai/engine";
import { organizationErrorResponse } from "@/lib/server/organization-response";
import { withRequestLogging } from "@/lib/server/observability/request-logging";
import { NextResponse, type NextRequest } from "next/server";
import { deleteBookmark, getBookmark } from "@bookmark-ai/db";
import { getRequestApiContext } from "@/lib/server/api-context";

type Params = { params: Promise<{ id: string }> };

async function GETHandler(_req: NextRequest, { params }: Params) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  const bookmark = await getBookmark(db, (await params).id);
  if (!bookmark) return NextResponse.json({ error: "Bookmark not found" }, { status: 404 });
  return NextResponse.json({ bookmark });
}

async function DELETEHandler(_req: NextRequest, { params }: Params) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  const deleted = await deleteBookmark(db, (await params).id);
  if (!deleted) return NextResponse.json({ error: "Bookmark not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}

export const GET = withRequestLogging("/api/bookmarks/[id]", "GET", GETHandler);
export const DELETE = withRequestLogging("/api/bookmarks/[id]", "DELETE", DELETEHandler);

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  await ctx.ready;
  const p = updateBookmarkSchema.safeParse(await req.json().catch(() => null));
  if (!p.success)
    return NextResponse.json(
      { error: p.error.issues[0]?.message ?? "Invalid edit" },
      { status: 400 },
    );
  const id = (await params).id;
  try {
    const operation = await editBookmark(ctx.db, id, p.data);
    scheduleOrganizationIndexing(ctx.db, ctx.gemini, operation);
    return NextResponse.json({ operation, bookmark: await getBookmark(ctx.db, id) });
  } catch (e) {
    return organizationErrorResponse(e);
  }
}
