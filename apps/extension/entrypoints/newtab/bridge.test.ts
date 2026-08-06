import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NewTabWizardData } from "@bookmark-ai/types";
import { attachBridge } from "./bridge";
import { requestApiProxy } from "../../lib/messages";

/**
 * Bridge dispatch tests (docs/features/newtab-canvas.md §4.4/§4.5, security §5):
 * the parent-side half of the sandbox protocol. Verifies that ONLY the fixed
 * vocabulary reaches the API, replies come back on the posted id, the
 * source+origin guards drop rogue messages, openUrl is scheme-gated, and the
 * wizard sections are served from the cached bundle. The message/loopback
 * plumbing is injected; `requestApiProxy` is mocked to capture paths.
 */

vi.mock("../../lib/messages", () => ({
  requestApiProxy: vi.fn(),
}));
const proxyMock = vi.mocked(requestApiProxy);

const WIZARD: NewTabWizardData = {
  favorites: [{ url: "https://a.com/x", title: "Fav", domain: "a.com", category: "dev", tags: [], savedAt: "2026-08-01T00:00:00Z" }],
  recent: [],
  continueWhereYouLeft: { enabled: false },
  workingOn: { enabled: false },
  mostUsed: [{ domain: "a.com", count: 3 }],
  timeSpent: { available: false },
};

interface Harness {
  replies: { id: string; [k: string]: unknown }[];
  fire: (event: { source?: unknown; origin?: string; data?: unknown }) => void;
  opened: string[];
  bridge: ReturnType<typeof attachBridge>;
  contentWindow: { postMessage(data: unknown, target: string): void };
  getWizard: ReturnType<typeof vi.fn>;
}

function makeHarness(): Harness {
  const replies: Harness["replies"] = [];
  const opened: string[] = [];
  const contentWindow = {
    postMessage(data: unknown, _target: string) {
      replies.push(data as Harness["replies"][number]);
    },
  };
  const listeners: Array<(e: unknown) => void> = [];
  const listenOn = {
    addEventListener: (_t: "message", fn: (e: never) => unknown) => {
      listeners.push(fn as (e: unknown) => void);
    },
    removeEventListener: (_t: "message", fn: (e: never) => unknown) => {
      const i = listeners.indexOf(fn as (e: unknown) => void);
      if (i >= 0) listeners.splice(i, 1);
    },
  };
  const getWizard = vi.fn(async () => WIZARD);
  const bridge = attachBridge({
    iframe: { contentWindow },
    getWizard,
    onOpenUrl: (url) => opened.push(url),
    listenOn,
  });
  return {
    replies,
    opened,
    bridge,
    contentWindow,
    getWizard,
    fire: (event) =>
      listeners.forEach((fn) =>
        fn({
          source: "source" in event ? event.source : contentWindow,
          origin: event.origin ?? "null",
          data: event.data,
        }),
      ),
  };
}

function proxySuccess(body: unknown) {
  proxyMock.mockResolvedValue({
    ok: true,
    status: 200,
    bodyJson: JSON.stringify(body),
  });
}

beforeEach(() => {
  proxyMock.mockReset();
});

describe("message guards (§5)", () => {
  it("drops messages from another source (not our iframe)", async () => {
    const h = makeHarness();
    h.fire({ source: {} /* other window */, data: { id: "a", type: "ready" } });
    await flush();
    expect(h.replies).toHaveLength(0);
    expect(proxyMock).not.toHaveBeenCalled();
  });

  it("drops messages whose origin is not the opaque-origin 'null'", async () => {
    const h = makeHarness();
    h.fire({ origin: "https://evil.example", data: { id: "a", type: "ready" } });
    await flush();
    expect(h.replies).toHaveLength(0);
  });

  it("drops malformed data and unknown vocabulary (no reply, no API call)", async () => {
    const h = makeHarness();
    h.fire({ data: "garbage" });
    h.fire({ data: { id: "x", type: "saveBookmark", url: "https://x" } });
    h.fire({ data: { id: "x", type: "deleteBookmark", id2: "y" } });
    h.fire({ data: { type: "ready" } /* missing id */ });
    await flush();
    expect(h.replies).toHaveLength(0);
    expect(proxyMock).not.toHaveBeenCalled();
  });
});

describe("bridge dispatch", () => {
  it("ready handshake replies ok without touching the API", async () => {
    const h = makeHarness();
    h.fire({ data: { id: "r1", type: "ready" } });
    await flush();
    expect(h.replies).toEqual([{ id: "r1", ok: true, data: { bridge: "bookmark-ai-newtab" } }]);
    expect(proxyMock).not.toHaveBeenCalled();
  });

  it("search proxies to /api/search with the validated query params and replies data", async () => {
    const h = makeHarness();
    proxySuccess({ mode: "hybrid", results: [] });
    h.fire({ data: { id: "s1", type: "search", q: "databases", mode: "hybrid", limit: 10 } });
    await flush();
    expect(proxyMock).toHaveBeenCalledWith("GET", "/api/search?q=databases&mode=hybrid&limit=10");
    expect(h.replies[0]).toMatchObject({ id: "s1", ok: true, data: { mode: "hybrid", results: [] } });
    expect(h.bridge.getRenderedSnapshot().search).toBeTruthy(); // §4.8 rendered-data snapshot
  });

  it("listBookmarks builds filter params and replies with the proxied body", async () => {
    const h = makeHarness();
    proxySuccess({ bookmarks: [], total: 0 });
    h.fire({
      data: { id: "b1", type: "listBookmarks", category: "dev", tag: "reading", limit: 24, offset: 48 },
    });
    await flush();
    const path = proxyMock.mock.calls[0]![1]!;
    expect(path).toContain("limit=24");
    expect(path).toContain("offset=48");
    expect(path).toContain("category=dev");
    expect(path).toContain("tag=reading");
    expect(h.replies[0]).toMatchObject({ id: "b1", ok: true, data: { total: 0 } });
  });

  it("getMeta and listSessions proxy to the right routes; sessions are filtered client-side", async () => {
    const h = makeHarness();
    proxySuccess({ sessions: [{ name: "Research tabs" }, { name: "Shopping" }] });
    h.fire({ data: { id: "m1", type: "getMeta" } });
    h.fire({ data: { id: "s2", type: "listSessions", query: "research", limit: 20 } });
    await flush();
    expect(proxyMock.mock.calls[0]![1]).toBe("/api/meta");
    expect(proxyMock.mock.calls[1]![1]).toBe("/api/sessions");
    expect(h.replies[1]).toMatchObject({ id: "s2", ok: true, data: { sessions: [{ name: "Research tabs" }] } });
  });

  it("wizard sections are sliced per type from the bundle (no direct API call)", async () => {
    const h = makeHarness();
    h.fire({ data: { id: "f1", type: "getFavorites" } });
    h.fire({ data: { id: "m1", type: "getMostUsed" } });
    h.fire({ data: { id: "t1", type: "getTimeSpent" } });
    await flush();
    expect(h.replies).toEqual([
      { id: "f1", ok: true, data: WIZARD.favorites },
      { id: "m1", ok: true, data: WIZARD.mostUsed },
      { id: "t1", ok: true, data: WIZARD.timeSpent },
    ]);
    // Note: HTTP-level caching is the caller's getWizard provider's job (App
    // memoizes the fetch promise per page load); the bridge itself re-reads it.
    expect(h.getWizard).toHaveBeenCalledTimes(3);
    expect(proxyMock).not.toHaveBeenCalled();
  });

  it("openUrl opens only http(s) URLs — file:// is dropped", async () => {
    const h = makeHarness();
    h.fire({ data: { id: "o1", type: "openUrl", url: "file:///etc/passwd" } });
    h.fire({ data: { id: "o2", type: "openUrl", url: "javascript:alert(1)" } });
    h.fire({ data: { id: "o3", type: "openUrl", url: "https://ok.example/page" } });
    await flush();
    expect(h.opened).toEqual(["https://ok.example/page"]);
    expect(h.replies).toHaveLength(3);
    expect(h.replies.every((r) => r.ok === true)).toBe(true);
  });

  it("a failed proxy call becomes an {ok:false, error} reply — templates can render an error state", async () => {
    const h = makeHarness();
    proxyMock.mockResolvedValue({ ok: true, status: 403, bodyJson: JSON.stringify({ error: "token-scope" }) });
    h.fire({ data: { id: "e1", type: "getMeta" } });
    await flush();
    expect(h.replies[0]).toMatchObject({ id: "e1", ok: false, error: expect.stringContaining("403") });
  });
});

async function flush() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}
