import type { Db } from "@bookmark-ai/db";
import { embedBookmarkById, embedPending, type GeminiClient } from "@bookmark-ai/engine";

/**
 * How many leftover rows a single post-save hook sweeps on top of its own.
 *
 * Deliberately ONE. Concurrent hooks all see the same oldest-first backlog, so
 * every straggler slot is a slot N racing saves may spend on the same row; at 1
 * the wasted work is capped at one extra embed per save while a lone save still
 * chips away at anything that fell through. The daily cron (/api/cron/embed)
 * drains the real backlog.
 */
export const STRAGGLER_LIMIT = 1;

/**
 * The embedding half of a post-save hook: embed the row THIS request saved, then
 * take one straggler.
 *
 * This used to be `embedPending(gemini, db, 5)` alone, which is a bug under
 * burst saves (an import, a session of quick saves, a seed run): `embedPending`
 * takes the N OLDEST unembedded rows, so 64 concurrent hooks each selected the
 * same 5 rows and embedded them in parallel — ~320 Gemini calls that produced 16
 * vectors on a 40-bookmark library, with the newest 24 rows never reached until
 * the next daily cron. Embedding the hook's OWN bookmark first makes the work
 * per save exactly one embedding, whatever else is in flight.
 *
 * Never throws: a post-save hook runs after the 201 has been sent, so there is
 * nobody left to report to, and anything missed is picked up by the cron sweep.
 */
export async function embedAfterSave(
  gemini: GeminiClient,
  db: Db,
  bookmarkId: string,
): Promise<void> {
  try {
    await embedBookmarkById(gemini, db, bookmarkId);
  } catch (err) {
    console.warn(`[embed] post-save ${bookmarkId}: ${(err as Error).message}`);
  }
  try {
    await embedPending(gemini, db, STRAGGLER_LIMIT);
  } catch (err) {
    console.warn(`[embed] post-save straggler sweep failed: ${(err as Error).message}`);
  }
}
