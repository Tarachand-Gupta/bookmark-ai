import { describe, expect, it } from "vitest";
import type { AppReleaseMap } from "@bookmark-ai/types";
import {
  CHROME_WEB_STORE_URL,
  FIREFOX_ADDONS_URL,
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
  type PlatformAction,
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
      if (entry.status === "soon") expect(entry.badge).toBeTruthy();
      if (entry.status !== "available") expect(entry.action.type).not.toBe("download");
      expect(entry.steps.length).toBeGreaterThan(0);
    }
    expect(badgeForStatus("available")).toBeNull();
  });

  it("copy never claims a store listing is in review or coming where it is not", () => {
    const text = (id: PlatformId) => {
      const e = getPlatform(id);
      return [e.blurb, e.note ?? "", ...e.steps, ...(e.source?.notes ?? [])].join(" ").toLowerCase();
    };
    expect(getPlatform("chrome").status).toBe("available");
    expect(text("chrome")).not.toContain("under review");
    expect(getPlatform("firefox").status).toBe("review");
    expect(text("firefox")).toContain("awaiting review");
    // Not submitted → "coming soon", and never the word "submitted" as a claim.
    for (const id of ["safari", "ios"] as const) {
      expect(getPlatform(id).status).toBe("soon");
      expect(text(id)).toContain("coming soon");
      expect(text(id)).not.toMatch(/has been submitted|was submitted/);
    }
    expect(getPlatform("macos").status).toBe("soon");
    expect(getPlatform("macos").badge).toBe("Update coming soon");
    expect(getPlatform("macos").action).toEqual({ type: "none" });
    expect(text("macos")).toContain("updated");
    expect(getPlatform("android").status).toBe("available");
    expect(getPlatform("android").badge).toBeNull();
    expect(text("android")).toContain("google play listing is still being prepared");
  });

  it("keeps published extension assets on fixed release tags", () => {
    expect(getPlatform("chrome").sideload?.url).toBe(
      releaseAssetUrl(RELEASE_TAGS.extension, "bookmark-aiextension-0.1.3-chrome.zip"),
    );
    expect(getPlatform("firefox").sideload).toBeNull();
    expect(releaseTagUrl("macos-v0.1.0")).toBe(
      "https://github.com/Tarachand-Gupta/bookmark-ai/releases/tag/macos-v0.1.0",
    );
  });

  it("keeps unavailable Mac downloads gated and exposes only the verified Android APK", () => {
    expect(getPlatform("macos").action).toEqual({ type: "none" });
    expect(getPlatform("macos").requires).toContain("macOS 14");
    expect(getPlatform("android").requires).toContain("Android 7.0");
    expect(getPlatform("android").action).toEqual({
      type: "download",
      url: releaseAssetUrl(RELEASE_TAGS.android, "BookmarkAI-Android-1.0.1-3.apk"),
      version: "1.0.1",
      build: "3",
      releasePlatform: "android",
      fileName: "BookmarkAI-Android-1.0.1-3.apk",
    });
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
  it("links only public marketplace listings", () => {
    expect(CHROME_WEB_STORE_URL).toBe(
      "https://chromewebstore.google.com/detail/ffhbgpgebpmofjkehpjcemepbgcmoelp",
    );
    expect(storeUrlFor("chrome")).toBe(CHROME_WEB_STORE_URL);
    expect(FIREFOX_ADDONS_URL).toBe(
      "https://addons.mozilla.org/firefox/addon/bookmark-ai-cloud/",
    );
    expect(storeUrlFor("firefox")).toBeNull();
    expect(storeUrlFor("safari")).toBeNull();
    expect(storeUrlFor("macos")).toBeNull();
  });

  it("anchors to the platform's card on /download", () => {
    expect(downloadAnchor("safari")).toBe("/download#safari");
  });
});

describe("resolveDownload", () => {
  const downloadable: PlatformAction = {
    type: "download",
    url: "https://github.com/Tarachand-Gupta/bookmark-ai/releases/download/macos-v0.1.0/BookmarkAI-0.1.0-macos.zip",
    version: "0.1.0",
    releasePlatform: "macos",
    fileName: "BookmarkAI-0.1.0-macos.zip",
  };
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
    expect(resolveDownload(downloadable, releases)).toEqual({
      url: releases.macos!.downloadUrl,
      version: "0.2.0",
      source: "release",
    });
  });

  it("falls back to the static tag URL without a record, or with a non-https one", () => {
    const action = { ...downloadable, releasePlatform: "android" as const };
    expect(resolveDownload(action, releases)).toMatchObject({ version: "0.1.0", source: "static" });
    expect(resolveDownload(action, null)).toMatchObject({ source: "static" });
    const bad: AppReleaseMap = {
      android: { ...releases.macos!, platform: "android", downloadUrl: "http://evil.example" },
    };
    expect(resolveDownload(action, bad)).toMatchObject({ source: "static" });
  });

  it("does not let an older release record override a newer static build", () => {
    const android = getPlatform("android").action;
    const stale: AppReleaseMap = {
      android: {
        ...releases.macos!,
        platform: "android",
        version: "1.0.1",
        build: "2",
        downloadUrl:
          "https://github.com/Tarachand-Gupta/bookmark-ai/releases/download/android-v1.0.1/bookmark-ai-1.0.1-android.apk",
      },
    };
    expect(resolveDownload(android, stale)).toMatchObject({ source: "static", version: "1.0.1" });
  });

  it("is null for open/none actions", () => {
    expect(resolveDownload(getPlatform("web").action, releases)).toBeNull();
    expect(resolveDownload(getPlatform("safari").action, releases)).toBeNull();
    expect(resolveDownload(getPlatform("macos").action, releases)).toBeNull();
    expect(resolveDownload(getPlatform("android").action, releases)).toMatchObject({
      source: "static",
      version: "1.0.1",
    });
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

  it("sends Chromium browsers to the Chrome Web Store listing", () => {
    for (const browser of ["chrome", "edge", "arc"] as const) {
      const t = extensionTargetForBrowser(browser);
      expect(t.platform).toBe("chrome");
      expect(t.status).toBe("available");
      expect(t.url).toBe(CHROME_WEB_STORE_URL);
      expect(t.external).toBe(true);
      expect(t.label).toBe(
        browser === "chrome" ? "Add to Chrome" : browser === "edge" ? "Add to Edge" : "Add to Arc",
      );
    }
    expect(extensionTargetForBrowser("firefox").status).toBe("review");
    expect(extensionTargetForBrowser("firefox").url).toBe("/download#firefox");
    expect(extensionTargetForBrowser("firefox").label).toBe("Install options");
    expect(extensionTargetForBrowser("safari").status).toBe("soon");
    expect(GENERIC_EXTENSION_TARGET.url).toBe("/download");
    expect(extensionTargetForBrowser("other")).toEqual(GENERIC_EXTENSION_TARGET);
  });

  it("carries a human status line for the in-app card", () => {
    expect(extensionTargetForBrowser("chrome").statusNote).toBeNull();
    expect(extensionTargetForBrowser("firefox").statusNote).toMatch(/under review/i);
    expect(extensionTargetForBrowser("firefox").statusNote).toMatch(/web app/i);
    expect(extensionTargetForBrowser("safari").statusNote).toMatch(/coming soon/i);
  });
});
