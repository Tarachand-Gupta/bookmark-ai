import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { test } from "node:test";
import { listLiveResponseSchema, type PushLiveStateInput } from "@bookmark-ai/types";
import type { Config } from "./config";
import { decryptWindows, isEncryptedEnvelope, windowsAad } from "./crypto";
import { devKey, indexKey, newWindowsKey, winNamesKey } from "./keys";
import { LiveStore } from "./live-store";
import type { RedisBundle } from "./redis";
import type { LiveEvent } from "./types";

/**
 * No-op publish suppression tests. These exercise `writeSnapshot` against an
 * in-memory fake of the two Redis calls it uses (EXISTS/HMGET + a MULTI pipeline)
 * so we can assert the fan-out signal (`changed`) and that liveness/TTL/index are
 * still refreshed on a suppressed push. Run with `pnpm --filter
 * @bookmark-ai/live-server test` (tsx's built-in node:test runner — no extra dep).
 *
 * `liveEncryptionSecret` is PINNED on every fake Config below (default: undefined =
 * plaintext) instead of being inherited from the shell: the store threads it into
 * crypto.ts explicitly, so exporting LIVE_ENCRYPTION_SECRET in your terminal must
 * not change what these tests observe.
 */

/** A throwaway 32-byte key, so no test depends on a real/exported secret. */
const TEST_KEY = randomBytes(32).toString("base64");

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
    // The new-window policy key is separate from the device hash; this fake models
    // one device hash only, so the policy key is always absent ⇒ default shared.
    async get(_key: string) {
      return null;
    },
    multi() {
      return makeMulti(hash, ops);
    },
  };

  const redis = { command } as unknown as RedisBundle;
  const config = {
    ttlSeconds: 604800,
    pushQuotaPerDay: 2000,
    liveEncryptionSecret: undefined, // pinned: plaintext, never the shell's value
  } as Config;
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
  assert.equal(res.newWindowsShared, true, "absent policy key ⇒ default shared");
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

// ── window-name overrides ────────────────────────────────────────────────────
// A richer multi-key fake: a map of Redis-key → Hash, a single-user ZSET index,
// and a publish recorder. Enough to exercise setWindowName (HSET/HDEL + EXPIRE +
// publish), the listDevices overlay, and winnames deletion on device removal.

interface StoreHarness {
  store: LiveStore;
  hashes: Map<string, Map<string, string>>;
  zset: Map<string, number>;
  strings: Map<string, string>;
  published: LiveEvent[];
}

function makeStoreHarness(liveEncryptionSecret?: string): StoreHarness {
  const hashes = new Map<string, Map<string, string>>();
  const zset = new Map<string, number>();
  const strings = new Map<string, string>();
  const published: LiveEvent[] = [];
  const hashFor = (key: string): Map<string, string> => {
    let h = hashes.get(key);
    if (!h) {
      h = new Map();
      hashes.set(key, h);
    }
    return h;
  };

  const makeMulti = () => {
    const chain = {
      hset(key: string, fieldOrObj: string | Record<string, string>, value?: string) {
        if (typeof fieldOrObj === "string") hashFor(key).set(fieldOrObj, value as string);
        else for (const [k, v] of Object.entries(fieldOrObj)) hashFor(key).set(k, v);
        return chain;
      },
      hdel(key: string, field: string) {
        hashes.get(key)?.delete(field);
        return chain;
      },
      hsetnx(key: string, field: string, value: string) {
        const h = hashFor(key);
        if (!h.has(field)) h.set(field, value);
        return chain;
      },
      expire(_key: string, _seconds: number) {
        return chain;
      },
      del(key: string) {
        hashes.delete(key);
        strings.delete(key);
        return chain;
      },
      zadd(_key: string, score: number, member: string) {
        zset.set(member, score);
        return chain;
      },
      zrem(_key: string, member: string) {
        zset.delete(member);
        return chain;
      },
      async exec() {
        return [];
      },
    };
    return chain;
  };

  const command = {
    multi() {
      return makeMulti();
    },
    async zrevrange(_key: string, _s: number, _e: number) {
      return [...zset.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
    },
    async zrange(_key: string, _s: number, _e: number) {
      return [...zset.entries()].sort((a, b) => a[1] - b[1]).map(([m]) => m);
    },
    async zrem(_key: string, ...members: string[]) {
      for (const m of members) zset.delete(m);
      return members.length;
    },
    async get(key: string) {
      return strings.has(key) ? (strings.get(key) as string) : null;
    },
    async set(key: string, value: string) {
      strings.set(key, value);
      return "OK";
    },
    async exists(key: string) {
      return hashes.has(key) ? 1 : 0;
    },
    async hmget(key: string, ...fields: string[]) {
      const h = hashes.get(key);
      return fields.map((f) => (h?.has(f) ? (h.get(f) as string) : null));
    },
    async del(key: string) {
      const had = hashes.delete(key) || strings.delete(key);
      return had ? 1 : 0;
    },
    pipeline() {
      // Records the mixed read stream (hgetall | get) so exec returns entries in
      // the same [err, value] shape and order the real ioredis pipeline does.
      const reads: Array<{ kind: "hgetall" | "get"; key: string }> = [];
      const p = {
        hgetall(key: string) {
          reads.push({ kind: "hgetall", key });
          return p;
        },
        get(key: string) {
          reads.push({ kind: "get", key });
          return p;
        },
        async exec() {
          return reads.map((r): [null, Record<string, string> | string | null] => {
            if (r.kind === "get") return [null, strings.has(r.key) ? (strings.get(r.key) as string) : null];
            const h = hashes.get(r.key);
            return [null, h ? Object.fromEntries(h) : {}];
          });
        },
      };
      return p;
    },
    async publish(_channel: string, payload: string) {
      published.push(JSON.parse(payload) as LiveEvent);
    },
  };

  const redis = { command } as unknown as RedisBundle;
  // Pinned explicitly (undefined unless a test opts in) — see the file header.
  const config = {
    ttlSeconds: 604800,
    pushQuotaPerDay: 2000,
    ttlHours: 168,
    liveEncryptionSecret,
  } as Config;
  return { store: new LiveStore(redis, config), hashes, zset, strings, published };
}

const DEV = BASE_PUSH.deviceId;

/** Seed one device with BASE_PUSH's window (windowId 1) into the index + hash. */
function seedDevice(h: StoreHarness): void {
  h.zset.set(DEV, Date.now());
  const dev = new Map<string, string>([
    ["label", "Laptop"],
    ["browser", "chrome"],
    ["device", "desktop"],
    ["os", "macOS"],
    ["windowsJson", JSON.stringify(BASE_PUSH.windows)],
    ["tabCount", "1"],
    ["hiddenTabCount", "0"],
    ["lastSeenAt", new Date().toISOString()],
  ]);
  h.hashes.set(devKey(USER, DEV), dev);
}

test("setWindowName (non-empty) → HSET stored + publishes push", async () => {
  const h = makeStoreHarness();
  await h.store.setWindowName(USER, DEV, "1", "Research");
  assert.equal(h.hashes.get(winNamesKey(USER, DEV))?.get("1"), "Research");
  assert.deepEqual(h.published, [{ type: "push", deviceId: DEV }]);
});

test("setWindowName (empty) → HDEL clears + still publishes", async () => {
  const h = makeStoreHarness();
  h.hashes.set(winNamesKey(USER, DEV), new Map([["1", "Research"]]));
  await h.store.setWindowName(USER, DEV, "1", "   ");
  assert.equal(h.hashes.get(winNamesKey(USER, DEV))?.has("1"), false);
  assert.deepEqual(h.published, [{ type: "push", deviceId: DEV }]);
});

test("listDevices overlays the window name onto the matching window", async () => {
  const h = makeStoreHarness();
  seedDevice(h);
  h.hashes.set(winNamesKey(USER, DEV), new Map([["1", "Research"], ["99", "Ghost"]]));
  const devices = await h.store.listDevices(USER);
  assert.equal(devices.length, 1);
  assert.equal(devices[0]?.windows[0]?.name, "Research");
});

test("listDevices ignores overrides for windowIds not in the snapshot", async () => {
  const h = makeStoreHarness();
  seedDevice(h);
  h.hashes.set(winNamesKey(USER, DEV), new Map([["42", "Stale"]]));
  const devices = await h.store.listDevices(USER);
  assert.equal(devices[0]?.windows[0]?.name, undefined);
});

test("listDevices with no overrides leaves name undefined", async () => {
  const h = makeStoreHarness();
  seedDevice(h);
  const devices = await h.store.listDevices(USER);
  assert.equal(devices[0]?.windows[0]?.name, undefined);
});

test("deleteDevice removes the winnames hash", async () => {
  const h = makeStoreHarness();
  seedDevice(h);
  h.hashes.set(winNamesKey(USER, DEV), new Map([["1", "Research"]]));
  await h.store.deleteDevice(USER, DEV);
  assert.equal(h.hashes.has(winNamesKey(USER, DEV)), false);
  assert.equal(h.hashes.has(devKey(USER, DEV)), false);
});

// ── per-device new-window policy ─────────────────────────────────────────────

test("setDeviceNewWindowsShared(false) → SET '0' + publishes push", async () => {
  const h = makeStoreHarness();
  await h.store.setDeviceNewWindowsShared(USER, DEV, false);
  assert.equal(h.strings.get(newWindowsKey(USER, DEV)), "0");
  assert.deepEqual(h.published, [{ type: "push", deviceId: DEV }]);
});

test("setDeviceNewWindowsShared(true) → DEL clears the opt-out + publishes", async () => {
  const h = makeStoreHarness();
  h.strings.set(newWindowsKey(USER, DEV), "0");
  await h.store.setDeviceNewWindowsShared(USER, DEV, true);
  assert.equal(h.strings.has(newWindowsKey(USER, DEV)), false, "true DELs the key (absent = default on)");
  assert.deepEqual(h.published, [{ type: "push", deviceId: DEV }]);
});

test("listDevices overlays newWindowsShared:false only when the key is '0'", async () => {
  const h = makeStoreHarness();
  seedDevice(h);
  h.strings.set(newWindowsKey(USER, DEV), "0");
  const devices = await h.store.listDevices(USER);
  assert.equal(devices[0]?.newWindowsShared, false);
});

test("listDevices leaves newWindowsShared undefined when the policy key is absent", async () => {
  const h = makeStoreHarness();
  seedDevice(h);
  const devices = await h.store.listDevices(USER);
  assert.equal(devices[0]?.newWindowsShared, undefined, "absent key ⇒ default (field omitted)");
});

test("writeSnapshot echoes newWindowsShared:false when the policy key is '0'", async () => {
  const h = makeStoreHarness();
  seedDevice(h);
  h.strings.set(newWindowsKey(USER, DEV), "0");
  const res = await h.store.writeSnapshot(USER, BASE_PUSH);
  assert.equal(res.newWindowsShared, false, "push body reflects the stored opt-out");
});

test("deleteDevice removes the new-window policy key", async () => {
  const h = makeStoreHarness();
  seedDevice(h);
  h.strings.set(newWindowsKey(USER, DEV), "0");
  await h.store.deleteDevice(USER, DEV);
  assert.equal(h.strings.has(newWindowsKey(USER, DEV)), false);
});

test("deleteAllDevices removes every device's new-window policy key", async () => {
  const h = makeStoreHarness();
  seedDevice(h);
  h.strings.set(newWindowsKey(USER, DEV), "0");
  await h.store.deleteAllDevices(USER);
  assert.equal(h.strings.has(newWindowsKey(USER, DEV)), false);
});

// ── at-rest encryption of windowsJson ────────────────────────────────────────
// Everything below runs the SAME store with a pinned test key. The invariants:
// writes are ciphertext, the no-op fan-out suppression still works despite the
// random IV, legacy plaintext migrates on a no-op push WITHOUT publishing, a
// ciphertext is bound to its (user, device) slot, and no stored value — however
// mangled — can 500 a read.

const DEV_B = "22222222-2222-2222-2222-222222222222";

/** Put a device into the index with a verbatim `windowsJson` value. */
function seedRawDevice(h: StoreHarness, deviceId: string, windowsJson: string): void {
  h.zset.set(deviceId, Date.now());
  h.hashes.set(
    devKey(USER, deviceId),
    new Map<string, string>([
      ["label", `Device ${deviceId.slice(0, 1)}`],
      ["browser", "chrome"],
      ["device", "desktop"],
      ["os", "macOS"],
      ["windowsJson", windowsJson],
      ["tabCount", "1"],
      ["hiddenTabCount", "0"],
      ["lastSeenAt", new Date().toISOString()],
    ]),
  );
}

const storedWindows = (h: StoreHarness, deviceId = DEV): string =>
  h.hashes.get(devKey(USER, deviceId))?.get("windowsJson") ?? "";

test("encryption on: a push stores an enc:v1: envelope that round-trips", async () => {
  const h = makeStoreHarness(TEST_KEY);
  const res = await h.store.writeSnapshot(USER, BASE_PUSH);
  assert.equal(res.changed, true);

  const stored = storedWindows(h);
  assert.ok(isEncryptedEnvelope(stored), "windowsJson is written as ciphertext");
  assert.ok(!stored.includes("a.test"), "no tab URL survives in the stored value");
  assert.equal(
    decryptWindows(stored, windowsAad(USER, DEV), TEST_KEY),
    JSON.stringify(BASE_PUSH.windows),
    "and decrypts back to exactly what was pushed",
  );

  const devices = await h.store.listDevices(USER);
  assert.deepEqual(devices[0]?.windows, BASE_PUSH.windows, "the read path sees plaintext windows");
});

test("encryption on: an identical second push is still a no-op despite the random IV", async () => {
  const h = makeStoreHarness(TEST_KEY);
  await h.store.writeSnapshot(USER, BASE_PUSH);
  const first = storedWindows(h);

  const res = await h.store.writeSnapshot(USER, {
    ...BASE_PUSH,
    capturedAt: "2026-07-23T11:00:00.000Z",
  });
  assert.equal(res.changed, false, "compare decrypts before comparing → no false 'changed'");
  assert.deepEqual(h.published, [], "and therefore no fan-out");
  assert.equal(storedWindows(h), first, "an already-encrypted value is left byte-identical");
});

test("encryption on: a real tab change still publishes and re-encrypts", async () => {
  const h = makeStoreHarness(TEST_KEY);
  await h.store.writeSnapshot(USER, BASE_PUSH);
  const first = storedWindows(h);

  const res = await h.store.writeSnapshot(USER, {
    ...BASE_PUSH,
    windows: [{ windowId: 1, tabs: [{ url: "https://a.test", title: "A" }, { url: "https://b.test", title: "B" }] }],
  });
  assert.equal(res.changed, true);
  assert.notEqual(storedWindows(h), first);
  assert.ok(isEncryptedEnvelope(storedWindows(h)));
});

test("FIX 2: a legacy PLAINTEXT row migrates to ciphertext on a no-op push, without publishing", async () => {
  const h = makeStoreHarness(TEST_KEY);
  // Exactly what a pre-encryption deploy left behind: plaintext windowsJson.
  seedDevice(h);
  assert.equal(isEncryptedEnvelope(storedWindows(h)), false, "precondition: plaintext");

  const res = await h.store.writeSnapshot(USER, {
    ...BASE_PUSH,
    capturedAt: "2026-07-23T11:00:00.000Z", // nothing a viewer renders has moved
  });

  assert.equal(res.changed, false, "still a no-op: representation changed, display did not");
  assert.deepEqual(h.published, [], "migration must NOT fan out — nothing visible moved");
  assert.ok(isEncryptedEnvelope(storedWindows(h)), "…but the row is now ciphertext");
  assert.equal(
    decryptWindows(storedWindows(h), windowsAad(USER, DEV), TEST_KEY),
    JSON.stringify(BASE_PUSH.windows),
    "and holds the same windows it did before",
  );
  const devices = await h.store.listDevices(USER);
  assert.deepEqual(devices[0]?.windows, BASE_PUSH.windows, "viewers see no difference");
});

test("FIX 2: with encryption OFF a no-op push leaves the plaintext row alone", async () => {
  const h = makeStoreHarness(); // no secret
  seedDevice(h);
  const before = storedWindows(h);
  const res = await h.store.writeSnapshot(USER, {
    ...BASE_PUSH,
    capturedAt: "2026-07-23T11:00:00.000Z",
  });
  assert.equal(res.changed, false);
  assert.equal(storedWindows(h), before, "no key ⇒ nothing to migrate to");
});

test("encryption on: a heartbeat never rewrites an already-encrypted windowsJson", async () => {
  const h = makeStoreHarness(TEST_KEY);
  await h.store.writeSnapshot(USER, BASE_PUSH);
  const before = storedWindows(h);

  const res = await h.store.writeSnapshot(USER, {
    deviceId: DEV,
    browser: "chrome",
    device: "desktop",
    capturedAt: "2026-07-23T11:00:00.000Z",
    hiddenTabCount: 0,
    // windows omitted → heartbeat
  });
  assert.equal(res.changed, false);
  assert.equal(storedWindows(h), before, "byte-identical — heartbeats touch liveness only");
  assert.deepEqual(h.published, []);
});

test("FIX 6 (AAD): a ciphertext copied into ANOTHER device's hash yields zero windows", async () => {
  const h = makeStoreHarness(TEST_KEY);
  await h.store.writeSnapshot(USER, BASE_PUSH);
  const cipher = storedWindows(h);

  // Attacker with Redis write access copies device A's blob onto a device B hash.
  seedRawDevice(h, DEV_B, cipher);

  const devices = await h.store.listDevices(USER);
  const a = devices.find((d) => d.deviceId === DEV);
  const b = devices.find((d) => d.deviceId === DEV_B);
  assert.deepEqual(a?.windows, BASE_PUSH.windows, "the rightful owner is unaffected");
  assert.deepEqual(b?.windows, [], "the copy fails the GCM auth tag → no disclosure");
  assert.doesNotThrow(() =>
    listLiveResponseSchema.parse({ devices, enabled: true, ttlHours: 168 }),
  );
});

test("FIX 3: every hostile windowsJson shape renders as zero windows, siblings intact", async () => {
  const hostile: Array<[string, string]> = [
    ["valid JSON, wrong shape (object)", '{"a":1}'],
    ["array of non-objects", "[1,2,3]"],
    ["JSON null", "null"],
    ["JSON true", "true"],
    ["JSON string", '"windows"'],
    ["not JSON at all", "not-json-at-all"],
    ["empty string", ""],
    ["undecryptable envelope", "enc:v1:garbage"],
    ["windows with a non-integer id", '[{"windowId":"one","tabs":[]}]'],
    ["window whose tabs are not objects", '[{"windowId":1,"tabs":[1,2,3]}]'],
    ["window with a non-string name", '[{"windowId":1,"tabs":[],"name":5}]'],
  ];

  for (const [name, value] of hostile) {
    const h = makeStoreHarness(TEST_KEY);
    seedDevice(h); // healthy sibling (plaintext row)
    seedRawDevice(h, DEV_B, value); // corrupt device
    // A rename override on the corrupt device — this is what used to throw when the
    // overlay tried to assign `.name` onto a number/null.
    h.hashes.set(winNamesKey(USER, DEV_B), new Map([["1", "Research"]]));

    let devices: Awaited<ReturnType<typeof h.store.listDevices>> = [];
    await assert.doesNotReject(async () => {
      devices = await h.store.listDevices(USER);
    }, `listDevices must not throw on: ${name}`);

    const corrupt = devices.find((d) => d.deviceId === DEV_B);
    const healthy = devices.find((d) => d.deviceId === DEV);
    assert.deepEqual(corrupt?.windows, [], `${name} → zero windows`);
    assert.deepEqual(healthy?.windows, BASE_PUSH.windows, `${name} → sibling still renders`);
    assert.doesNotThrow(
      () => listLiveResponseSchema.parse({ devices, enabled: true, ttlHours: 168 }),
      `${name} → the response schema still validates (no 500 in routes/list)`,
    );
  }
});

test("FIX 3: a corrupt lastSeenAt / tabCount cannot fail the response schema either", async () => {
  const h = makeStoreHarness(TEST_KEY);
  seedDevice(h);
  seedRawDevice(h, DEV_B, JSON.stringify(BASE_PUSH.windows));
  const bad = h.hashes.get(devKey(USER, DEV_B)) as Map<string, string>;
  bad.set("lastSeenAt", "yesterday-ish");
  bad.set("tabCount", "not-a-number");

  const devices = await h.store.listDevices(USER);
  assert.doesNotThrow(() =>
    listLiveResponseSchema.parse({ devices, enabled: true, ttlHours: 168 }),
  );
  const corrupt = devices.find((d) => d.deviceId === DEV_B);
  assert.equal(corrupt?.tabCount, 0, "unparseable counter degrades to 0");
  assert.equal(corrupt?.lastSeenAgeSeconds, 0);
});

test("FIX 6 (AAD): a ciphertext written for user A does not open for user B", async () => {
  const h = makeStoreHarness(TEST_KEY);
  await h.store.writeSnapshot(USER, BASE_PUSH);
  const cipher = storedWindows(h);

  // The same device id under a DIFFERENT user's namespace.
  const other = "user_other";
  h.zset.set(DEV, Date.now());
  h.hashes.set(
    devKey(other, DEV),
    new Map<string, string>([
      ["browser", "chrome"],
      ["device", "desktop"],
      ["windowsJson", cipher],
      ["lastSeenAt", new Date().toISOString()],
    ]),
  );
  const devices = await h.store.listDevices(other);
  assert.deepEqual(devices[0]?.windows, [], "cross-tenant reuse of a blob discloses nothing");
});
