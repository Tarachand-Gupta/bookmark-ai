import { defineBackground } from "#imports";
import { browser } from "wxt/browser";
import { createBookmark, getWebBaseUrl, saveSession } from "@/lib/api";
import { detectSource } from "@/lib/detect";
import { closeWindowsAndOpen, gatherOpenTabs } from "@/lib/session";
import {
  isRestoreSessionMessage,
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
    const tabs = await gatherOpenTabs(message.windowId);
    if (tabs.length === 0) throw new Error("No open tabs in this window to save.");
    const src = detectSource();
    const session = await saveSession({
      name: message.name,
      tabs,
      browser: src.browser,
      device: src.device,
      savedAt: src.savedAt,
    });
    // Saved successfully — only now is it safe to close the window + open the app.
    const webUrl = await getWebBaseUrl();
    await closeWindowsAndOpen(`${webUrl}/?section=sessions`, message.windowId);
    return { ok: true, session };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export default defineBackground(() => {
  // Web-app handoff (origins allowed via manifest externally_connectable):
  // restore a saved session as ONE new window holding every tab — something
  // the page itself can't do (popup blockers allow one window.open per click).
  browser.runtime.onMessageExternal?.addListener(
    (message: unknown, _sender, sendResponse: (response: { ok: boolean }) => void) => {
      if (!isRestoreSessionMessage(message)) return undefined;
      const urls = message.urls.filter((u) => /^https?:/i.test(u)).slice(0, 100);
      if (urls.length === 0) {
        sendResponse({ ok: false });
        return undefined;
      }
      browser.windows
        .create({ url: urls })
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true; // async sendResponse
    },
  );

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
