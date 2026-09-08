/**
 * FIREFOX ONLY — strip the `Origin` header off the extension's own requests to
 * the Clerk Frontend API.
 *
 * WHY (prod outage, 2026-09-08): on the PRODUCTION Clerk instance the native
 * fallback in `lib/native-session.ts` presents the `__client` cookie as an
 * `Authorization` header with `?_is_native=1`. Clerk's FAPI rejects a request
 * that carries BOTH `Origin` and `Authorization` unless the origin is in the
 * instance's `allowed_origins`:
 *
 *   400 {"code":"origin_authorization_headers_conflict",
 *        "message":"Setting both the 'Origin' and 'Authorization' headers is
 *                   forbidden"}
 *
 * and rejects an un-allowlisted `Origin` on its own with
 * `400 {"code":"origin_invalid"}` (both verified against
 * clerk.bookmark-ai.cloud AND darling-baboon-13.clerk.accounts.dev).
 *
 * A Firefox extension's background `fetch` sends `Origin: moz-extension://<UUID>`
 * on every non-GET request (Bugzilla 1405971), and that UUID is regenerated per
 * INSTALL, so it can never be added to `allowed_origins` the way the Chrome
 * extension ids are. That is exactly the observed failure shape: the GET
 * `/v1/client` probe (no Origin on a GET) returns 200, then the POST
 * `/v1/client/sessions/:id/tokens` returns 400, no session JWT is minted, the
 * device token can't be minted or renewed, and the live server 401s — the
 * "Live tabs toggles on then flips back off" symptom.
 *
 * Chrome is unaffected: `Origin: chrome-extension://<pinned id>` IS allowlisted
 * (see wxt.config.ts CRX_KEYS / CLAUDE.md). Safari never reaches this path (it
 * mints through the content-script bridge). Firefox against the DEV instance
 * also never reached it: dev sessions resolve on the SDK rung, and the native
 * fallback only runs when the SDK finds nothing.
 *
 * With no `Origin` at all Clerk treats the call as a native (non-browser)
 * request and answers 200 — verified by curl against both instances. CORS is
 * not a concern: an extension request covered by `host_permissions` is not
 * subject to a CORS check, so nothing reads the response's ACAO header.
 *
 * Kept free of `wxt/browser` / `import.meta.env` so the header logic is unit
 * testable in node; the caller passes the runtime objects in.
 */

/** One `webRequest` request header. */
export interface HeaderLike {
  name: string;
  value?: string;
}

/** The subset of `webRequest.onBeforeSendHeaders` this module touches. */
export interface WebRequestLike {
  onBeforeSendHeaders?: {
    addListener: (
      listener: (details: { requestHeaders?: HeaderLike[] }) => unknown,
      filter: { urls: string[] },
      extraInfoSpec: string[],
    ) => void;
  };
}

export type OriginStripOutcome =
  /** Listener installed — Clerk FAPI requests will go out without `Origin`. */
  | "registered"
  /** No FAPI origin could be derived from the publishable key. */
  | "no-origin"
  /** `webRequest.onBeforeSendHeaders` is not available (non-Firefox, tests). */
  | "unavailable"
  /** `addListener` threw (missing permission, exotic host). */
  | "failed";

/** Match pattern covering every Clerk FAPI path for `origin`. */
export function clerkOriginFilterUrls(origin: string): string[] {
  return [`${origin.replace(/\/+$/, "")}/*`];
}

/**
 * Pure: the header list without `Origin`, or `null` when there was none (the
 * listener then returns nothing, leaving the request untouched — returning a
 * `requestHeaders` array on every request would make Firefox rewrite headers it
 * did not need to).
 */
export function stripOriginHeader(headers: readonly HeaderLike[] | undefined): HeaderLike[] | null {
  if (!headers) return null;
  const kept = headers.filter((h) => h.name.toLowerCase() !== "origin");
  return kept.length === headers.length ? null : kept;
}

/**
 * Install the blocking `onBeforeSendHeaders` listener for the Clerk FAPI host.
 * Call ONCE at background boot, Firefox target only. Never throws — a failure
 * leaves today's behavior (the 400, then the device-token/`fallback` ladder) in
 * place, never worse.
 */
export function registerClerkOriginStrip(
  webRequest: WebRequestLike | undefined,
  fapiOrigin: string | null,
): OriginStripOutcome {
  if (!fapiOrigin) return "no-origin";
  const on = webRequest?.onBeforeSendHeaders;
  if (!on?.addListener) return "unavailable";
  try {
    on.addListener(
      (details) => {
        const requestHeaders = stripOriginHeader(details.requestHeaders);
        return requestHeaders ? { requestHeaders } : {};
      },
      { urls: clerkOriginFilterUrls(fapiOrigin) },
      ["blocking", "requestHeaders"],
    );
    return "registered";
  } catch {
    return "failed";
  }
}
