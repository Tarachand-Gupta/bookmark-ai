import { after } from "next/server";
import type { OrganizationOperation } from "@bookmark-ai/types";
import type { Db } from "@bookmark-ai/db";
import { embedBookmarkById, type GeminiClient } from "@bookmark-ai/engine";
import { flushObservability } from "./observability/flush";
/** Manual writes never wait for AI. FTS updates in the write transaction; the
 * existing daily sweep drains larger edits beyond this bounded immediate work. */
export function scheduleOrganizationIndexing(
  db: Db,
  gemini: GeminiClient | null,
  operation: OrganizationOperation,
): void {
  if (!gemini) return;
  const ids = [
    ...new Set(
      operation.results
        .filter((r) =>
          r.changedFields?.some((f) => f === "title" || f === "categoryId" || f === "tags"),
        )
        .map((r) => r.id),
    ),
  ].slice(0, 3);
  if (!ids.length) return;
  after(async () => {
    for (const id of ids) {
      try {
        await embedBookmarkById(gemini, db, id);
      } catch {
        /* The existing embedding sweep will retry. */
      }
    }
    await flushObservability();
  });
}
