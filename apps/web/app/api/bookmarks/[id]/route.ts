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
