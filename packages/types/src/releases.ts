import { z } from "zod";

/**
 * App releases — the source of truth for "latest version per platform", polled
 * by the native apps at launch to decide whether to show an update banner.
 * Stored in the MASTER control-plane DB (`app_releases`, master migration v5);
 * a deployment without a master DB serves `{ releases: {} }` and no client ever
 * shows a banner. Everything version-shaped here is compared NUMERICALLY
 * (`0.10.0` > `0.9.0`) — never lexically.
 */

export const APP_PLATFORMS = ["macos", "ios", "android"] as const;
export const appPlatformSchema = z.enum(APP_PLATFORMS);
export type AppPlatform = z.infer<typeof appPlatformSchema>;

/** Marketing version: exactly three numeric components. */
export const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;
/** Build identifier: CFBundleVersion / Expo buildNumber / Android versionCode —
 * one or more dot-separated numeric components ("2", "42", "1.0.3"). */
export const BUILD_PATTERN = /^\d+(\.\d+)*$/;
export const RELEASE_BUILD_MAX = 32;
export const RELEASE_NOTES_MAX = 2_000;
export const RELEASE_URL_MAX = 2_048;

export const RELEASE_VERSION_MESSAGE = "version must be semver like 1.2.3";
export const RELEASE_BUILD_MESSAGE = "build must be numeric, e.g. 42 or 1.0.3";
export const RELEASE_URL_MESSAGE = "downloadUrl must be an https:// URL";
export const RELEASE_MIN_VERSION_MESSAGE = "minSupportedVersion must not be newer than version";

const semverField = z.string().trim().regex(SEMVER_PATTERN, RELEASE_VERSION_MESSAGE);
const buildField = z
  .string()
  .trim()
  .max(RELEASE_BUILD_MAX, RELEASE_BUILD_MESSAGE)
  .regex(BUILD_PATTERN, RELEASE_BUILD_MESSAGE);
const httpsUrlField = z
  .string()
  .trim()
  .max(RELEASE_URL_MAX)
  .url(RELEASE_URL_MESSAGE)
  .refine((u) => u.startsWith("https://"), RELEASE_URL_MESSAGE);

/** Optional text field where `""`, whitespace, `null` and absent all mean "unset" → `null`. */
function optionalText<T extends z.ZodTypeAny>(inner: T) {
  return z.preprocess(
    (v) => (v == null || (typeof v === "string" && v.trim() === "") ? null : v),
    inner.nullable(),
  );
}

/** What `GET /api/app/releases` returns per platform. */
export const appReleaseSchema = z.object({
  platform: appPlatformSchema,
  version: z.string(),
  build: z.string().nullable(),
  /** Below this the client shows a blocking (non-dismissible) banner. */
  minSupportedVersion: z.string().nullable(),
  /** macOS: releases page; iOS: App Store URL; Android: Play URL. */
  downloadUrl: z.string(),
  /** Short markdown, optional. */
  releaseNotes: z.string().nullable(),
  publishedAt: z.string(),
  updatedAt: z.string(),
});
export type AppRelease = z.infer<typeof appReleaseSchema>;

/** `GET /api/app/releases` → `{ releases }` keyed by platform; absent = no record. */
export const appReleasesResponseSchema = z.object({
  releases: z.object({
    macos: appReleaseSchema.optional(),
    ios: appReleaseSchema.optional(),
    android: appReleaseSchema.optional(),
  }),
});
export type AppReleasesResponse = z.infer<typeof appReleasesResponseSchema>;
export type AppReleaseMap = AppReleasesResponse["releases"];

/**
 * `PUT /api/admin/releases/:platform` body. Empty strings clear the optional
 * fields (the admin form sends what it shows). `publishedAt` is optional: when
 * omitted the server keeps the existing timestamp for the same version+build
 * and stamps "now" for a new one.
 */
export const upsertAppReleaseSchema = z
  .object({
    version: semverField,
    build: optionalText(buildField).default(null),
    minSupportedVersion: optionalText(semverField).default(null),
    downloadUrl: httpsUrlField,
    releaseNotes: optionalText(z.string().trim().max(RELEASE_NOTES_MAX)).default(null),
    publishedAt: z.string().datetime({ offset: true }).optional(),
  })
  .refine(
    (r) => r.minSupportedVersion === null || compareVersions(r.minSupportedVersion, r.version) <= 0,
    { message: RELEASE_MIN_VERSION_MESSAGE, path: ["minSupportedVersion"] },
  );
export type UpsertAppReleaseInput = z.infer<typeof upsertAppReleaseSchema>;

/** `PUT /api/admin/releases/:platform` → `{ release }`. */
export const appReleaseResponseSchema = z.object({ release: appReleaseSchema });
export type AppReleaseResponse = z.infer<typeof appReleaseResponseSchema>;

// ── Pure version helpers (shared by the server and every native client) ──

/** A version with an optional build — the client's own bundle, or a release. */
export interface VersionRef {
  version: string;
  build?: string | null;
}

/** "v1.2.3" / "1.2" / "1.2.3-beta" → [1, 2, 3]; non-numeric segments count as 0. */
function segments(value: string): number[] {
  return value
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((part) => {
      const n = parseInt(part, 10);
      return Number.isFinite(n) && n >= 0 ? n : 0;
    });
}

function compareSegments(a: number[], b: number[]): -1 | 0 | 1 {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/**
 * Numeric semver comparison: -1 when `a` is older, 0 when equal, 1 when newer.
 * Missing components read as 0 (`1.2` == `1.2.0`). When the versions are equal
 * and BOTH sides carry a build, the build breaks the tie (numerically, dotted
 * builds segment-wise); a missing build on either side never breaks a tie.
 * Prereleases are not modelled — this product ships plain x.y.z.
 */
export function compareVersions(a: string | VersionRef, b: string | VersionRef): -1 | 0 | 1 {
  const av = typeof a === "string" ? a : a.version;
  const bv = typeof b === "string" ? b : b.version;
  const byVersion = compareSegments(segments(av), segments(bv));
  if (byVersion !== 0) return byVersion;
  const ab = typeof a === "string" ? null : (a.build ?? null);
  const bb = typeof b === "string" ? null : (b.build ?? null);
  if (ab == null || bb == null) return 0;
  return compareSegments(segments(ab), segments(bb));
}

export type UpdateState = "current" | "update-available" | "unsupported";

/**
 * What a running client should do given the platform's release record:
 *  - no record → `"current"` (never show a banner without data)
 *  - own version below `minSupportedVersion` → `"unsupported"` (blocking banner)
 *  - own version+build below the release → `"update-available"` (dismissible)
 *  - same or newer → `"current"`
 */
export function updateState(
  current: VersionRef,
  release: Pick<AppRelease, "version" | "build" | "minSupportedVersion"> | null | undefined,
): UpdateState {
  if (!release) return "current";
  if (release.minSupportedVersion && compareVersions(current.version, release.minSupportedVersion) < 0) {
    return "unsupported";
  }
  return compareVersions(current, release) < 0 ? "update-available" : "current";
}
