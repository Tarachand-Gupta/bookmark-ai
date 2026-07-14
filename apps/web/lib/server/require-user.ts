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

/** First hop of x-forwarded-for (the client), then x-real-ip, then a constant. */
function clientKey(h: Headers): string {
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

/**
 * API-route gate, mirroring the Express auth middleware: rate limiting, then
 * open-mode shortcuts (keyless self-host / dev bypass), then a Clerk session
 * (browser cookie or `Authorization: Bearer` session JWT — clerkMiddleware
 * verifies both), an azp origin check with Express semantics (absent = pass,
 * so native mobile tokens work; wrong = reject), and an optional user-id
 * allowlist. Returns the error response to send, or null to proceed.
 */
export async function requireUser(): Promise<NextResponse | null> {
  const h = await headers();

  if (!checkRateLimit(clientKey(h))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  // Open modes skip Clerk entirely: never call auth() here — it throws when
  // Clerk middleware/keys are absent.
  if (!process.env.CLERK_SECRET_KEY) {
    warnOpenMode("CLERK_SECRET_KEY unset");
    return null;
  }
  if (process.env.DEV_OPEN_API === "1" && process.env.NODE_ENV !== "production") {
    // Lets the Zig desktop app (which can't attach auth headers) talk to a
    // local dev server that DOES have Clerk keys configured.
    warnOpenMode("DEV_OPEN_API=1");
    return null;
  }

  const { userId, sessionClaims } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Missing or invalid bearer token" }, { status: 401 });
  }
  const azp = (sessionClaims as { azp?: string } | null)?.azp;
  if (azp && !AUTHORIZED_PARTIES.includes(azp)) {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }
  const allowed = csv(process.env.CLERK_ALLOWED_USER_IDS);
  if (allowed.length > 0 && !allowed.includes(userId)) {
    return NextResponse.json({ error: "This account may not use this API" }, { status: 403 });
  }
  return null;
}
