import type { LiveDevice, LiveWindow, PushLiveStateInput } from "@bookmark-ai/types";
import type { Config } from "./config";
import {
  decryptWindows,
  encryptionEnabled,
  encryptWindows,
  isEncryptedEnvelope,
  windowsAad,
} from "./crypto";
import {
  channelKey,
  devKey,
  enabledKey,
  indexKey,
  newWindowsKey,
  quotaKey,
  winNamesKey,
} from "./keys";
import type { RedisBundle } from "./redis";
import type { LiveEvent } from "./types";

const QUOTA_TTL_SECONDS = 26 * 60 * 60; // > 24h so the counter self-cleans past UTC midnight

/**
 * The result of applying one checkpoint. `changed` is the fan-out signal for the
 * caller: true only when a viewer would SEE something different (a display field
 * moved), so `routes/push` publishes exactly then. A heartbeat, a no-op full push
 * (payload resolves to byte-identical display state — e.g. a favicon/title flap
 * that survives serialization), and a heartbeat against a missing snapshot are all
 * pure-liveness and report `changed: false`: storage TTL/index still refresh, but
 * no SSE re-read is triggered (every open stream would re-read + re-serialize
 * ~42KB for zero visible change).
 */
export interface WriteResult {
  changed: boolean;
  /**
   * This device's "new windows share by default" policy (absent key ⇒ true).
   * Read on every write and returned so POST /live echoes it in the 200 body —
   * the extension mirrors the policy from the push it already sends, no extra
   * request. Independent of `changed`; a heartbeat reports it too.
   */
  newWindowsShared: boolean;
}

/**
 * The device-hash fields that constitute VISIBLE state. `windowsJson` is the
 * dominant term; the rest are the other columns a viewer renders. Deliberately
 * EXCLUDES the pure-liveness timestamps (`lastSeenAt`, `capturedAt`) and the
 * write-once `createdAt` — those move on every push and must never by themselves
 * force a fan-out. Order is fixed so it lines up with the positional HMGET read.
 */
const DISPLAY_FIELDS = [
  "label",
  "browser",
  "device",
  "os",
  "windowsJson",
  "tabCount",
  "hiddenTabCount",
] as const;

/**
 * The ONLY module that talks to Redis directly. Owns the whole storage model:
 *  - device snapshot = a Hash with a 7-day TTL that resets on every push/heartbeat
 *    (retention = native TTL, so a device that stops reporting just expires — no reaper);
 *  - a per-user ZSET index (score = last-seen ms) for ordering + lazy GC;
 *  - a persisted per-user enabled flag (absent ⇒ OFF, the fail-safe default);
 *  - an in-row-equivalent daily push quota counter;
 *  - a per-user pub/sub channel for SSE fan-out.
 * All freshness math is server-side (clients never subtract their own clock).
 */
export class LiveStore {
  private readonly ttlSeconds: number;
  private readonly quota: number;
  /**
   * The at-rest encryption key (base64), taken from Config and threaded into every
   * crypto call. Held HERE rather than read from process.env inside crypto.ts so a
   * test can pin it on the fake Config instead of inheriting the developer's shell.
   */
  private readonly encryptionSecret: string | undefined;

  constructor(
    private readonly redis: RedisBundle,
    config: Config,
  ) {
    this.ttlSeconds = config.ttlSeconds;
    this.quota = config.pushQuotaPerDay;
    this.encryptionSecret = config.liveEncryptionSecret;
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.redis.command.ping()) === "PONG";
    } catch {
      return false;
    }
  }

  // ── consent flag ──────────────────────────────────────────────────────────
  async getEnabled(userId: string): Promise<boolean> {
    return (await this.redis.command.get(enabledKey(userId))) === "1";
  }

  async setEnabled(userId: string, enabled: boolean): Promise<void> {
    await this.redis.command.set(enabledKey(userId), enabled ? "1" : "0");
  }

  // ── daily push quota ──────────────────────────────────────────────────────
  /** INCR the per-device UTC-day counter; true = under the cap. */
  async checkAndBumpQuota(userId: string, deviceId: string, dayUtc: string): Promise<boolean> {
    const key = quotaKey(userId, deviceId, dayUtc);
    const count = await this.redis.command.incr(key);
    if (count === 1) await this.redis.command.expire(key, QUOTA_TTL_SECONDS);
    return count <= this.quota;
  }

  // ── snapshot write ────────────────────────────────────────────────────────
  /**
   * Apply one checkpoint and report whether it changed anything a viewer sees.
   *
   * A HEARTBEAT (input.windows === undefined) only refreshes liveness + TTL and
   * leaves the stored windows untouched — and is a NO-OP if no snapshot exists yet,
   * so it can never create a windowless ghost. Heartbeats never change display
   * state, so they always report `changed: false` (never publish).
   *
   * A FULL PUSH (windows present, including `[]` = "all windows closed") first
   * reads the currently-stored display fields (one HMGET round-trip) and compares
   * them to the incoming serialization. If every DISPLAY_FIELDS value is
   * byte-identical it is a no-op push: refresh liveness/TTL/index only and report
   * `changed: false` so the caller skips the fan-out. Otherwise it replaces the
   * fields and reports `changed: true`. A first-ever push (no hash) reads all-null,
   * so it compares unequal and publishes. Every write is one MULTI so a device is
   * never observed half-updated.
   */
  async writeSnapshot(userId: string, input: PushLiveStateInput): Promise<WriteResult> {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const dk = devKey(userId, input.deviceId);
    const ik = indexKey(userId);

    // Read the per-device new-window policy alongside the write so the push
    // response can echo it (absent key ⇒ shared). Cheap single GET; on every path.
    const newWindowsShared =
      (await this.redis.command.get(newWindowsKey(userId, input.deviceId))) !== "0";

    if (input.windows === undefined) {
      const exists = await this.redis.command.exists(dk);
      if (!exists) return { changed: false, newWindowsShared };
      await this.redis.command
        .multi()
        .hset(dk, "lastSeenAt", nowIso)
        .zadd(ik, now, input.deviceId)
        .expire(dk, this.ttlSeconds)
        .exec();
      return { changed: false, newWindowsShared };
    }

    const windows = input.windows;
    const tabCount = windows.reduce((sum, w) => sum + w.tabs.length, 0);
    const display: Record<(typeof DISPLAY_FIELDS)[number], string> = {
      label: input.label ?? "",
      browser: input.browser,
      device: input.device,
      os: input.os ?? "",
      windowsJson: JSON.stringify(windows),
      tabCount: String(tabCount),
      hiddenTabCount: String(input.hiddenTabCount),
    };

    // One extra round-trip: the stored value of exactly the display fields, in the
    // same order. A missing hash yields all-null (⇒ unequal ⇒ changed). The 42KB
    // windowsJson read here is the cost we accept to save the far larger fan-out.
    // windowsJson is stored ENCRYPTED, so decrypt it back to plaintext before the
    // compare — otherwise the fresh random IV makes every push look changed and the
    // no-op fan-out suppression breaks. decrypt(encrypt(x)) === x exactly, and a
    // legacy plaintext value passes through unchanged, so the equality still holds.
    const aad = windowsAad(userId, input.deviceId);
    const stored = await this.redis.command.hmget(dk, ...DISPLAY_FIELDS);
    const storedWindowsJson = stored[DISPLAY_FIELDS.indexOf("windowsJson")] ?? null;
    const changed = DISPLAY_FIELDS.some((field, i) => {
      const s =
        field === "windowsJson" && stored[i] != null
          ? decryptWindows(stored[i], aad, this.encryptionSecret)
          : stored[i];
      return s !== display[field];
    });

    if (!changed) {
      // No-op push: viewers already show this exact state. Refresh liveness + TTL +
      // index only, and skip the publish. capturedAt is bumped too so the stored
      // "as of" metadata still matches what a full push would leave — it is
      // display-only and never surfaced by listDevices, so this has no read-side
      // effect, but it keeps the suppressed path a pure superset-minus-publish.
      //
      // OPPORTUNISTIC MIGRATION: a device whose tabs never change (a parked laptop)
      // would otherwise keep its pre-encryption PLAINTEXT windowsJson forever, since
      // only the `changed` branch ever rewrites the field. If encryption is on and
      // the stored value is not an envelope, re-write it as ciphertext here — the
      // plaintext we would encrypt is byte-identical to what is stored (that is what
      // `!changed` just proved), so this is a pure representation change. It bounds
      // plaintext→ciphertext migration to ONE push cycle (~2 min) fleet-wide.
      // Deliberately does NOT publish: nothing a viewer renders moved, and
      // `changed:false` is what suppresses the fan-out in routes/push.
      const needsMigration =
        encryptionEnabled(this.encryptionSecret) &&
        storedWindowsJson !== null &&
        !isEncryptedEnvelope(storedWindowsJson);
      const liveness: Record<string, string> = {
        lastSeenAt: nowIso,
        capturedAt: input.capturedAt,
        ...(needsMigration
          ? { windowsJson: encryptWindows(display.windowsJson, aad, this.encryptionSecret) }
          : {}),
      };
      await this.redis.command
        .multi()
        .hset(dk, liveness)
        .zadd(ik, now, input.deviceId)
        .expire(dk, this.ttlSeconds)
        .exec();
      return { changed: false, newWindowsShared };
    }

    // Encrypt ONLY windowsJson at rest (its value carries the real tab URLs/titles/
    // favicons); label/os/timestamps/tabCount and the separate winnames hash stay
    // plaintext. The Redis field name is unchanged — the value is just ciphertext now.
    await this.redis.command
      .multi()
      .hset(dk, {
        ...display,
        windowsJson: encryptWindows(display.windowsJson, aad, this.encryptionSecret),
        capturedAt: input.capturedAt,
        lastSeenAt: nowIso,
      })
      .hsetnx(dk, "createdAt", nowIso)
      .zadd(ik, now, input.deviceId)
      .expire(dk, this.ttlSeconds)
      .exec();
    return { changed: true, newWindowsShared };
  }

  // ── per-device new-window policy ──────────────────────────────────────────
  /**
   * Set this device's "new windows share by default" policy. `shared=true` DELs
   * the key (absent = the default ON); `false` SETs "0". No TTL — a preference
   * must outlive the 7-day snapshot TTL. Publishes the usual `push` envelope so
   * open viewers re-read the (now updated) device state.
   */
  async setDeviceNewWindowsShared(
    userId: string,
    deviceId: string,
    shared: boolean,
  ): Promise<void> {
    const key = newWindowsKey(userId, deviceId);
    if (shared) await this.redis.command.del(key);
    else await this.redis.command.set(key, "0");
    await this.publish(userId, { type: "push", deviceId });
  }

  // ── window names (viewer-side overrides) ──────────────────────────────────
  /**
   * Set (or clear) the user's display name for ONE window of a device. An empty
   * name HDELs the field (restores the default label); a non-empty name HSETs it.
   * The winnames hash is TTL'd to match the device snapshot on every write so it
   * expires alongside the device rather than lingering. Publishes a `push` so open
   * SSE streams re-read and re-emit the overlaid state (a rename IS visible).
   * `windowId` is stored exactly as it arrives in the URL — the same string the
   * pushed windows' numeric windowId serializes to — so the read-side overlay matches.
   */
  async setWindowName(
    userId: string,
    deviceId: string,
    windowId: string,
    name: string,
  ): Promise<void> {
    const wk = winNamesKey(userId, deviceId);
    const trimmed = name.trim();
    const multi = this.redis.command.multi();
    if (trimmed.length === 0) multi.hdel(wk, windowId);
    else multi.hset(wk, windowId, trimmed);
    multi.expire(wk, this.ttlSeconds);
    await multi.exec();
    await this.publish(userId, { type: "push", deviceId });
  }

  // ── read ──────────────────────────────────────────────────────────────────
  /** ZSET (newest first) → pipelined HGETALL (device hash + its winnames hash) →
   * drop index members whose hash TTL'd out (lazy GC) → map, overlaying window
   * names and computing lastSeenAgeSeconds server-side. */
  async listDevices(userId: string): Promise<LiveDevice[]> {
    const ik = indexKey(userId);
    const deviceIds = await this.redis.command.zrevrange(ik, 0, -1);
    if (deviceIds.length === 0) return [];

    // Three reads per device, interleaved: [devHash, winNames, newWin, …].
    const pipeline = this.redis.command.pipeline();
    for (const id of deviceIds) {
      pipeline.hgetall(devKey(userId, id));
      pipeline.hgetall(winNamesKey(userId, id));
      pipeline.get(newWindowsKey(userId, id));
    }
    const results = await pipeline.exec();

    const now = Date.now();
    const devices: LiveDevice[] = [];
    const orphaned: string[] = [];

    deviceIds.forEach((id, i) => {
      const devEntry = results?.[i * 3];
      const nameEntry = results?.[i * 3 + 1];
      const newWinEntry = results?.[i * 3 + 2];
      const err = devEntry?.[0];
      const h = (devEntry?.[1] ?? null) as Record<string, string> | null;
      if (err || !h || Object.keys(h).length === 0) {
        orphaned.push(id);
        return;
      }
      const names = (nameEntry?.[1] ?? null) as Record<string, string> | null;
      // ABSENT/anything-but-"0" ⇒ shared (the default); overlay false ONLY on "0".
      const newWindowsShared = (newWinEntry?.[1] ?? null) !== "0";
      devices.push(
        hashToDevice(userId, id, h, now, this.encryptionSecret, names, newWindowsShared),
      );
    });

    if (orphaned.length > 0) await this.redis.command.zrem(ik, ...orphaned);
    return devices;
  }

  // ── delete / purge ────────────────────────────────────────────────────────
  async deleteDevice(userId: string, deviceId: string): Promise<void> {
    await this.redis.command
      .multi()
      .del(devKey(userId, deviceId))
      .del(winNamesKey(userId, deviceId))
      .del(newWindowsKey(userId, deviceId))
      .zrem(indexKey(userId), deviceId)
      .exec();
    await this.publish(userId, { type: "delete", deviceId });
  }

  async deleteAllDevices(userId: string): Promise<void> {
    const ik = indexKey(userId);
    const ids = await this.redis.command.zrange(ik, 0, -1);
    const multi = this.redis.command.multi();
    for (const id of ids) {
      multi.del(devKey(userId, id));
      multi.del(winNamesKey(userId, id));
      multi.del(newWindowsKey(userId, id));
    }
    multi.del(ik);
    await multi.exec();
    await this.publish(userId, { type: "reset" });
  }

  // ── pub/sub ───────────────────────────────────────────────────────────────
  async publish(userId: string, event: LiveEvent): Promise<void> {
    await this.redis.command.publish(channelKey(userId), JSON.stringify(event));
  }

  /** Subscribe an SSE stream to a user's channel. Returns an unsubscribe fn. */
  subscribe(userId: string, handler: (event: LiveEvent) => void): () => void {
    return this.redis.subscriptions.subscribe(channelKey(userId), (payload) => {
      let event: LiveEvent;
      try {
        event = JSON.parse(payload) as LiveEvent;
      } catch {
        return;
      }
      handler(event);
    });
  }
}

/**
 * Minimal structural guard for ONE stored window. A `windowsJson` value that is
 * valid JSON but the WRONG SHAPE must not reach the winnames overlay (assigning
 * `.name` onto a number/null throws in strict-mode ESM) or the response-schema
 * validation in routes/list (a zod throw 500s the whole user's GET /live, taking
 * their HEALTHY devices down with the corrupt one). Deliberately checks only what
 * those two steps need — object-ness, an integer `windowId`, and tabs that are
 * objects with a string `url` — rather than re-implementing `liveWindowSchema`,
 * which would just be a second copy to drift.
 */
function isRenderableWindow(value: unknown): value is LiveWindow {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const w = value as Record<string, unknown>;
  if (!Number.isInteger(w.windowId)) return false;
  if (w.name !== undefined && w.name !== null && typeof w.name !== "string") return false;
  if (w.focused !== undefined && typeof w.focused !== "boolean") return false;
  if (!Array.isArray(w.tabs)) return false;
  return w.tabs.every((t) => {
    if (typeof t !== "object" || t === null || Array.isArray(t)) return false;
    const tab = t as Record<string, unknown>;
    return (
      typeof tab.url === "string" && (tab.title === undefined || typeof tab.title === "string")
    );
  });
}

/**
 * Parse a stored `windowsJson` into windows that are SAFE to render, never throwing.
 * Covers every hostile/corrupt shape a Redis value can hold: not JSON, a non-array
 * (`null`, `{"a":1}`), an array of non-objects (`[1,2,3]`), or ciphertext this key
 * cannot open. Bad WINDOWS are dropped individually so one wrecked entry does not
 * blank a device that still has good windows; a bad TOP LEVEL yields zero windows.
 */
function parseStoredWindows(
  stored: string,
  aad: string,
  secretB64: string | undefined,
): LiveWindow[] {
  try {
    // windowsJson is stored encrypted; decryptWindows never throws — it returns the
    // plaintext JSON, passes legacy plaintext through, or yields "[]" on a bad/rotated/
    // wrong-owner payload so a corrupt snapshot renders as zero windows rather than 500ing.
    const parsed: unknown = JSON.parse(decryptWindows(stored, aad, secretB64));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRenderableWindow);
  } catch {
    return [];
  }
}

/** Stored counter → a non-negative integer the response schema will accept. */
function toCount(raw: string | undefined): number {
  const n = Number(raw ?? "0");
  return Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
}

function hashToDevice(
  userId: string,
  deviceId: string,
  h: Record<string, string>,
  now: number,
  secretB64: string | undefined,
  names?: Record<string, string> | null,
  newWindowsShared = true,
): LiveDevice {
  // AAD binds the ciphertext to this (user, device) slot — a hash copied from
  // another device fails the GCM check and degrades to zero windows.
  const windows = parseStoredWindows(
    h.windowsJson ?? "[]",
    windowsAad(userId, deviceId),
    secretB64,
  );

  // Overlay user-set window names. Match by the windowId's string form (the same
  // key the rename route stored). Stale entries for windowIds no longer present
  // are simply not applied. Non-empty only — an empty stored value = no override.
  // Every `w` here passed `isRenderableWindow`, so the assignment cannot throw.
  if (names) {
    for (const w of windows) {
      const override = names[String(w.windowId)];
      if (override) w.name = override;
    }
  }
  // Same defence as the windows guard, one field over: a corrupt/non-ISO
  // `lastSeenAt` or a non-numeric `tabCount` would fail the response schema in
  // routes/list and 500 the WHOLE user's read. Degrade the single bad field instead.
  const seenMs = Date.parse(h.lastSeenAt ?? "");
  const valid = !Number.isNaN(seenMs);
  // Re-serialized (not passed through) so the value always satisfies the response
  // schema's `.datetime()`; for anything our own writer stored it is byte-identical.
  const lastSeenAt = new Date(valid ? seenMs : now).toISOString();
  const ageSeconds = valid ? Math.max(0, Math.floor((now - seenMs) / 1000)) : 0;

  return {
    deviceId,
    label: h.label ?? "",
    browser: (h.browser ?? "other") as LiveDevice["browser"],
    device: (h.device ?? "other") as LiveDevice["device"],
    os: h.os ? h.os : null,
    windows,
    tabCount: toCount(h.tabCount),
    hiddenTabCount: toCount(h.hiddenTabCount),
    lastSeenAt,
    lastSeenAgeSeconds: ageSeconds,
    // Only overlay the explicit opt-out; absent (default true) stays undefined so
    // the wire payload matches "absent = shared".
    ...(newWindowsShared ? {} : { newWindowsShared: false }),
  };
}
