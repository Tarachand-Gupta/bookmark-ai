import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/require-user";
import { mintLiveSessionToken } from "@/lib/server/live-token";

/**
 * GET /api/live-token — mint a fresh standard Clerk session JWT for the caller's
 * CURRENT session, so a client that can't mint one itself can still authenticate
 * to the Live Sessions server (a DIFFERENT origin — `live.bookmark-ai.cloud` —
 * that no cookie or same-origin bridge reaches). The Safari extension fetches
 * this through its content-script bridge (a whitelisted `/api/` path) and
 * attaches the result as `Authorization: Bearer` to live-server requests, which
 * verify standard session JWTs offline (azp absent = pass).
 *
 * Uses the DEFAULT session token (no JWT template) — the exact token
 * `session.getToken()` returns client-side — so NO Clerk dashboard template is
 * required. Never cached server-side; short-lived by design. The actual minting
 * lives in lib/server/live-token.ts (shared with the chat `listLiveTabs` tool).
 */

export async function GET() {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  // Open modes (keyless self-host / dev bypass) have no Clerk session to mint
  // from; a self-hosted live server presumably runs open too (out of scope).
  if (!gate.userId) {
    return NextResponse.json({ error: "live token requires Clerk" }, { status: 501 });
  }

  const { sessionId } = await auth();
  if (!sessionId) {
    return NextResponse.json({ error: "No active session" }, { status: 401 });
  }

  return NextResponse.json(await mintLiveSessionToken(sessionId));
}
