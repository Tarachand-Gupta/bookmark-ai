import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOWNLOAD_URLS,
  RELEASE_COPY,
  compareVersions,
  draftFromRelease,
  emptyReleaseDraft,
  formatPublished,
  isHttpsUrl,
  isSemver,
  toUpsertInput,
  updateState,
  validateReleaseDraft,
  type AppRelease,
} from "./releases";

const release: AppRelease = {
  platform: "macos",
  version: "0.2.0",
  build: "2",
  minSupportedVersion: "0.1.0",
  downloadUrl: "https://github.com/Tarachand-Gupta/bookmark-ai/releases",
  releaseNotes: "Update banner, skills import.",
  publishedAt: "2026-09-07T10:00:00.000Z",
  updatedAt: "2026-09-07T10:00:00.000Z",
};

describe("compareVersions (shared)", () => {
  it("compares numerically per segment", () => {
    expect(compareVersions("1.2.3", "1.2.3")).toBe(0);
    expect(compareVersions("1.10.0", "1.9.9")).toBe(1);
    expect(compareVersions("0.1.0", "0.2.0")).toBe(-1);
    expect(compareVersions("1.2", "1.2.0")).toBe(0);
    expect(compareVersions("v2.0.0", "1.99.99")).toBe(1);
  });

  it("breaks ties with the build only when both sides carry one", () => {
    expect(compareVersions({ version: "1.0.0", build: "1" }, { version: "1.0.0", build: "2" })).toBe(-1);
    expect(compareVersions({ version: "1.0.0", build: "10" }, { version: "1.0.0", build: "9" })).toBe(1);
    expect(compareVersions({ version: "1.0.0", build: null }, { version: "1.0.0", build: "1" })).toBe(0);
    expect(compareVersions({ version: "1.0.0", build: "3" }, { version: "1.0.0" })).toBe(0);
    // A higher VERSION always wins regardless of build.
    expect(compareVersions({ version: "1.0.1", build: "1" }, { version: "1.0.0", build: "99" })).toBe(1);
  });
});

describe("updateState (shared)", () => {
  it("is quiet without a record or when current/newer", () => {
    expect(updateState({ version: "0.1.0", build: "1" }, null)).toBe("current");
    expect(updateState({ version: "0.1.0", build: "1" }, undefined)).toBe("current");
    expect(updateState({ version: "0.2.0", build: "2" }, release)).toBe("current");
    expect(updateState({ version: "0.3.0" }, release)).toBe("current");
  });

  it("offers an update when older, blocks below the minimum", () => {
    expect(updateState({ version: "0.1.5", build: "1" }, release)).toBe("update-available");
    expect(updateState({ version: "0.2.0", build: "1" }, release)).toBe("update-available");
    expect(updateState({ version: "0.0.9", build: "1" }, release)).toBe("unsupported");
    expect(updateState({ version: "0.0.9" }, { ...release, minSupportedVersion: null })).toBe("update-available");
  });
});

describe("validation", () => {
  it("isSemver / isHttpsUrl", () => {
    expect(isSemver("1.2.3")).toBe(true);
    expect(isSemver(" 1.2.3 ")).toBe(true);
    expect(isSemver("1.2")).toBe(false);
    expect(isSemver("v1.2.3")).toBe(false);
    expect(isHttpsUrl("https://example.com/x")).toBe(true);
    expect(isHttpsUrl("http://example.com")).toBe(false);
    expect(isHttpsUrl("not a url")).toBe(false);
  });

  it("validateReleaseDraft mirrors the server rules", () => {
    const ok = draftFromRelease(release);
    expect(validateReleaseDraft(ok)).toEqual({});
    expect(validateReleaseDraft({ ...ok, version: "" })).toMatchObject({ version: RELEASE_COPY.versionRequired });
    expect(validateReleaseDraft({ ...ok, version: "1.2" })).toMatchObject({ version: RELEASE_COPY.semver });
    expect(validateReleaseDraft({ ...ok, build: "beta" })).toMatchObject({ build: RELEASE_COPY.build });
    expect(validateReleaseDraft({ ...ok, build: "1.0.3" })).toEqual({});
    expect(validateReleaseDraft({ ...ok, minSupportedVersion: "abc" })).toMatchObject({
      minSupportedVersion: RELEASE_COPY.semver,
    });
    expect(validateReleaseDraft({ ...ok, minSupportedVersion: "0.3.0" })).toMatchObject({
      minSupportedVersion: RELEASE_COPY.minNewer,
    });
    expect(validateReleaseDraft({ ...ok, downloadUrl: "" })).toMatchObject({ downloadUrl: RELEASE_COPY.urlRequired });
    expect(validateReleaseDraft({ ...ok, downloadUrl: "http://x.io" })).toMatchObject({
      downloadUrl: RELEASE_COPY.https,
    });
    expect(validateReleaseDraft({ ...ok, downloadUrl: DEFAULT_DOWNLOAD_URLS.ios })).toMatchObject({
      downloadUrl: RELEASE_COPY.placeholder,
    });
    expect(validateReleaseDraft({ ...ok, releaseNotes: "x".repeat(2_001) })).toMatchObject({
      releaseNotes: RELEASE_COPY.notesTooLong,
    });
  });
});

describe("drafts", () => {
  it("emptyReleaseDraft prefills the platform's download URL", () => {
    expect(emptyReleaseDraft("macos").downloadUrl).toBe("https://github.com/Tarachand-Gupta/bookmark-ai/releases");
    expect(emptyReleaseDraft("android").downloadUrl).toBe(
      "https://play.google.com/store/apps/details?id=ai.purecode.bookmarkai",
    );
    expect(emptyReleaseDraft("ios")).toMatchObject({ version: "", build: "", releaseNotes: "" });
  });

  it("toUpsertInput trims and nulls blank optionals", () => {
    expect(toUpsertInput({ ...draftFromRelease(release), build: " ", releaseNotes: "" })).toEqual({
      version: "0.2.0",
      build: null,
      minSupportedVersion: "0.1.0",
      downloadUrl: "https://github.com/Tarachand-Gupta/bookmark-ai/releases",
      releaseNotes: null,
    });
  });

  it("formatPublished is readable and tolerant", () => {
    expect(formatPublished("2026-09-07T10:00:00.000Z")).toMatch(/Sep 7, 2026/);
    expect(formatPublished("garbage")).toBe("garbage");
  });
});
