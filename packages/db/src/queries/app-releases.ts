import type { Row } from "@libsql/client";
import type { Db } from "../client";

/**
 * `app_releases` (MASTER DB, migration v5): one row per native platform holding
 * the latest published version. Platform strings are validated by the API layer
 * (`appPlatformSchema`) before they reach here; this module is shape-only.
 */
export interface AppReleaseRow {
  platform: string;
  version: string;
  build: string | null;
  minSupportedVersion: string | null;
  downloadUrl: string;
  releaseNotes: string | null;
  publishedAt: string;
  updatedAt: string;
}

function rowToRelease(row: Row): AppReleaseRow {
  return {
    platform: String(row.platform),
    version: String(row.version),
    build: row.build == null ? null : String(row.build),
    minSupportedVersion: row.min_supported_version == null ? null : String(row.min_supported_version),
    downloadUrl: String(row.download_url),
    releaseNotes: row.release_notes == null ? null : String(row.release_notes),
    publishedAt: String(row.published_at),
    updatedAt: String(row.updated_at),
  };
}

/** Every platform's current release, platform-sorted for stable output. */
export async function listAppReleases(db: Db): Promise<AppReleaseRow[]> {
  const rs = await db.execute("SELECT * FROM app_releases ORDER BY platform ASC");
  return rs.rows.map(rowToRelease);
}

/** One platform's release, or null when nothing has been published for it. */
export async function getAppRelease(db: Db, platform: string): Promise<AppReleaseRow | null> {
  const rs = await db.execute({
    sql: "SELECT * FROM app_releases WHERE platform = ?",
    args: [platform],
  });
  const row = rs.rows[0];
  return row ? rowToRelease(row) : null;
}

/** Insert or fully replace a platform's release (the row IS the latest version). */
export async function upsertAppRelease(db: Db, release: AppReleaseRow): Promise<void> {
  await db.execute({
    sql: `INSERT INTO app_releases
            (platform, version, build, min_supported_version, download_url, release_notes, published_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(platform) DO UPDATE SET
            version               = excluded.version,
            build                 = excluded.build,
            min_supported_version = excluded.min_supported_version,
            download_url          = excluded.download_url,
            release_notes         = excluded.release_notes,
            published_at          = excluded.published_at,
            updated_at            = excluded.updated_at`,
    args: [
      release.platform,
      release.version,
      release.build,
      release.minSupportedVersion,
      release.downloadUrl,
      release.releaseNotes,
      release.publishedAt,
      release.updatedAt,
    ],
  });
}

/** Remove a platform's release. Returns whether a row existed. */
export async function deleteAppRelease(db: Db, platform: string): Promise<boolean> {
  const rs = await db.execute({
    sql: "DELETE FROM app_releases WHERE platform = ?",
    args: [platform],
  });
  return rs.rowsAffected > 0;
}
