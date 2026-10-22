import { beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({
  token: null as string | null,
  permission: false,
  tree: vi.fn(),
  fetch: vi.fn(),
  store: vi.fn(),
}));
vi.mock("wxt/browser", () => ({
  browser: {
    bookmarks: { getTree: fixture.tree },
    permissions: { contains: async () => fixture.permission },
    storage: { local: { set: fixture.store } },
  },
}));
vi.mock("./api", () => ({ getApiBaseUrl: async () => "https://fixture.test" }));
vi.mock("./supabase-oauth", () => ({
  SUPABASE_AUTH: true,
  getOAuthToken: async () => fixture.token,
}));
vi.mock("./net", () => ({ fetchWithTimeout: fixture.fetch }));
import {
  extensionImportRequest,
  importAccountSubject,
  readBrowserImportPreview,
  readExtensionImportSyncSettings,
} from "./bookmark-import";
const token = (sub: string) => `header.${btoa(JSON.stringify({ sub }))}.signature`;
beforeEach(() => {
  vi.clearAllMocks();
  fixture.token = token("account-a");
  fixture.permission = false;
});

describe("extension import identity and permission boundaries", () => {
  it("uses a stable account subject without retaining a credential", () => {
    expect(importAccountSubject(token("fixture-account"))).toBe("fixture-account");
  });
  it("rejects missing or malformed account subjects", () => {
    for (const value of [null, "", "bad", "header.!.signature", `header.${btoa("{}")}.signature`])
      expect(importAccountSubject(value)).toBeNull();
  });
  it("never reads the browser library when permission is denied or revoked", async () => {
    await expect(readBrowserImportPreview("account-a")).rejects.toThrow("Allow bookmark access");
    expect(fixture.tree).not.toHaveBeenCalled();
    expect(fixture.fetch).not.toHaveBeenCalled();
  });
  it("never dispatches under another account's credential", async () => {
    await expect(extensionImportRequest("account-b", { action: "apply" })).rejects.toThrow(
      "account changed",
    );
    expect(fixture.fetch).not.toHaveBeenCalled();
  });
  it("reads sync status with the captured credential and updates the background's cache", async () => {
    fixture.fetch.mockResolvedValue(
      new Response(
        JSON.stringify({ settings: { nativeSyncEnabled: false, nativeSyncFull: true } }),
      ),
    );
    expect(await readExtensionImportSyncSettings("account-a")).toEqual({
      nativeSyncEnabled: false,
      nativeSyncFull: true,
    });
    expect(fixture.fetch).toHaveBeenCalledWith(
      "https://fixture.test/api/settings",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: `Bearer ${fixture.token}` }),
        credentials: "omit",
      }),
    );
    expect(fixture.store).toHaveBeenCalledWith({ nativeSyncEnabled: false, nativeSyncFull: true });
  });
  it("discards settings from the previous account after a switch", async () => {
    fixture.fetch.mockImplementationOnce(async () => {
      fixture.token = token("account-b");
      return new Response(
        JSON.stringify({ settings: { nativeSyncEnabled: true, nativeSyncFull: true } }),
      );
    });
    expect(await readExtensionImportSyncSettings("account-a")).toBeNull();
    expect(fixture.store).not.toHaveBeenCalled();
  });
});
