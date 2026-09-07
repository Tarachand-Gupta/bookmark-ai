import { describe, expect, it } from "vitest";
import type { AppReleaseMap } from "@bookmark-ai/types";
import {
  CHROME_WEB_STORE_URL,
  PLATFORMS,
  RELEASE_TAGS,
  badgeForStatus,
  downloadAnchor,
  getPlatform,
  isHttps,
  releaseAssetUrl,
  releaseTagUrl,
  resolveDownload,
  storeUrlFor,
  urlsOf,
  type PlatformId,
} from "./platforms";
import {
  EXTENSION_STORE_URLS,
  GENERIC_EXTENSION_TARGET,
  extensionTargetForBrowser,
} from "./extension-links";

const EXPECTED_IDS: PlatformId[] = ["chrome", "firefox", "safari", "macos", "ios", "android", "web"];

describe("platform list", () => {
  it("lists every platform exactly once, in display order", () => {
    expect(PLATFORMS.map((p) => p.id)).toEqual(EXPECTED_IDS);
    for (const id of EXPECTED_IDS) expect(getPlatform(id).id).toBe(id);
  });

  it("uses only https URLs and never a placeholder", () => {
    for (const entry of PLATFORMS) {
      for (const url of urlsOf(entry)) {
        if (url.startsWith("/")) continue; // same-origin app link
        expect(url, `${entry.id}: ${url}`).toMatch(/^https:\/\//);
        expect(url).not.toContain("example.com");
        expect(url).not.toContain("REPLACE");
        expect(url).not.toContain("FILL_IN");
      }
    }
  });

  it("never links the /releases/latest alias — tags only", () => {
    for (const entry of PLATFORMS) {
      for (const url of urlsOf(entry)) expect(url).not.toContain("/releases/latest");
    }
  });

  it("gives every non-available entry a status badge and no primary download", () => {
    for (const entry of PLATFORMS) {
      if (entry.status === "review") expect(entry.badge).toBe("Under review");
      if (entry.status === "soon") expect(entry.badge).toBe("Coming soon");
      if (entry.status !== "available") expect(entry.action.type).not.toBe("download");
      expect(entry.steps.length).toBeGreaterThan(0);
    }
    expect(badgeForStatus("available")).toBeNull();
  });

  it("copy never claims a store listing is available or submitted where it is not", () => {
    const text = (id: PlatformId) => {
      const e = getPlatform(id);
      return [e.blurb, e.note ?? "", ...e.steps, ...(e.source?.notes ?? [])].join(" ").toLowerCase();
    };
    // Submitted → "under review", never "available now".
    for (const id of ["chrome", "firefox"] as const) {
      expect(getPlatform(id).status).toBe("review");
      expect(text(id)).toContain("under review");
    }
    // Not submitted → "coming soon", and never the word "submitted" as a claim.
    for (const id of ["safari", "ios"] as const) {
      expect(getPlatform(id).status).toBe("soon");
      expect(text(id)).toContain("coming soon");
      expect(text(id)).not.toMatch(/has been submitted|was submitted/);
    }
    expect(text("macos")).not.toContain("notarized by apple ");
    expect(text("macos")).toContain("not notarized");
  });

  it("points the native downloads at the fixed release tags", () => {
    const macos = getPlatform("macos");
    const android = getPlatform("android");
    expect(macos.action).toMatchObject({
      type: "download",
      releasePlatform: "macos",
      version: "0.1.0",
      url: `https://github.com/Tarachand-Gupta/bookmark-ai/releases/download/${RELEASE_TAGS.macos}/BookmarkAI-0.1.0-macos.zip`,
    });
    expect(android.action).toMatchObject({
      type: "download",
      releasePlatform: "android",
      version: "1.0.1",
      url: `https://github.com/Tarachand-Gupta/bookmark-ai/releases/download/${RELEASE_TAGS.android}/bookmark-ai-1.0.1-android.apk`,
    });
    expect(getPlatform("chrome").sideload?.url).toBe(
      releaseAssetUrl(RELEASE_TAGS.extension, "bookmark-aiextension-0.1.2-chrome.zip"),
    );
    expect(getPlatform("firefox").sideload?.url).toBe(
      releaseAssetUrl(RELEASE_TAGS.extension, "bookmark-aiextension-0.1.2-firefox.zip"),
    );
    expect(releaseTagUrl("macos-v0.1.0")).toBe(
      "https://github.com/Tarachand-Gupta/bookmark-ai/releases/tag/macos-v0.1.0",
    );
  });

  it("documents the macOS first-launch path and the Android unknown-sources path", () => {
    const mac = getPlatform("macos").steps.join(" ");
    expect(mac).toContain("Open Anyway");
    expect(mac).toContain("Privacy & Security");
    expect(getPlatform("macos").requires).toContain("macOS 14");
    const android = getPlatform("android").steps.join(" ");
    expect(android).toContain("Install unknown apps");
    expect(android).toContain("bookmark-ai.cloud");
    expect(getPlatform("android").requires).toContain("Android 8");
  });

  it("offers build-from-source for Safari and iOS with the real commands", () => {
    expect(getPlatform("safari").source?.commands).toContain(
      "corepack pnpm --filter @bookmark-ai/extension safari:xcode -- --install",
    );
    expect(getPlatform("ios").source?.commands).toContain(
      "cd apps/mobile && npx expo run:ios --device",
    );
    expect(getPlatform("ios").source?.notes.join(" ")).toContain("7 days");
  });
});

describe("store URLs", () => {
  it("withholds the Chrome Web Store URL while the listing is under review", () => {
    expect(CHROME_WEB_STORE_URL).toBe(
      "https://chromewebstore.google.com/detail/ffhbgpgebpmofjkehpjcemepbgcmoelp",
    );
    expect(storeUrlFor("chrome")).toBeNull();
    expect(storeUrlFor("firefox")).toBeNull();
    expect(storeUrlFor("safari")).toBeNull();
    expect(storeUrlFor("macos")).toBeNull();
  });

  it("anchors to the platform's card on /download", () => {
    expect(downloadAnchor("safari")).toBe("/download#safari");
  });
});

describe("resolveDownload", () => {
  const releases: AppReleaseMap = {
    macos: {
      platform: "macos",
      version: "0.2.0",
      build: "2",
      minSupportedVersion: null,
      downloadUrl: "https://github.com/Tarachand-Gupta/bookmark-ai/releases/download/macos-v0.2.0/BookmarkAI-0.2.0-macos.zip",
      releaseNotes: null,
      publishedAt: "2026-09-08T00:00:00.000Z",
      updatedAt: "2026-09-08T00:00:00.000Z",
    },
  };

  it("prefers the published release record", () => {
    expect(resolveDownload(getPlatform("macos").action, releases)).toEqual({
      url: releases.macos!.downloadUrl,
      version: "0.2.0",
      source: "release",
    });
  });

  it("falls back to the static tag URL without a record, or with a non-https one", () => {
    const action = getPlatform("android").action;
    expect(resolveDownload(action, releases)).toMatchObject({ version: "1.0.1", source: "static" });
    expect(resolveDownload(action, null)).toMatchObject({ source: "static" });
    const bad: AppReleaseMap = {
      android: { ...releases.macos!, platform: "android", downloadUrl: "http://evil.example" },
    };
    expect(resolveDownload(action, bad)).toMatchObject({ source: "static" });
  });

  it("is null for open/none actions", () => {
    expect(resolveDownload(getPlatform("web").action, releases)).toBeNull();
    expect(resolveDownload(getPlatform("safari").action, releases)).toBeNull();
  });

  it("isHttps", () => {
    expect(isHttps("https://a.b/c")).toBe(true);
    expect(isHttps("http://a.b")).toBe(false);
    expect(isHttps("nope")).toBe(false);
  });
});

describe("extension-links derives from platforms", () => {
  it("has no placeholder and only https or /download links", () => {
    for (const url of Object.values(EXTENSION_STORE_URLS)) {
      expect(url).not.toContain("example.com");
      expect(url).toMatch(/^(https:\/\/|\/download)/);
    }
  });

  it("sends Chromium browsers to the Chrome entry, under review → /download#chrome", () => {
    for (const browser of ["chrome", "edge", "arc"] as const) {
      const t = extensionTargetForBrowser(browser);
      expect(t.platform).toBe("chrome");
      expect(t.status).toBe("review");
      expect(t.url).toBe("/download#chrome");
      expect(t.external).toBe(false);
    }
    // Under review, the label is honest rather than "Add to Edge" pointing at a 404.
    expect(extensionTargetForBrowser("edge").label).toBe("Install options");
    expect(extensionTargetForBrowser("firefox").url).toBe("/download#firefox");
    expect(extensionTargetForBrowser("safari").status).toBe("soon");
    expect(GENERIC_EXTENSION_TARGET.url).toBe("/download");
    expect(extensionTargetForBrowser("other")).toEqual(GENERIC_EXTENSION_TARGET);
  });

  it("carries a human status line for the in-app card", () => {
    expect(extensionTargetForBrowser("chrome").statusNote).toMatch(/under review/i);
    expect(extensionTargetForBrowser("safari").statusNote).toMatch(/coming soon/i);
  });
});
