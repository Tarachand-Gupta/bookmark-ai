import {
  APP_PLATFORMS,
  BUILD_PATTERN,
  RELEASE_NOTES_MAX,
  SEMVER_PATTERN,
  compareVersions,
  updateState,
  type AppPlatform,
  type AppRelease,
  type AppReleaseMap,
  type AppReleasesResponse,
  type UpdateState,
  type UpsertAppReleaseInput,
  type VersionRef,
} from "@bookmark-ai/types";

/**
 * App releases (CONTRACT §12) — "latest version per platform", which the native
 * apps poll on launch to show an update banner. The web app only ADMINISTERS
 * these records (Settings → Releases); it never shows a banner itself.
 *
 * Schemas, types and the version helpers are the shared ones from
 * `packages/types/src/releases.ts` (the same rules the API validates with and
 * the native clients compare with). This module adds the admin editor's
 * vocabulary: labels, default URLs, the draft shape and its inline validation.
 * Pure and unit-tested (releases.test.ts).
 */

export { APP_PLATFORMS, SEMVER_PATTERN, BUILD_PATTERN, compareVersions, updateState };
export type {
  AppPlatform,
  AppRelease,
  AppReleaseMap,
  AppReleasesResponse,
  UpdateState,
  UpsertAppReleaseInput,
  VersionRef,
};

export const PLATFORM_LABELS: Record<AppPlatform, string> = {
  macos: "macOS",
  ios: "iOS",
  android: "Android",
};

/** Where each platform's users get the build — prefilled when a record is empty. */
export const DEFAULT_DOWNLOAD_URLS: Record<AppPlatform, string> = {
  macos: "https://github.com/Tarachand-Gupta/bookmark-ai/releases",
  ios: "https://apps.apple.com/app/id<FILL_IN>",
  android: "https://play.google.com/store/apps/details?id=ai.purecode.bookmarkai",
};

export function isSemver(value: string): boolean {
  return SEMVER_PATTERN.test(value.trim());
}

export function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

// ── Admin editor ─────────────────────────────────────────────────────────────

export interface ReleaseDraft {
  version: string;
  build: string;
  minSupportedVersion: string;
  downloadUrl: string;
  releaseNotes: string;
}

export type ReleaseDraftErrors = Partial<Record<keyof ReleaseDraft, string>>;

/** A blank draft with the platform's default download URL prefilled. */
export function emptyReleaseDraft(platform: AppPlatform): ReleaseDraft {
  return {
    version: "",
    build: "",
    minSupportedVersion: "",
    downloadUrl: DEFAULT_DOWNLOAD_URLS[platform],
    releaseNotes: "",
  };
}

export function draftFromRelease(release: AppRelease): ReleaseDraft {
  return {
    version: release.version,
    build: release.build ?? "",
    minSupportedVersion: release.minSupportedVersion ?? "",
    downloadUrl: release.downloadUrl,
    releaseNotes: release.releaseNotes ?? "",
  };
}

export const RELEASE_COPY = {
  versionRequired: "Enter the version, like 1.2.3.",
  semver: "Use semver: three numbers, like 1.2.3.",
  build: "Build is numeric, like 42 or 1.0.3.",
  minNewer: "Min supported can’t be newer than the version.",
  urlRequired: "Enter the download URL.",
  https: "Use a full https:// URL.",
  placeholder: "Replace <FILL_IN> with the real id before saving.",
  notesTooLong: `Keep the notes under ${RELEASE_NOTES_MAX.toLocaleString("en-US")} characters.`,
} as const;

/** Mirrors `upsertAppReleaseSchema` so the user sees the problem next to the
 * field instead of as a 400: semver version (and min, not newer than the
 * version), numeric build, https URL, notes cap. */
export function validateReleaseDraft(draft: ReleaseDraft): ReleaseDraftErrors {
  const errors: ReleaseDraftErrors = {};
  const version = draft.version.trim();
  if (!version) errors.version = RELEASE_COPY.versionRequired;
  else if (!isSemver(version)) errors.version = RELEASE_COPY.semver;

  const build = draft.build.trim();
  if (build && !BUILD_PATTERN.test(build)) errors.build = RELEASE_COPY.build;

  const min = draft.minSupportedVersion.trim();
  if (min) {
    if (!isSemver(min)) errors.minSupportedVersion = RELEASE_COPY.semver;
    else if (!errors.version && compareVersions(min, version) > 0) {
      errors.minSupportedVersion = RELEASE_COPY.minNewer;
    }
  }

  const url = draft.downloadUrl.trim();
  if (!url) errors.downloadUrl = RELEASE_COPY.urlRequired;
  else if (url.includes("<FILL_IN>")) errors.downloadUrl = RELEASE_COPY.placeholder;
  else if (!isHttpsUrl(url)) errors.downloadUrl = RELEASE_COPY.https;

  if (draft.releaseNotes.trim().length > RELEASE_NOTES_MAX) errors.releaseNotes = RELEASE_COPY.notesTooLong;
  return errors;
}

/** Trimmed wire payload; blank optionals become null (clearing a stored value). */
export function toUpsertInput(draft: ReleaseDraft): UpsertAppReleaseInput {
  const opt = (v: string) => (v.trim() ? v.trim() : null);
  return {
    version: draft.version.trim(),
    build: opt(draft.build),
    minSupportedVersion: opt(draft.minSupportedVersion),
    downloadUrl: draft.downloadUrl.trim(),
    releaseNotes: opt(draft.releaseNotes),
  };
}

/** "Sep 7, 2026" — or the raw string if it isn't a date. */
export function formatPublished(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
