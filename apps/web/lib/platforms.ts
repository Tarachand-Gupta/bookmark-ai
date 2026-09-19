import { compareVersions, type AppPlatform, type AppReleaseMap } from "@bookmark-ai/types";

/**
 * Every way to get Bookmark AI, with an HONEST availability state — the one
 * source of truth behind the homepage platform section, the /download page, the
 * in-app "Get the extension" card and `extension-links.ts`.
 *
 * Status vocabulary (never say more than is true):
 * - `available` — a working download or store listing exists today.
 * - `review`    — a store listing has been SUBMITTED and is under review. The
 *                 store URL is known but 404s until approval, so nothing links
 *                 to it while the status is `review`; sideload/source instead.
 * - `soon`      — not submitted anywhere yet. Build from source or wait.
 *
 * Native downloads are GitHub Release assets on a per-platform tag. The `/releases/latest`
 * alias is NOT used: "latest" is whichever platform shipped last, so a fixed
 * tag is the only stable form. When `GET /api/app/releases` carries a record for
 * a platform, `resolveDownload` prefers that record — so downloads can be
 * re-pointed from Settings → Releases without a deploy. Pure; tested in
 * platforms.test.ts.
 */

export const REPO_URL = "https://github.com/Tarachand-Gupta/bookmark-ai";
export const RELEASES_URL = `${REPO_URL}/releases`;

/** GitHub release page for a tag. */
export function releaseTagUrl(tag: string): string {
  return `${REPO_URL}/releases/tag/${tag}`;
}

/** A GitHub release asset on a tag — the direct download link. */
export function releaseAssetUrl(tag: string, file: string): string {
  return `${REPO_URL}/releases/download/${tag}/${file}`;
}

/** Release tags the static fallbacks point at. Bump here when a new build ships. */
export const RELEASE_TAGS = {
  macos: "macos-v0.1.0",
  android: "android-release-1.0.1-build3",
  extension: "extension-v0.1.3",
} as const;

/**
 * The Chrome Web Store item id is pinned (the extension's manifest `key`), so
 * the listing URL is stable. LIVE since 2026-09-13.
 */
export const CHROME_WEB_STORE_ID = "ffhbgpgebpmofjkehpjcemepbgcmoelp";
export const CHROME_WEB_STORE_URL = `https://chromewebstore.google.com/detail/${CHROME_WEB_STORE_ID}`;

/**
 * Replacement Firefox Add-ons (AMO) listing for add-on id
 * `bookmark-ai@bookmark-ai.cloud`. Version 0.1.4 is awaiting review; the URL is
 * known but is not linked until AMO makes the listing public.
 */
export const FIREFOX_ADDONS_URL = "https://addons.mozilla.org/firefox/addon/bookmark-ai-cloud/";

export const WEB_APP_URL = "https://www.bookmark-ai.cloud/app";
export const SIGN_UP_URL = "https://www.bookmark-ai.cloud/sign-up";
export const DOCS_URL = "https://docs.bookmark-ai.cloud";

/** Repo docs the long recipes live in — linked, not duplicated. */
export const SOURCE_DOCS = {
  safari: `${REPO_URL}/blob/main/docs/safari-store-readiness.md`,
  mobile: `${REPO_URL}/blob/main/docs/mobile-store-readiness.md`,
  testing: `${REPO_URL}/blob/main/docs/TESTING.md`,
  extension: `${REPO_URL}/blob/main/apps/extension/README.md`,
  macos: `${REPO_URL}/blob/main/apps/macos/README.md`,
} as const;

export type PlatformId = "chrome" | "firefox" | "safari" | "macos" | "ios" | "android" | "web";
export type PlatformKind = "extension" | "app" | "web";
export type PlatformStatus = "available" | "review" | "soon";
export type PlatformIcon =
  | "chrome"
  | "firefox"
  | "safari"
  | "macos"
  | "ios"
  | "android"
  | "windows"
  | "linux"
  | "web";

/** What the primary button does. */
export type PlatformAction =
  | {
      type: "download";
      /** Static fallback: the direct asset URL on a fixed release tag. */
      url: string;
      /** Version the static asset carries — shown next to the button. */
      version: string;
      /** Build the static asset carries, when it matters within the same version. */
      build?: string;
      /** The release-record key (`GET /api/app/releases`) that can override `url`. */
      releasePlatform: AppPlatform | null;
      /** File the button hands over, for the caption. */
      fileName: string;
    }
  | { type: "open"; url: string; label: string }
  | { type: "none" };

/** A secondary artefact: the unpacked-extension zip you can sideload. */
export interface SideloadAsset {
  url: string;
  fileName: string;
  version: string;
}

export interface SourceRecipe {
  /** Shell lines, verbatim. */
  commands: string[];
  /** Prose after the commands. */
  notes: string[];
  requirements: string;
  docsUrl: string;
}

export interface PlatformEntry {
  id: PlatformId;
  name: string;
  kind: PlatformKind;
  status: PlatformStatus;
  icon: PlatformIcon;
  /** One line under the name. */
  blurb: string;
  /** Status pill text, or null for a plain available entry. */
  badge: string | null;
  /** "macOS 14 or later" etc.; null when nothing to say. */
  requires: string | null;
  action: PlatformAction;
  sideload: SideloadAsset | null;
  /** Numbered "How to install" steps — short, exact, in order. */
  steps: string[];
  /** "Build from source" recipe, only where it is a real path for users. */
  source: SourceRecipe | null;
  /** A one-line caveat shown under the steps (signing, store status…). */
  note: string | null;
}

const BADGE: Record<PlatformStatus, string | null> = {
  available: null,
  review: "Under review",
  soon: "Coming soon",
};

export const PLATFORMS: readonly PlatformEntry[] = [
  {
    id: "chrome",
    name: "Chrome, Edge & Arc",
    kind: "extension",
    status: "available",
    icon: "chrome",
    blurb: "One-click save from the toolbar, whole-window sessions, live tabs.",
    badge: null,
    requires: "Any Chromium browser (Chrome, Edge, Arc, Brave, Vivaldi)",
    action: { type: "open", url: CHROME_WEB_STORE_URL, label: "Add to Chrome" },
    sideload: {
      url: releaseAssetUrl(RELEASE_TAGS.extension, "bookmark-aiextension-0.1.3-chrome.zip"),
      fileName: "bookmark-aiextension-0.1.3-chrome.zip",
      version: "0.1.3",
    },
    steps: [
      "Click Add to Chrome above — the Chrome Web Store opens in a new tab.",
      "Click Add extension and confirm the permissions prompt.",
      "Pin Bookmark AI from the extensions menu and click its icon to save the current tab.",
      "Sign in at bookmark-ai.cloud in the same browser — the extension mirrors that session; there is no separate sign-in.",
    ],
    source: null,
    note: "The store version auto-updates. Where the Web Store is blocked, download the zip below and load it unpacked via chrome://extensions.",
  },
  {
    id: "firefox",
    name: "Firefox",
    kind: "extension",
    status: "review",
    icon: "firefox",
    blurb: "Save and search without leaving Firefox.",
    badge: BADGE.review,
    requires: "Firefox 140 or later",
    action: { type: "none" },
    sideload: null,
    steps: [
      "The replacement Firefox Add-ons listing is awaiting review.",
      "Once it is public, install version 0.1.4 from Firefox Add-ons and confirm the permissions prompt.",
      "Sign in at bookmark-ai.cloud in Firefox — the extension mirrors that session.",
    ],
    source: null,
    note: "The previous public listing is intentionally not linked. This page will point to the replacement listing after approval.",
  },
  {
    id: "safari",
    name: "Safari",
    kind: "extension",
    status: "soon",
    icon: "safari",
    blurb: "Native Safari web extension with a menu-bar companion app.",
    badge: BADGE.soon,
    requires: "macOS 14 or later",
    action: { type: "none" },
    sideload: null,
    steps: [
      "The Mac App Store version is coming soon — it has not been submitted yet.",
      "Meanwhile: build it from source with Xcode (below), or use the web app in Safari.",
      "After the build installs, open Safari ▸ Settings ▸ Extensions and tick Bookmark AI.",
      "Sign in at bookmark-ai.cloud in Safari — the extension mirrors that session.",
    ],
    source: {
      requirements: "macOS 14+, Xcode 16 or later, Node 22, pnpm (via corepack)",
      commands: [
        "git clone https://github.com/Tarachand-Gupta/bookmark-ai.git",
        "cd bookmark-ai && corepack pnpm install",
        "corepack pnpm --filter @bookmark-ai/extension safari:xcode -- --install",
      ],
      notes: [
        "The build is signed with the Apple Development identity Xcode finds in your keychain and installs /Applications/Bookmark AI.app, whose menu bar item walks you through turning the extension on.",
        "With no signing identity the build is ad-hoc signed: Safari then loads it only after Safari ▸ Develop ▸ Allow Unsigned Extensions (enable the Develop menu under Settings ▸ Advanced), and that switch resets every time Safari quits.",
      ],
      docsUrl: SOURCE_DOCS.safari,
    },
    note: null,
  },
  {
    id: "macos",
    name: "macOS app",
    kind: "app",
    status: "soon",
    icon: "macos",
    blurb: "A native Mac app for your library, search and live tabs.",
    badge: "Update coming soon",
    requires: "macOS 14 (Sonoma) or later, Apple silicon or Intel",
    action: { type: "none" },
    sideload: null,
    steps: [
      "An updated Mac download is being prepared.",
      "Use the web app in Safari, Chrome or Edge in the meantime; it has the same library and search.",
    ],
    source: {
      requirements: "macOS 14+, Xcode 16 or later, XcodeGen",
      commands: [
        "git clone https://github.com/Tarachand-Gupta/bookmark-ai.git",
        "brew install xcodegen",
        "cd bookmark-ai/apps/macos && xcodegen generate && open BookmarkAI.xcodeproj",
      ],
      notes: ["Build and run the BookmarkAI scheme in Xcode (⌘R)."],
      docsUrl: SOURCE_DOCS.macos,
    },
    note: "The previous download is no longer offered. The replacement will appear here when it is ready.",
  },
  {
    id: "ios",
    name: "iPhone & iPad",
    kind: "app",
    status: "soon",
    icon: "ios",
    blurb: "Your library, search and live tabs on iPhone and iPad, plus a share-sheet save.",
    badge: BADGE.soon,
    requires: "iOS / iPadOS 16.4 or later",
    action: { type: "open", url: WEB_APP_URL, label: "Add the web app" },
    sideload: null,
    steps: [
      "The App Store version is coming soon — it has not been submitted yet.",
      "Meanwhile, install the web app: open bookmark-ai.cloud/app in Safari, tap Share, then Add to Home Screen. It opens full-screen like an app.",
      "Or build the native app from source with Xcode (below) and run it on your own device.",
    ],
    source: {
      requirements: "macOS with Xcode 16 or later, Node 22, an Apple ID (a free developer account works)",
      commands: [
        "git clone https://github.com/Tarachand-Gupta/bookmark-ai.git",
        "cd bookmark-ai && corepack pnpm install",
        "cd apps/mobile && npx expo run:ios --device",
      ],
      notes: [
        "Pick your iPhone or iPad when prompted; Xcode signs the build with your Apple ID.",
        "With a free Apple developer account the app expires after 7 days — run the command again to re-sign it. A paid account keeps it for a year.",
      ],
      docsUrl: SOURCE_DOCS.mobile,
    },
    note: null,
  },
  {
    id: "android",
    name: "Android",
    kind: "app",
    status: "available",
    icon: "android",
    blurb: "The same library, search and live tabs on Android, plus a share-sheet save.",
    badge: null,
    requires: "Android 7.0 or later",
    action: {
      type: "download",
      url: releaseAssetUrl(RELEASE_TAGS.android, "BookmarkAI-Android-1.0.1-3.apk"),
      version: "1.0.1",
      build: "3",
      releasePlatform: "android",
      fileName: "BookmarkAI-Android-1.0.1-3.apk",
    },
    sideload: null,
    steps: [
      "Download the signed Bookmark AI APK above.",
      "Open the downloaded file. If Android asks, allow installs from this browser or file manager, then confirm Install.",
      "Open Bookmark AI and sign in; shared links and text can be saved from Android's share sheet.",
    ],
    source: {
      requirements: "Node 22, Android Studio with SDK 36 and JDK 17",
      commands: [
        "git clone https://github.com/Tarachand-Gupta/bookmark-ai.git",
        "cd bookmark-ai && corepack pnpm install",
        "cd apps/mobile && npx expo run:android --variant release",
      ],
      notes: ["Installs onto the connected device or running emulator."],
      docsUrl: SOURCE_DOCS.mobile,
    },
    note: "The direct APK is available now. The Google Play listing is still being prepared.",
  },
  {
    id: "web",
    name: "Web app",
    kind: "web",
    status: "available",
    icon: "web",
    blurb: "Your full library in any browser — nothing to install.",
    badge: null,
    requires: null,
    action: { type: "open", url: "/app", label: "Open the web app" },
    sideload: null,
    steps: [
      "Open bookmark-ai.cloud/app and sign in (or create a free account).",
      "iPhone / iPad: in Safari tap Share, then Add to Home Screen for a full-screen app.",
      "Android: in Chrome tap ⋮, then Add to Home screen (or Install app).",
      "Desktop Chrome and Edge: click the install icon at the right end of the address bar.",
    ],
    source: null,
    note: null,
  },
];

export function getPlatform(id: PlatformId): PlatformEntry {
  const entry = PLATFORMS.find((p) => p.id === id);
  if (!entry) throw new Error(`unknown platform ${id}`);
  return entry;
}

/** Status pill text for a status, e.g. for callers that only have the status. */
export function badgeForStatus(status: PlatformStatus): string | null {
  return BADGE[status];
}

/**
 * The store listing to link for an extension platform: only once it is
 * `available`. Only Safari's Mac App Store URL is still unknown — Safari is
 * `soon`, so callers get null and should send people to /download#safari.
 */
export function storeUrlFor(id: PlatformId): string | null {
  const entry = getPlatform(id);
  if (entry.kind !== "extension" || entry.status !== "available") return null;
  if (id === "chrome") return CHROME_WEB_STORE_URL;
  if (id === "firefox") return FIREFOX_ADDONS_URL;
  return null;
}

/** Anchor on the download page for a platform's card. */
export function downloadAnchor(id: PlatformId): string {
  return `/download#${id}`;
}

export interface ResolvedDownload {
  url: string;
  version: string | null;
  /** Where the URL came from. */
  source: "release" | "static";
}

/**
 * The URL a Download button should hand over: the published release record
 * for that platform when one exists (an https URL is guaranteed by the API
 * schema, but it is re-checked because this runs on untrusted input), else the
 * static asset on the fixed tag.
 */
export function resolveDownload(
  action: PlatformAction,
  releases: AppReleaseMap | null | undefined,
): ResolvedDownload | null {
  if (action.type !== "download") return null;
  const record = action.releasePlatform && releases ? releases[action.releasePlatform] : undefined;
  const staticRelease = { version: action.version, build: action.build ?? null };
  if (
    record &&
    isHttps(record.downloadUrl) &&
    compareVersions({ version: record.version, build: record.build }, staticRelease) >= 0
  ) {
    return { url: record.downloadUrl, version: record.version || null, source: "release" };
  }
  return { url: action.url, version: action.version, source: "static" };
}

export function isHttps(value: string): boolean {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Every external URL an entry references — for the "all https" invariant test. */
export function urlsOf(entry: PlatformEntry): string[] {
  const urls: string[] = [];
  if (entry.action.type === "download" || entry.action.type === "open") urls.push(entry.action.url);
  if (entry.sideload) urls.push(entry.sideload.url);
  if (entry.source) urls.push(entry.source.docsUrl);
  return urls;
}
