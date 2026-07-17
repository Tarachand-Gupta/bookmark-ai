import { defineBackground } from "#imports";
import { browser } from "wxt/browser";
import { createClerkClient } from "@clerk/chrome-extension/background";
import { createBookmark, getWebBaseUrl, saveSession, setAuthTokenProvider } from "@/lib/api";
import { CLERK_PUBLISHABLE_KEY, CLERK_SYNC_HOST } from "@/lib/clerk";
import { detectSource } from "@/lib/detect";
import { registerLiveCheckpoint, setLiveEnabled } from "@/lib/live-checkpoint";
import { closeWindowsAndOpen, gatherOpenTabs } from "@/lib/session";
import {
  isLiveSetEnabledMessage,
  isRestoreSessionMessage,
  isSaveBookmarkMessage,
  isSaveSessionMessage,
  type LiveSetEnabledResult,
  type RestoreSessionMessage,
  type SaveBookmarkMessage,
  type SaveBookmarkResult,
  type SaveSessionMessage,
  type SaveSessionResult,
} from "@/lib/messages";

/** Clerk session JWT (same syncHost session the popup shows). Null when
 * signed out or Clerk is unreachable — saves still work against the open
 * local server; the auth-enforcing deployed server rejects them. */
async function getSessionToken(): Promise<string | null> {
  try {
    const clerk = await createClerkClient({
      publishableKey: CLERK_PUBLISHABLE_KEY,
      syncHost: CLERK_SYNC_HOST,
    });
    return (await clerk.session?.getToken()) ?? null;
  } catch {
    return null;
  }
}

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
    // `keepOpen` is the checkpoint path: nothing closes, nothing opens, the user
    // stays exactly where they are.
    if (!message.keepOpen) {
      const webUrl = await getWebBaseUrl();
      await closeWindowsAndOpen(`${webUrl}/app?section=sessions`, message.windowId);
    }
    return { ok: true, session };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// Tab-group APIs are Chrome ≥89; webextension-polyfill types don't know them.
interface TabGroupApis {
  tabs: {
    group?: (options: { tabIds: number[] }) => Promise<number>;
  };
  tabGroups?: {
    update: (groupId: number, props: { title?: string; color?: string }) => Promise<unknown>;
  };
}

/** Open the urls as a titled tab group in `windowId` (the sender's window). */
async function openAsTabGroup(
  urls: string[],
  windowId: number | undefined,
  name: string | undefined,
): Promise<{ ok: boolean }> {
  const api = browser as unknown as TabGroupApis;
  if (!api.tabs.group) return { ok: false }; // Firefox/Safari: no tab groups
  const tabs = [];
  for (const url of urls) {
    // Sequential so the group keeps the session's tab order.
    tabs.push(await browser.tabs.create({ windowId, url, active: false }));
  }
  const tabIds = tabs.map((t) => t.id).filter((id): id is number => typeof id === "number");
  const groupId = await api.tabs.group({ tabIds });
  try {
    await api.tabGroups?.update(groupId, { title: name || "Restored session", color: "blue" });
  } catch {
    // Group exists even if titling fails (missing tabGroups permission).
  }
  return { ok: true };
}

async function handleRestoreSession(
  message: RestoreSessionMessage,
  senderWindowId: number | undefined,
): Promise<{ ok: boolean }> {
  const urls = message.urls.filter((u) => /^https?:/i.test(u)).slice(0, 100);
  if (urls.length === 0) return { ok: false };
  if (message.mode === "group") return openAsTabGroup(urls, senderWindowId, message.name);
  await browser.windows.create({ url: urls });
  return { ok: true };
}

export default defineBackground(() => {
  setAuthTokenProvider(getSessionToken);

  // Live-tabs checkpoint: registers its tab/window/alarm listeners SYNCHRONOUSLY
  // (must run before the first await, or the MV3 worker won't wake — §4.5). It
  // gates every wake on the storage flag, so this is inert until the popup opts in.
  registerLiveCheckpoint();

  // Web-app handoff (origins allowed via manifest externally_connectable):
  // restore a saved session as ONE new window holding every tab — something
  // the page itself can't do (popup blockers allow one window.open per click)
  // — or, in "group" mode, as a titled tab group in the user's own window.
  browser.runtime.onMessageExternal?.addListener(
    (message: unknown, sender, sendResponse: (response: { ok: boolean }) => void) => {
      if (!isRestoreSessionMessage(message)) return undefined;
      handleRestoreSession(message, sender.tab?.windowId)
        .then(sendResponse)
        .catch(() => sendResponse({ ok: false }));
      return true; // async sendResponse
    },
  );

  browser.runtime.onMessage.addListener(
    (
      message: unknown,
      _sender,
      sendResponse: (
        response: SaveBookmarkResult | SaveSessionResult | LiveSetEnabledResult,
      ) => void,
    ) => {
      if (isSaveBookmarkMessage(message)) {
        void handleSaveBookmark(message).then(sendResponse);
        return true; // keep the channel open for the async response
      }
      if (isSaveSessionMessage(message)) {
        void handleSaveSession(message).then(sendResponse);
        return true;
      }
      if (isLiveSetEnabledMessage(message)) {
        void setLiveEnabled(message.enabled).then(sendResponse);
        return true;
      }
      return undefined;
    },
  );
});
