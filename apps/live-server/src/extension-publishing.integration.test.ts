import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import Fastify from "fastify";
import Redis from "ioredis";
import { makeAuthPreHandler } from "./auth";
import { loadConfig } from "./config";
import { LiveStore } from "./live-store";
import { channelKey, devKey, newWindowsKey, publishingKey, winNamesKey } from "./keys";
import { COMMIT_EXTENSION_SNAPSHOT, SET_EXTENSION_PUBLISHING } from "./publishing-scripts";
import { registerPush } from "./routes/push";
import { registerSettings } from "./routes/settings";
import { registerForget } from "./routes/forget";
import type { Deps } from "./deps";
import type { RedisBundle } from "./redis";

// Real, isolated Redis + actual routes/auth policy. Provider verification and
// account lookup are simulated; no provider, production Redis, or real user data.
const IDS = ["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002", "00000000-0000-4000-8000-000000000003"];
const ACCOUNT = "owned-local-fixture";
const CLIENTS = ["fixture-safari", "fixture-chrome", "fixture-firefox"];
const config = loadConfig({ AUTH_PROVIDER: "supabase", BOOKMARK_BUILD_VARIANT: "supabase-production", SUPABASE_URL: "https://fixture.invalid", SUPABASE_PUBLISHABLE_KEY: "fixture-public", SUPABASE_DATABASE_URL: "postgres://fixture.invalid/fixture", SUPABASE_EXTENSION_CLIENT_IDS: CLIENTS.join(",") });
const payload = (i = 0, title = "fixture") => ({ deviceId: IDS[i], browser: "safari", device: "desktop", capturedAt: "2026-10-09T00:00:00.000Z", windows: [{ windowId: 1, tabs: [{ url: "https://fixture.invalid/", title }] }] });
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
function deferred() { let resolve!: () => void; const promise = new Promise<void>((r) => { resolve = r; }); return { promise, resolve }; }
async function waitAtCommit(barrier: { entered: Promise<void>; release(): void }) {
  let timer!: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([barrier.entered, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => { barrier.release(); reject(new Error("commit barrier not reached")); }, 2000);
    })]);
  } finally { clearTimeout(timer); }
}

test("isolated real Redis: verified extension session stop/admission lifecycle", { timeout: 30000 }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "bookmark-live-fence-"));
  const socket = join(directory, "redis.sock");
  let child: ChildProcess;
  let command!: Redis;
  let subscriber!: Redis;
  let app: ReturnType<typeof Fastify>;
  let store: LiveStore;
  const events: Array<{ type: string; deviceId?: string }> = [];
  const start = async () => {
    child = spawn(process.env.LIVE_TEST_REDIS_SERVER || "/opt/homebrew/bin/redis-server", ["--port", "0", "--unixsocket", socket, "--save", "", "--appendonly", "yes", "--appendfsync", "always", "--dir", directory], { stdio: "ignore" });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error("isolated Redis could not start");
      const probe = new Redis({ path: socket, lazyConnect: true, retryStrategy: () => null, maxRetriesPerRequest: 1 });
      probe.on("error", () => {});
      try { await probe.connect(); await probe.ping(); probe.disconnect(); break; }
      catch { probe.disconnect(); if (attempt === 99) throw new Error("isolated Redis startup timeout"); await delay(20); }
    }
    command = new Redis({ path: socket, retryStrategy: () => null, maxRetriesPerRequest: 1 });
    subscriber = new Redis({ path: socket, retryStrategy: () => null, maxRetriesPerRequest: 1 });
    command.on("error", () => {}); subscriber.on("error", () => {});
    subscriber.on("message", (_channel, message) => events.push(JSON.parse(message)));
    await subscriber.subscribe(channelKey(ACCOUNT));
  };
  const createApp = (encrypted = false) => {
    store = new LiveStore({ command } as RedisBundle, { ...config, liveEncryptionSecret: encrypted ? randomBytes(32).toString("base64") : undefined });
    const auth = makeAuthPreHandler(config, {
      verify: async (token) => {
        const index = token === "other-extension" ? 0 : Number(token);
        const human = token === "human" || token === "other";
        const subject = token === "other" || token === "other-extension" ? "other" : ACCOUNT;
        return { providerUserId: subject, sessionId: human ? "human-session" : IDS[index]!, accessToken: token, expiresAt: Date.now() / 1000 + 60, authenticatedAt: Date.now() / 1000, aal: "aal1", clientId: human ? undefined : CLIENTS[index], user: { id: subject } };
      },
      master: { query: async (_sql, args) => [{ id: args?.[0] }] },
    });
    app = Fastify({ logger: false });
    const deps = { store, config, auth } as Deps;
    registerPush(app, deps); registerSettings(app, deps); registerForget(app, deps);
  };
  const request = (token: string, url: string, body?: unknown, method: "POST" | "DELETE" = "POST") => app.inject({ method, url, headers: { authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { payload: body as any }) });
  const setting = (token: string, enabled: boolean) => request(token, "/live/settings", { enabled });
  const push = (i: number, body: unknown = payload(i)) => request(String(i), "/live", body);
  const exists = () => command.exists(devKey(ACCOUNT, IDS[0]!));
  const pauseCommit = () => {
    const entered = deferred(), release = deferred();
    const original = command.eval.bind(command);
    let paused = false;
    command.eval = (async (...args: any[]) => {
      if (!paused && args[0] === COMMIT_EXTENSION_SNAPSHOT && args[3] === publishingKey(ACCOUNT, IDS[0]!)) {
        paused = true; entered.resolve(); await release.promise;
      }
      return (original as any)(...args);
    }) as typeof command.eval;
    return { entered: entered.promise, release: () => { command.eval = original as typeof command.eval; release.resolve(); } };
  };
  try {
    await start(); createApp();
    await t.test("three clients: Safari OFF preserves siblings, account opt-in, preferences and emits own delete only", async () => {
      assert.equal((await setting("human", true)).statusCode, 200);
      for (let i = 0; i < 3; i++)  { const result = await push(i); assert.equal(result.statusCode, 200, result.body); }
      await store.setDeviceNewWindowsShared(ACCOUNT, IDS[0]!, false);
      await store.setWindowName(ACCOUNT, IDS[0]!, "1", "Fixture window");
      await delay(20); events.length = 0;
      assert.equal((await setting("0", false)).statusCode, 200); await delay(20);
      assert.equal(await exists(), 0); assert.equal(await store.getEnabled(ACCOUNT), true);
      for (let i = 1; i < 3; i++) assert.equal(await command.exists(devKey(ACCOUNT, IDS[i]!)), 1);
      assert.deepEqual(events, [{ type: "delete", deviceId: IDS[0] }]);
      assert.equal(await command.get(newWindowsKey(ACCOUNT, IDS[0]!)), "0");
      assert.equal(await command.hget(winNamesKey(ACCOUNT, IDS[0]!), "1"), "Fixture window");
      for (let i = 1; i < 3; i++) assert.equal((await push(i, payload(i, "sibling next"))).statusCode, 200);
      assert.equal((await push(0)).statusCode, 403);
      assert.equal((await setting("0", false)).statusCode, 200);
    });
    for (const mode of ["full", "no-op", "heartbeat", "encryption migration"] as const) {
      await t.test(`OFF wins at actual Redis commit boundary: ${mode}`, async () => {
        await setting("0", true); await push(0);
        if (mode === "encryption migration") { await app.close(); createApp(true); }
        const body = mode === "heartbeat" ? { ...payload(), windows: undefined } : payload(0, mode === "full" ? "changed" : "fixture");
        const barrier = pauseCommit();
        const pending = push(0, body).then((r: { statusCode: number; body: string; json(): any }) => r); await waitAtCommit(barrier);
        await setting("0", false); barrier.release();
        assert.equal((await pending).statusCode, 403); assert.equal(await exists(), 0);
        assert.equal(await command.zscore(`live:{${ACCOUNT}}:index`, IDS[0]!), null);
        if (mode === "encryption migration") { await app.close(); createApp(); }
      });
    }
    await t.test("OFF→ON rejects old epoch without telling unchanged client to stop renewed publication", async () => {
      await setting("0", true);
      const barrier = pauseCommit(); const pending = push(0, payload(0, "obsolete")).then((r: { statusCode: number; body: string; json(): any }) => r); await waitAtCommit(barrier);
      await setting("0", false); await setting("0", true); await delay(20); events.length = 0;
      barrier.release(); const response = await pending;
      assert.equal(response.statusCode, 200); assert.equal(response.json().enabled, true);
      assert.equal(await exists(), 0); await delay(20); assert.deepEqual(events, []);
      assert.equal((await push(0, payload(0, "renewed"))).statusCode, 200);
      assert.match((await command.hget(devKey(ACCOUNT, IDS[0]!), "windowsJson"))!, /renewed/);
      const nextBarrier = pauseCommit();
      const oldResponse = push(0, payload(0, "obsolete second")).then((r: { statusCode: number; body: string; json(): any }) => r);
      await waitAtCommit(nextBarrier);
      await setting("0", false); await setting("0", true);
      // The one-shot barrier pauses only the older request, allowing the new epoch to commit.
      assert.equal((await push(0, payload(0, "fresh post ON"))).statusCode, 200);
      const fresh = await command.hgetall(devKey(ACCOUNT, IDS[0]!));
      await delay(20); events.length = 0; nextBarrier.release();
      assert.equal((await oldResponse).statusCode, 200);
      assert.deepEqual(await command.hgetall(devKey(ACCOUNT, IDS[0]!)), fresh);
      await delay(20); assert.deepEqual(events, []);
    });
    await t.test("website global OFF purges all and fences admitted extension writes", async () => {
      const barrier = pauseCommit(); const pending = push(0, payload(0, "late")).then((r: { statusCode: number; body: string; json(): any }) => r); await waitAtCommit(barrier);
      assert.equal((await setting("human", false)).statusCode, 200); barrier.release();
      assert.equal((await pending).statusCode, 403); assert.equal(await store.getEnabled(ACCOUNT), false);
      for (const id of IDS) assert.equal(await command.exists(devKey(ACCOUNT, id)), 0);
      assert.equal((await push(1)).statusCode, 403);
      assert.equal((await setting("0", true)).statusCode, 200);
      assert.equal(await store.getEnabled(ACCOUNT), true);
    });
    await t.test("verified ownership denies same-account spoof and foreign teardown; separate accounts remain isolated", async () => {
      assert.equal((await push(0, payload(1))).statusCode, 403);
      assert.equal((await request("0", `/live/${IDS[1]}`, undefined, "DELETE")).statusCode, 403);
      assert.equal((await request("0", "/live", undefined, "DELETE")).statusCode, 403);
      assert.equal((await request("0", "/live/settings", { enabled: false, deviceId: IDS[1], isExtension: false })).statusCode, 200);
      assert.equal(await store.getExtensionPublishingEpoch(ACCOUNT, IDS[1]!), "0");
      await setting("other-extension", true);
      assert.equal((await request("other-extension", "/live", payload(0, "other account"))).statusCode, 200);
      await setting("0", false); assert.equal(await command.exists(devKey("other", IDS[0]!)), 1);
    });
    await t.test("Redis mutation failure cannot falsely acknowledge OFF; explicit retry persists stop", async () => {
      await setting("0", true); await push(0);
      const original = command.eval.bind(command);
      command.eval = (async (...args: any[]) => { if (args[0] === SET_EXTENSION_PUBLISHING) throw new Error("fixture Redis unavailable"); return (original as any)(...args); }) as typeof command.eval;
      assert.equal((await setting("0", false)).statusCode, 500);
      command.eval = original as typeof command.eval;
      assert.equal(await exists(), 1); assert.notEqual(await store.getExtensionPublishingEpoch(ACCOUNT, IDS[0]!), null);
      assert.equal((await setting("0", false)).statusCode, 200);
      await app.close(); createApp(); assert.equal((await push(0)).statusCode, 403);
    });
    await t.test("actual AOF Redis restart retains stop; disconnected requests fail, then own ON resumes", async () => {
      await app.close(); command.disconnect(); subscriber.disconnect();
      const exited = once(child, "exit"); child.kill("SIGTERM"); await exited;
      createApp(); assert.equal((await setting("0", true)).statusCode, 500); await app.close();
      await start(); createApp();
      assert.equal((await push(0)).statusCode, 403);
      assert.equal((await setting("0", false)).statusCode, 200);
      assert.equal((await setting("0", true)).statusCode, 200); assert.equal((await push(0)).statusCode, 200);
    });
  } finally {
    if (app!) await app.close(); command?.disconnect(); subscriber?.disconnect();
    if (child! && child.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; }
    await rm(directory, { recursive: true, force: true });
  }
});
