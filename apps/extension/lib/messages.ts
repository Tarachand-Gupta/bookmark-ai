import type { Bookmark } from "@bookmark-ai/types";
import { browser } from "wxt/browser";

/** Message contracts between the popup and the background script. */

export const SAVE_BOOKMARK = "SAVE_BOOKMARK" as const;

export interface SaveBookmarkMessage {
  type: typeof SAVE_BOOKMARK;
  url: string;
  title?: string;
}

export type SaveBookmarkResult =
  | { ok: true; bookmark: Bookmark }
  | { ok: false; error: string };

export function isSaveBookmarkMessage(
  message: unknown,
): message is SaveBookmarkMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as SaveBookmarkMessage).type === SAVE_BOOKMARK
  );
}

/** Popup-side helper: ask the background script to save a bookmark. */
export function requestSaveBookmark(
  url: string,
  title?: string,
): Promise<SaveBookmarkResult> {
  const message: SaveBookmarkMessage = { type: SAVE_BOOKMARK, url, title };
  return browser.runtime.sendMessage(message) as Promise<SaveBookmarkResult>;
}
