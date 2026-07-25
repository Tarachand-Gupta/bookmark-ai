import { headers } from "next/headers";
import { NextResponse } from "next/server";
import {
  DEVICE_TOKEN_PREFIX,
  DEVICE_TOKEN_ROOT_MAX_AGE_SECONDS,
  mintDeviceToken,
  verifyDeviceToken,
} from "@/lib/server/device-token";
import { requireUser } from "@/lib/server/require-user";

/**
 * POST /api/device-token — mint (or renew) a long-lived device token for the
 * caller. The Safari extension calls this ONCE after a real Clerk sign-in (via its
 * content-script bridge), stores the returned `bkd_…` token, and thereafter
 * re-calls this same route WITH that token to renew before expiry — no further
 * Clerk visibility needed. See lib/server/device-token.ts for the format and why.
 *
 * Two paths, both gated through requireUser():
 *  - Clerk session  → mint a FRESH token (starts a new 90-day renewal chain).
 *  - Device token   → renew, PRESERVING the chain's root issued-at (`rti`), but
 *    only while the chain is younger than 365 days; past that, force a real
 *    Clerk re-auth (401 `code:"reauth"`) so a stolen token can't renew forever.
 */
export async function POST() {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  // Open modes (keyless self-host / dev bypass) have no Clerk user to bind a token
  // to; device tokens are meaningless without a stable identity.
  if (!gate.userId) {
    return NextResponse.json({ error: "device tokens require Clerk" }, { status: 501 });
  }

  let rootIatSeconds: number | undefined;
  if (gate.via === "device") {
    // Re-verify the presented token to read its `rti` (requireUser only surfaced
    // the userId). Enforce the renewal-chain cap: a device token can renew itself
    // only within 365 days of the chain's root.
    const h = await headers();
    const authHeader = h.get("authorization");
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
    const verified = bearer.startsWith(DEVICE_TOKEN_PREFIX) ? verifyDeviceToken(bearer) : null;
    if (!verified) {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }
    const now = Math.floor(Date.now() / 1000);
    if (now - verified.rti > DEVICE_TOKEN_ROOT_MAX_AGE_SECONDS) {
      return NextResponse.json(
        { error: "Re-authentication required", code: "reauth" },
        { status: 401 },
      );
    }
    rootIatSeconds = verified.rti;
  }

  const { token, expiresInSeconds, expiresAtMs } = mintDeviceToken(gate.userId, rootIatSeconds);
  return NextResponse.json({ token, expiresInSeconds, expiresAtMs });
}
