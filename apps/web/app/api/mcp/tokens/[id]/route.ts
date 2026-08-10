import { NextResponse, type NextRequest } from "next/server";
import { getMcpToken, revokeMcpToken } from "@bookmark-ai/db";
import { getRequestApiContext } from "@/lib/server/api-context";

type Params = { params: Promise<{ id: string }> };

/**
 * DELETE /api/mcp/tokens/:id — revoke a token. The row is KEPT (with
 * `revoked_at` stamped) so the Settings list can still show that the token
 * existed and when it was last used; /api/mcp refuses any token whose row is
 * revoked, which takes effect immediately (it is checked per request).
 *
 * Clerk session only — see ../route.ts on why a token can't revoke a token.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  const id = (await params).id;
  const existing = await getMcpToken(db, id);
  if (!existing) return NextResponse.json({ error: "Token not found" }, { status: 404 });
  // Already revoked → still 204: the caller's intended end state holds.
  await revokeMcpToken(db, id);
  return new NextResponse(null, { status: 204 });
}
