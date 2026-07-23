import { clerkClient } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/server/require-user";

/**
 * GET /api/me — the current signed-in identity, for the cookie-credentialed auth
 * path. The Safari extension fetches this with `credentials:'include'` so the
 * SITE's own Clerk session cookie authenticates the request WITHOUT the extension
 * ever reading the cookie (Safari's `browser.cookies` API doesn't expose Clerk's
 * HttpOnly `__client` cookie, which breaks the SDK + Native-API paths there).
 *
 * A normal protected route: `requireUser()` gates it (rate limit → session/bearer
 * → azp → allowlist), so a signed-out caller gets the standard 401 JSON.
 */
export async function GET() {
  const gate = await requireUser();
  if (!gate.ok) return gate.response;

  // Open modes (keyless self-host / dev bypass) have no Clerk user to look up.
  if (!gate.userId) {
    return NextResponse.json({ signedIn: true, name: null, email: null });
  }

  const client = await clerkClient();
  const user = await client.users.getUser(gate.userId);
  const name =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.username || null;
  const email =
    user.emailAddresses.find((e) => e.id === user.primaryEmailAddressId)?.emailAddress ??
    user.emailAddresses[0]?.emailAddress ??
    null;
  return NextResponse.json({ signedIn: true, name, email });
}
