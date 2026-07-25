import { NextResponse, type NextRequest } from "next/server";
import { updateSessionSchema } from "@bookmark-ai/types";
import { deleteSession, getSession } from "@bookmark-ai/db";
import { renameSession } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  const session = await getSession(db, (await params).id);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  return NextResponse.json({ session });
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  const parsed = updateSessionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  const session = await renameSession(db, (await params).id, parsed.data.name);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ session });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  const deleted = await deleteSession(db, (await params).id);
  if (!deleted) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
