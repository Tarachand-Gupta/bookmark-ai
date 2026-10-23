import { describe, expect, it, vi } from "vitest";
import { isRestoreSender, restoreCapabilities, restoreSession, validRestoreMessage } from "./session-restore";
import { connectSessionRestorePage, RESTORE_PAGE_CHANNEL } from "./session-restore-bridge";

const urls = ["https://example.com/one", "https://example.com/two", "https://example.com/three"];
const message = { type: "RESTORE_SESSION", urls };
function api(grouped = false) {
  return { windows: { create: vi.fn().mockResolvedValue({ id: 42 }) }, tabs: {
    create: vi.fn().mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce({ id: 2 }).mockResolvedValueOnce({ id: 3 }),
    ...(grouped ? { group: vi.fn().mockResolvedValue(7) } : {}),
  }, tabGroups: { update: vi.fn().mockResolvedValue({}) } };
}
describe("session restore", () => {
  it("opens every saved URL, in order, in exactly one window on Safari", async () => {
    const browser = api();
    expect(await restoreSession(browser, message, 4)).toEqual({ ok: true });
    expect(browser.windows.create.mock.calls).toEqual([[{ url: urls }]]);
    expect(browser.tabs.create).not.toHaveBeenCalled();
  });
  it("preserves sessions larger than the former 100-tab cutoff", async () => {
    const browser = api(); const all = Array.from({ length: 113 }, (_, i) => `https://example.com/${i}`);
    expect(await restoreSession(browser, { ...message, urls: all })).toEqual({ ok: true });
    expect(browser.windows.create).toHaveBeenCalledWith({ url: all });
  });
  it("reports unsupported groups before creating any tabs", async () => {
    const browser = api();
    expect(restoreCapabilities(browser).tabGroups).toBe(false);
    expect(await restoreSession(browser, { ...message, mode: "group" }, 4)).toEqual({ ok: false, reason: "unsupported" });
    expect(browser.tabs.create).not.toHaveBeenCalled();
    expect(browser.windows.create).not.toHaveBeenCalled();
  });
  it("keeps group order, target window, and title where grouping is supported", async () => {
    const browser = api(true);
    expect(await restoreSession(browser, { ...message, mode: "group", name: "Research" }, 4)).toEqual({ ok: true });
    expect(browser.tabs.create.mock.calls).toEqual(urls.map(url => [{ url, windowId: 4, active: false }]));
    expect(browser.tabs.group).toHaveBeenCalledWith({ tabIds: [1, 2, 3] });
    expect(browser.tabGroups.update).toHaveBeenCalledWith(7, { title: "Research", color: "blue" });
  });
  it.each([null, {}, { ...message, urls: ["javascript:alert(1)"] }, { ...message, urls: [4] }, { ...message, urls: [] }, { ...message, mode: "evil" }, { ...message, name: {} }])("rejects malformed/untrusted navigation data", async value => {
    const browser = api();
    expect(validRestoreMessage(value)).toBe(false);
    expect(await restoreSession(browser, value)).toEqual({ ok: false, reason: "invalid" });
    expect(browser.windows.create).not.toHaveBeenCalled();
  });
  it("does not retry after a potentially partial failure", async () => {
    const browser = api(); browser.windows.create.mockRejectedValue(new Error("lost connection"));
    expect(await restoreSession(browser, message)).toEqual({ ok: false, reason: "failed" });
    expect(browser.windows.create).toHaveBeenCalledTimes(1);
  });
  it("accepts only the extension's top-level content script on its configured origin", () => {
    const sender = { id: "ours", url: "https://www.bookmark-ai.cloud/app", frameId: 0, tab: { id: 3 } };
    expect(isRestoreSender(sender, "ours", "https://www.bookmark-ai.cloud")).toBe(true);
    for (const altered of [{ ...sender, id: "other" }, { ...sender, frameId: 1 }, { ...sender, tab: undefined }, { ...sender, url: "https://attacker.test" }])
      expect(isRestoreSender(altered, "ours", "https://www.bookmark-ai.cloud")).toBe(false);
  });
});

it("relays same-page requests once and rejects foreign sources, origins, and malformed messages", async () => {
  const target = new EventTarget() as EventTarget & { location: { origin: string }; postMessage: ReturnType<typeof vi.fn> };
  target.location = { origin: "https://www.bookmark-ai.cloud" }; target.postMessage = vi.fn();
  const send = vi.fn().mockResolvedValue({ ok: true });
  const disconnect = connectSessionRestorePage(target as unknown as Window, send);
  function dispatch(id: string, source: unknown = target, origin = target.location.origin, payload: unknown = message) {
    const event = new Event("message");
    Object.assign(event, { source, origin, data: { channel: RESTORE_PAGE_CHANNEL, direction: "request", id, message: payload } });
    target.dispatchEvent(event);
  }
  dispatch("one"); dispatch("one"); dispatch("foreign", {}); dispatch("wrong-origin", target, "https://attacker.test");
  dispatch("bad-url", target, target.location.origin, { ...message, urls: ["file:///etc/passwd"] });
  await vi.waitFor(() => expect(target.postMessage).toHaveBeenCalledTimes(1));
  expect(send.mock.calls).toEqual([[message]]);
  expect(target.postMessage).toHaveBeenCalledWith({ channel: RESTORE_PAGE_CHANNEL, direction: "response", id: "one", response: { ok: true } }, target.location.origin);
  disconnect(); dispatch("after-dispose"); expect(send).toHaveBeenCalledTimes(1);
});
