import type { SecureValues } from "./secure-session-storage";

/** Serializes the single last-authorized-account marker independently of SDK
 * credentials. Invalidation is immediate; queued disk cleanup precedes any new
 * admission, so an old completion cannot erase a newly verified account. */
export function createAdmissionMarker<T>(storage: SecureValues, key: string) {
  let epoch = 0;
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <R>(work: () => Promise<R>): Promise<R> => {
    const task = queue.catch(() => undefined).then(work);
    queue = task;
    return task;
  };
  return {
    epoch: () => epoch,
    read: () => {
      const started = epoch;
      return serial(async (): Promise<T | null> => {
        const raw = await storage.getItem(key);
        if (started !== epoch || !raw) return null;
        try { return JSON.parse(raw) as T; } catch { return null; }
      });
    },
    write: (value: T, started: number, isCurrent: () => boolean) => serial(async () => {
      if (started !== epoch || !isCurrent()) return false;
      await storage.setItem(key, JSON.stringify(value));
      // Never enqueue a stale cleanup here: clear already owns the correct
      // position in the queue, ahead of a subsequent authorized write.
      return started === epoch && isCurrent();
    }),
    clear: () => {
      epoch++;
      return serial(() => storage.removeItem(key));
    },
  };
}
