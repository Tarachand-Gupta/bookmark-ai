/**
 * Redis key builders, all namespaced by the Clerk `userId` (`sub`). The `{…}`
 * braces around the userId are a Redis Cluster HASH TAG: they force every key
 * for one user onto the same slot, so a future move to Cluster keeps the
 * per-user MGET/pipeline in `listDevices` working (all one user's keys co-locate).
 *
 * In open/self-host mode there is no Clerk user; callers pass the "local"
 * sentinel (mirrors the web app's engine `settingsKey`).
 */

export function devKey(userId: string, deviceId: string): string {
  return `live:{${userId}}:dev:${deviceId}`;
}

export function indexKey(userId: string): string {
  return `live:{${userId}}:index`;
}

export function enabledKey(userId: string): string {
  return `live:{${userId}}:enabled`;
}

/** Daily push counter, keyed per device per UTC day so it self-cleans on rollover. */
export function quotaKey(userId: string, deviceId: string, dayUtc: string): string {
  return `live:{${userId}}:quota:${deviceId}:${dayUtc}`;
}

/** Pub/sub channel a user's SSE streams subscribe to; publishers fan out here. */
export function channelKey(userId: string): string {
  return `live:{${userId}}:events`;
}

/** Per-device Hash of user-set window names (field = windowId, value = name).
 * Overlaid onto the device's windows on read; TTL'd alongside the device snapshot. */
export function winNamesKey(userId: string, deviceId: string): string {
  return `live:{${userId}}:winnames:${deviceId}`;
}

/**
 * Per-device "new windows join live sessions by default" policy. Holds "0" when
 * the policy is OFF; ABSENT = ON (the default). Deliberately carries NO TTL — a
 * preference must survive the 7-day snapshot TTL — but is deleted by
 * forget-one/forget-all alongside the winnames key.
 */
export function newWindowsKey(userId: string, deviceId: string): string {
  return `live:{${userId}}:newwin:${deviceId}`;
}
