import { describe, expect, it, vi } from "vitest";
import {
  clerkOriginFilter,
  clerkOriginFilterUrls,
  isExtensionOwnRequest,
  registerClerkOriginStrip,
  stripOriginHeader,
  type HeaderLike,
  type RequestDetailsLike,
  type WebRequestLike,
} from "./clerk-origin-strip";

/** The web app's own Clerk.js XHR — the request that must NEVER be rewritten. */
const TAB_REQUEST: RequestDetailsLike = {
  tabId: 5,
  originUrl: "https://www.bookmark-ai.cloud/app/library?section=live",
  requestHeaders: [
    { name: "Origin", value: "https://www.bookmark-ai.cloud" },
    { name: "Accept", value: "*/*" },
  ],
};

/** The background page's native-API mint — the request the strip exists for. */
const BACKGROUND_REQUEST: RequestDetailsLike = {
  tabId: -1,
  originUrl: "moz-extension://3f7a-uuid/background.html",
  requestHeaders: [
    { name: "Origin", value: "moz-extension://3f7a-uuid" },
    { name: "Authorization", value: "client_tok" },
  ],
};

describe("stripOriginHeader", () => {
  it("removes Origin regardless of header-name case", () => {
    const headers: HeaderLike[] = [
      { name: "Authorization", value: "client_tok" },
      { name: "origin", value: "moz-extension://abc" },
      { name: "Accept", value: "*/*" },
    ];
    expect(stripOriginHeader(headers)).toEqual([
      { name: "Authorization", value: "client_tok" },
      { name: "Accept", value: "*/*" },
    ]);
  });

  it("keeps Authorization — it is the whole point of the native path", () => {
    const kept = stripOriginHeader([
      { name: "Origin", value: "moz-extension://abc" },
      { name: "Authorization", value: "client_tok" },
    ]);
    expect(kept).toEqual([{ name: "Authorization", value: "client_tok" }]);
  });

  it("returns null when there is no Origin (GET requests) so the request is untouched", () => {
    expect(stripOriginHeader([{ name: "Authorization", value: "x" }])).toBeNull();
    expect(stripOriginHeader([])).toBeNull();
    expect(stripOriginHeader(undefined)).toBeNull();
  });
});

describe("isExtensionOwnRequest", () => {
  it("rejects a request owned by a tab — the web app's Clerk.js XHR is CORS-checked", () => {
    expect(isExtensionOwnRequest(TAB_REQUEST)).toBe(false);
    // Even without originUrl, a real tab id is disqualifying on its own.
    expect(isExtensionOwnRequest({ tabId: 5 })).toBe(false);
  });

  it("accepts the extension's own background request", () => {
    expect(isExtensionOwnRequest(BACKGROUND_REQUEST)).toBe(true);
    expect(isExtensionOwnRequest({ tabId: -1, documentUrl: "moz-extension://uuid/popup.html" })).toBe(
      true,
    );
  });

  it("rejects a tabless request triggered by a web document (worker, prefetch)", () => {
    expect(isExtensionOwnRequest({ tabId: -1, originUrl: "https://www.bookmark-ai.cloud" })).toBe(
      false,
    );
  });

  it("accepts a tabless request with no triggering document — the documented policy", () => {
    // Firefox omits originUrl on some system-initiated requests; defaulting to
    // "not ours" there would silently re-break the prod session mint, and a
    // FAPI request with no tab AND no document is not a page's CORS XHR.
    expect(isExtensionOwnRequest({ tabId: -1 })).toBe(true);
    expect(isExtensionOwnRequest({})).toBe(true);
    expect(isExtensionOwnRequest({ tabId: -1, originUrl: "" })).toBe(true);
  });
});

describe("clerkOriginFilter", () => {
  it("scopes delivery to the FAPI host AND to tabless requests", () => {
    expect(clerkOriginFilter("https://clerk.bookmark-ai.cloud")).toEqual({
      urls: ["https://clerk.bookmark-ai.cloud/*"],
      tabId: -1,
    });
  });
});

describe("clerkOriginFilterUrls", () => {
  it("covers every path on the FAPI host", () => {
    expect(clerkOriginFilterUrls("https://clerk.bookmark-ai.cloud")).toEqual([
      "https://clerk.bookmark-ai.cloud/*",
    ]);
  });

  it("tolerates a trailing slash", () => {
    expect(clerkOriginFilterUrls("https://darling-baboon-13.clerk.accounts.dev/")).toEqual([
      "https://darling-baboon-13.clerk.accounts.dev/*",
    ]);
  });
});

describe("registerClerkOriginStrip", () => {
  function fakeWebRequest() {
    const addListener = vi.fn();
    return { webRequest: { onBeforeSendHeaders: { addListener } } as WebRequestLike, addListener };
  }

  it("registers a blocking listener scoped to the FAPI host", () => {
    const { webRequest, addListener } = fakeWebRequest();
    expect(registerClerkOriginStrip(webRequest, "https://clerk.bookmark-ai.cloud")).toBe(
      "registered",
    );
    const [listener, filter, extraInfoSpec] = addListener.mock.calls[0]!;
    expect(filter).toEqual({ urls: ["https://clerk.bookmark-ai.cloud/*"], tabId: -1 });
    expect(extraInfoSpec).toEqual(["blocking", "requestHeaders"]);
    expect(listener(BACKGROUND_REQUEST)).toEqual({
      requestHeaders: [{ name: "Authorization", value: "client_tok" }],
    });
    expect(listener({ tabId: -1, requestHeaders: [{ name: "Authorization", value: "tok" }] })).toEqual(
      {},
    );
  });

  it("leaves a tab's request untouched — the 2026-09-08 live-page regression", () => {
    const { webRequest, addListener } = fakeWebRequest();
    registerClerkOriginStrip(webRequest, "https://clerk.bookmark-ai.cloud");
    const listener = addListener.mock.calls[0]![0];
    // No requestHeaders returned at all => Firefox sends the page's Origin as-is,
    // Clerk echoes ACAO, and the page's getToken() resolves promptly.
    expect(listener(TAB_REQUEST)).toEqual({});
  });

  it("falls back to the host-only filter when the engine rejects a tabId filter", () => {
    const calls: { filter: unknown }[] = [];
    const webRequest: WebRequestLike = {
      onBeforeSendHeaders: {
        addListener: (listener, filter, extraInfoSpec) => {
          calls.push({ filter });
          if (filter.tabId !== undefined) throw new Error("tabId filter unsupported");
          // The handler check still protects tab requests on this path.
          expect(listener(TAB_REQUEST)).toEqual({});
          expect(listener(BACKGROUND_REQUEST)).toEqual({
            requestHeaders: [{ name: "Authorization", value: "client_tok" }],
          });
          expect(extraInfoSpec).toEqual(["blocking", "requestHeaders"]);
        },
      },
    };
    expect(registerClerkOriginStrip(webRequest, "https://clerk.bookmark-ai.cloud")).toBe(
      "registered-no-tab-filter",
    );
    expect(calls.map((c) => c.filter)).toEqual([
      { urls: ["https://clerk.bookmark-ai.cloud/*"], tabId: -1 },
      { urls: ["https://clerk.bookmark-ai.cloud/*"] },
    ]);
  });

  it("is a no-op without a FAPI origin or a webRequest API", () => {
    expect(registerClerkOriginStrip(fakeWebRequest().webRequest, null)).toBe("no-origin");
    expect(registerClerkOriginStrip(undefined, "https://clerk.bookmark-ai.cloud")).toBe(
      "unavailable",
    );
    expect(registerClerkOriginStrip({}, "https://clerk.bookmark-ai.cloud")).toBe("unavailable");
  });

  it("never throws when addListener rejects BOTH registrations", () => {
    const webRequest: WebRequestLike = {
      onBeforeSendHeaders: {
        addListener: () => {
          throw new Error("missing webRequestBlocking permission");
        },
      },
    };
    expect(registerClerkOriginStrip(webRequest, "https://clerk.bookmark-ai.cloud")).toBe("failed");
  });
});
