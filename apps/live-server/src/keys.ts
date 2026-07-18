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
