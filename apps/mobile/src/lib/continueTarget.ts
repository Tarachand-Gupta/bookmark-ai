import type { Bookmark, LiveDevice, SessionSummary } from "@bookmark-ai/types";

/**
 * "Continue where you left off" — the single best resume target
 * (docs/features/dashboard.md §3.2 / §4.2; mobile shows the winner only, no
 * runner-up). Ranked client-side because the winner depends on live-device data
 * that arrives on its own stream, separately from the dashboard payload.
 *
 * Order is strict, not scored: a browser that is (or just was) open beats a
 * frozen snapshot, which beats "here's what you saved on your laptop".
 */
export type ContinueTarget =
  | { kind: "live"; device: LiveDevice }
  | { kind: "session"; session: SessionSummary }
  | { kind: "bookmark"; bookmark: Bookmark };

export function pickContinueTarget({
  devices,
  sessions,
  otherDeviceBookmarks,
}: {
  /** Live devices, or [] when live sessions are off/unreachable — Home never
   * shows a live failure, it just falls through to the next candidate. */
  devices: LiveDevice[];
  sessions: SessionSummary[];
  otherDeviceBookmarks: Bookmark[];
}): ContinueTarget | null {
  // 1. The most recently seen live device (server-computed age — never a local
  //    clock read, see lib/live.ts). Devices with no tabs mirrored are useless
  //    as a resume target, so they don't count.
  const live = devices
    .filter((d) => d.tabCount > 0)
    .reduce<LiveDevice | null>(
      (best, d) => (best === null || d.lastSeenAgeSeconds < best.lastSeenAgeSeconds ? d : best),
      null,
    );
  if (live) return { kind: "live", device: live };

  // 2. The newest saved session. Sorted defensively — the endpoint already
  //    returns newest-first, but the winner must not depend on that.
  const session = sessions.reduce<SessionSummary | null>(
    (best, s) => (best === null || s.savedAt > best.savedAt ? s : best),
    null,
  );
  if (session) return { kind: "session", session };

  // 3. The newest save made on some OTHER device (a phone resuming a laptop
  //    read). Same defensive sort.
  const bookmark = otherDeviceBookmarks.reduce<Bookmark | null>(
    (best, b) => (best === null || b.source.savedAt > best.source.savedAt ? b : best),
    null,
  );
  if (bookmark) return { kind: "bookmark", bookmark };

  return null;
}
