import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  bannerFor,
  compareVersions,
  isSnoozed,
  parseReleasesResponse,
  parseSnooze,
  releaseKey,
  releaseNotesLine,
  SNOOZE_MS,
  snoozeRelease,
  updateState,
  type AppRelease,
} from "./appUpdate";

const release = (patch: Partial<AppRelease> = {}): AppRelease => ({
  platform: "ios",
  version: "1.1.0",
  build: "7",
  minSupportedVersion: null,
  downloadUrl: "https://apps.apple.com/app/id123",
  releaseNotes: null,
  publishedAt: "2026-09-07T00:00:00.000Z",
  updatedAt: "2026-09-07T00:00:00.000Z",
  ...patch,
});

/** What the shipped 1.0.0 (build 1) reports through expo-constants. */
const installed = { version: "1.0.0", build: "1" };

// The comparison lives in @bookmark-ai/types; these pin the semantics the
// banner relies on, so a change there fails HERE too.
describe("compareVersions (shared)", () => {
  it("orders numerically, not lexically", () => {
    assert.equal(compareVersions("1.2.10", "1.2.9"), 1);
    assert.equal(compareVersions("1.2.9", "1.2.10"), -1);
    assert.equal(compareVersions("10.0.0", "9.9.9"), 1);
  });
  it("treats missing parts as zero and is exact on equality", () => {
    assert.equal(compareVersions("1.0", "1.0.0"), 0);
    assert.equal(compareVersions("1", "1.0.1"), -1);
    assert.equal(compareVersions("1.0.0", "1.0.0"), 0);
    assert.equal(compareVersions(" v1.0.0 ", "1.0.0"), 0);
  });
  it("breaks a version tie on the build only when both sides have one", () => {
    assert.equal(compareVersions({ version: "1.0.0", build: "2" }, installed), 1);
    assert.equal(compareVersions({ version: "1.0.0", build: "0" }, installed), -1);
    assert.equal(compareVersions({ version: "1.0.0", build: "42" }, { version: "1.0.0", build: "7" }), 1);
    assert.equal(compareVersions({ version: "1.0.0", build: null }, installed), 0);
    assert.equal(compareVersions({ version: "1.0.0" }, installed), 0);
    // A newer build never outranks an older version.
    assert.equal(compareVersions({ version: "0.9.0", build: "500" }, installed), -1);
  });
  it("never throws on garbage", () => {
    assert.equal(compareVersions("", "0.0.0"), 0);
    assert.equal(compareVersions("abc", "0.0.0"), 0);
    assert.equal(compareVersions("1.x.3", "1.0.3"), 0);
  });
});

describe("updateState (shared)", () => {
  it("is current without a record, or for the same / an older one", () => {
    assert.equal(updateState(installed, null), "current");
    assert.equal(updateState(installed, undefined), "current");
    assert.equal(updateState(installed, release({ version: "1.0.0", build: "1" })), "current");
    assert.equal(updateState(installed, release({ version: "1.0.0", build: null })), "current");
    assert.equal(updateState(installed, release({ version: "0.9.9", build: "99" })), "current");
  });
  it("offers an update for a newer version, or a newer build of the same version", () => {
    assert.equal(updateState(installed, release({ version: "1.0.1", build: null })), "update-available");
    assert.equal(updateState(installed, release({ version: "9.9.9", build: "99" })), "update-available");
    assert.equal(updateState(installed, release({ version: "1.0.0", build: "2" })), "update-available");
  });
  it("blocks when this build is below the supported floor", () => {
    assert.equal(
      updateState(installed, release({ version: "9.9.9", minSupportedVersion: "9.0.0" })),
      "unsupported",
    );
    assert.equal(
      updateState(installed, release({ version: "1.0.1", minSupportedVersion: "1.0.0" })),
      "update-available",
    );
  });
});

describe("snooze", () => {
  const now = Date.parse("2026-09-07T10:00:00.000Z");
  const rel = release({ version: "1.1.0", build: "7" });

  it("keys a release by version, plus build when present", () => {
    assert.equal(releaseKey(rel), "1.1.0+7");
    assert.equal(releaseKey(release({ build: null })), "1.1.0");
  });
  it("hides the same release for 24 hours, then lets it back", () => {
    const snooze = snoozeRelease(rel, now);
    assert.equal(snooze.until, now + SNOOZE_MS);
    assert.equal(isSnoozed(snooze, rel, now), true);
    assert.equal(isSnoozed(snooze, rel, now + SNOOZE_MS - 1), true);
    assert.equal(isSnoozed(snooze, rel, now + SNOOZE_MS), false);
  });
  it("does not hide a different release", () => {
    const snooze = snoozeRelease(rel, now);
    assert.equal(isSnoozed(snooze, release({ version: "1.2.0" }), now), false);
    assert.equal(isSnoozed(snooze, release({ version: "1.1.0", build: "8" }), now), false);
    assert.equal(isSnoozed(null, rel, now), false);
  });
  it("round-trips through storage and shrugs off corruption", () => {
    const snooze = snoozeRelease(rel, now);
    assert.deepEqual(parseSnooze(JSON.stringify(snooze)), snooze);
    assert.equal(parseSnooze(null), null);
    assert.equal(parseSnooze(""), null);
    assert.equal(parseSnooze("{not json"), null);
    assert.equal(parseSnooze(JSON.stringify({ release: "1.1.0" })), null);
    assert.equal(parseSnooze(JSON.stringify({ release: 1, until: 5 })), null);
    assert.equal(parseSnooze(JSON.stringify({ release: "1.1.0", until: "soon" })), null);
  });
});

describe("parseReleasesResponse", () => {
  it("accepts the contract shape", () => {
    const ios = release({ version: "9.9.9", build: "99", releaseNotes: "Faster search" });
    const android = release({
      platform: "android",
      version: "1.2.0",
      build: null,
      downloadUrl: "https://play.google.com/store/apps/details?id=ai.purecode.bookmarkai",
    });
    const parsed = parseReleasesResponse({ releases: { ios, android } });
    assert.ok(parsed);
    assert.deepEqual(parsed.releases.ios, ios);
    assert.deepEqual(parsed.releases.android, android);
    assert.equal(parsed.releases.macos, undefined);
  });
  it("returns an empty map for no records", () => {
    assert.deepEqual(parseReleasesResponse({ releases: {} }), { releases: {} });
  });
  it("is null for anything that is not the contract", () => {
    assert.equal(parseReleasesResponse(null), null);
    assert.equal(parseReleasesResponse("nope"), null);
    assert.equal(parseReleasesResponse({ error: "Too many requests" }), null);
    assert.equal(parseReleasesResponse({ releases: "x" }), null);
    // A record missing what the client needs to compare/act fails the body.
    assert.equal(parseReleasesResponse({ releases: { ios: { version: "1.0.0" } } }), null);
  });
});

describe("releaseNotesLine", () => {
  it("takes the first meaningful line without markdown furniture", () => {
    assert.equal(releaseNotesLine("Faster search"), "Faster search");
    assert.equal(releaseNotesLine("\n\n- **Faster** search\n- Fixes"), "Faster search");
    assert.equal(releaseNotesLine("## What's new\nSync   is  quicker"), "What's new");
    assert.equal(releaseNotesLine("1. `Live` tabs on iPad"), "Live tabs on iPad");
  });
  it("is null when there is nothing to say", () => {
    assert.equal(releaseNotesLine(null), null);
    assert.equal(releaseNotesLine(""), null);
    assert.equal(releaseNotesLine("   \n\n"), null);
  });
});

describe("bannerFor", () => {
  const now = Date.parse("2026-09-07T10:00:00.000Z");
  const rel = release({ version: "9.9.9", build: "99" });

  it("shows a dismissible banner for a newer release", () => {
    assert.deepEqual(bannerFor({ current: installed, release: rel, snooze: null, now }), {
      release: rel,
      state: "update-available",
    });
  });
  it("shows nothing without a record, a version, or anything newer", () => {
    assert.equal(bannerFor({ current: installed, release: undefined, snooze: null, now }), null);
    assert.equal(bannerFor({ current: installed, release: null, snooze: null, now }), null);
    assert.equal(bannerFor({ current: null, release: rel, snooze: null, now }), null);
    assert.equal(
      bannerFor({ current: installed, release: release({ version: "1.0.0", build: "1" }), snooze: null, now }),
      null,
    );
  });
  it("honours a live snooze and forgets an expired one", () => {
    const snooze = snoozeRelease(rel, now);
    assert.equal(bannerFor({ current: installed, release: rel, snooze, now: now + 1000 }), null);
    assert.equal(
      bannerFor({ current: installed, release: rel, snooze, now: now + SNOOZE_MS })?.state,
      "update-available",
    );
    // A snooze on last week's release says nothing about this one.
    const stale = snoozeRelease(release({ version: "1.0.5", build: "3" }), now);
    assert.equal(bannerFor({ current: installed, release: rel, snooze: stale, now })?.state, "update-available");
  });
  it("never lets a snooze hide the unsupported variant", () => {
    const blocking = release({ version: "9.9.9", build: "99", minSupportedVersion: "9.0.0" });
    const snooze = snoozeRelease(blocking, now);
    assert.deepEqual(bannerFor({ current: installed, release: blocking, snooze, now }), {
      release: blocking,
      state: "unsupported",
    });
  });
});
