import type { Bookmark, Session } from "@bookmark-ai/types";
import { browser } from "wxt/browser";

/** Message contracts between the popup and the background script. */

export const SAVE_BOOKMARK = "SAVE_BOOKMARK" as const;
export const SAVE_SESSION = "SAVE_SESSION" as const;

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

/** Popup-side helper: save the popup's window as a session (background then
 * closes that window and opens the web app). */
export function requestSaveSession(
  options: { windowId?: number; name?: string } = {},
): Promise<SaveSessionResult> {
  const message: SaveSessionMessage = { type: SAVE_SESSION, ...options };
  return browser.runtime.sendMessage(message) as Promise<SaveSessionResult>;
}
