import { randomUUID } from "node:crypto";
import type { Bookmark, CreateBookmarkInput } from "@bookmark-ai/types";
import {
  getBookmarkByUrl,
  insertBookmark,
  listTagCounts,
  updateBookmarkContent,
  type Db,
} from "@bookmark-ai/db";
import type { GeminiClient } from "./gemini";
import { scrapeOpenGraph } from "./og";
import { categorize, heuristicCategorize } from "./categorize";

/**
 * Instant save: persist immediately with a no-network heuristic category so
 * clients get their 201 in milliseconds. OG scrape + AI categorization run
 * afterwards via enrichBookmark. Re-saves of an already-enriched URL keep the
 * enriched content rather than degrading it until enrichment lands again.
 */
export async function saveBookmarkFast(db: Db, input: CreateBookmarkInput): Promise<Bookmark> {
  const url = new URL(input.url);
  const domain = url.hostname.replace(/^www\./, "");
  const existing = await getBookmarkByUrl(db, input.url);
  const title = existing?.title ?? input.title ?? domain;
  const heuristic = heuristicCategorize({
    url: input.url,
    domain,
    title,
    description: existing?.description ?? null,
    og: existing?.og ?? {},
  });

  const now = new Date().toISOString();
  return insertBookmark(db, {
    id: existing?.id ?? randomUUID(),
    url: input.url,
    domain,
    title,
    description: existing?.description ?? null,
    og: existing?.og ?? {},
    source: {
      browser: input.browser,
      device: input.device,
      deviceName: input.deviceName ?? null,
      os: input.os ?? null,
      savedAt: input.savedAt ?? now,
    },
    category: existing?.category ?? heuristic.category,
    // Caller-supplied tags (native-sync markers like "reading"/"article") merge
    // into the heuristic tags; an existing enriched row keeps its tags (they're
    // a superset — enrichment merges caller tags again on re-save).
    tags:
      existing && existing.tags.length > 0
        ? existing.tags
        : Array.from(new Set([...(input.tags ?? []), ...heuristic.tags])),
    createdAt: existing?.createdAt ?? now,
  });
}

/**
 * Post-save enrichment: scrape OG data → AI categorize (comprehensive tags) →
 * update the row and clear its embedding for the embed worker. A failure at
 * any step leaves the instant-save data in place.
 */
export async function enrichBookmark(
  db: Db,
  gemini: GeminiClient | null,
  id: string,
  input: CreateBookmarkInput,
): Promise<void> {
  const url = new URL(input.url);
  const domain = url.hostname.replace(/^www\./, "");
  const scraped = await scrapeOpenGraph(input.url);

  const title = scraped.title ?? input.title ?? domain;
  const description = scraped.description;

  // Share the established vocabulary so the AI reuses tags before inventing.
  const existingTags = gemini ? await listTagCounts(db, 40) : [];
  const { category, tags } = await categorize(
    gemini,
    {
      url: input.url,
      domain,
      title,
      description,
      og: scraped.og,
    },
    existingTags,
  );

  // Enrichment REPLACES the row's tags, so caller-supplied tags (the
  // native-sync markers) are re-merged here to survive it.
  await updateBookmarkContent(db, id, {
    title,
    description,
    og: scraped.og,
    category,
    tags: Array.from(new Set([...(input.tags ?? []), ...tags])),
  });
}
