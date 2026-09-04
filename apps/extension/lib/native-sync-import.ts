/**
 * Native-sync BACKFILL gate — the cross-browser stand-in for Chrome's
 * `bookmarks.onImportBegan/onImportEnded`.
 *
 * Chrome brackets a bookmark import with those two events, and lib/native-sync.ts
 * ignores every `onCreated` between them so an import of 2,000 old bookmarks
 * doesn't become 2,000 API saves (and burn the quota). Firefox never implemented
 * either event — so on Firefox an import (Library → Import, the migration wizard
 * from Chrome/Safari, a bookmarks.html restore) or a Firefox Sync backfill fired
 * `onCreated` per node straight into the mirror. Observed 2026-09-03: a fresh
 * Firefox profile's own bookmark seed mirrored itself as four saves within
 * seconds of install.
 *
 * The tell that works everywhere: a node the browser tells us about NOW but that
 * was created long ago. Every importer/restore/sync preserves the original
 * `dateAdded`; a bookmark the user just made (Ctrl/Cmd+D, drag to the toolbar,
 * "bookmark all tabs") carries `dateAdded ≈ now`. Anything older than
 * `BACKFILL_MAX_AGE_MS` at notification time is treated as backfill and skipped —
 * additive default, so a skipped node only means "no saved copy", never data loss.
 * Unknown/absent/future timestamps are treated as live (mirror as before).
 *
 * Pure — no `wxt/browser` import — so it is unit-testable in plain node.
 */

/** Older than this at `onCreated` time ⇒ import/restore/sync backfill, not a live add. */
export const BACKFILL_MAX_AGE_MS = 60_000;

export function isBackfilledNode(
  dateAdded: number | undefined,
  now: number = Date.now(),
  maxAgeMs: number = BACKFILL_MAX_AGE_MS,
): boolean {
  if (typeof dateAdded !== "number" || !Number.isFinite(dateAdded)) return false;
  return now - dateAdded > maxAgeMs;
}
