import { browser } from "wxt/browser";
import { CLERK_PUBLISHABLE_KEY } from "@/lib/clerk";
import { diag } from "@/lib/diag";
import { fetchWithTimeout } from "@/lib/net";

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
  if (!origin) {
    diag("native", "readClientToken", { origin: null });
    return null;
  }
  try {
    const cookie = await browser.cookies.get({ url: origin, name: "__client" });
    // Log presence + length only — NEVER the cookie value.
    diag("native", "readClientToken", { origin, found: !!cookie?.value, len: cookie?.value?.length ?? 0 });
    return cookie?.value || null;
  } catch (e) {
    diag("native", "readClientToken error", {
      origin,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** Clerk's machine-readable error code for a failed FAPI call, for diagnostics
 * only (never a value from the request). `origin_invalid` /
 * `origin_authorization_headers_conflict` mean the browser attached an `Origin`
 * this instance does not allowlist — see lib/clerk-origin-strip.ts. */
export async function errorCode(res: Response): Promise<string | null> {
  try {
    const body = (await res.clone().json()) as { errors?: { code?: string }[] };
    return body.errors?.[0]?.code ?? null;
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

/** One-time-per-SW-lifetime diagnostic: when the FAPI `__client` cookie isn't
 * visible to us, dump what the cookies API DOES return for our domains so we can
 * tell "Safari hides nothing from us" (permission/entitlement empty) from "Safari
 * selectively hides HttpOnly __client" (filtering). Logs count/names/domains
 * ONLY — never cookie values. */
let cookieProbed = false;
async function probeCookieVisibility(): Promise<void> {
  if (cookieProbed) return;
  cookieProbed = true;
  const queries = [
    { domain: "bookmark-ai.cloud" },
    { url: "https://clerk.bookmark-ai.cloud/" },
  ] as const;
  for (const query of queries) {
    try {
      const all = await browser.cookies.getAll(query);
      diag("native", "cookie probe", {
        query,
        count: all.length,
        names: all.map((c) => c.name),
        domains: Array.from(new Set(all.map((c) => c.domain))),
      });
    } catch (e) {
      diag("native", "cookie probe error", {
        query,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

export async function getNativeSession(): Promise<NativeSession | null> {
  const origin = fapiOrigin();
  const token = await readClientToken();
  if (!origin || !token) {
    // Native path can't proceed — surface what the cookies API sees (once).
    void probeCookieVisibility();
    return null;
  }
  try {
    const res = await fetchWithTimeout(`${origin}/v1/client?_is_native=1`, {
      headers: { Authorization: token },
    });
    diag("native", "GET /v1/client", {
      status: res.status,
      ...(res.ok ? {} : { code: await errorCode(res) }),
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
    const res = await fetchWithTimeout(`${origin}/v1/client/sessions/${session.sessionId}/tokens?_is_native=1`, {
      method: "POST",
      headers: { Authorization: token },
    });
    diag("native", "POST /v1/client/sessions/:id/tokens", {
      status: res.status,
      ...(res.ok ? {} : { code: await errorCode(res) }),
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
    const res = await fetchWithTimeout(
      `${origin}/v1/client/sessions/${session.sessionId}/remove?_is_native=1`,
      { method: "POST", headers: { Authorization: token } },
    );
    diag("native", "POST /v1/client/sessions/:id/remove", { status: res.status });
    return res.ok;
  } catch {
    return false;
  }
}
