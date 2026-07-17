import type { SessionTab } from "@bookmark-ai/types";

/**
 * Which tabs/windows a session save is allowed to touch — pure functions, no
 * `wxt/browser` import, so they run (and are tested) in plain node. `session.ts`
 * is the thin browser-API wrapper over these.
 *
 * The incognito rules are load-bearing, not hygiene. Chrome disables extensions
 * in incognito by default, but a user who ticked "Allow in Incognito" for the
 * bookmark-save feature has silently opted their private windows in — and an
 * incognito window is `type: "normal"`, so the window-type check alone does NOT
 * exclude it. Two guarantees, both regression-tested in session-filter.test.ts:
 *   1. a private tab never reaches a session payload, and
 *   2. a private window is never closed by a save (its tabs were never backed
 *      up, so closing it would simply destroy them).
 */

/** The fields we read off `browser.tabs.Tab`. Real Tabs satisfy this
 * structurally — `incognito` is a required boolean there, optional here so
 * fixtures and any surface that omits it still type-check. */
export interface FilterableTab {
  url?: string;
  title?: string;
  favIconUrl?: string;
  incognito?: boolean;
  windowId?: number;
}

/** The fields we read off `browser.windows.Window` (same structural deal). */
export interface FilterableWindow {
  id?: number;
  type?: string;
  incognito?: boolean;
  tabs?: FilterableTab[];
}

/** Only http(s) tabs are worth snapshotting — chrome://, about:, extension and
 * file pages can't be meaningfully restored on another device. */
export function isRestorableUrl(url: string | undefined): url is string {
  return !!url && /^https?:/i.test(url);
}

/** Private beats everything: an incognito tab is never captured, whatever its
 * url. Checked per-tab as well as per-window because under the manifest's
 * default `spanning` mode one worker sees both contexts. */
export function isCapturableTab(tab: FilterableTab): boolean {
  if (tab.incognito) return false;
  return isRestorableUrl(tab.url);
}

/** Skip devtools/popup windows (nothing restorable) and private ones. */
export function isCapturableWindow(win: FilterableWindow): boolean {
  if (win.incognito) return false;
  return !win.type || win.type === "normal";
}

/** A save must never close a private window — `isCapturableWindow` refused to
 * back its tabs up, so closing it would throw them away. */
export function isPrivateWindow(win: FilterableWindow): boolean {
  return win.incognito === true;
}

function toSessionTab(tab: FilterableTab, windowId: number | undefined): SessionTab {
  return {
    url: tab.url!, // isCapturableTab guarantees a restorable url
    title: tab.title ?? "",
    favIconUrl: tab.favIconUrl,
    windowId,
  };
}

/** Every capturable tab across every capturable window, as session tabs. */
export function sessionTabsFromWindows(windows: FilterableWindow[]): SessionTab[] {
  const tabs: SessionTab[] = [];
  for (const win of windows) {
    if (!isCapturableWindow(win)) continue;
    for (const tab of win.tabs ?? []) {
      if (!isCapturableTab(tab)) continue;
      tabs.push(toSessionTab(tab, win.id));
    }
  }
  return tabs;
}

/** One window's tabs, as session tabs. `windowId` is stamped from the caller:
 * this is the `tabs.query({windowId})` path, which never sees a Window object —
 * hence the per-tab `incognito` check inside `isCapturableTab` is the only thing
 * standing between a private window and the payload here. */
export function sessionTabsFromWindow(tabs: FilterableTab[], windowId: number): SessionTab[] {
  return tabs.filter(isCapturableTab).map((tab) => toSessionTab(tab, windowId));
}
