import { describe, expect, it, vi } from "vitest";
import {
  clerkOriginFilterUrls,
  registerClerkOriginStrip,
  stripOriginHeader,
  type HeaderLike,
  type WebRequestLike,
} from "./clerk-origin-strip";

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
    expect(filter).toEqual({ urls: ["https://clerk.bookmark-ai.cloud/*"] });
    expect(extraInfoSpec).toEqual(["blocking", "requestHeaders"]);
    expect(
      listener({
        requestHeaders: [
          { name: "Origin", value: "moz-extension://uuid" },
          { name: "Authorization", value: "tok" },
        ],
      }),
    ).toEqual({ requestHeaders: [{ name: "Authorization", value: "tok" }] });
    expect(listener({ requestHeaders: [{ name: "Authorization", value: "tok" }] })).toEqual({});
  });

  it("is a no-op without a FAPI origin or a webRequest API", () => {
    expect(registerClerkOriginStrip(fakeWebRequest().webRequest, null)).toBe("no-origin");
    expect(registerClerkOriginStrip(undefined, "https://clerk.bookmark-ai.cloud")).toBe(
      "unavailable",
    );
    expect(registerClerkOriginStrip({}, "https://clerk.bookmark-ai.cloud")).toBe("unavailable");
  });

  it("never throws when addListener rejects the registration", () => {
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
