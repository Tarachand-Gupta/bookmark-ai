import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing";
const h = vi.hoisted(() => ({
  reading: vi.fn(),
  remove: vi.fn(),
  add: vi.fn(),
  readCallbacks: {} as Record<string, (entry: unknown) => void>,
  bookmarkRemove: undefined as ((id: string, info: unknown) => void) | undefined,
  consent: true,
}));
vi.mock("./release-reading-list", () => ({
  mirrorReadingEntry: h.reading,
  drainReadingEntries: vi.fn(),
}));
vi.mock("./supabase-oauth", () => ({
  SUPABASE_AUTH: true,
  getOAuthToken: async () => "test-only",
  oauthGeneration: () => 1,
}));
vi.mock("@/lib/api", () => ({
  createBookmark: h.add,
  deleteBookmark: h.remove,
  fetchSyncSettings: vi.fn(),
}));
vi.mock("@/lib/detect", () => ({ detectSource: () => ({ browser: "chrome", device: "desktop" }) }));
vi.mock("@/lib/diag", () => ({ diag: vi.fn() }));
vi.mock("./native-bookmark-consent", () => ({
  canMirrorNativeBookmarks: async () => h.consent,
  initializeBookmarkConsent: async () => {},
  ensureImportOnlyConsent: async () => {},
  revokeBookmarkConsent: async () => {},
}));
const entry = { url: "https://page.test/", title: "Page", hasBeenRead: true };
beforeEach(async () => {
  vi.resetModules();
  fakeBrowser.reset();
  vi.stubEnv("BROWSER", "chrome");
  vi.stubGlobal("browser", fakeBrowser);
  vi.stubGlobal("chrome", fakeBrowser);
  h.reading.mockReset();
  h.remove.mockReset();
  h.add.mockReset();
  h.consent = true;
  h.readCallbacks = {};
  h.reading.mockResolvedValue(undefined);
  h.remove.mockResolvedValue(undefined);
  Object.defineProperty(fakeBrowser, "readingList", {
    configurable: true,
    value: Object.fromEntries(
      ["onEntryAdded", "onEntryRemoved", "onEntryUpdated"].map((event) => [
        event,
        {
          addListener: (callback: (entry: unknown) => void) => {
            h.readCallbacks[event] = callback;
          },
        },
      ]),
    ),
  });
  vi.spyOn(fakeBrowser.permissions.onAdded, "addListener").mockImplementation(() => {});
  vi.spyOn(fakeBrowser.permissions.onRemoved, "addListener").mockImplementation(() => {});
  vi.spyOn(fakeBrowser.bookmarks.onCreated, "addListener").mockImplementation(() => {});
  vi.spyOn(fakeBrowser.bookmarks.onRemoved, "addListener").mockImplementation((callback) => {
    h.bookmarkRemove = callback as typeof h.bookmarkRemove;
  });
  const { registerNativeSync } = await import("./native-sync");
  registerNativeSync();
});
afterEach(() => vi.unstubAllEnvs());
it.each([false, true])(
  "Reading List removal is membership-only with full sync %s",
  async (full) => {
    await fakeBrowser.storage.local.set({ nativeSyncFull: full });
    h.readCallbacks.onEntryRemoved!(entry);
    await vi.waitFor(() => expect(h.reading).toHaveBeenCalledWith(entry, true));
    expect(h.remove).not.toHaveBeenCalled();
  },
);
it("registers canonical addition and read-update paths without legacy tag saves", async () => {
  h.readCallbacks.onEntryAdded!(entry);
  h.readCallbacks.onEntryUpdated!(entry);
  await vi.waitFor(() => expect(h.reading).toHaveBeenCalledTimes(2));
  expect(h.add).not.toHaveBeenCalled();
});
it("retains the native-bookmark removal consent and full-sync boundary", async () => {
  await fakeBrowser.storage.local.set({
    nativeSyncFull: true,
    nativeSyncIds: { [entry.url]: "saved-id" },
  });
  h.bookmarkRemove!("native-id", { node: entry });
  await vi.waitFor(() => expect(h.remove).toHaveBeenCalledWith("saved-id"));
  expect(h.reading).not.toHaveBeenCalled();
});
it("does not mirror removal when native-bookmark consent is off", async () => {
  await fakeBrowser.storage.local.set({
    nativeSyncFull: true,
    nativeSyncIds: { [entry.url]: "saved-id" },
  });
  h.consent = false;
  h.bookmarkRemove!("native-id", { node: entry });
  await Promise.resolve();
  await Promise.resolve();
  expect(h.remove).not.toHaveBeenCalled();
});
it("respects the master sync switch for Reading List events", async () => {
  await fakeBrowser.storage.local.set({ nativeSyncEnabled: false });
  h.readCallbacks.onEntryRemoved!(entry);
  await Promise.resolve();
  await Promise.resolve();
  expect(h.reading).not.toHaveBeenCalled();
});
it.each(["firefox", "safari"])("does not register a Reading List adapter on %s", async (target) => {
  h.readCallbacks = {};
  vi.resetModules();
  vi.stubEnv("BROWSER", target);
  const { registerNativeSync } = await import("./native-sync");
  registerNativeSync();
  expect(Object.keys(h.readCallbacks)).toHaveLength(0);
});
