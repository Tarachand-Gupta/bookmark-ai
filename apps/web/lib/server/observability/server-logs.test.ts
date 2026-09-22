import { afterEach, describe, expect, it, vi } from "vitest";
import { createServerLogger } from "@bookmark-ai/server-logging";
const sink = () => ({ log: vi.fn(), warn: vi.fn(), error: vi.fn() });
afterEach(() => vi.useRealTimers());
describe("New Relic structured transport", () => {
  it("keeps local structured logs without a key and never sends", async () => {
    const fetch = vi.fn(); const console = sink();
    const logger = createServerLogger({ service: "test", env: {}, fetch, console });
    logger.log("info", "api_request", { status: 200 }); await logger.flush();
    expect(fetch).not.toHaveBeenCalled(); expect(console.log).toHaveBeenCalledOnce();
  });
  it("sends detailed Log API JSON to the selected region without sensitive fields", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const logger = createServerLogger({ service: "test", env: { NEW_RELIC_LICENSE_KEY: "test-key", NEW_RELIC_REGION: "EU" }, fetch, console: sink() });
    logger.log("error", "api_request_failed", { route: "/api/bookmarks/[id]", method: "GET", error: new Error("Bearer private-key https://private.test?q=secret"), ...{ body: "secret", userId: "private-user" } });
    await logger.flush();
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://log-api.eu.newrelic.com/log/v1");
    expect(init.headers["Api-Key"]).toBe("test-key");
    expect(init.redirect).toBe("error");
    expect(init.body).not.toMatch(/private|secret|Bearer/);
    expect(JSON.parse(init.body)[0].logs[0].attributes).toEqual({ level: "error", route: "/api/bookmarks/[id]", method: "GET", errorType: "Error" });
  });
  it("rejects request URLs and suppresses lower levels and invalid regions", async () => {
    const fetch = vi.fn(); const console = sink();
    const logger = createServerLogger({ service: "test", env: { NEW_RELIC_LICENSE_KEY: "key", NEW_RELIC_REGION: "INVALID", NEW_RELIC_LOG_LEVEL: "warn" }, fetch, console });
    logger.log("info", "api_request");
    logger.log("warn", "failure", { route: "/api/search?q=private", operation: "Bearer secret" });
    await logger.flush();
    expect(fetch).not.toHaveBeenCalled(); expect(console.log).not.toHaveBeenCalled();
    expect(console.warn.mock.calls.flat().join()).not.toContain("private");
    expect(console.warn.mock.calls.flat().join()).not.toContain("Bearer");
  });
  it("does not throw on HTTP or network failures and never forwards response bodies", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("secret", { status: 403 })).mockRejectedValueOnce(new Error("secret"));
    const console = sink();
    const logger = createServerLogger({ service: "test", env: { NEW_RELIC_LICENSE_KEY: "key" }, fetch, console });
    logger.log("error", "failure"); await expect(logger.flush()).resolves.toBeUndefined();
    logger.log("error", "failure"); await expect(logger.flush()).resolves.toBeUndefined();
    expect(console.warn.mock.calls.flat().join()).not.toContain("secret");
  });
  it("bounds queues and batch sizes", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    const logger = createServerLogger({ service: "test", env: { NEW_RELIC_LICENSE_KEY: "key" }, fetch, console: sink() });
    for (let i = 0; i < 250; i++) logger.log("info", "api_request", { durationMs: i });
    await logger.flush();
    expect(fetch).toHaveBeenCalledTimes(2);
    for (const [, init] of fetch.mock.calls) {
      expect(JSON.parse(init.body)[0].logs).toHaveLength(100);
      expect(Buffer.byteLength(init.body)).toBeLessThan(1_000_000);
    }
    expect(JSON.parse(fetch.mock.calls[0]![1].body)[0].logs[0].attributes.durationMs).toBe(50);
  });
  it("bounds even a stalled transport and aborts it", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockImplementation(() => new Promise(() => {}));
    const logger = createServerLogger({ service: "test", env: { NEW_RELIC_LICENSE_KEY: "key" }, fetch, console: sink() });
    logger.log("info", "api_request"); const flush = logger.flush();
    await vi.advanceTimersByTimeAsync(2001); await flush;
    expect(fetch.mock.calls[0]![1].signal.aborted).toBe(true);
  });
  it("flushes logs added while a prior flush is pending", async () => {
    let release!: (value: Response) => void;
    const fetch = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => { release = resolve; })).mockResolvedValue(new Response(null, { status: 202 }));
    const logger = createServerLogger({ service: "test", env: { NEW_RELIC_LICENSE_KEY: "key" }, fetch, console: sink() });
    logger.log("info", "first"); const first = logger.flush();
    logger.log("info", "second"); const second = logger.flush();
    release(new Response(null, { status: 202 })); await Promise.all([first, second]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1]![1].body)[0].logs[0].message).toBe("second");
  });
});
