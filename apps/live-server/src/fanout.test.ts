import assert from "node:assert/strict";
import { test } from "node:test";
import type { LiveDevice } from "@bookmark-ai/types";
import { type FanoutStore, LiveFanout } from "./fanout";
import type { LiveEvent } from "./types";

/**
 * Fan-out coalescing + viewer-gated refresh tests. LiveFanout is exercised against
 * a fake store (structural FanoutStore) with SHORT real timers so we assert the
 * observable contract: one read + one broadcast frame per burst, one Redis
 * subscription per user, teardown on last leave, and a periodic fresh re-emit only
 * while viewers are connected. Run with `pnpm --filter @bookmark-ai/live-server test`.
 */

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

class FakeStore implements FanoutStore {
  listCalls = 0;
  enabled = true;
  ageSeconds = 5;
  private readonly handlers = new Map<string, Set<(e: LiveEvent) => void>>();

  async getEnabled(): Promise<boolean> {
    return this.enabled;
  }

  async listDevices(): Promise<LiveDevice[]> {
    this.listCalls++;
    return [
      {
        deviceId: "d1",
        label: "Laptop",
        browser: "chrome",
        device: "desktop",
        os: "macOS",
        windows: [],
        tabCount: 0,
        hiddenTabCount: 0,
        lastSeenAt: "2026-07-23T10:00:00.000Z",
        lastSeenAgeSeconds: this.ageSeconds,
      },
    ] as LiveDevice[];
  }

  subscribe(userId: string, handler: (e: LiveEvent) => void): () => void {
    let set = this.handlers.get(userId);
    if (!set) {
      set = new Set();
      this.handlers.set(userId, set);
    }
    set.add(handler);
    return () => {
      const s = this.handlers.get(userId);
      if (!s) return;
      s.delete(handler);
      if (s.size === 0) this.handlers.delete(userId);
    };
  }

  /** Simulate a Redis pub/sub event on this user's channel. */
  emit(userId: string): void {
    for (const handler of [...(this.handlers.get(userId) ?? [])]) {
      handler({ type: "push", deviceId: "d1" });
    }
  }

  /** How many handlers (⇒ Redis SUBs) are live for a user. */
  subscriberCount(userId: string): number {
    return this.handlers.get(userId)?.size ?? 0;
  }
}

const USER = "user_fanout";
const NO_REFRESH = 1_000_000; // large enough that no periodic tick fires during a test

test("burst of 3 events within the window → one read, one frame per client", async () => {
  const store = new FakeStore();
  const fanout = new LiveFanout(store, { coalesceMs: 40, refreshEmitMs: NO_REFRESH, ttlHours: 168 });

  const c1: string[] = [];
  const c2: string[] = [];
  const leave1 = fanout.join(USER, (f) => c1.push(f));
  const leave2 = fanout.join(USER, (f) => c2.push(f));

  store.emit(USER);
  store.emit(USER);
  store.emit(USER);

  await delay(90);

  assert.equal(store.listCalls, 1, "the 3-event burst coalesced into ONE listDevices read");
  assert.equal(c1.length, 1, "client 1 got exactly one frame");
  assert.equal(c2.length, 1, "client 2 got exactly one frame");
  assert.equal(c1[0], c2[0], "the SAME serialized frame was broadcast to every client");

  leave1();
  leave2();
  fanout.closeAll();
});

test("one store subscription per user; group torn down on the last leave", async () => {
  const store = new FakeStore();
  const fanout = new LiveFanout(store, { coalesceMs: 20, refreshEmitMs: NO_REFRESH, ttlHours: 168 });

  const leaveA = fanout.join(USER, () => {});
  const leaveB = fanout.join(USER, () => {});
  assert.equal(store.subscriberCount(USER), 1, "N viewers share ONE Redis subscription");
  assert.equal(fanout.activeUserCount, 1);

  leaveA();
  assert.equal(store.subscriberCount(USER), 1, "group persists while a viewer remains");
  assert.equal(fanout.activeUserCount, 1);

  leaveB();
  assert.equal(store.subscriberCount(USER), 0, "last leave unsubscribes from Redis (timer cleanup)");
  assert.equal(fanout.activeUserCount, 0, "group removed");

  // With no group, further events are inert — no read, no leaked timer firing.
  store.emit(USER);
  await delay(40);
  assert.equal(store.listCalls, 0);

  fanout.closeAll();
});

test("periodic re-emit sends a fresh frame (refreshed ages) while a viewer is connected", async () => {
  const store = new FakeStore();
  store.ageSeconds = 3;
  const fanout = new LiveFanout(store, { coalesceMs: 10, refreshEmitMs: 40, ttlHours: 168 });

  const frames: string[] = [];
  const leave = fanout.join(USER, (f) => frames.push(f));

  await delay(110); // spans ~2 refresh windows, no pub/sub events at all

  assert.ok(store.listCalls >= 1, "the periodic tick performed a fresh listDevices read");
  assert.ok(frames.length >= 1, "a state frame was emitted with no pub/sub event driving it");
  assert.ok(
    frames[0]?.includes('"lastSeenAgeSeconds":3'),
    "the frame carries freshly-computed ages from the fresh read",
  );

  leave();
  const callsAtLeave = store.listCalls;
  await delay(110);
  assert.equal(store.listCalls, callsAtLeave, "no further ticks once the last viewer has left");

  fanout.closeAll();
});

test("periodic tick is skipped when a coalesced frame already went out in the window", async () => {
  const store = new FakeStore();
  const fanout = new LiveFanout(store, { coalesceMs: 10, refreshEmitMs: 50, ttlHours: 168 });

  const frames: string[] = [];
  const leave = fanout.join(USER, (f) => frames.push(f));

  // Keep the channel busy: an event every ~25ms coalesces to a frame that resets the
  // group's lastEmitAt, so the 50ms periodic tick always finds a recent emit → skips.
  for (let i = 0; i < 5; i++) {
    store.emit(USER);
    await delay(25);
  }
  await delay(15);

  // 5 events, each its own coalesce window (spaced > coalesceMs apart) ⇒ 5 reads.
  // A periodic tick that ignored the skip guard would have added ≥1 extra read.
  assert.equal(store.listCalls, 5, "no redundant periodic read while coalesced frames are flowing");

  leave();
  fanout.closeAll();
});
