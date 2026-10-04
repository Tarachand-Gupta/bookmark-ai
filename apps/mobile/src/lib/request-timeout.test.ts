import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fetchWithTimeout } from "./request-timeout";

const require = createRequire(import.meta.url);
const nativeRequire = createRequire(require.resolve("react-native/package.json"));
const nativeAbort = nativeRequire("abort-controller/dist/abort-controller");

test("hosted request works with the exact React Native AbortSignal without static timeout", async (t) => {
  assert.equal(typeof nativeAbort.AbortSignal.timeout, "undefined");
  const original = globalThis.AbortController;
  globalThis.AbortController = nativeAbort.AbortController;
  t.after(() => { globalThis.AbortController = original; });
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
    signal = init.signal!;
    return new Response(JSON.stringify({ status: "ready" }), { status: 201 });
  });
  const response = await fetchWithTimeout("https://www.bookmark-ai.cloud/api/auth/native/start", { method: "POST" }, 10);
  assert.equal(response.status, 201);
  assert.equal(await response.json().then((data) => data.status), "ready");
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(signal?.aborted, false, "a completed request must clear its timer");
});

test("native timeout aborts a hanging fetch instead of failing before the network call", async (t) => {
  const original = globalThis.AbortController;
  globalThis.AbortController = nativeAbort.AbortController;
  t.after(() => { globalThis.AbortController = original; });
  let called = false;
  t.mock.method(globalThis, "fetch", (_input: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
    called = true;
    init.signal!.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }));
  await assert.rejects(fetchWithTimeout("https://www.bookmark-ai.cloud/api/auth/native/start", { method: "POST" }, 10), /aborted/);
  assert.equal(called, true);
});

test("failed native requests clear the timer and preserve the network error", async (t) => {
  const original = globalThis.AbortController;
  globalThis.AbortController = nativeAbort.AbortController;
  t.after(() => { globalThis.AbortController = original; });
  let signal: AbortSignal | undefined;
  t.mock.method(globalThis, "fetch", async (_input: unknown, init: RequestInit) => {
    signal = init.signal!;
    throw new Error("offline");
  });
  await assert.rejects(fetchWithTimeout("https://www.bookmark-ai.cloud/api/auth/native/start", { method: "POST" }, 10), /offline/);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(signal?.aborted, false);
});
