import type { Bookmark, Session } from "@bookmark-ai/types";
import { browser } from "wxt/browser";

/** Message contracts between the popup and the background script. */

export const SAVE_BOOKMARK = "SAVE_BOOKMARK" as const;
export const SAVE_SESSION = "SAVE_SESSION" as const;
/** Popup → background: flip the live-tabs opt-in. The background owns the Clerk
 * token, so the settings POST + local mirror + push loop all run there (§4.9). */
export const LIVE_SET_ENABLED = "LIVE_SET_ENABLED" as const;
/** External contract: sent by the WEB APP (externally_connectable origins)
 * to restore a saved session — either as one new window with all its tabs,
 * or as a named tab group in the user's current window. */
export const RESTORE_SESSION = "RESTORE_SESSION" as const;

export type RestoreMode = "window" | "group";

export interface RestoreSessionMessage {
  type: typeof RESTORE_SESSION;
  urls: string[];
  /** Defaults to "window" when omitted (older web clients don't send it). */
  mode?: RestoreMode;
  /** Session name — becomes the tab group title in "group" mode. */
  name?: string;
}

export function isRestoreSessionMessage(message: unknown): message is RestoreSessionMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as RestoreSessionMessage).type === RESTORE_SESSION &&
    Array.isArray((message as RestoreSessionMessage).urls)
  );
}

export interface SaveBookmarkMessage {
  type: typeof SAVE_BOOKMARK;
  url: string;
  title?: string;
}

export interface SaveSessionMessage {
  type: typeof SAVE_SESSION;
  name?: string;
  /** Scope the session to this window (the popup's); background contexts
   * cannot resolve "current window" reliably themselves. */
  windowId?: number;
  /** Checkpoint instead of archive: snapshot the tabs but leave the window
   * open and don't open the web app. Defaults to the closing behavior. */
  keepOpen?: boolean;
}

export type SaveBookmarkResult = { ok: true; bookmark: Bookmark } | { ok: false; error: string };

export type SaveSessionResult = { ok: true; session: Session } | { ok: false; error: string };

export function isSaveBookmarkMessage(message: unknown): message is SaveBookmarkMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as SaveBookmarkMessage).type === SAVE_BOOKMARK
  );
}

export function isSaveSessionMessage(message: unknown): message is SaveSessionMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as SaveSessionMessage).type === SAVE_SESSION
  );
}

/** Popup-side helper: ask the background script to save a bookmark. */
export function requestSaveBookmark(url: string, title?: string): Promise<SaveBookmarkResult> {
  const message: SaveBookmarkMessage = { type: SAVE_BOOKMARK, url, title };
  return browser.runtime.sendMessage(message) as Promise<SaveBookmarkResult>;
}

/** Popup-side helper: save the popup's window as a session. Unless `keepOpen`
 * is set, the background then closes that window and opens the web app. */
export function requestSaveSession(
  options: { windowId?: number; name?: string; keepOpen?: boolean } = {},
): Promise<SaveSessionResult> {
  const message: SaveSessionMessage = { type: SAVE_SESSION, ...options };
  return browser.runtime.sendMessage(message) as Promise<SaveSessionResult>;
}

export interface LiveSetEnabledMessage {
  type: typeof LIVE_SET_ENABLED;
  enabled: boolean;
}

/** `enabled` reflects the settled local state (a failed on-request rolls back to
 * off); `ok` is whether the server write also succeeded. */
export type LiveSetEnabledResult = { ok: boolean; enabled: boolean };

export function isLiveSetEnabledMessage(message: unknown): message is LiveSetEnabledMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as LiveSetEnabledMessage).type === LIVE_SET_ENABLED &&
    typeof (message as LiveSetEnabledMessage).enabled === "boolean"
  );
}

/** Popup-side helper: turn this browser's live-tabs publishing on or off. */
export function requestSetLiveEnabled(enabled: boolean): Promise<LiveSetEnabledResult> {
  const message: LiveSetEnabledMessage = { type: LIVE_SET_ENABLED, enabled };
  return browser.runtime.sendMessage(message) as Promise<LiveSetEnabledResult>;
}
