import { NextResponse, type NextRequest } from "next/server";
import { deleteBookmark, getBookmark } from "@bookmark-ai/db";
import { getApiContext } from "@/lib/server/context";
import { requireUser } from "@/lib/server/require-user";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const denied = await requireUser();
  if (denied) return denied;
  const { db, ready } = getApiContext();
  await ready;

  const bookmark = await getBookmark(db, (await params).id);
  if (!bookmark) return NextResponse.json({ error: "Bookmark not found" }, { status: 404 });
  return NextResponse.json({ bookmark });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const denied = await requireUser();
  if (denied) return denied;
  const { db, ready } = getApiContext();
  await ready;

  const deleted = await deleteBookmark(db, (await params).id);
  if (!deleted) return NextResponse.json({ error: "Bookmark not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
