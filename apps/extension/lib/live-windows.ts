import { storage } from "#imports";

/**
 * Per-window sharing decisions for Live Sessions, resolved against a per-DEVICE
 * default policy.
 *
 * Two pieces of durable state:
 *  - `liveWindowOverrides` — a map of windowId → explicit user choice made in the
 *    popup's "Share this window" switch. An entry here WINS over the policy.
 *  - `liveNewWindowsShared` — a MIRROR of this device's server-side policy
 *    ("Enable live session on any new window", default ON), refreshed from every
 *    push response. A window with NO override falls back to this.
 *
 * So the decision is: shared(windowId) = overrides[windowId] ?? policy.
 *
 * Window ids are SESSION-SCOPED: the browser mints fresh ids every launch and
 * never restores the old ones, so after a restart no override matches and every
 * window follows the policy again. That is intended — an override is a "this
 * window, right now" choice, not a durable per-machine setting — so we do NOT try
 * to persist overrides across restarts. The map still lives in storage.local (not
 * a worker global) so it survives the MV3 worker being killed mid-session;
 * `pruneWindowOverrides` drops entries whose windows have since closed.
 */
const windowOverridesItem = storage.defineItem<Record<number, boolean>>(
  "local:liveWindowOverrides",
  { fallback: {} },
);

/**
 * This device's new-window policy, mirrored from the push response on every push.
 * Fallback true: an unconfigured device shares new windows, matching the server
 * default (absent policy key ⇒ on). The web app is the source of truth; this is
 * a read-through cache the popup and the checkpoint loop consult offline.
 */
const newWindowsSharedItem = storage.defineItem<boolean>("local:liveNewWindowsShared", {
  fallback: true,
});

/**
 * LEGACY (shipped minutes ago): the old pure per-window exclusion list. Read once
 * at boot and folded into `overrides` as explicit `false` entries, then removed —
 * so a window the user had just opted out of stays opted out across the semantics
 * change within the same browser session.
 */
const legacyExcludedItem = storage.defineItem<number[]>("local:liveExcludedWindows", {
  fallback: [],
});

/** The device policy mirror (fallback true). */
export function getNewWindowsPolicy(): Promise<boolean> {
  return newWindowsSharedItem.getValue();
}

/** Update the device-policy mirror from a push response. Skips a no-op write. */
export async function setNewWindowsPolicy(shared: boolean): Promise<void> {
  if ((await newWindowsSharedItem.getValue()) === shared) return;
  await newWindowsSharedItem.setValue(shared);
}

/** Pure decision: an explicit per-window override wins, else the device policy. */
export function resolveWindowShared(
  overrides: Record<number, boolean>,
  policy: boolean,
  windowId: number | undefined,
): boolean {
  if (typeof windowId === "number" && windowId in overrides) return overrides[windowId]!;
  return policy;
}

/** True when `windowId`'s tabs should be pushed: its override, else the policy. */
export async function isWindowShared(windowId: number): Promise<boolean> {
  const [overrides, policy] = await Promise.all([
    windowOverridesItem.getValue(),
    newWindowsSharedItem.getValue(),
  ]);
  return resolveWindowShared(overrides, policy, windowId);
}

/**
 * Record an explicit per-window choice from the popup switch. Always writes an
 * override (a deliberate user choice), even when it happens to match the current
 * policy, so a later policy flip can't silently reverse it. Skips a no-op write.
 */
export async function setWindowShared(windowId: number, shared: boolean): Promise<void> {
  const overrides = await windowOverridesItem.getValue();
  if (overrides[windowId] === shared) return;
  await windowOverridesItem.setValue({ ...overrides, [windowId]: shared });
}

/**
 * Treat every window OPEN right now as an existing shared window by writing an
 * explicit `true` override for each. Called when live is enabled so turning it on
 * actually shows something even if this device's policy is OFF; windows created
 * AFTER carry no override and follow the policy. A no-op when the set is empty or
 * nothing changes.
 */
export async function overrideExistingWindowsShared(windowIds: number[]): Promise<void> {
  if (windowIds.length === 0) return;
  const overrides = await windowOverridesItem.getValue();
  const next = { ...overrides };
  let changed = false;
  for (const id of windowIds) {
    if (next[id] !== true) {
      next[id] = true;
      changed = true;
    }
  }
  if (changed) await windowOverridesItem.setValue(next);
}

/**
 * Drop any override whose window is no longer open. Called during state collection
 * (the full scan already enumerates every window, so `existingIds` is free), so the
 * map can't grow stale as windows close. Returns the surviving map so the caller
 * can filter the same scan without a second read.
 */
export async function pruneWindowOverrides(
  existingIds: number[],
): Promise<Record<number, boolean>> {
  const overrides = await windowOverridesItem.getValue();
  const open = new Set(existingIds);
  const pruned: Record<number, boolean> = {};
  let changed = false;
  for (const [key, value] of Object.entries(overrides)) {
    const id = Number(key);
    if (open.has(id)) pruned[id] = value;
    else changed = true;
  }
  if (changed) await windowOverridesItem.setValue(pruned);
  return pruned;
}

/**
 * One-time migration of the old exclusion list into the override map (as `false`
 * entries), then remove the legacy item. Idempotent — after the first run the
 * legacy item is gone, so subsequent calls are a cheap empty-read + remove.
 */
export async function migrateLegacyExclusions(): Promise<void> {
  const legacy = await legacyExcludedItem.getValue();
  if (legacy.length === 0) {
    await legacyExcludedItem.removeValue();
    return;
  }
  const overrides = await windowOverridesItem.getValue();
  const next = { ...overrides };
  for (const id of legacy) {
    if (!(id in next)) next[id] = false; // preserve the explicit opt-out
  }
  await windowOverridesItem.setValue(next);
  await legacyExcludedItem.removeValue();
}
