import type { LiveDevice } from "@bookmark-ai/types";
import { formatEvent } from "./sse";
import type { LiveEvent } from "./types";

/**
 * Per-USER SSE fan-out coordinator. Sits between the store's Redis pub/sub and the
 * connected SSE sockets and does two things the naive "every event → every
 * connection re-reads and re-serializes" path cannot:
 *
 *  1. COALESCING. A pub/sub event does not fan out immediately: it arms (or joins)
 *     a per-user trailing timer of `coalesceMs`. Further events for that user
 *     inside the window collapse into it. When it fires we do ONE `listDevices`
 *     read + ONE serialize and write that single frame to ALL of the user's
 *     sockets — so N viewers × M burst events becomes 1 read + 1 serialize + N
 *     writes. Delete/reset events ride the same window (the full re-read reflects
 *     them). The initial connect frame is sent immediately by the stream route and
 *     never routed through here.
 *
 *  2. VIEWER-GATED REFRESH. `lastSeenAgeSeconds` is computed server-side per read,
 *     so an idle device that only heartbeats (heartbeats no longer fan out) would
 *     otherwise appear to go stale in open viewers. While ≥1 viewer is connected we
 *     re-emit a fresh coalesced frame every `refreshEmitMs`, skipping the tick when
 *     a frame already went out within that window (no double work on busy channels).
 *     With no viewers there is no group and thus zero cost.
 *
 * A group holds exactly ONE store subscription (the store's SubscriptionManager
 * ref-counts to a single Redis SUB per channel) and is torn down — subscription,
 * coalesce timer, and refresh interval all cleared — when its last viewer leaves or
 * on server shutdown, so nothing leaks.
 */

/** One connected SSE socket, as a sink for a pre-serialized frame. */
export type SseSink = (frame: string) => void;

/** The slice of `LiveStore` the fan-out needs (structural, so tests can fake it). */
export interface FanoutStore {
  getEnabled(userId: string): Promise<boolean>;
  listDevices(userId: string): Promise<LiveDevice[]>;
  subscribe(userId: string, handler: (event: LiveEvent) => void): () => void;
}

export interface FanoutOptions {
  coalesceMs: number;
  refreshEmitMs: number;
  ttlHours: number;
}

interface UserGroup {
  clients: Set<SseSink>;
  unsubscribe: () => void;
  coalesceTimer: NodeJS.Timeout | null;
  refreshTimer: NodeJS.Timeout;
  /** ms epoch of the last frame broadcast to this group (seeds at creation). */
  lastEmitAt: number;
}

export class LiveFanout {
  private readonly groups = new Map<string, UserGroup>();
  private readonly coalesceMs: number;
  private readonly refreshEmitMs: number;
  private readonly ttlHours: number;

  constructor(
    private readonly store: FanoutStore,
    opts: FanoutOptions,
  ) {
    this.coalesceMs = opts.coalesceMs;
    this.refreshEmitMs = opts.refreshEmitMs;
    this.ttlHours = opts.ttlHours;
  }

  /**
   * Attach one SSE socket to its user's group (creating the group + its single
   * store subscription + refresh interval on the first viewer). Returns a cleanup
   * fn that detaches it and tears the group down once the last viewer leaves.
   */
  join(userId: string, sink: SseSink): () => void {
    let group = this.groups.get(userId);
    if (!group) {
      const refreshTimer = setInterval(() => this.tick(userId), this.refreshEmitMs);
      refreshTimer.unref?.(); // never keep the process alive for the refresh loop
      group = {
        clients: new Set(),
        unsubscribe: () => {},
        coalesceTimer: null,
        refreshTimer,
        lastEmitAt: Date.now(),
      };
      this.groups.set(userId, group);
      // Register the ONE handler after the group exists so a same-tick event schedules.
      group.unsubscribe = this.store.subscribe(userId, () => this.schedule(userId));
    }
    group.clients.add(sink);
    return () => this.leave(userId, sink);
  }

  /** Clear every group's timers + subscriptions (server shutdown). */
  closeAll(): void {
    for (const group of this.groups.values()) {
      if (group.coalesceTimer) clearTimeout(group.coalesceTimer);
      clearInterval(group.refreshTimer);
      group.unsubscribe();
    }
    this.groups.clear();
  }

  /** Number of live groups — for tests/introspection. */
  get activeUserCount(): number {
    return this.groups.size;
  }

  // ── internals ───────────────────────────────────────────────────────────────

  private leave(userId: string, sink: SseSink): void {
    const group = this.groups.get(userId);
    if (!group) return;
    group.clients.delete(sink);
    if (group.clients.size > 0) return;
    if (group.coalesceTimer) clearTimeout(group.coalesceTimer);
    clearInterval(group.refreshTimer);
    group.unsubscribe();
    this.groups.delete(userId);
  }

  /** Arm the trailing coalesce window (no-op if one is already pending). */
  private schedule(userId: string): void {
    const group = this.groups.get(userId);
    if (!group || group.coalesceTimer) return;
    const timer = setTimeout(() => {
      const g = this.groups.get(userId);
      if (g) g.coalesceTimer = null;
      void this.flush(userId);
    }, this.coalesceMs);
    timer.unref?.();
    group.coalesceTimer = timer;
  }

  /** Periodic refresh tick — emit only if nothing went out within the last window. */
  private tick(userId: string): void {
    const group = this.groups.get(userId);
    if (!group || group.clients.size === 0) return;
    if (Date.now() - group.lastEmitAt < this.refreshEmitMs) return;
    void this.flush(userId);
  }

  /** ONE read + ONE serialize → write the same frame to every socket in the group. */
  private async flush(userId: string): Promise<void> {
    if (!this.groups.has(userId)) return;
    let frame: string;
    try {
      const enabled = await this.store.getEnabled(userId);
      const devices = enabled ? await this.store.listDevices(userId) : [];
      frame = formatEvent("state", { devices, enabled, ttlHours: this.ttlHours });
    } catch {
      return; // transient read error — the next event or the client's reconnect recovers
    }
    const group = this.groups.get(userId);
    if (!group || group.clients.size === 0) return; // torn down while awaiting
    group.lastEmitAt = Date.now();
    for (const sink of group.clients) {
      try {
        sink(frame);
      } catch {
        // a dead socket is removed by its own close handler → leave(); don't let it
        // block delivery to the rest of the group.
      }
    }
  }
}
