import { afterEach, describe, expect, it, vi } from "vitest";
const auth = vi.hoisted(() => ({ getAccessToken: vi.fn(), getSession: vi.fn() }));
vi.mock("./auth", () => ({ getAccessToken: auth.getAccessToken, getBrowserSupabase: () => ({ auth: { getSession: auth.getSession } }) }));
import { getAppReleases, getLive, getObservability, listMcpTokens, listSkills } from "./api";

function signedIn(id: string) {
  auth.getAccessToken.mockResolvedValue("test-token");
  auth.getSession.mockResolvedValue({ data: { session: { user: { id }, access_token: "test-token" } } });
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("settings prefetch read attribution", () => {
  it("binds metadata, skills and admin reads to their original account", async () => {
    signedIn("other-account"); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    for (const read of [listMcpTokens, listSkills, getObservability, getAppReleases]) {
      await expect(read(undefined, "original-account")).rejects.toThrow("account changed");
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it("reuses prefetched settings to resolve live URL without a second settings request", async () => {
    signedIn("account");
    const payload = { enabled: true, devices: [] };
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => payload }); vi.stubGlobal("fetch", fetch);
    const controller = new AbortController();
    const result = await getLive(controller.signal, "account", Promise.resolve({ settings: { liveServerUrl: "https://live.example.test" } } as never));
    expect(result).toEqual(payload); expect(fetch).toHaveBeenCalledTimes(1);
    // The Live origin accepts Authorization and Content-Type only. The main
    // API's X-Bookmark-Client attribution must not trigger a rejected preflight.
    expect(fetch).toHaveBeenCalledWith("https://live.example.test/live", expect.objectContaining({ signal: controller.signal, headers: { authorization: "Bearer test-token" } }));
  });
  it("does not send a live read after settings resolve across an account change or timeout", async () => {
    signedIn("other-account"); const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const settings = Promise.resolve({ settings: { liveServerUrl: "https://live.example.test" } } as never);
    await expect(getLive(undefined, "account", settings)).rejects.toThrow("account changed");
    const controller = new AbortController(); controller.abort(); signedIn("account");
    await expect(getLive(controller.signal, "account", settings)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
