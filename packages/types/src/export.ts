import { z } from "zod";
import { httpUrlSchema } from "./bookmark";
import { sessionTabSchema } from "./api";

/**
 * Version of the export bundle format. Bump this whenever the exported shape of
 * user data changes (a new/renamed user-data column, a restructured field) AND
 * add a matching `migrateExportBundle` upgrader step, so older bundles keep
 * importing cleanly. v1 is the initial format.
 */
export const SCHEMA_VERSION = 1;

/**
 * A single bookmark, flattened to mirror its real DB columns (see
 * `packages/db` rows.ts / migrations.ts). Omits the per-DB `id` (import upserts
 * by URL) and the `embedding` blob (regenerable — the embed sweep refills it).
 * `ogJson` is the raw `og_json` column verbatim (a JSON string) so nothing in
 * the scraped Open Graph payload is lost.
 */
export const exportedBookmarkSchema = z.object({
  url: httpUrlSchema,
  title: z.string(),
  description: z.string().nullable(),
  category: z.string(),
  tags: z.array(z.string()),
  browser: z.string(),
  device: z.string(),
  deviceName: z.string().nullable(),
  os: z.string().nullable(),
  domain: z.string(),
  /** Raw `og_json` column (a JSON-encoded OpenGraph object). */
  ogJson: z.string(),
  savedAt: z.string(),
  savedDay: z.string(),
  createdAt: z.string(),
});
export type ExportedBookmark = z.infer<typeof exportedBookmarkSchema>;

/** A saved tab-session, mirroring the `sessions` table (minus the per-DB id). */
export const exportedSessionSchema = z.object({
  name: z.string(),
  tabs: z.array(sessionTabSchema),
  tabCount: z.number(),
  browser: z.string(),
  device: z.string(),
  savedAt: z.string(),
  createdAt: z.string(),
});
export type ExportedSession = z.infer<typeof exportedSessionSchema>;

/** The full, versioned, lossless export of a user's data. */
export const exportBundleSchema = z.object({
  schemaVersion: z.number(),
  /** ISO 8601 timestamp of when the bundle was produced (supplied by caller). */
  exportedAt: z.string(),
  counts: z.object({
    bookmarks: z.number(),
    sessions: z.number(),
  }),
  bookmarks: z.array(exportedBookmarkSchema),
  sessions: z.array(exportedSessionSchema),
});
export type ExportBundle = z.infer<typeof exportBundleSchema>;

/**
 * Validate and upgrade a raw (untrusted) export bundle to the current
 * `SCHEMA_VERSION`. Structured as a version-dispatch chain: it reads the
 * declared `schemaVersion`, runs any vN→vN+1 upgraders in sequence, then
 * validates the final shape. Only v1 exists today, so the chain is empty and
 * this is validate-and-passthrough — but future versions slot a `case` in
 * cleanly. Throws a clear error on a missing, unknown, or newer-than-supported
 * version, or on a bundle that fails validation.
 */
export function migrateExportBundle(raw: unknown): ExportBundle {
  const versioned = z.object({ schemaVersion: z.number() }).safeParse(raw);
  if (!versioned.success) {
    throw new Error("Export bundle is missing a numeric schemaVersion");
  }

  let version = versioned.data.schemaVersion;
  if (version < 1 || !Number.isInteger(version)) {
    throw new Error(`Unknown export bundle schemaVersion: ${version}`);
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(
      `Export bundle schemaVersion ${version} is newer than supported (${SCHEMA_VERSION}); update the app to import it`,
    );
  }

  let data: unknown = raw;
  // vN → vN+1 upgraders run in ascending order until `data` is at
  // SCHEMA_VERSION. No upgraders exist yet (v1 is current); each future bump
  // adds a `case` that transforms `data` and increments `version`.
  while (version < SCHEMA_VERSION) {
    switch (version) {
      // case 1:
      //   data = upgradeV1ToV2(data);
      //   version = 2;
      //   break;
      default:
        throw new Error(`No upgrade path from export schemaVersion ${version}`);
    }
  }

  const parsed = exportBundleSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`Invalid export bundle: ${parsed.error.message}`);
  }
  return parsed.data;
}
