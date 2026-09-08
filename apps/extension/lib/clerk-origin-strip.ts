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
 * not a concern **for the extension's own requests**: a request covered by
 * `host_permissions` is not subject to a CORS check, so nothing reads the
 * response's ACAO header.
 *
 * SCOPE — this must ONLY touch the extension's own requests (regression,
 * 2026-09-08): a `webRequest` listener sees EVERY request in the browser that
 * matches its filter, not just the extension's. The first cut filtered on the
 * FAPI host alone, so it also stripped `Origin` from the WEB APP's Clerk.js
 * XHRs (`Origin: https://www.bookmark-ai.cloud`, credentialed, made from the
 * tab). Those DO go through a CORS check: with no `Origin` on the wire Clerk
 * echoes no `Access-Control-Allow-Origin`, Firefox rejects the response, and
 * Clerk.js falls back/retries — which is why, with the add-on loaded,
 * `/app/library?section=live` took 5-10s to show live tabs and sometimes hit
 * the "Couldn't reach the live sessions server" panel (the page's `getToken()`
 * for the live server was slow or failed). Chrome was unaffected because the
 * listener is Firefox-only. The listener is therefore scoped BOTH by the
 * `RequestFilter` (`tabId: -1` = not owned by a tab) AND, authoritatively, by
 * `isExtensionOwnRequest` in the handler.
 *
 * Kept free of `wxt/browser` / `import.meta.env` so the header logic is unit
 * testable in node; the caller passes the runtime objects in.
 */

/** One `webRequest` request header. */
export interface HeaderLike {
  name: string;
  value?: string;
}

/**
 * The `onBeforeSendHeaders` details this module reads. Firefox populates
 * `originUrl` (the URL of the resource that TRIGGERED the request) on every
 * request; `documentUrl` is its Chrome-ish sibling and is read defensively.
 * `tabId` is `-1` when no tab owns the request (background page, extension
 * page, service worker).
 */
export interface RequestDetailsLike {
  requestHeaders?: HeaderLike[];
  tabId?: number;
  originUrl?: string;
  documentUrl?: string;
}

/** The `RequestFilter` this module builds. */
export interface RequestFilterLike {
  urls: string[];
  tabId?: number;
}

/** The subset of `webRequest.onBeforeSendHeaders` this module touches. */
export interface WebRequestLike {
  onBeforeSendHeaders?: {
    addListener: (
      listener: (details: RequestDetailsLike) => unknown,
      filter: RequestFilterLike,
      extraInfoSpec: string[],
    ) => void;
  };
}

export type OriginStripOutcome =
  /** Listener installed — the extension's Clerk FAPI requests lose `Origin`. */
  | "registered"
  /**
   * Installed, but this browser rejected the `tabId: -1` filter, so the
   * listener is scoped by `isExtensionOwnRequest` alone. Still correct — tab
   * requests are passed through untouched — just less selectively delivered.
   */
  | "registered-no-tab-filter"
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
 * The `RequestFilter`: the FAPI host AND `tabId: -1` (requests no tab owns —
 * the background page and extension pages). The tab filter is an OPTIMIZATION
 * that keeps the blocking listener off the browsing path entirely; correctness
 * rests on `isExtensionOwnRequest`, because not every engine honours a `tabId`
 * filter and `registerClerkOriginStrip` drops it if `addListener` rejects it.
 */
export function clerkOriginFilter(origin: string): RequestFilterLike {
  return { urls: clerkOriginFilterUrls(origin), tabId: NO_TAB };
}

/** `webRequest`'s sentinel for "no tab owns this request". */
const NO_TAB = -1;

const EXTENSION_URL = /^moz-extension:\/\//i;

/**
 * Pure: is this request the EXTENSION's own (background/extension page), as
 * opposed to one the browser made for a web page?
 *
 * Order matters — the tab id is checked first because it is the one field
 * Firefox always populates:
 *  • a real tab id (≥ 0) ⇒ a page's request ⇒ NEVER touched (the regression);
 *  • otherwise the triggering document decides: `moz-extension://` ⇒ ours,
 *    any other scheme (`https://www.bookmark-ai.cloud`, a service worker) ⇒
 *    not ours;
 *  • neither field present ⇒ ours. POLICY, deliberately permissive: `tabId`
 *    is absent/-1 and no document triggered the request, which is what a
 *    background `fetch()` looks like — Firefox omits `originUrl` for some
 *    system-initiated requests, and the alternative (default to "not ours")
 *    would silently re-break the prod session mint this listener exists to
 *    fix. The blast radius is bounded by the URL filter: a non-extension
 *    request to the Clerk FAPI with no tab AND no triggering document is not
 *    a page's CORS-checked XHR, so it cannot reproduce the regression.
 */
export function isExtensionOwnRequest(details: RequestDetailsLike): boolean {
  if (typeof details.tabId === "number" && details.tabId !== NO_TAB) return false;
  const trigger = details.originUrl ?? details.documentUrl;
  if (trigger === undefined || trigger === "") return true;
  return EXTENSION_URL.test(trigger);
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
  const listener = (details: RequestDetailsLike) => {
    if (!isExtensionOwnRequest(details)) return {};
    const requestHeaders = stripOriginHeader(details.requestHeaders);
    return requestHeaders ? { requestHeaders } : {};
  };
  const extraInfoSpec = ["blocking", "requestHeaders"];
  try {
    on.addListener(listener, clerkOriginFilter(fapiOrigin), extraInfoSpec);
    return "registered";
  } catch {
    // An engine that rejects `tabId` in a RequestFilter must not lose the fix:
    // retry on the host filter alone — the handler's own check still keeps the
    // listener off every tab request.
    try {
      on.addListener(listener, { urls: clerkOriginFilterUrls(fapiOrigin) }, extraInfoSpec);
      return "registered-no-tab-filter";
    } catch {
      return "failed";
    }
  }
}
