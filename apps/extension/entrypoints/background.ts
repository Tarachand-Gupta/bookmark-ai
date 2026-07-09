import { defineBackground } from "#imports";
import { browser } from "wxt/browser";
import { createBookmark, getWebBaseUrl, saveSession } from "@/lib/api";
import { detectSource } from "@/lib/detect";
import { closeWindowsAndOpen, gatherOpenTabs } from "@/lib/session";
import {
  isSaveBookmarkMessage,
  isSaveSessionMessage,
  type SaveBookmarkMessage,
  type SaveBookmarkResult,
  type SaveSessionMessage,
  type SaveSessionResult,
} from "@/lib/messages";

async function handleSaveBookmark(message: SaveBookmarkMessage): Promise<SaveBookmarkResult> {
  try {
    const bookmark = await createBookmark({
      url: message.url,
      title: message.title,
      ...detectSource(),
    });
    return { ok: true, bookmark };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function handleSaveSession(message: SaveSessionMessage): Promise<SaveSessionResult> {
  try {
    const tabs = await gatherOpenTabs();
    if (tabs.length === 0) throw new Error("No open tabs to save.");
    const src = detectSource();
    const session = await saveSession({
      name: message.name,
      tabs,
      browser: src.browser,
      device: src.device,
      savedAt: src.savedAt,
    });
    // Saved successfully — only now is it safe to close the windows + open the app.
    const webUrl = await getWebBaseUrl();
    await closeWindowsAndOpen(`${webUrl}/?section=sessions`);
    return { ok: true, session };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (
      message: unknown,
      _sender,
      sendResponse: (response: SaveBookmarkResult | SaveSessionResult) => void,
    ) => {
      if (isSaveBookmarkMessage(message)) {
        void handleSaveBookmark(message).then(sendResponse);
        return true; // keep the channel open for the async response
      }
      if (isSaveSessionMessage(message)) {
        void handleSaveSession(message).then(sendResponse);
        return true;
      }
      return undefined;
    },
  );
});
