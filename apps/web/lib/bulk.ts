/**
 * Bounded-concurrency runner for the library's bulk actions (today: bulk delete).
 *
 * Extracted from the page so the two things that were easy to get wrong are
 * testable in isolation: the completion COUNT reported to the UI (it must tick
 * once per settled request, failures included) and the failure accounting (one
 * bad id must not abort the batch, and the summary has to be able to say how many
 * of how many landed).
 */

export interface BulkOptions {
  /** How many requests may be in flight at once. */
  concurrency: number;
  /**
   * Called after EVERY settled request — resolved or rejected — with the running
   * completed count (1-based, ending at `ids.length`). This is what drives the
   * progress line, so callers must make it produce a visible render; see
   * library-page.tsx for why a plain setState is not enough there.
   */
  onSettled?: (done: number) => void;
}

export interface BulkResult {
  /** Requests that settled. Always `ids.length` — the batch never aborts early. */
  done: number;
  /** How many rejected. */
  failed: number;
  /** Message of the FIRST rejection, for an honest partial-success summary. */
  firstError: string | null;
}

/**
 * Apply `task` to every id, at most `concurrency` at a time, never aborting on a
 * failure. A bare `Promise.all` over 100 ids trips the API's rate limiter and a
 * serial loop takes a visible age, hence the fixed pool of workers pulling from a
 * shared cursor.
 */
export async function runBulk(
  ids: readonly string[],
  task: (id: string) => Promise<unknown>,
  { concurrency, onSettled }: BulkOptions,
): Promise<BulkResult> {
  let cursor = 0;
  let done = 0;
  let failed = 0;
  let firstError: string | null = null;

  const worker = async () => {
    for (;;) {
      const index = cursor++;
      if (index >= ids.length) return;
      try {
        await task(ids[index]);
      } catch (err) {
        failed++;
        firstError ??= (err as Error)?.message ?? String(err);
      }
      done++;
      onSettled?.(done);
    }
  };

  await Promise.all(
    // `Array.from(…, worker)` would hand worker the map callback's (value, index)
    // arguments; it ignores them, but calling it explicitly keeps that harmless
    // by construction.
    Array.from({ length: Math.max(1, Math.min(concurrency, ids.length)) }, () => worker()),
  );

  return { done, failed, firstError };
}
