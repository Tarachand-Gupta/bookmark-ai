import { storage } from "#imports";
import { diag } from "./diag";

/**
 * RETRY QUEUE for native-sync mirror ADDS.
 *
 * A native bookmark save arrives as a one-shot browser event: nothing ever fires
 * `bookmarks.onCreated` for that node again. So a mirror POST that failed —
 * offline, a 5xx, or a 401 the inline retry couldn't heal — used to be dropped on
 * the floor with a diag line and lost forever. The user's bookmark simply never
 * appeared in the library, with no way to notice or repair it.
 *
 * Failed adds land here and drain at background boot and on the 6h auth alarm, by
 * which time the 401 recovery ladder has usually replaced the credential.
 *
 * Bounded on purpose: the newest `QUEUE_CAP` entries survive (a long offline
 * stretch shouldn't grow storage.local without limit) and each entry gets
 * `MAX_TRIES` attempts so a permanently-rejected url can't be retried forever.
 */

export interface QueuedMirrorAdd {
  url: string;
  title?: string;
  tags?: string[];
  /** Epoch ms the entry was (re)queued — newest-wins when the cap trims. */
  at: number;
  /** Failed attempts so far, including the original inline one. */
  tries: number;
}

const QUEUE_CAP = 200;
const MAX_TRIES = 5;

const mirrorQueueItem = storage.defineItem<QueuedMirrorAdd[]>("local:nativeSyncQueue", {
  fallback: [],
});

async function readQueue(): Promise<QueuedMirrorAdd[]> {
  const value = await mirrorQueueItem.getValue().catch((): QueuedMirrorAdd[] => []);
  return Array.isArray(value) ? value : [];
}

async function writeQueue(entries: QueuedMirrorAdd[]): Promise<void> {
  await mirrorQueueItem.setValue(entries.slice(-QUEUE_CAP)).catch(() => {});
}

/** Queue a mirror add for a later attempt. Re-queuing the same url replaces the
 * existing entry (one pending mirror per url) and moves it to the newest slot. */
export async function enqueueMirrorAdd(
  entry: Omit<QueuedMirrorAdd, "at" | "tries"> & { tries?: number },
): Promise<void> {
  const queue = (await readQueue()).filter((e) => e.url !== entry.url);
  queue.push({ ...entry, tries: entry.tries ?? 1, at: Date.now() });
  const dropped = Math.max(0, queue.length - QUEUE_CAP);
  await writeQueue(queue);
  diag("nativeSync", "queued add for retry", {
    size: Math.min(queue.length, QUEUE_CAP),
    dropped,
    tries: entry.tries ?? 1,
  });
}

/** Current queue contents (diagnostics / tests). */
export function queuedMirrorAdds(): Promise<QueuedMirrorAdd[]> {
  return readQueue();
}

/** Re-entrancy guard: boot and the 6h alarm can both fire a drain, and two drains
 * over one queue would double-post every entry. */
let draining = false;

export interface DrainResult {
  sent: number;
  kept: number;
  dropped: number;
}

/**
 * Attempt every queued mirror with `send` (resolve true = mirrored). The queue is
 * emptied up-front and survivors are written back with an incremented attempt
 * count, so a crash mid-drain loses at most the in-flight entries rather than
 * replaying the whole queue. Entries that reach `MAX_TRIES` are dropped.
 *
 * `send` is injected rather than imported so this module stays free of the API
 * client (and is unit-testable without a fetch mock).
 */
export async function drainMirrorQueue(
  send: (entry: QueuedMirrorAdd) => Promise<boolean>,
): Promise<DrainResult> {
  if (draining) return { sent: 0, kept: 0, dropped: 0 };
  draining = true;
  try {
    const queue = await readQueue();
    if (queue.length === 0) return { sent: 0, kept: 0, dropped: 0 };
    await writeQueue([]);
    let sent = 0;
    let dropped = 0;
    const keep: QueuedMirrorAdd[] = [];
    for (const entry of queue) {
      const ok = await send(entry).catch(() => false);
      if (ok) {
        sent += 1;
        continue;
      }
      const tries = entry.tries + 1;
      if (tries >= MAX_TRIES) {
        dropped += 1;
        continue;
      }
      keep.push({ ...entry, tries });
    }
    if (keep.length > 0) {
      // Anything queued WHILE we were draining (a fresh native add) must not be
      // clobbered by the write-back.
      const queuedMeanwhile = await readQueue();
      const fresh = queuedMeanwhile.filter((e) => !keep.some((k) => k.url === e.url));
      await writeQueue([...keep, ...fresh]);
    }
    diag("nativeSync", "queue drained", { sent, kept: keep.length, dropped });
    return { sent, kept: keep.length, dropped };
  } finally {
    draining = false;
  }
}

/** Test seam: clear the re-entrancy guard between cases. */
export function resetDrainGuard(): void {
  draining = false;
}
