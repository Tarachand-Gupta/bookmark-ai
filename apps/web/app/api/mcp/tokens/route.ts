import { NextResponse, type NextRequest } from "next/server";
import { insertMcpToken, listMcpTokens } from "@bookmark-ai/db";
import { createMcpTokenSchema, type McpToken } from "@bookmark-ai/types";
import { getRequestApiContext } from "@/lib/server/api-context";
import { isMcpConfigured, mcpTokenHint, mintMcpToken } from "@/lib/server/mcp-token";
import { mcpSubject } from "@/lib/server/mcp/subject";

/**
 * MCP token management. These routes go through `getRequestApiContext()`, so they
 * accept ONLY a Clerk session (or an open/self-host install, where there is no
 * Clerk user and the subject collapses to the `"local"` sentinel — same pattern
 * as /api/settings).
 *
 * A device token (`bkd_`) is refused by requireUser's route scoping, and an MCP
 * token (`bkmcp_`) has no Clerk session at all, so it 401s: a credential can
 * never mint or revoke another credential. That containment is the whole point —
 * a leaked MCP token cannot extend its own lifetime or lock the owner out.
 *
 * The token VALUE exists only in the POST response. Nothing stores it, and no
 * other route can return it.
 */

/** GET /api/mcp/tokens → the caller's tokens (revoked ones included, as history). */
export async function GET() {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready } = ctx;
  await ready;

  const tokens: McpToken[] = (await listMcpTokens(db)).map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: row.createdAt,
    lastUsedAt: row.lastUsedAt,
    revokedAt: row.revokedAt,
    // Not a secret: 10 of ~260 characters, stored at mint time purely so the
    // Settings list can say which row is which token. Null for pre-v11 rows.
    hint: row.hint,
  }));
  return NextResponse.json({ tokens });
}

/** POST /api/mcp/tokens → mint one. The response is the ONLY time the value is
 * transmitted; it is not recoverable. */
export async function POST(req: NextRequest) {
  const ctx = await getRequestApiContext();
  if ("response" in ctx) return ctx.response;
  const { db, ready, userId } = ctx;
  await ready;

  if (!isMcpConfigured()) {
    return NextResponse.json(
      { error: "MCP is not configured on this server (DEVICE_TOKEN_SECRET is unset)" },
      { status: 503 },
    );
  }

  const parsed = createMcpTokenSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid body" },
      { status: 400 },
    );
  }

  // Bind the token to the same subject the tool config is keyed by, so /api/mcp
  // resolves the identical settings row and (flag-on) the identical tenant DB.
  const minted = mintMcpToken(mcpSubject(userId));
  const row = await insertMcpToken(db, {
    id: minted.id,
    name: parsed.data.name,
    createdAt: new Date(minted.issuedAtMs).toISOString(),
    // The ONLY moment the hint can be computed — the value is not stored and
    // never crosses this boundary again.
    hint: mcpTokenHint(minted.token),
  });

  // The response shape is unchanged: it already carries the full token, so
  // echoing its own hint back would be noise. The list route serves the hint.
  return NextResponse.json(
    { token: minted.token, id: row.id, name: row.name, createdAt: row.createdAt },
    { status: 201 },
  );
}
