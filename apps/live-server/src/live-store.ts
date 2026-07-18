import type { LiveDevice, LiveWindow, PushLiveStateInput } from "@bookmark-ai/types";
import type { Config } from "./config";
import { channelKey, devKey, enabledKey, indexKey, quotaKey } from "./keys";
import type { RedisBundle } from "./redis";
import type { LiveEvent } from "./types";

const QUOTA_TTL_SECONDS = 26 * 60 * 60; // > 24h so the counter self-cleans past UTC midnight

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

  constructor(
    private readonly redis: RedisBundle,
    config: Config,
  ) {
    this.ttlSeconds = config.ttlSeconds;
    this.quota = config.pushQuotaPerDay;
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
   * Apply one checkpoint. A HEARTBEAT (input.windows === undefined) only refreshes
   * liveness + TTL and leaves the stored windows untouched — and is a NO-OP if no
   * snapshot exists yet, so it can never create a windowless ghost. A FULL PUSH
   * (windows present, including `[]` = "all windows closed") replaces windowsJson.
   * Every write is one MULTI so a device is never observed half-updated.
   */
  async writeSnapshot(userId: string, input: PushLiveStateInput): Promise<void> {
    const now = Date.now();
    const nowIso = new Date(now).toISOString();
    const dk = devKey(userId, input.deviceId);
    const ik = indexKey(userId);

    if (input.windows === undefined) {
      const exists = await this.redis.command.exists(dk);
      if (!exists) return;
      await this.redis.command
        .multi()
        .hset(dk, "lastSeenAt", nowIso)
        .zadd(ik, now, input.deviceId)
        .expire(dk, this.ttlSeconds)
        .exec();
      return;
    }

    const windows = input.windows;
    const tabCount = windows.reduce((sum, w) => sum + w.tabs.length, 0);
    await this.redis.command
      .multi()
      .hset(dk, {
        label: input.label ?? "",
        browser: input.browser,
        device: input.device,
        os: input.os ?? "",
        windowsJson: JSON.stringify(windows),
        tabCount: String(tabCount),
        hiddenTabCount: String(input.hiddenTabCount),
        capturedAt: input.capturedAt,
        lastSeenAt: nowIso,
      })
      .hsetnx(dk, "createdAt", nowIso)
      .zadd(ik, now, input.deviceId)
      .expire(dk, this.ttlSeconds)
      .exec();
  }

  // ── read ──────────────────────────────────────────────────────────────────
  /** ZSET (newest first) → pipelined HGETALL → drop index members whose hash
   * TTL'd out (lazy GC) → map, computing lastSeenAgeSeconds server-side. */
  async listDevices(userId: string): Promise<LiveDevice[]> {
    const ik = indexKey(userId);
    const deviceIds = await this.redis.command.zrevrange(ik, 0, -1);
    if (deviceIds.length === 0) return [];

    const pipeline = this.redis.command.pipeline();
    for (const id of deviceIds) pipeline.hgetall(devKey(userId, id));
    const results = await pipeline.exec();

    const now = Date.now();
    const devices: LiveDevice[] = [];
    const orphaned: string[] = [];

    results?.forEach(([err, hash], i) => {
      const id = deviceIds[i];
      if (id === undefined) return;
      const h = hash as Record<string, string> | null;
      if (err || !h || Object.keys(h).length === 0) {
        orphaned.push(id);
        return;
      }
      devices.push(hashToDevice(id, h, now));
    });

    if (orphaned.length > 0) await this.redis.command.zrem(ik, ...orphaned);
    return devices;
  }

  // ── delete / purge ────────────────────────────────────────────────────────
  async deleteDevice(userId: string, deviceId: string): Promise<void> {
    await this.redis.command
      .multi()
      .del(devKey(userId, deviceId))
      .zrem(indexKey(userId), deviceId)
      .exec();
    await this.publish(userId, { type: "delete", deviceId });
  }

  async deleteAllDevices(userId: string): Promise<void> {
    const ik = indexKey(userId);
    const ids = await this.redis.command.zrange(ik, 0, -1);
    const multi = this.redis.command.multi();
    for (const id of ids) multi.del(devKey(userId, id));
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

function hashToDevice(deviceId: string, h: Record<string, string>, now: number): LiveDevice {
  let windows: LiveWindow[] = [];
  try {
    windows = JSON.parse(h.windowsJson ?? "[]") as LiveWindow[];
  } catch {
    windows = [];
  }
  const lastSeenAt = h.lastSeenAt ?? new Date(now).toISOString();
  const seenMs = Date.parse(lastSeenAt);
  const ageSeconds = Number.isNaN(seenMs) ? 0 : Math.max(0, Math.floor((now - seenMs) / 1000));

  return {
    deviceId,
    label: h.label ?? "",
    browser: (h.browser ?? "other") as LiveDevice["browser"],
    device: (h.device ?? "other") as LiveDevice["device"],
    os: h.os ? h.os : null,
    windows,
    tabCount: Number(h.tabCount ?? "0"),
    hiddenTabCount: Number(h.hiddenTabCount ?? "0"),
    lastSeenAt,
    lastSeenAgeSeconds: ageSeconds,
  };
}
