import assert from "node:assert/strict";
import { test } from "node:test";
import type { PushLiveStateInput } from "@bookmark-ai/types";
import type { Config } from "./config";
import { LiveStore } from "./live-store";
import type { RedisBundle } from "./redis";

/**
 * No-op publish suppression tests. These exercise `writeSnapshot` against an
 * in-memory fake of the two Redis calls it uses (EXISTS/HMGET + a MULTI pipeline)
 * so we can assert the fan-out signal (`changed`) and that liveness/TTL/index are
 * still refreshed on a suppressed push. Run with `pnpm --filter
 * @bookmark-ai/live-server test` (tsx's built-in node:test runner — no extra dep).
 */

interface MultiOp {
  cmd: string;
  args: unknown[];
}

/** Minimal MULTI recorder that also applies HSET/HSETNX to the backing hash so a
 * subsequent HMGET in the same test observes the write, mirroring real Redis. */
function makeMulti(hash: Map<string, string>, log: MultiOp[]) {
  const chain = {
    hset(_key: string, fieldOrObj: string | Record<string, string>, value?: string) {
      log.push({ cmd: "hset", args: [fieldOrObj, value] });
      if (typeof fieldOrObj === "string") {
        hash.set(fieldOrObj, value as string);
      } else {
        for (const [k, v] of Object.entries(fieldOrObj)) hash.set(k, v);
      }
      return chain;
    },
    hsetnx(_key: string, field: string, value: string) {
      log.push({ cmd: "hsetnx", args: [field, value] });
      if (!hash.has(field)) hash.set(field, value);
      return chain;
    },
    zadd(key: string, score: number, member: string) {
      log.push({ cmd: "zadd", args: [key, score, member] });
      return chain;
    },
    expire(key: string, seconds: number) {
      log.push({ cmd: "expire", args: [key, seconds] });
      return chain;
    },
    async exec() {
      return [];
    },
  };
  return chain;
}

interface Harness {
  store: LiveStore;
  hash: Map<string, string>;
  ops: MultiOp[];
  resetOps: () => void;
}

function makeHarness(initial?: Record<string, string>): Harness {
  const hash = new Map<string, string>(Object.entries(initial ?? {}));
  const ops: MultiOp[] = [];

  const command = {
    async exists(_key: string) {
      return hash.size > 0 ? 1 : 0;
    },
    async hmget(_key: string, ...fields: string[]) {
      return fields.map((f) => (hash.has(f) ? (hash.get(f) as string) : null));
    },
    multi() {
      return makeMulti(hash, ops);
    },
  };

  const redis = { command } as unknown as RedisBundle;
  const config = { ttlSeconds: 604800, pushQuotaPerDay: 2000 } as Config;
  const store = new LiveStore(redis, config);
  return { store, hash, ops, resetOps: () => (ops.length = 0) };
}

const BASE_PUSH: PushLiveStateInput = {
  deviceId: "11111111-1111-1111-1111-111111111111",
  label: "Laptop",
  browser: "chrome",
  device: "desktop",
  os: "macOS",
  capturedAt: "2026-07-23T10:00:00.000Z",
  hiddenTabCount: 0,
  windows: [{ windowId: 1, tabs: [{ url: "https://a.test", title: "A" }] }],
};

const USER = "user_test";

/** The set of ops that prove liveness + index + TTL were refreshed. */
function assertLivenessRefreshed(ops: MultiOp[]): void {
  assert.ok(
    ops.some((o) => o.cmd === "zadd"),
    "index (ZADD) must be refreshed",
  );
  assert.ok(
    ops.some((o) => o.cmd === "expire" && o.args[1] === 604800),
    "TTL (EXPIRE) must be refreshed",
  );
  assert.ok(
    ops.some(
      (o) =>
        o.cmd === "hset" &&
        (o.args[0] === "lastSeenAt" || // string-form: hset(key, "lastSeenAt", iso)
          (typeof o.args[0] === "object" &&
            "lastSeenAt" in (o.args[0] as Record<string, string>))),
    ),
    "lastSeenAt must be refreshed",
  );
}

test("first-ever push → changed, publishes, writes full hash", async () => {
  const { store, ops, hash } = makeHarness();
  const res = await store.writeSnapshot(USER, BASE_PUSH);
  assert.equal(res.changed, true);
  assert.equal(hash.get("label"), "Laptop");
  assert.equal(hash.get("windowsJson"), JSON.stringify(BASE_PUSH.windows));
  assert.ok(ops.some((o) => o.cmd === "hsetnx")); // createdAt written once
  assertLivenessRefreshed(ops);
});

test("identical push → no publish, TTL/index/liveness still refreshed", async () => {
  // Seed the hash exactly as a full push would have left it.
  const { store, resetOps, ops } = makeHarness({
    label: "Laptop",
    browser: "chrome",
    device: "desktop",
    os: "macOS",
    windowsJson: JSON.stringify(BASE_PUSH.windows),
    tabCount: "1",
    hiddenTabCount: "0",
    capturedAt: "2026-07-23T09:00:00.000Z",
    lastSeenAt: "2026-07-23T09:00:00.000Z",
    createdAt: "2026-07-23T08:00:00.000Z",
  });
  resetOps();

  const res = await store.writeSnapshot(USER, {
    ...BASE_PUSH,
    capturedAt: "2026-07-23T10:00:00.000Z", // only liveness metadata moved
  });

  assert.equal(res.changed, false, "byte-identical display state must not publish");
  assert.ok(
    !ops.some((o) => o.cmd === "hsetnx"),
    "no-op path must not touch createdAt",
  );
  assertLivenessRefreshed(ops);
});

test("changed windowsJson (real tab change) → publishes", async () => {
  const { store } = makeHarness({
    label: "Laptop",
    browser: "chrome",
    device: "desktop",
    os: "macOS",
    windowsJson: JSON.stringify(BASE_PUSH.windows),
    tabCount: "1",
    hiddenTabCount: "0",
    capturedAt: "2026-07-23T09:00:00.000Z",
    lastSeenAt: "2026-07-23T09:00:00.000Z",
    createdAt: "2026-07-23T08:00:00.000Z",
  });

  const res = await store.writeSnapshot(USER, {
    ...BASE_PUSH,
    windows: [
      { windowId: 1, tabs: [{ url: "https://a.test", title: "A" }, { url: "https://b.test", title: "B" }] },
    ],
  });
  assert.equal(res.changed, true);
});

test("label-only change with identical windows → publishes", async () => {
  const { store, hash } = makeHarness({
    label: "Laptop",
    browser: "chrome",
    device: "desktop",
    os: "macOS",
    windowsJson: JSON.stringify(BASE_PUSH.windows),
    tabCount: "1",
    hiddenTabCount: "0",
    capturedAt: "2026-07-23T09:00:00.000Z",
    lastSeenAt: "2026-07-23T09:00:00.000Z",
    createdAt: "2026-07-23T08:00:00.000Z",
  });

  const res = await store.writeSnapshot(USER, { ...BASE_PUSH, label: "Work Laptop" });
  assert.equal(res.changed, true, "a rename is visible to viewers → must publish");
  assert.equal(hash.get("label"), "Work Laptop");
});

test("hiddenTabCount-only change with identical windows → publishes", async () => {
  const { store } = makeHarness({
    label: "Laptop",
    browser: "chrome",
    device: "desktop",
    os: "macOS",
    windowsJson: JSON.stringify(BASE_PUSH.windows),
    tabCount: "1",
    hiddenTabCount: "0",
    capturedAt: "2026-07-23T09:00:00.000Z",
    lastSeenAt: "2026-07-23T09:00:00.000Z",
    createdAt: "2026-07-23T08:00:00.000Z",
  });

  const res = await store.writeSnapshot(USER, { ...BASE_PUSH, hiddenTabCount: 3 });
  assert.equal(res.changed, true, "hidden-tab count is rendered → must publish");
});

test("heartbeat (windows absent) on existing device → no publish, liveness refreshed", async () => {
  const { store, resetOps, ops } = makeHarness({
    label: "Laptop",
    windowsJson: JSON.stringify(BASE_PUSH.windows),
    lastSeenAt: "2026-07-23T09:00:00.000Z",
  });
  resetOps();

  const heartbeat: PushLiveStateInput = {
    deviceId: BASE_PUSH.deviceId,
    browser: "chrome",
    device: "desktop",
    capturedAt: "2026-07-23T10:00:00.000Z",
    hiddenTabCount: 0,
    // windows omitted → heartbeat
  };
  const res = await store.writeSnapshot(USER, heartbeat);
  assert.equal(res.changed, false, "heartbeats never change visible state → never publish");
  assertLivenessRefreshed(ops);
});

test("heartbeat against missing snapshot → no publish, no ghost", async () => {
  const { store, ops, hash } = makeHarness(); // empty
  const heartbeat: PushLiveStateInput = {
    deviceId: BASE_PUSH.deviceId,
    browser: "chrome",
    device: "desktop",
    capturedAt: "2026-07-23T10:00:00.000Z",
    hiddenTabCount: 0,
  };
  const res = await store.writeSnapshot(USER, heartbeat);
  assert.equal(res.changed, false);
  assert.equal(hash.size, 0, "must not create a windowless ghost");
  assert.equal(ops.length, 0, "no write at all");
});
