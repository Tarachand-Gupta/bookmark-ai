import type { LiveTab, LiveWindow } from "@bookmark-ai/types";
import {
  isCapturableWindow,
  isRestorableUrl,
  type FilterableTab,
  type FilterableWindow,
} from "./session-filter";

/**
 * Capture-time URL/tab sanitization for Live Sessions (§5.3/§5.4). Unlike saved
 * sessions — which keep urls verbatim and defend XSS at the render layer — a live
 * checkpoint copies urls into a cloud DB, so a bearer token in a query string or a
 * magic-link path is a live credential the instant it leaves the machine.
 * Render-layer defense does nothing against that; the only fix is to not send it.
 * Pure (no wxt/browser import), so it runs and is tested in plain node.
 *
 * A denylist is a mitigation, not a guarantee (§5.4): it layers with opt-in, 7-day
 * retention, no export, and instant purge. Some token shape will slip through —
 * this closes the common, high-yield ones without the unbounded false-positives of
 * an entropy heuristic (rejected, §6.14).
 */

/** Query params whose value is (or is often) a credential. Matched as a
 * case-insensitive SUBSTRING of the param name — deliberately broad (§5.4). */
const SENSITIVE_PARAM_SUBSTRINGS = [
  "token",
  "access_token",
  "id_token",
  "refresh_token",
  "auth",
  "apikey",
  "api_key",
  "key",
  "secret",
  "password",
  "pwd",
  "passwd",
  "otp",
  "code",
  "state",
  "signature",
  "sig",
  "session",
  "sid",
  "ticket",
  "unlock",
  "invite",
  "magic",
  "confirm",
  "confirmation",
  "reset",
  "verify",
  "jwt",
  "sso",
  "saml",
  "oauth_verifier",
  "credential",
];

/** A path on an auth flow carries the credential in the path itself (magic links,
 * `/login/<token>`), so the whole path is dropped — origin only. */
const AUTH_PATH_RE = /(reset|signin|login|oauth|auth\/callback|verify|magic|invite|activate)/i;

const MAX_FRAGMENT = 32; // a plausible "#section" anchor; longer/`=`-bearing → dropped
const MAX_TITLE = 300; // liveTabSchema.title cap
const MAX_TABS_PER_WINDOW = 100; // liveWindowSchema.tabs cap
const MAX_WINDOWS = 12; // pushLiveStateSchema.windows cap

function isSensitiveParam(name: string): boolean {
  const lower = name.toLowerCase();
  if (lower.startsWith("utm_")) return true; // tracking noise, not a credential
  return SENSITIVE_PARAM_SUBSTRINGS.some((s) => lower.includes(s));
}

export interface SanitizedUrl {
  url: string;
  /** True when the path/query looked credential-bearing and only the origin
   * survived — the reader renders "(link hidden — open on the source device)". */
  redacted: boolean;
}

/** Sanitize one url for a live checkpoint, or null when it must not be sent at all
 * (non-http scheme, or unparseable). */
export function sanitizeLiveUrl(raw: string): SanitizedUrl | null {
  if (!isRestorableUrl(raw)) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }

  // Auth-flow path → emit the origin only; the path itself may be the credential.
  if (AUTH_PATH_RE.test(u.pathname)) {
    return { url: u.origin, redacted: true };
  }

  // Strip credential-bearing / tracking query params.
  for (const name of [...u.searchParams.keys()]) {
    if (isSensitiveParam(name)) u.searchParams.delete(name);
  }

  // Drop the fragment unless it's a plausible "#section" anchor (no "=", short).
  const fragment = u.hash.replace(/^#/, "");
  if (fragment && (fragment.includes("=") || fragment.length > MAX_FRAGMENT)) u.hash = "";

  return { url: u.toString(), redacted: false };
}

/** favIconUrl is kept only when it's an http(s) url — a `data:` favicon is an
 * unbounded payload bomb (§5.4/§7), and other schemes don't render off-device. */
export function sanitizeFavicon(favIconUrl: string | null | undefined): string | undefined {
  return favIconUrl && /^https?:/i.test(favIconUrl) ? favIconUrl : undefined;
}

/** A tab as read off `browser.tabs.Tab` — FilterableTab plus the display fields the
 * live payload carries. */
export interface LiveInputTab extends FilterableTab {
  active?: boolean;
}
export interface LiveInputWindow extends FilterableWindow {
  focused?: boolean;
  tabs?: LiveInputTab[];
}

export interface BuiltLiveState {
  windows: LiveWindow[];
  hiddenTabCount: number;
}

/**
 * Turn a full window scan into the sanitized live payload. Incognito windows and
 * tabs never reach it (reusing the session-filter guarantees, §5.3); non-http tabs
 * are dropped but COUNTED into hiddenTabCount so the reader can be honest ("2 tabs
 * not shown"). A window left empty after filtering is dropped.
 */
export function buildLiveWindows(windows: LiveInputWindow[]): BuiltLiveState {
  const out: LiveWindow[] = [];
  let hiddenTabCount = 0;

  for (const win of windows) {
    if (!isCapturableWindow(win)) continue; // incognito/devtools/popup — never counted
    const tabs: LiveTab[] = [];
    for (const tab of win.tabs ?? []) {
      if (tab.incognito) continue; // belt-and-braces; uncounted, so a private count never leaks
      if (!isRestorableUrl(tab.url)) {
        hiddenTabCount++; // local/internal page — hidden but honestly counted
        continue;
      }
      const clean = sanitizeLiveUrl(tab.url);
      if (!clean) {
        hiddenTabCount++;
        continue;
      }
      const liveTab: LiveTab = {
        url: clean.url,
        title: (tab.title ?? "").slice(0, MAX_TITLE),
      };
      const favIconUrl = sanitizeFavicon(tab.favIconUrl);
      if (favIconUrl) liveTab.favIconUrl = favIconUrl;
      if (tab.active) liveTab.active = true;
      if (clean.redacted) liveTab.redacted = true;
      tabs.push(liveTab);
    }
    if (tabs.length === 0) continue; // nothing worth showing in this window
    const liveWindow: LiveWindow = {
      windowId: win.id ?? 0,
      tabs: tabs.slice(0, MAX_TABS_PER_WINDOW),
    };
    if (win.focused) liveWindow.focused = true;
    out.push(liveWindow);
  }

  return { windows: out.slice(0, MAX_WINDOWS), hiddenTabCount };
}
