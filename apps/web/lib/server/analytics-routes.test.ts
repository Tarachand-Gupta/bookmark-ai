import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  callbacks: [] as Array<() => Promise<void>>,
  after: vi.fn(), capture: vi.fn(), flush: vi.fn(), platform: vi.fn(),
  context: vi.fn(), search: vi.fn(), quota: vi.fn(),
}));
vi.mock("next/server", () => ({
  after: state.after,
  NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) },
}));
vi.mock("@/lib/server/analytics/posthog", () => ({
  analyticsPlatform: state.platform, captureProductEvent: state.capture, flushProductAnalytics: state.flush,
}));
vi.mock("@/lib/server/api-context", () => ({ getRequestApiContext: state.context, enforceQuota: state.quota }));
vi.mock("@bookmark-ai/engine", () => ({ performSearch: state.search }));
vi.mock("@langfuse/tracing", () => ({ propagateAttributes: (_: unknown, work: () => unknown) => work() }));
vi.mock("@/lib/server/observability/flush", () => ({ flushObservability: async () => {} }));
vi.mock("@/lib/server/observability/request-logging", () => ({ withRequestLogging: (_route: string, _method: string, handler: unknown) => handler }));

import { scheduleProductEvent, trackChatOutcome } from "@/app/api/product-analytics";
import { GET as searchRoute } from "@/app/api/search/route";
import type { NextRequest } from "next/server";

const request = () => new Request("https://example.test/api/bookmarks", { headers: { "X-Bookmark-Client": "ios" } });
async function finishResponse() { for (const work of state.callbacks.splice(0)) await work(); }

beforeEach(() => {
  vi.resetAllMocks();
  state.callbacks.length = 0;
  state.after.mockImplementation((work: () => Promise<void>) => state.callbacks.push(work));
  state.platform.mockReturnValue("ios");
  state.capture.mockResolvedValue(undefined);
  state.flush.mockResolvedValue(undefined);
  state.context.mockResolvedValue({ userId: "opaque-user", db: {}, gemini: null, ready: Promise.resolve() });
  state.search.mockResolvedValue({ mode: "text", results: [] });
  state.quota.mockResolvedValue(null);
});

describe("route analytics lifecycle", () => {
  it("captures only after response and awaits capture before flush", async () => {
    const sequence: string[] = [];
    state.capture.mockImplementation(async () => { sequence.push("capture"); });
    state.flush.mockImplementation(async () => { sequence.push("flush"); });
    scheduleProductEvent(request(), { event: "bookmark_save_completed", userId: "opaque-user", properties: { item_count: 1 } });
    expect(state.capture).not.toHaveBeenCalled();
    await finishResponse();
    expect(sequence).toEqual(["capture", "flush"]);
    expect(state.capture).toHaveBeenCalledWith({ event: "bookmark_save_completed", userId: "opaque-user", platform: "ios", properties: { item_count: 1 } });
  });

  it("contains scheduling and transport failures", async () => {
    state.after.mockImplementationOnce(() => { throw new Error("no scope"); });
    expect(() => scheduleProductEvent(request(), { event: "export_completed", userId: "opaque-user" })).not.toThrow();
    state.flush.mockRejectedValue(new Error("offline"));
    scheduleProductEvent(request(), { event: "export_completed", userId: "opaque-user" });
    await expect(finishResponse()).resolves.toBeUndefined();
  });

  it("emits one terminal chat failure even if completion also fires", async () => {
    const turn = trackChatOutcome(request(), "opaque-user", "own");
    turn.fail(); turn.complete(); turn.fail();
    expect(state.capture).not.toHaveBeenCalled();
    await finishResponse();
    expect(state.capture).toHaveBeenCalledTimes(1);
    expect(state.capture.mock.calls[0][0]).toMatchObject({ event: "chat_response_failed", properties: { outcome: "failure", ai_source: "own" } });
  });

  it("counts completed streams as success and interrupted streams as failure", async () => {
    trackChatOutcome(request(), "opaque-user", "included").complete();
    trackChatOutcome(request(), "opaque-user", "included");
    await finishResponse();
    expect(state.capture.mock.calls.map(([event]) => event.event)).toEqual(["chat_response_completed", "chat_response_failed"]);
  });

  it("partial-content aborted completion stays a single failure even if completion fires again", async () => {
    const turn = trackChatOutcome(request(), "opaque-user", "included");
    turn.complete({ isAborted: true });
    turn.complete();
    await finishResponse();
    expect(state.capture).toHaveBeenCalledTimes(1);
    expect(state.capture.mock.calls[0][0]).toMatchObject({ event: "chat_response_failed", properties: { outcome: "failure" } });
  });

  it("search route records first page only, with no query content", async () => {
    for (const offset of [0, 40]) {
      const response = await searchRoute(new Request(`https://example.test/api/search?q=private-query&mode=text&offset=${offset}`) as NextRequest);
      expect(response.status).toBe(200);
    }
    await finishResponse();
    expect(state.capture).toHaveBeenCalledTimes(1);
    expect(state.capture.mock.calls[0][0]).toMatchObject({ event: "search_completed", properties: { result_count: 0, search_mode: "text" } });
    expect(JSON.stringify(state.capture.mock.calls)).not.toContain("private-query");
  });

  it("does not capture rejected or invalid searches", async () => {
    state.context.mockResolvedValueOnce({ response: Response.json({ error: "unauthorized" }, { status: 401 }) });
    expect((await searchRoute(new Request("https://example.test/api/search?q=test") as NextRequest)).status).toBe(401);
    expect((await searchRoute(new Request("https://example.test/api/search?q=") as NextRequest)).status).toBe(400);
    await finishResponse();
    expect(state.capture).not.toHaveBeenCalled();
  });
});
