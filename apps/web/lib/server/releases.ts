import {
  deleteAppRelease,
  getAppRelease,
  listAppReleases,
  upsertAppRelease,
  type AppReleaseRow,
} from "@bookmark-ai/db";
import {
  appPlatformSchema,
  type AppPlatform,
  type AppRelease,
  type AppReleaseMap,
  type AppReleasesResponse,
  type UpsertAppReleaseInput,
} from "@bookmark-ai/types";
import { getMasterContext } from "@/lib/server/context";

/**
 * App release records (master `app_releases`, migration v5) behind the public
 * `GET /api/app/releases` and the admin PUT/DELETE. Reads never throw — a
 * deployment without a master DB, or a blip reading it, is "no releases", so
 * no client ever shows a banner on bad data. Writes require the master DB
 * (publishing is a control-plane operation) and surface its absence as
 * `ReleaseStoreUnavailableError` → 503.
 */

export class ReleaseStoreUnavailableError extends Error {
  constructor() {
    super("MASTER_DATABASE_URL is not configured — app releases live in the master DB");
    this.name = "ReleaseStoreUnavailableError";
  }
}

/** Row → API shape. Rows with a platform this build doesn't know are dropped. */
function toAppRelease(row: AppReleaseRow): AppRelease | null {
  const platform = appPlatformSchema.safeParse(row.platform);
  if (!platform.success) return null;
  return {
    platform: platform.data,
    version: row.version,
    build: row.build,
    minSupportedVersion: row.minSupportedVersion,
    downloadUrl: row.downloadUrl,
    releaseNotes: row.releaseNotes,
    publishedAt: row.publishedAt,
    updatedAt: row.updatedAt,
  };
}

/** Every published release keyed by platform; `{}` without a master DB or on error. */
export async function listPublishedReleases(): Promise<AppReleasesResponse> {
  const releases: AppReleaseMap = {};
  const master = getMasterContext();
  if (!master) return { releases };
  try {
    await master.ready;
    for (const row of await listAppReleases(master.db)) {
      const release = toAppRelease(row);
      if (release) releases[release.platform] = release;
    }
  } catch (err) {
    console.warn("[releases] read failed, serving none:", (err as Error).message);
    return { releases: {} };
  }
  return { releases };
}

/**
 * Publish (insert or replace) a platform's release. `publishedAt` is taken from
 * the body when given; otherwise an edit of the SAME version+build keeps the
 * existing timestamp (fixing notes isn't a new release) and anything else is
 * stamped now. `updatedAt` is always now.
 */
export async function publishRelease(
  platform: AppPlatform,
  input: UpsertAppReleaseInput,
  now: Date = new Date(),
): Promise<AppRelease> {
  const master = getMasterContext();
  if (!master) throw new ReleaseStoreUnavailableError();
  await master.ready;

  const existing = await getAppRelease(master.db, platform);
  const sameBuild =
    existing !== null && existing.version === input.version && existing.build === input.build;
  const nowIso = now.toISOString();
  const row: AppReleaseRow = {
    platform,
    version: input.version,
    build: input.build,
    minSupportedVersion: input.minSupportedVersion,
    downloadUrl: input.downloadUrl,
    releaseNotes: input.releaseNotes,
    publishedAt: input.publishedAt ?? (sameBuild ? existing.publishedAt : nowIso),
    updatedAt: nowIso,
  };
  await upsertAppRelease(master.db, row);
  const saved = toAppRelease(row);
  if (!saved) throw new Error("publishRelease: platform rejected after validation");
  return saved;
}

/** Remove a platform's release. Returns whether one existed (the route 204s either way). */
export async function unpublishRelease(platform: AppPlatform): Promise<boolean> {
  const master = getMasterContext();
  if (!master) throw new ReleaseStoreUnavailableError();
  await master.ready;
  return deleteAppRelease(master.db, platform);
}
