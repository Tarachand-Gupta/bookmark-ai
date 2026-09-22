import assert from "node:assert/strict";
import { test } from "node:test";
import Fastify from "fastify";
import { createServerLogger } from "@bookmark-ai/server-logging";
import { registerServerLogging, type LiveLogger } from "./logging";

test("remote logs contain templates and status, never request content or error messages", async () => {
  const batches: string[] = [];
  const logger = createServerLogger({
    service: "bookmark-ai-live",
    env: { NEW_RELIC_LICENSE_KEY: "test-only", NEW_RELIC_REGION: "US" },
    console: { log() {}, warn() {}, error() {} },
    fetch: async (_input, init) => {
      batches.push(String(init?.body));
      return new Response("", { status: 202 });
    },
  });
  const app = Fastify();
  registerServerLogging(app, logger);
  app.post("/live/:deviceId", async () => {
    throw new TypeError("private-error-message");
  });
  const response = await app.inject({
    method: "POST", url: "/live/private-device?secret=private-query",
    headers: { authorization: "Bearer private-token" },
    payload: { title: "private-title" },
  });
  assert.equal(response.statusCode, 500);
  await app.inject({ method: "GET", url: "/unknown-private-path?token=private-query" });
  await app.close();
  const exported = batches.join("\n");
  assert.match(exported, /http.request.completed/);
  assert.match(exported, /http.request.failed/);
  assert.match(exported, /\/live\/:deviceId/);
  assert.match(exported, /500/);
  assert.match(exported, /404/);
  assert.match(exported, /durationMs/);
  assert.doesNotMatch(exported, /private-/);
});

test("periodic flush does not overlap and shutdown waits then flushes once more", async () => {
  let calls = 0;
  let release: (() => void) | undefined;
  let firstStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => { firstStarted = resolve; });
  const logger: LiveLogger = {
    log() {},
    async flush() {
      calls++;
      if (calls === 1) {
        firstStarted!();
        await new Promise<void>((resolve) => { release = resolve; });
      }
    },
  };
  const app = Fastify();
  registerServerLogging(app, logger, 5);
  await app.ready();
  // Keep the event loop alive: production owns listening sockets; this test doesn't.
  const keepalive = setInterval(() => {}, 1000);
  try {
    await started;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls, 1);
    let closed = false;
    const closing = app.close().then(() => { closed = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(closed, false);
    release!();
    await closing;
    assert.equal(calls, 2);
  } finally {
    clearInterval(keepalive);
  }
});
