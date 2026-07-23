import { NextResponse } from "next/server";
import { listConversationRecords } from "@bookmark-ai/engine";
import { getRequestApiContext } from "@/lib/server/api-context";

// Authed, per-user — never statically cache.
export const dynamic = "force-dynamic";

/**
 * GET /api/chat/conversations → { conversations: [{ id, title, createdAt,
 * updatedAt }] }, newest updated first. Thin adapter over the engine chat store.
 */
export async function GET() {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  const conversations = await listConversationRecords(db);
  return NextResponse.json({ conversations });
}
