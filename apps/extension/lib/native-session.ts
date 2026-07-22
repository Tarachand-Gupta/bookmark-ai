import { browser } from "wxt/browser";
import { CLERK_PUBLISHABLE_KEY } from "@/lib/clerk";

/**
 * Native-API session resolution for PRODUCTION Clerk instances.
 *
 * Why this exists: with a production instance on a custom domain, the client
 * token lives in an HttpOnly `__client` cookie on the FRONTEND API domain
 * (e.g. `clerk.bookmark-ai.cloud`) — NOT on the web app origin. As of
 * @clerk/chrome-extension 3.1.55 the syncHost flow only looks for cookies on
 * the syncHost itself, so it never finds the production session and resolves
 * an anonymous client. This module implements the documented Native API
 * handshake directly: read the `__client` cookie from the FAPI domain (the
 * extension has host_permissions + `cookies` for it) and present it as the
 * `Authorization` header with `_is_native=1`. Verified working against
 * clerk.bookmark-ai.cloud on 2026-07-22. Dev instances keep using the SDK
 * path (`__clerk_db_jwt` on the syncHost) — this is a FALLBACK, tried only
 * when the SDK resolves no session.
 */

/** Frontend API origin, decoded from the publishable key
 * (`pk_<env>_<base64(host + "$")>`). */
export function fapiOrigin(publishableKey: string = CLERK_PUBLISHABLE_KEY): string | null {
  const b64 = publishableKey.split("_")[2] ?? "";
  try {
    const host = atob(b64).replace(/\$$/, "");
    return host ? `https://${host}` : null;
  } catch {
    return null;
  }
}

/** The client token from the FAPI domain's `__client` cookie, or null. */
async function readClientToken(): Promise<string | null> {
  const origin = fapiOrigin();
  if (!origin) return null;
  try {
    const cookie = await browser.cookies.get({ url: origin, name: "__client" });
    return cookie?.value || null;
  } catch {
    return null;
  }
}

interface FapiUser {
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  primary_email_address_id?: string | null;
  email_addresses?: { id?: string; email_address?: string }[];
}

interface FapiSession {
  id?: string;
  status?: string;
  user?: FapiUser | null;
}

/** The active session (with its user) for the FAPI `__client` cookie, or null. */
export interface NativeSession {
  sessionId: string;
  name: string | null;
  email: string | null;
}

export async function getNativeSession(): Promise<NativeSession | null> {
  const origin = fapiOrigin();
  const token = await readClientToken();
  if (!origin || !token) return null;
  try {
    const res = await fetch(`${origin}/v1/client?_is_native=1`, {
      headers: { Authorization: token },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      response?: { sessions?: FapiSession[] } | null;
      client?: { sessions?: FapiSession[] } | null;
    };
    const client = body.response ?? body.client ?? null;
    const session = client?.sessions?.find((s) => s.status === "active");
    if (!session?.id) return null;
    const user = session.user ?? {};
    const name =
      [user.first_name, user.last_name].filter(Boolean).join(" ") || user.username || null;
    const email =
      user.email_addresses?.find((e) => e.id === user.primary_email_address_id)?.email_address ??
      user.email_addresses?.[0]?.email_address ??
      null;
    return { sessionId: session.id, name, email };
  } catch {
    return null;
  }
}

/** Mint a short-lived session JWT for API calls (the same token the SDK's
 * `session.getToken()` would return), or null. */
export async function getNativeSessionToken(): Promise<string | null> {
  const origin = fapiOrigin();
  const token = await readClientToken();
  if (!origin || !token) return null;
  const session = await getNativeSession();
  if (!session) return null;
  try {
    const res = await fetch(`${origin}/v1/client/sessions/${session.sessionId}/tokens?_is_native=1`, {
      method: "POST",
      headers: { Authorization: token },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { jwt?: string; response?: { jwt?: string } | null };
    return body.jwt ?? body.response?.jwt ?? null;
  } catch {
    return null;
  }
}

/** End the active session (signs the user out of the WEB session too — it is
 * the same Clerk client). Returns whether a session was ended. */
export async function nativeSignOut(): Promise<boolean> {
  const origin = fapiOrigin();
  const token = await readClientToken();
  if (!origin || !token) return false;
  const session = await getNativeSession();
  if (!session) return false;
  try {
    const res = await fetch(
      `${origin}/v1/client/sessions/${session.sessionId}/remove?_is_native=1`,
      { method: "POST", headers: { Authorization: token } },
    );
    return res.ok;
  } catch {
    return false;
  }
}
