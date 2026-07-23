import { NextResponse, type NextRequest } from "next/server";
import { deleteConversationRecord, loadConversationRecord } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";

// Authed, per-user — never statically cache.
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/chat/conversations/[id] → { conversation, messages }. Messages come
 * back UIMessage-compatible ({ id, role, parts }) so the client can hydrate the
 * chat transcript directly.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  const loaded = await loadConversationRecord(db, (await params).id);
  if (!loaded) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  return NextResponse.json(loaded);
}

/** DELETE /api/chat/conversations/[id] → 204 (also removes its messages). */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  const deleted = await deleteConversationRecord(db, (await params).id);
  if (!deleted) return NextResponse.json({ error: "Conversation not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}
