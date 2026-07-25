import { storage } from "#imports";

/**
 * Per-window opt-OUT list for Live Sessions. The global live toggle
 * (`liveEnabledItem`) shares EVERY window of this device by default; this list
 * holds the window ids the user has explicitly EXCLUDED from the current
 * device's pushes. It is a denylist (not an allowlist) on purpose — that is what
 * makes a brand-new window shared automatically, giving the intended "on =
 * everything, minus what I opt out of" semantics.
 *
 * Window ids are SESSION-SCOPED: the browser mints fresh ids on every launch and
 * never restores the old ones, so after a browser restart every window is new
 * and therefore shared by default. That matches the intended behavior — an
 * exclusion is a "this window, right now" choice, not a durable per-machine
 * setting — so we deliberately do NOT try to persist exclusions across restarts.
 * The list still lives in storage.local (not a worker global) so it survives the
 * MV3 worker being killed mid-session; `pruneExcludedWindows` keeps it from
 * accumulating ids whose windows have since closed.
 */
const excludedWindowsItem = storage.defineItem<number[]>("local:liveExcludedWindows", {
  fallback: [],
});

/** The window ids the user has opted OUT of sharing on this device. */
export async function getExcludedWindowIds(): Promise<number[]> {
  return excludedWindowsItem.getValue();
}

/** True when `windowId` is currently excluded — its tabs must not be pushed. */
export async function isWindowExcluded(windowId: number): Promise<boolean> {
  return (await excludedWindowsItem.getValue()).includes(windowId);
}

/**
 * Include (`shared=true`) or exclude (`shared=false`) one window by adding it to
 * or removing it from the denylist. A write that wouldn't change the list is
 * skipped so re-affirming a window's current state doesn't churn storage.
 */
export async function setWindowShared(windowId: number, shared: boolean): Promise<void> {
  const current = await excludedWindowsItem.getValue();
  const has = current.includes(windowId);
  if (shared) {
    if (!has) return; // already shared — nothing on the denylist to remove
    await excludedWindowsItem.setValue(current.filter((id) => id !== windowId));
  } else {
    if (has) return; // already excluded
    await excludedWindowsItem.setValue([...current, windowId]);
  }
}

/**
 * Drop any excluded id whose window is no longer open. Called during state
 * collection (the full scan already enumerates every live window, so `existingIds`
 * is free), so the list can't grow stale as excluded windows are closed. Returns
 * the surviving list so the caller can filter the same scan without a second read.
 */
export async function pruneExcludedWindows(existingIds: number[]): Promise<number[]> {
  const current = await excludedWindowsItem.getValue();
  const open = new Set(existingIds);
  const pruned = current.filter((id) => open.has(id));
  if (pruned.length !== current.length) await excludedWindowsItem.setValue(pruned);
  return pruned;
}
