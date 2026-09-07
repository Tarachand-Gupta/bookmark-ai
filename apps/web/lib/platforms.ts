import type { AppPlatform, AppReleaseMap } from "@bookmark-ai/types";

/**
 * Every way to get Bookmark AI, with an HONEST availability state — the one
 * source of truth behind the homepage platform section, the /download page, the
 * in-app "Get the extension" card and `extension-links.ts`.
 *
 * Status vocabulary (never say more than is true):
 * - `available` — a working download or URL exists today.
 * - `review`    — a store listing has been SUBMITTED and is under review. The
 *                 store URL is known but 404s until approval, so nothing links
 *                 to it while the status is `review`; sideload/source instead.
 * - `soon`      — not submitted anywhere yet. Build from source or wait.
 *
 * Native downloads are GitHub Release assets on a per-platform tag
 * (`macos-v0.1.0`, `android-v1.0.1`, `extension-v0.1.2`). The `/releases/latest`
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
  android: "android-v1.0.1",
  extension: "extension-v0.1.2",
} as const;

/**
 * The Chrome Web Store item id is pinned (the extension's manifest `key`), so
 * the listing URL is known before approval — but it answers 404 until then.
 * Kept here so nothing has to guess it later; NOT linked while status is
 * `review` (see `storeUrlFor`).
 */
export const CHROME_WEB_STORE_ID = "ffhbgpgebpmofjkehpjcemepbgcmoelp";
export const CHROME_WEB_STORE_URL = `https://chromewebstore.google.com/detail/${CHROME_WEB_STORE_ID}`;

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
export type PlatformIcon = "chrome" | "firefox" | "safari" | "macos" | "ios" | "android" | "web";

/** What the primary button does. */
export type PlatformAction =
  | {
      type: "download";
      /** Static fallback: the direct asset URL on a fixed release tag. */
      url: string;
      /** Version the static asset carries — shown next to the button. */
      version: string;
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
    status: "review",
    icon: "chrome",
    blurb: "One-click save from the toolbar, whole-window sessions, live tabs.",
    badge: BADGE.review,
    requires: "Any Chromium browser (Chrome, Edge, Arc, Brave, Vivaldi)",
    action: { type: "none" },
    sideload: {
      url: releaseAssetUrl(RELEASE_TAGS.extension, "bookmark-aiextension-0.1.2-chrome.zip"),
      fileName: "bookmark-aiextension-0.1.2-chrome.zip",
      version: "0.1.2",
    },
    steps: [
      "The Chrome Web Store listing has been submitted and is under review — it will be available shortly.",
      "Until then, download the extension zip below and unzip it.",
      "Open chrome://extensions (edge://extensions in Edge), turn on Developer mode, click Load unpacked and choose the unzipped folder.",
      "Sign in at bookmark-ai.cloud in the same browser — the extension mirrors that session; there is no separate sign-in.",
    ],
    source: null,
    note: "A sideloaded extension does not auto-update. Switch to the store listing once it is approved.",
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
    sideload: {
      url: releaseAssetUrl(RELEASE_TAGS.extension, "bookmark-aiextension-0.1.2-firefox.zip"),
      fileName: "bookmark-aiextension-0.1.2-firefox.zip",
      version: "0.1.2",
    },
    steps: [
      "The Firefox Add-ons listing has been submitted and is under review — it will be available shortly.",
      "Until then, download the extension zip below.",
      "Open about:debugging#/runtime/this-firefox, click Load Temporary Add-on… and pick the zip.",
      "Sign in at bookmark-ai.cloud in the same browser — the extension mirrors that session.",
    ],
    source: null,
    note: "Temporary add-ons are removed when Firefox quits — reload the zip next session, or wait for the store listing.",
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
    status: "available",
    icon: "macos",
    blurb: "A native Mac app for your library, search and live tabs.",
    badge: "Beta",
    requires: "macOS 14 (Sonoma) or later, Apple silicon or Intel",
    action: {
      type: "download",
      url: releaseAssetUrl(RELEASE_TAGS.macos, "BookmarkAI-0.1.0-macos.zip"),
      version: "0.1.0",
      releasePlatform: "macos",
      fileName: "BookmarkAI-0.1.0-macos.zip",
    },
    sideload: null,
    steps: [
      "Download the zip and double-click it — Bookmark AI.app appears next to it. Drag it into Applications.",
      "Open it once. macOS says “Apple could not verify Bookmark AI is free of malware” — click Done (not Move to Trash).",
      "Open System Settings ▸ Privacy & Security, scroll to Security, and click Open Anyway next to Bookmark AI, then confirm.",
      "Sign in with the same account you use on the web. The app checks for new builds at launch and shows a banner when one is out.",
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
    note: "This build is signed but not notarized by Apple, which is why the first launch needs Open Anyway. Later launches open normally.",
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
    badge: "Beta",
    requires: "Android 8 or later",
    action: {
      type: "download",
      url: releaseAssetUrl(RELEASE_TAGS.android, "bookmark-ai-1.0.1-android.apk"),
      version: "1.0.1",
      releasePlatform: "android",
      fileName: "bookmark-ai-1.0.1-android.apk",
    },
    sideload: null,
    steps: [
      "Download the APK on your phone (or copy it over) and tap it in your Files or Downloads app.",
      "If Android says the install is blocked, tap Settings in that dialog and allow installs from this source (Settings ▸ Apps ▸ Special app access ▸ Install unknown apps ▸ your browser or Files app).",
      "Go back and tap Install, then open Bookmark AI and sign in with the same account you use on the web.",
      "The app talks to bookmark-ai.cloud and checks for new builds at launch — a banner tells you when one is out. Google Play version coming soon.",
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
    note: "Installed outside Google Play, so Play Protect may ask you to confirm. New builds are announced by the in-app update banner, not by the store.",
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
 * `available`. While under review the listing 404s, so callers get null and
 * should send people to /download#<id> instead.
 */
export function storeUrlFor(id: PlatformId): string | null {
  const entry = getPlatform(id);
  if (entry.kind !== "extension" || entry.status !== "available") return null;
  if (id === "chrome") return CHROME_WEB_STORE_URL;
  // Firefox (AMO slug) and Safari (Mac App Store) URLs are not known yet.
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
  if (record && isHttps(record.downloadUrl)) {
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
