import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ after: vi.fn(), log: vi.fn(), flush: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("./server-logs", () => ({ serverLogger: { log: mocks.log, flush: mocks.flush } }));
import { withRequestLogging } from "./request-logging";
beforeEach(() => vi.clearAllMocks());
it("preserves streamed response, handler args and context while deferring delivery", async () => {
  const response = new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("hello")); controller.close(); } }), { status: 201 });
  const handler = vi.fn(async (_request: Request, _context: { params: Promise<{ id: string }> }) => response);
  const request = new Request("https://example.test/api/bookmarks/secret?q=private");
  const context = { params: Promise.resolve({ id: "secret" }) };
  const result = await withRequestLogging("/api/bookmarks/[id]", "POST", handler)(request, context);
  expect(result).toBe(response); expect(result.bodyUsed).toBe(false);
  expect(handler).toHaveBeenCalledWith(request, context);
  expect(mocks.log).toHaveBeenCalledWith("info", "api_request", expect.objectContaining({ route: "/api/bookmarks/[id]", method: "POST", status: 201 }));
  expect(mocks.flush).not.toHaveBeenCalled(); await mocks.after.mock.calls[0]![0](); expect(mocks.flush).toHaveBeenCalledOnce();
});
it.each([401, 429, 500])("captures handled status %i", async status => {
  await withRequestLogging("/api/test", "GET", () => new Response(null, { status }))();
  expect(mocks.log).toHaveBeenCalledWith(status >= 500 ? "error" : "warn", "api_request", expect.objectContaining({ status }));
});
it("rethrows the original failure and still schedules an awaited flush", async () => {
  const error = new Error("sensitive");
  await expect(withRequestLogging("/api/test", "GET", async () => { throw error; })()).rejects.toBe(error);
  expect(mocks.log).toHaveBeenCalledWith("error", "api_request_failed", expect.objectContaining({ error }));
  await mocks.after.mock.calls[0]![0](); expect(mocks.flush).toHaveBeenCalledOnce();
});
it("falls back to an awaited flush when after has no request context", async () => {
  mocks.after.mockImplementationOnce(() => { throw new Error("no request scope"); });
  const response = new Response(null, { status: 204 });
  await expect(withRequestLogging("/api/test", "GET", () => response)()).resolves.toBe(response);
  expect(mocks.flush).toHaveBeenCalledOnce();
});
