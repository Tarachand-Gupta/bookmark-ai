import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESTORE_EXTENSION_IDS, restoreSessionViaExtension } from "./extension-bridge";
import { EXTENSION_IDS, pingExtensionOnce } from "./extension-detect";

const [storeId, qaId] = RESTORE_EXTENSION_IDS;
const urls = ["https://example.com/one", "https://example.com/two"];
type Message = { type: string; urls?: string[]; mode?: string; name?: string };
type Reply = (response?: { ok?: boolean }) => void;

function installRuntime(handler: (id: string, message: Message, reply: Reply) => void) {
  const runtime = { sendMessage: vi.fn(handler), lastError: undefined as unknown };
  vi.stubGlobal("window", { chrome: { runtime } });
  return runtime;
}
function restores(runtime: ReturnType<typeof installRuntime>) {
  return runtime.sendMessage.mock.calls.filter(([, message]) => message.type === "RESTORE_SESSION");
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("fixed Chrome restore routing", () => {
  it("prefers the store install and restores exactly once with every URL and option", async () => {
    const runtime = installRuntime((_id, _message, reply) => reply({ ok: true }));
    expect(await restoreSessionViaExtension(urls, { mode: "group", name: "Saved tabs" })).toBe(true);
    expect(runtime.sendMessage.mock.calls.map(([id, message]) => [id, message.type]))
      .toEqual([[storeId, "BOOKMARK_AI_PING"], [storeId, "RESTORE_SESSION"]]);
    expect(restores(runtime)[0][1]).toEqual({ type: "RESTORE_SESSION", urls, mode: "group", name: "Saved tabs" });
  });

  it("selects the pinned QA install when the store extension is absent", async () => {
    const runtime = installRuntime((id, _message, reply) => reply({ ok: id === qaId }));
    expect(await restoreSessionViaExtension(urls)).toBe(true);
    expect(restores(runtime)).toHaveLength(1);
    expect(restores(runtime)[0][0]).toBe(qaId);
    expect(restores(runtime)[0][1].mode).toBe("window");
  });

  it("only probes when neither install answers, despite an arbitrary ID in page storage", async () => {
    const runtime = installRuntime((_id, _message, reply) => reply({ ok: false }));
    Object.assign(window, { location: { search: "?extensionId=arbitrary" }, localStorage: { getItem: () => "arbitrary" } });
    expect(await restoreSessionViaExtension(urls)).toBe(false);
    expect(runtime.sendMessage.mock.calls.map(([id]) => id)).toEqual([storeId, qaId]);
    expect(restores(runtime)).toHaveLength(0);
  });

  it("bounds discovery and reaches QA after an unresponsive store ping", async () => {
    const runtime = installRuntime((id, _message, reply) => { if (id === qaId) reply({ ok: true }); });
    const result = restoreSessionViaExtension(urls);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await result).toBe(true);
    expect(restores(runtime).map(([id]) => id)).toEqual([qaId]);
  });

  it("never tries another extension after an ambiguous restore timeout or late reply", async () => {
    let lateReply: Reply | undefined;
    const runtime = installRuntime((_id, message, reply) => {
      if (message.type === "BOOKMARK_AI_PING") reply({ ok: true });
      else lateReply = reply;
    });
    const result = restoreSessionViaExtension(urls);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await result).toBe(false);
    lateReply?.({ ok: true });
    await vi.runAllTimersAsync();
    expect(restores(runtime).map(([id]) => id)).toEqual([storeId]);
    expect(runtime.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("does not retry a restore rejected by the selected extension", async () => {
    const runtime = installRuntime((_id, message, reply) => reply({ ok: message.type === "BOOKMARK_AI_PING" }));
    expect(await restoreSessionViaExtension(urls)).toBe(false);
    expect(restores(runtime).map(([id]) => id)).toEqual([storeId]);
    expect(runtime.sendMessage).toHaveBeenCalledTimes(2);
  });

  it("ignores transport lastError even with a positive ping payload", async () => {
    const runtime = installRuntime((id, _message, reply) => {
      runtime.lastError = id === storeId ? { message: "Not installed" } : undefined;
      reply({ ok: true });
    });
    expect(await restoreSessionViaExtension(urls)).toBe(true);
    expect(restores(runtime).map(([id]) => id)).toEqual([qaId]);
  });

  it("resolves absent browser APIs and synchronous transport errors without a restore", async () => {
    vi.stubGlobal("window", {});
    expect(await restoreSessionViaExtension(urls)).toBe(false);
    vi.stubGlobal("window", undefined);
    expect(await restoreSessionViaExtension(urls)).toBe(false);
    const runtime = installRuntime(() => { throw new Error("Not reachable"); });
    expect(await restoreSessionViaExtension(urls)).toBe(false);
    expect(restores(runtime)).toHaveLength(0);
  });

  it("detects the QA install using the same fixed ID without changing the store ID", async () => {
    installRuntime((id, _message, reply) => reply({ ok: id === qaId }));
    expect(RESTORE_EXTENSION_IDS).toEqual(["ffhbgpgebpmofjkehpjcemepbgcmoelp", "peikdeadpkgjgohdndljbciephekdpfg"]);
    expect(EXTENSION_IDS).toContain(qaId);
    expect(await pingExtensionOnce()).toBe(true);
  });
});

function installPageBridge(handler: (message: Message, respond: (reply: unknown) => void) => void) {
  const target = new EventTarget() as EventTarget & { location: { origin: string }; postMessage: ReturnType<typeof vi.fn> };
  target.location = { origin: "https://www.bookmark-ai.cloud" };
  target.postMessage = vi.fn(data => handler(data.message, response => {
    const event = new Event("message");
    Object.assign(event, { source: target, origin: target.location.origin, data: { ...data, direction: "response", response } });
    target.dispatchEvent(event);
  }));
  vi.stubGlobal("window", target);
  return target;
}

describe("Safari and Firefox content-script restore", () => {
  it("restores once through the page bridge without a Chrome runtime", async () => {
    const page = installPageBridge((message, reply) => reply(message.type === "BOOKMARK_AI_PING"
      ? { ok: true, restoreWindow: true, tabGroups: false } : { ok: true }));
    expect(await restoreSessionViaExtension(urls)).toBe(true);
    expect(page.postMessage.mock.calls.map(([data]) => data.message.type)).toEqual(["BOOKMARK_AI_PING", "RESTORE_SESSION"]);
    expect(page.postMessage.mock.calls[1][0].message.urls).toEqual(urls);
  });
  it("never sends a group restore when the browser reports no support", async () => {
    const page = installPageBridge((_message, reply) => reply({ ok: true, restoreWindow: true, tabGroups: false }));
    expect(await restoreSessionViaExtension(urls, { mode: "group" })).toBe(false);
    expect(page.postMessage).toHaveBeenCalledTimes(1);
  });
  it("does not retry or fall back when a restore response is lost", async () => {
    const page = installPageBridge((message, reply) => {
      if (message.type === "BOOKMARK_AI_PING") reply({ ok: true, restoreWindow: true, tabGroups: false });
    });
    const pending = restoreSessionViaExtension(urls);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await pending).toBe(false);
    expect(page.postMessage).toHaveBeenCalledTimes(2);
  });
  it("reports the correct recovery instruction without mentioning Chrome or retrying an uncertain operation", async () => {
    const { sessionRestoreNote } = await import("./extension-bridge");
    expect(sessionRestoreNote("unavailable")).not.toMatch(/Chrome/);
    expect(sessionRestoreNote("unsupported")).toContain("New window");
    expect(sessionRestoreNote("unknown")).toContain("Check for a new window before trying again");
  });
});
