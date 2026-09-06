import { auth } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { AUTHORIZED_PARTIES } from "@/lib/authorized-parties";
import { DEVICE_TOKEN_PREFIX, verifyDeviceToken } from "@/lib/server/device-token";
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
 * Exported for the PUBLIC routes that skip the gate but still rate-limit
 * (`/api/app/releases`).
 */
export function clientKey(h: Headers): string {
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
 *    route to a tenant DB (they use the shared/local DB). `via` records how the
 *    caller authenticated ("clerk" session vs. a long-lived "device" token); it's
 *    absent for the open modes and used by /api/device-token to enforce the
 *    renewal-chain cap. `sessionId` is the Clerk session id from the SAME
 *    `auth()` call (null for device tokens and the open modes) — routes that
 *    need it (the chat agent mints the caller's live-server token from it) read
 *    it here instead of paying for a second `auth()`.
 */
export type Gate =
  | { ok: false; response: NextResponse }
  | { ok: true; userId: string | null; via?: "clerk" | "device"; sessionId: string | null };

/**
 * The ONLY routes a device token may call — the extension's save/live/native-sync
 * surface. Everything else 403s with code "token-scope" even with a valid token.
 * Keep this list in lockstep with what apps/extension actually calls via its
 * device token (the live server is a separate origin with its own device-token
 * acceptance).
 */
const DEVICE_TOKEN_ROUTES = new Set([
  "POST /api/bookmarks",
  "POST /api/sessions",
  "GET /api/me",
  "POST /api/device-token",
  "GET /api/settings",
]);

/** Dynamic-suffix device-token scope: "METHOD /prefix" entries match by prefix —
 * needed for per-id paths. `DELETE /api/bookmarks/:id` is the native-sync "full
 * sync" remove mirror: the extension keeps a local url→id map of mirroring adds,
 * so a device token never needs (or gets) list/read access to the library. */
const DEVICE_TOKEN_ROUTE_PREFIXES = ["DELETE /api/bookmarks/"];

/** `x-bkm-route` → canonical "METHOD /path" (trailing slash stripped). */
function normalizeRoute(stamp: string | null): string {
  if (!stamp) return "";
  const [method, path] = stamp.split(" ");
  if (!method || !path) return "";
  return `${method.toUpperCase()} ${path.length > 1 ? path.replace(/\/+$/, "") : path}`;
}

/**
 * API-route gate, mirroring the Express auth middleware: rate limiting, then
 * open-mode shortcuts (keyless self-host / dev bypass), then a long-lived device
 * token (`Bearer bkd_…`, verified locally — the Safari extension's header-auth
 * path), then a Clerk session (browser cookie or `Authorization: Bearer` session
 * JWT — clerkMiddleware verifies both), an azp origin check with Express semantics (absent = pass,
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
    return { ok: true, userId: null, sessionId: null };
  }
  if (process.env.DEV_OPEN_API === "1" && process.env.NODE_ENV !== "production") {
    // Lets the Zig desktop app (which can't attach auth headers) talk to a
    // local dev server that DOES have Clerk keys configured.
    warnOpenMode("DEV_OPEN_API=1");
    return { ok: true, userId: null, sessionId: null };
  }

  // Long-lived device token (Safari extension header-auth — see device-token.ts).
  // Verified BEFORE Clerk's auth() because it's a self-contained JWT we sign; a
  // device token carries no azp, so it skips the origin check. Same allowlist.
  const authHeader = h.get("authorization");
  const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  if (bearer.startsWith(DEVICE_TOKEN_PREFIX)) {
    const verified = verifyDeviceToken(bearer);
    if (!verified) {
      return {
        ok: false,
        response: NextResponse.json({ error: "Invalid or expired token" }, { status: 401 }),
      };
    }
    // SCOPE: device tokens are extension credentials, not full-power sessions —
    // they're honored ONLY on the routes the extension needs. The route comes from
    // the middleware's `x-bkm-route` stamp (always overwritten there, unspoofable);
    // a missing stamp fails CLOSED. Everything else — list/search/export, chat,
    // imports — requires a real Clerk session, so a stolen token can't read or
    // destroy the library (the only destructive capability a device token gets is
    // per-id deletes, the opt-in native-sync mirror surface).
    const route = normalizeRoute(h.get("x-bkm-route"));
    const inScope =
      DEVICE_TOKEN_ROUTES.has(route) ||
      DEVICE_TOKEN_ROUTE_PREFIXES.some((prefix) => route.startsWith(prefix));
    if (!inScope) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "This token may not access this endpoint", code: "token-scope" },
          { status: 403 },
        ),
      };
    }
    const allowedDevice = csv(process.env.CLERK_ALLOWED_USER_IDS);
    if (allowedDevice.length > 0 && !allowedDevice.includes(verified.userId)) {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "This account may not use this API", code: "forbidden" },
          { status: 403 },
        ),
      };
    }
    return { ok: true, userId: verified.userId, via: "device", sessionId: null };
  }

  const { userId, sessionClaims, sessionId } = await auth();
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
    // `code: "forbidden"` is additive — the `error` string is unchanged so
    // clients in the wild that match on it keep working, while newer clients
    // detect the stable code to show a distinct "no access" state (the account
    // is signed in, just not on the allowlist). Keep the message in sync with
    // FORBIDDEN_MESSAGE in lib/api.ts.
    return {
      ok: false,
      response: NextResponse.json(
        { error: "This account may not use this API", code: "forbidden" },
        { status: 403 },
      ),
    };
  }
  return { ok: true, userId, via: "clerk", sessionId: sessionId ?? null };
}
