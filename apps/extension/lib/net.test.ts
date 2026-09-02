import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "./net";

/**
 * The 2026-09-02 outage regression: a fetch that never settles (network switch
 * mid-request) must be FORCED to settle, or everything serialized behind it —
 * the live checkpoint's flushing guard, the auth single-flight — wedges for
 * the worker's lifetime.
 */
describe("fetchWithTimeout", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("rejects a hung fetch instead of pending forever", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        // Simulate a stalled connection: resolve only via abort.
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason ?? new Error("aborted")),
          );
        });
      }),
    );

    const start = Date.now();
    await expect(fetchWithTimeout("https://example.test/live", {}, 50)).rejects.toThrow();
    expect(Date.now() - start).toBeLessThan(2_000);
  });

  it("passes through a fast response untouched", async () => {
    const response = new Response("ok", { status: 200 });
    vi.stubGlobal("fetch", vi.fn(async () => response));
    await expect(fetchWithTimeout("https://example.test/live", {}, 1_000)).resolves.toBe(response);
  });

  it("keeps a caller-provided abort working alongside the timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason ?? new Error("aborted")),
          );
        });
      }),
    );
    const controller = new AbortController();
    const pending = fetchWithTimeout(
      "https://example.test/live",
      { signal: controller.signal },
      60_000,
    );
    controller.abort(new Error("caller cancelled"));
    await expect(pending).rejects.toThrow();
  });
});
