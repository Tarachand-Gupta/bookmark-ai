import type { LiveWindow } from "@bookmark-ai/types";
import type { Db } from "../client";
import { LIVE_DEVICE_COLUMNS, rowToLiveDevice, type LiveDeviceRow } from "../rows";

export type { LiveDeviceRow } from "../rows";

export interface UpsertDeviceSnapshot {
  deviceId: string;
  label: string;
  browser: string;
  device: string;
  os: string | null;
  /** `null` = heartbeat: leave windows_json/tab_count/hidden_tab_count untouched. */
  windows: LiveWindow[] | null;
  tabCount: number;
  hiddenTabCount: number;
  /** Client clock — display metadata only (§4.4). */
  capturedAt: string;
  /** SERVER-stamped. The only freshness source; never `capturedAt` (§4.4). */
  lastSeenAt: string;
  /** Server-computed YYYY-MM-DD, for the in-row daily quota (§4.6). */
  pushDay: string;
  createdAt: string;
}

/**
 * The checkpoint upsert — one hop, no read-back (§4.3). `push_count` is kept in
 * row via the CASE (reset when the day rolls over). A heartbeat (windows === null)
 * omits windows_json/tab_count/hidden_tab_count from the SET so the mirror is
 * left alone. There is deliberately NO captured_at ordering guard — a skewed
 * client clock would freeze its own mirror forever (§4.3).
 */
export async function upsertDeviceSnapshot(db: Db, s: UpsertDeviceSnapshot): Promise<void> {
  const heartbeat = s.windows === null;
  // Exact SET list from §4.3: browser/device/os are insert-only (immutable per
  // device install); only `label` is user-mutable. A heartbeat additionally omits
  // windows_json/tab_count/hidden_tab_count so the mirror is left untouched.
  const setClauses = [
    "label            = excluded.label",
    ...(heartbeat
      ? []
      : [
          "windows_json     = excluded.windows_json",
          "tab_count        = excluded.tab_count",
          "hidden_tab_count = excluded.hidden_tab_count",
        ]),
    "captured_at      = excluded.captured_at",
    "last_seen_at     = excluded.last_seen_at",
    "push_day         = excluded.push_day",
    `push_count       = CASE WHEN live_devices.push_day = excluded.push_day
                            THEN live_devices.push_count + 1 ELSE 1 END`,
  ];
  await db.execute({
    sql: `INSERT INTO live_devices (device_id, label, browser, device, os, windows_json,
                                    tab_count, hidden_tab_count, captured_at, last_seen_at,
                                    push_day, push_count, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?)
          ON CONFLICT(device_id) DO UPDATE SET
            ${setClauses.join(",\n            ")}`,
    args: [
      s.deviceId,
      s.label,
      s.browser,
      s.device,
      s.os,
      JSON.stringify(s.windows ?? []),
      s.tabCount,
      s.hiddenTabCount,
      s.capturedAt,
      s.lastSeenAt,
      s.pushDay,
      s.createdAt,
    ],
  });
}

/** Devices last seen after `notBefore` (the TTL cutoff), freshest first (§4.2.3). */
export async function listDevices(db: Db, notBefore: string): Promise<LiveDeviceRow[]> {
  const rs = await db.execute({
    sql: `SELECT ${LIVE_DEVICE_COLUMNS} FROM live_devices
          WHERE last_seen_at > ? ORDER BY last_seen_at DESC`,
    args: [notBefore],
  });
  return rs.rows.map(rowToLiveDevice);
}

export async function getDevice(db: Db, deviceId: string): Promise<LiveDeviceRow | null> {
  const rs = await db.execute({
    sql: `SELECT ${LIVE_DEVICE_COLUMNS} FROM live_devices WHERE device_id = ?`,
    args: [deviceId],
  });
  const row = rs.rows[0];
  return row ? rowToLiveDevice(row) : null;
}

export async function deleteDevice(db: Db, deviceId: string): Promise<boolean> {
  const rs = await db.execute({
    sql: "DELETE FROM live_devices WHERE device_id = ?",
    args: [deviceId],
  });
  return rs.rowsAffected > 0;
}

/** Purge every device — used when the account flag is turned off (§5.7). */
export async function deleteAllDevices(db: Db): Promise<void> {
  await db.execute("DELETE FROM live_devices");
}

/** Free GC in the push path: drop devices past the TTL cutoff (§4.2.3). */
export async function reapExpiredDevices(db: Db, notAfter: string): Promise<void> {
  await db.execute({
    sql: "DELETE FROM live_devices WHERE last_seen_at <= ?",
    args: [notAfter],
  });
}

/** The account opt-in flag. Absent row = off — privacy by default (§5.1). */
export async function getLiveSettings(db: Db, userId: string): Promise<boolean> {
  const rs = await db.execute({
    sql: "SELECT enabled FROM live_settings WHERE user_id = ?",
    args: [userId],
  });
  const row = rs.rows[0];
  return row ? Boolean(Number(row.enabled)) : false;
}

export async function setLiveSettings(db: Db, userId: string, enabled: boolean): Promise<void> {
  await db.execute({
    sql: `INSERT INTO live_settings (user_id, enabled, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            enabled    = excluded.enabled,
            updated_at = excluded.updated_at`,
    args: [userId, enabled ? 1 : 0, new Date().toISOString()],
  });
}
