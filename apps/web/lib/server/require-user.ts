import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { AUTHORIZED_PARTIES } from "@/lib/authorized-parties";
import { checkRateLimit } from "@/lib/server/rate-limit";

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Rate-limit bucket key: the caller's IP. Prefer Vercel's
 * `x-vercel-forwarded-for` (the edge sets it and a client can't override it),
 * then the first `x-forwarded-for` hop, then `x-real-ip`, then a constant.
 * SECURITY: XFF is only trustworthy behind Vercel's edge — revisit before
 * self-hosting behind another proxy that doesn't strip an inbound XFF header.
 */
function clientKey(h: Headers): string {
  const vercel = h.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",")[0].trim() || "unknown";
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || "unknown";
  return h.get("x-real-ip") ?? "unknown";
}

// Serving the API without auth is a deliberate mode, but a silent one is a
// footgun — warn exactly once per process so it can't happen by accident.
let openModeWarned = false;
function warnOpenMode(reason: string): void {
  if (openModeWarned) return;
  openModeWarned = true;
  console.warn(`[api] serving in OPEN mode (${reason}) — no authentication is enforced`);
}

// A missing/misnamed CLERK_SECRET_KEY in production would otherwise fail OPEN
// (serve everyone unauthenticated). We fail CLOSED instead — warn exactly once
// so the 503s aren't silent, without logging on every rejected request.
let authMisconfigWarned = false;
function warnAuthMisconfig(): void {
  if (authMisconfigWarned) return;
  authMisconfigWarned = true;
  console.error(
    "[api] CLERK_SECRET_KEY is unset in production and ALLOW_OPEN_MODE is not '1' — refusing all requests (503). Set the secret, or set ALLOW_OPEN_MODE=1 to intentionally run open.",
  );
}

/**
 * Result of the gate. A discriminated union so callers can pull the resolved
 * `userId` out without re-calling `auth()`:
 *  - `{ ok: false }` → an error response to return as-is (429/401/403).
 *  - `{ ok: true, userId }` → allowed. `userId` is null in the OPEN modes
 *    (keyless self-host / dev bypass), where no Clerk user exists — those never
 *    route to a tenant DB (they use the shared/local DB).
 */
export type Gate =
  | { ok: false; response: NextResponse }
  | { ok: true; userId: string | null };

/**
 * API-route gate, mirroring the Express auth middleware: rate limiting, then
 * open-mode shortcuts (keyless self-host / dev bypass), then a Clerk session
 * (browser cookie or `Authorization: Bearer` session JWT — clerkMiddleware
 * verifies both), an azp origin check with Express semantics (absent = pass,
 * so native mobile tokens work; wrong = reject), and an optional user-id
 * allowlist. Order and semantics are byte-equivalent to the previous
 * `NextResponse | null` version — only the return shape changed.
 */
export async function requireUser(): Promise<Gate> {
  const h = await headers();

  if (!checkRateLimit(clientKey(h))) {
    return { ok: false, response: NextResponse.json({ error: "Too many requests" }, { status: 429 }) };
  }

  // Open modes skip Clerk entirely: never call auth() here — it throws when
  // Clerk middleware/keys are absent. No Clerk user → userId null.
  if (!process.env.CLERK_SECRET_KEY) {
    // Keyless open mode is legitimate for local dev and for an intentional
    // self-host, but serving PRODUCTION unauthenticated because a secret went
    // missing/misnamed is a security footgun. So it's allowed ONLY outside
    // production, OR when a self-hoster explicitly opts in with ALLOW_OPEN_MODE=1.
    // Otherwise fail CLOSED with a 503 rather than exposing every user's data.
    const openAllowed =
      process.env.NODE_ENV !== "production" || process.env.ALLOW_OPEN_MODE === "1";
    if (!openAllowed) {
      warnAuthMisconfig();
      return {
        ok: false,
        response: NextResponse.json({ error: "Server auth misconfigured" }, { status: 503 }),
      };
    }
    warnOpenMode("CLERK_SECRET_KEY unset");
    return { ok: true, userId: null };
  }
  if (process.env.DEV_OPEN_API === "1" && process.env.NODE_ENV !== "production") {
    // Lets the Zig desktop app (which can't attach auth headers) talk to a
    // local dev server that DOES have Clerk keys configured.
    warnOpenMode("DEV_OPEN_API=1");
    return { ok: true, userId: null };
  }

  const { userId, sessionClaims } = await auth();
  if (!userId) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Missing or invalid bearer token" }, { status: 401 }),
    };
  }
  const azp = (sessionClaims as { azp?: string } | null)?.azp;
  if (azp && !AUTHORIZED_PARTIES.includes(azp)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Invalid or expired token" }, { status: 401 }),
    };
  }
  const allowed = csv(process.env.CLERK_ALLOWED_USER_IDS);
  if (allowed.length > 0 && !allowed.includes(userId)) {
    return {
      ok: false,
      response: NextResponse.json({ error: "This account may not use this API" }, { status: 403 }),
    };
  }
  return { ok: true, userId };
}
