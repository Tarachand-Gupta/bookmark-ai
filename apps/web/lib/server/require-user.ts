import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { AUTHORIZED_PARTIES } from "@/lib/authorized-parties";

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * API-route gate, mirroring the Express auth middleware: a Clerk session
 * (browser cookie or `Authorization: Bearer` session JWT — clerkMiddleware
 * verifies both), an azp origin check with Express semantics (absent = pass,
 * so native mobile tokens work; wrong = reject), and an optional user-id
 * allowlist. Returns the error response to send, or null to proceed.
 */
export async function requireUser(): Promise<NextResponse | null> {
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
