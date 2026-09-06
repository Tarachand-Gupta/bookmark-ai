/**
 * The update banner's decision logic (CONTRACT §12). Pure and unit-tested; the
 * I/O (fetch, AsyncStorage, AppState) lives in hooks/useAppUpdate.
 *
 * The version arithmetic — `compareVersions` (numeric semver, build breaks a
 * tie) and `updateState` — is the SHARED implementation in
 * `@bookmark-ai/types/releases`, so the server's admin validation, the macOS
 * app and this app can never disagree on what "newer" means. This module adds
 * only what is client-side by nature: the 24 h snooze, the response check, the
 * one-line notes, and the final "show which banner?" decision.
 */
import {
  appReleasesResponseSchema,
  compareVersions,
  updateState,
  type AppPlatform,
  type AppRelease,
  type AppReleasesResponse,
  type UpdateState,
  type VersionRef,
} from "@bookmark-ai/types";

export { compareVersions, updateState };
export type { AppPlatform, AppRelease, AppReleasesResponse, UpdateState };

/** What this build reports about itself (expo-constants on mobile). */
export type InstalledVersion = Required<VersionRef>;

// ---------------------------------------------------------------------------
// Snooze — "Later" hides ONE release for 24 h, persisted by the hook.

export const SNOOZE_MS = 24 * 60 * 60 * 1000;

export interface UpdateSnooze {
  /** `releaseKey()` of the release that was snoozed. */
  release: string;
  /** Epoch ms after which the banner may return. */
  until: number;
}

/**
 * Identity of a release for snoozing: the version, plus the build when the
 * record carries one — so a same-version, higher-build re-release (the
 * tie-break case) is a new banner, not a snoozed one.
 */
export function releaseKey(release: Pick<AppRelease, "version" | "build">): string {
  return release.build ? `${release.version}+${release.build}` : release.version;
}

export function snoozeRelease(
  release: Pick<AppRelease, "version" | "build">,
  now: number = Date.now(),
): UpdateSnooze {
  return { release: releaseKey(release), until: now + SNOOZE_MS };
}

export function isSnoozed(
  snooze: UpdateSnooze | null,
  release: Pick<AppRelease, "version" | "build">,
  now: number = Date.now(),
): boolean {
  if (snooze === null) return false;
  return snooze.release === releaseKey(release) && now < snooze.until;
}

/** The stored JSON, defensively — a corrupt entry is simply "not snoozed". */
export function parseSnooze(raw: string | null | undefined): UpdateSnooze | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === "object" &&
      value !== null &&
      typeof (value as UpdateSnooze).release === "string" &&
      typeof (value as UpdateSnooze).until === "number" &&
      Number.isFinite((value as UpdateSnooze).until)
    ) {
      return { release: (value as UpdateSnooze).release, until: (value as UpdateSnooze).until };
    }
  } catch {
    // fall through
  }
  return null;
}

// ---------------------------------------------------------------------------
// Response check + presentation helpers.

/**
 * `GET /api/app/releases` body → the typed response, or null when it isn't the
 * contract's shape (a rate-limit `{error}`, a proxy page, an old server). The
 * caller treats null exactly like a failed request: no banner.
 */
export function parseReleasesResponse(json: unknown): AppReleasesResponse | null {
  const result = appReleasesResponseSchema.safeParse(json);
  return result.success ? result.data : null;
}

/**
 * The banner has room for ONE line of notes: the first non-empty line of the
 * (short markdown) release notes, minus list/heading markers and emphasis.
 */
export function releaseNotesLine(notes: string | null | undefined): string | null {
  if (!notes) return null;
  for (const raw of notes.split(/\r?\n/)) {
    const line = raw
      .replace(/^\s*(?:[-*+•]\s+|#{1,6}\s+|\d+[.)]\s+)/, "")
      .replace(/\*\*|__|`/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (line !== "") return line;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The one decision the UI renders.

export interface UpdateBannerModel {
  release: AppRelease;
  state: Exclude<UpdateState, "current">;
}

/**
 * Whether Home shows a banner right now, and which one. Null when there is
 * nothing to say: no record for this platform, an unknown installed version
 * (Expo Go), the record is not newer, or the user snoozed it and the 24 h have
 * not passed. An `unsupported` release ignores the snooze — it is the
 * non-dismissible variant.
 */
export function bannerFor({
  current,
  release,
  snooze,
  now = Date.now(),
}: {
  current: InstalledVersion | null;
  release: AppRelease | null | undefined;
  snooze: UpdateSnooze | null;
  now?: number;
}): UpdateBannerModel | null {
  if (!current || !release) return null;
  const state = updateState(current, release);
  if (state === "current") return null;
  if (state === "update-available" && isSnoozed(snooze, release, now)) return null;
  return { release, state };
}
