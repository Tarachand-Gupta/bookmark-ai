import { browser } from "wxt/browser";

/**
 * Every "leave the popup" destination in one place. Each opens a tab on the
 * build target's app origin and closes the popup — the popup is a launcher, so
 * it never lingers behind the tab it just opened.
 *
 * These paths were previously duplicated inline across five components (App,
 * LiveTabsToggle, SettingsButton, SignInGate, ClerkUnavailable); the URL shapes
 * (`/app`, `?section=live`, `?settings=devices`, `/sign-in`) are unchanged.
 */

function open(url: string): void {
  void browser.tabs.create({ url });
  window.close();
}

/** The library. */
export function openApp(webUrl: string): void {
  open(`${webUrl}/app`);
}

/** The live-tabs view inside the app. */
export function openLiveView(webUrl: string): void {
  open(`${webUrl}/app?section=live`);
}

/** Settings → Devices, where the per-device new-window policy and the live
 * server URL live. */
export function openDeviceSettings(webUrl: string): void {
  open(`${webUrl}/app?settings=devices`);
}

/** Sign-in (or `/app` for the Safari "reconnect" variant, where a live session
 * redirects straight into the app and a dead one lands on sign-in anyway). */
export function openSignIn(webUrl: string, reconnect = false): void {
  open(`${webUrl}${reconnect ? "/app" : "/sign-in"}`);
}

/** `bookmark-ai.cloud` from `https://bookmark-ai.cloud` — the "Open app" tile's
 * meta line, so the popup always names the origin it is actually talking to. */
export function hostLabel(webUrl: string): string {
  try {
    return new URL(webUrl).host;
  } catch {
    return webUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  }
}

/** `nngroup.com` from a page url — the hero card's and confirmation card's
 * second line. Returns "" when the url is unparseable. */
export function domainOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
