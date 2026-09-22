import { afterEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { apiUrlItem, authFetch, createBookmark, setAuthTokenProvider } from "./api";
import { requestBridgeFetch } from "./messages";
import { analyticsHeaders, isMainApiRequest } from "./analytics-headers";

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe("analytics attribution", () => {
  it.each(["chrome", "safari"])("labels %s using the build target", async (target) => {
    vi.stubEnv("BROWSER", target);
    expect(await analyticsHeaders()).toEqual({ "X-Bookmark-Client": `extension-${target}` });
  });

  it("reads Firefox consent on every request so revocation takes effect", async () => {
    vi.stubEnv("BROWSER", "firefox");
    vi.spyOn(browser.permissions, "getAll")
      .mockResolvedValueOnce({ permissions: [], origins: [], data_collection: ["technicalAndInteraction"] } as never)
      .mockResolvedValueOnce({ permissions: [], origins: [], data_collection: [] } as never);
    expect(await analyticsHeaders()).toEqual({ "X-Bookmark-Client": "extension-firefox", "X-Bookmark-Analytics-Consent": "granted" });
    expect((await analyticsHeaders())["X-Bookmark-Analytics-Consent"]).toBe("denied");
  });

  it("fails closed when Firefox lacks support or cannot read permissions", async () => {
    vi.stubEnv("BROWSER", "firefox");
    vi.spyOn(browser.permissions, "getAll")
      .mockResolvedValueOnce({ permissions: [], origins: [] } as never)
      .mockRejectedValueOnce(new Error("unavailable"));
    expect((await analyticsHeaders())["X-Bookmark-Analytics-Consent"]).toBe("denied");
    expect((await analyticsHeaders())["X-Bookmark-Analytics-Consent"]).toBe("denied");
  });

  it("restricts attribution to main API origin and paths", () => {
    const base = "https://www.bookmark-ai.cloud";
    expect(isMainApiRequest(`${base}/api/bookmarks?offset=1`, base)).toBe(true);
    expect(isMainApiRequest("https://live.bookmark-ai.cloud/api/bookmarks", base)).toBe(false);
    expect(isMainApiRequest(`${base}/live`, base)).toBe(false);
    expect(isMainApiRequest("not a url", base)).toBe(false);
  });

  it("suppresses automatic saves even with Firefox consent and preserves manual saves", async () => {
    vi.stubEnv("BROWSER", "firefox");
    await apiUrlItem.setValue("https://www.bookmark-ai.cloud");
    setAuthTokenProvider(async () => "test-token");
    vi.spyOn(browser.permissions, "getAll").mockResolvedValue({ permissions: [], origins: [], data_collection: ["technicalAndInteraction"] } as never);
    const headers: Headers[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
      headers.push(new Headers(init?.headers));
      return new Response(JSON.stringify({ bookmark: { id: "test" } }), { status: 201 });
    }));
    await createBookmark({ url: "https://example.com" } as never, { analytics: false });
    await createBookmark({ url: "https://example.com" } as never);
    await authFetch("https://live.bookmark-ai.cloud/live");
    expect(headers[0]?.get("X-Bookmark-Analytics-Consent")).toBe("denied");
    expect(headers[1]?.get("X-Bookmark-Analytics-Consent")).toBe("granted");
    expect(headers[2]?.get("X-Bookmark-Client")).toBeNull();
    expect(headers[2]?.get("X-Bookmark-Analytics-Consent")).toBeNull();
    expect(requestBridgeFetch("/api/bookmarks", "POST", "{}", true).analyticsDenied).toBe(true);
    setAuthTokenProvider(async () => null);
  });
});
