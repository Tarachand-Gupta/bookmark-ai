import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { closeWindowsAndOpen, gatherOpenTabs } from "./session";

/**
 * session-filter.test.ts proves the rules are right; this proves session.ts
 * actually applies them to what the browser hands back — and covers
 * closeWindowsAndOpen, whose guarantee ("never close a window we didn't save")
 * only exists in terms of the windows API.
 */

vi.mock("wxt/browser", () => ({
  browser: {
    tabs: { query: vi.fn() },
    windows: { getAll: vi.fn(), get: vi.fn(), create: vi.fn(), remove: vi.fn() },
  },
}));

const { browser } = await import("wxt/browser");
const api = browser as unknown as {
  tabs: { query: Mock };
  windows: { getAll: Mock; get: Mock; create: Mock; remove: Mock };
};

const PRIVATE_URL = "https://secret-bank.example/account";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("gatherOpenTabs", () => {
  it("excludes a private window's tabs from the all-windows walk", async () => {
    api.windows.getAll.mockResolvedValue([
      { id: 1, type: "normal", incognito: false, tabs: [{ url: "https://example.com", incognito: false }] },
      { id: 2, type: "normal", incognito: true, tabs: [{ url: PRIVATE_URL, incognito: true }] },
    ]);

    const tabs = await gatherOpenTabs();

    expect(api.windows.getAll).toHaveBeenCalledWith({ populate: true });
    expect(tabs.map((t) => t.url)).toEqual(["https://example.com"]);
    expect(JSON.stringify(tabs)).not.toContain("secret-bank.example");
  });

  it("excludes private tabs on the single-window path", async () => {
    api.tabs.query.mockResolvedValue([
      { url: "https://example.com", incognito: false },
      { url: PRIVATE_URL, incognito: true },
    ]);

    const tabs = await gatherOpenTabs(7);

    expect(api.tabs.query).toHaveBeenCalledWith({ windowId: 7 });
    expect(tabs).toEqual([{ url: "https://example.com", title: "", favIconUrl: undefined, windowId: 7 }]);
  });

  it("yields nothing for a private window, so a save from one cannot proceed", async () => {
    // The background rejects an empty gather with "No open tabs…" — which is
    // what stops the close path from ever running against a private window.
    api.tabs.query.mockResolvedValue([{ url: PRIVATE_URL, incognito: true }]);
    expect(await gatherOpenTabs(9)).toEqual([]);
  });
});

describe("closeWindowsAndOpen", () => {
  it("closes other regular windows but never a private one", async () => {
    api.windows.create.mockResolvedValue({ id: 99 });
    api.windows.getAll.mockResolvedValue([
      { id: 1, type: "normal", incognito: false },
      { id: 2, type: "normal", incognito: true }, // private: must survive
      { id: 99, type: "normal", incognito: false }, // the window we just opened
    ]);

    await closeWindowsAndOpen("https://bookmark-ai.cloud/app?section=sessions");

    expect(api.windows.create).toHaveBeenCalledWith({
      url: "https://bookmark-ai.cloud/app?section=sessions",
    });
    expect(api.windows.remove).toHaveBeenCalledExactlyOnceWith(1);
  });

  it("refuses to close an explicit windowId that turns out to be private", async () => {
    api.windows.create.mockResolvedValue({ id: 99 });
    api.windows.get.mockResolvedValue({ id: 2, type: "normal", incognito: true });

    await closeWindowsAndOpen("https://bookmark-ai.cloud/app", 2);

    expect(api.windows.remove).not.toHaveBeenCalled();
  });

  it("closes an explicit regular windowId", async () => {
    api.windows.create.mockResolvedValue({ id: 99 });
    api.windows.get.mockResolvedValue({ id: 2, type: "normal", incognito: false });

    await closeWindowsAndOpen("https://bookmark-ai.cloud/app", 2);

    expect(api.windows.remove).toHaveBeenCalledExactlyOnceWith(2);
  });

  it("tolerates a window that closed underneath it", async () => {
    api.windows.create.mockResolvedValue({ id: 99 });
    api.windows.get.mockRejectedValue(new Error("No window with id: 2."));
    api.windows.remove.mockRejectedValue(new Error("No window with id: 2."));

    await expect(closeWindowsAndOpen("https://bookmark-ai.cloud/app", 2)).resolves.toBeUndefined();
  });
});
