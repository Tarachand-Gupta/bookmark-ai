import type { LiveDevice, PushLiveStateInput } from "@bookmark-ai/types";
import {
  deleteAllDevices,
  deleteDevice,
  getDevice,
  getLiveSettings,
  listDevices,
  reapExpiredDevices,
  setLiveSettings,
  upsertDeviceSnapshot,
  type Db,
  type LiveDeviceRow,
} from "@bookmark-ai/db";

/**
 * Retention (§5.6, owner decision 2026-07-17). Governs a device that STOPS
 * reporting — never an individual window (§4.2.2). Derived from `last_seen_at`,
 * so it can change without a migration.
 */
export const LIVE_TTL_DAYS = 7;
const LIVE_TTL_MS = LIVE_TTL_DAYS * 24 * 60 * 60 * 1000;
const LIVE_TTL_HOURS = LIVE_TTL_DAYS * 24;

/**
 * Per-device daily push cap (§4.6). A containment bound on a runaway or
 * compromised build, not a billing lever — ~1 push/43s, far above the real
 * cadence, so only a misbehaving client trips it. Metered in-row (push_day/
 * push_count), never through the master DB.
 */
const PUSH_QUOTA_PER_DAY = 2000;

/** Open/self-host mode has no Clerk user; collapse to the `local` sentinel (§4.3). */
function settingsKey(userId: string | null): string {
  return userId ?? "local";
}

export type ApplyDeviceSnapshotResult =
  | { ok: true }
  | { ok: false; reason: "disabled" }
  | { ok: false; reason: "quota" };

/**
 * Apply one checkpoint push. Refuses when the account flag is off ("disabled" →
 * the route 403s), enforces the in-row daily quota ("quota" → 429), server-stamps
 * `last_seen_at` (freshness is NEVER the client's `capturedAt` — §4.4), then does
 * the single upsert. Reaps expired peers in the same path as free GC (§4.2.3).
 */
export async function applyDeviceSnapshot(
  db: Db,
  userId: string | null,
  input: PushLiveStateInput,
): Promise<ApplyDeviceSnapshotResult> {
  const enabled = await getLiveSettings(db, settingsKey(userId));
  if (!enabled) return { ok: false, reason: "disabled" };

  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const pushDay = nowIso.slice(0, 10);

  const existing = await getDevice(db, input.deviceId);
  const usedToday = existing && existing.pushDay === pushDay ? existing.pushCount : 0;
  if (usedToday >= PUSH_QUOTA_PER_DAY) return { ok: false, reason: "quota" };

  const windows = input.windows ?? null;
  const tabCount = windows ? windows.reduce((sum, w) => sum + w.tabs.length, 0) : 0;

  await upsertDeviceSnapshot(db, {
    deviceId: input.deviceId,
    label: input.label ?? "",
    browser: input.browser,
    device: input.device,
    os: input.os ?? null,
    windows,
    tabCount,
    hiddenTabCount: input.hiddenTabCount,
    capturedAt: input.capturedAt,
    lastSeenAt: nowIso,
    pushDay,
    createdAt: nowIso,
  });

  await reapExpiredDevices(db, new Date(now - LIVE_TTL_MS).toISOString());

  return { ok: true };
}

/**
 * The reader view (§4.3). Gates on the account flag — off returns no devices
 * regardless of table contents (§5.7) — TTL-filters, and computes each device's
 * `lastSeenAgeSeconds` server-side (clamped ≥ 0), so no client ever subtracts its
 * own clock (§4.4).
 */
export async function listLiveDevices(
  db: Db,
  userId: string | null,
): Promise<{ devices: LiveDevice[]; enabled: boolean; ttlHours: number }> {
  const enabled = await getLiveSettings(db, settingsKey(userId));
  if (!enabled) return { devices: [], enabled: false, ttlHours: LIVE_TTL_HOURS };

  const now = Date.now();
  const cutoff = new Date(now - LIVE_TTL_MS).toISOString();
  const rows = await listDevices(db, cutoff);
  return {
    devices: rows.map((r) => toLiveDevice(r, now)),
    enabled: true,
    ttlHours: LIVE_TTL_HOURS,
  };
}

/** Forget one device — idempotent (§4.3). */
export async function deleteLiveDevice(db: Db, deviceId: string): Promise<boolean> {
  return deleteDevice(db, deviceId);
}

export async function getLiveEnabled(db: Db, userId: string | null): Promise<boolean> {
  return getLiveSettings(db, settingsKey(userId));
}

/** Set the account flag. Turning it OFF purges every device in the same call (§5.7). */
export async function setLiveEnabled(
  db: Db,
  userId: string | null,
  enabled: boolean,
): Promise<void> {
  await setLiveSettings(db, settingsKey(userId), enabled);
  if (!enabled) await deleteAllDevices(db);
}

function toLiveDevice(row: LiveDeviceRow, now: number): LiveDevice {
  return {
    deviceId: row.deviceId,
    label: row.label,
    browser: row.browser,
    device: row.device,
    os: row.os,
    windows: row.windows,
    tabCount: row.tabCount,
    hiddenTabCount: row.hiddenTabCount,
    lastSeenAt: row.lastSeenAt,
    lastSeenAgeSeconds: ageSeconds(now, row.lastSeenAt),
  };
}

function ageSeconds(now: number, lastSeenAt: string): number {
  const seen = new Date(lastSeenAt).getTime();
  if (Number.isNaN(seen)) return 0;
  return Math.max(0, Math.floor((now - seen) / 1000));
}
