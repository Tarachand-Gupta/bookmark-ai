import { defineBackground } from "#imports";
import { browser } from "wxt/browser";
import { createClerkClient } from "@clerk/chrome-extension/background";
import { createBookmark, getWebBaseUrl, saveSession, setAuthTokenProvider } from "@/lib/api";
import { CLERK_PUBLISHABLE_KEY, CLERK_SYNC_HOST } from "@/lib/clerk";
import { detectSource } from "@/lib/detect";
import { fullName } from "@/lib/identity";
import { getNativeSession, getNativeSessionToken, nativeSignOut } from "@/lib/native-session";
import { pushLiveNow, registerLiveCheckpoint, setLiveEnabled } from "@/lib/live-checkpoint";
import { closeWindowsAndOpen, gatherOpenTabs } from "@/lib/session";
import {
  isBookmarkAiPingMessage,
  isGetUserMessage,
  isLivePushNowMessage,
  isLiveSetEnabledMessage,
  isRestoreSessionMessage,
  isSaveBookmarkMessage,
  isSaveSessionMessage,
  isSignOutMessage,
  type LiveSetEnabledResult,
  type RestoreSessionMessage,
  type SaveBookmarkMessage,
  type SaveBookmarkResult,
  type SaveSessionMessage,
  type SaveSessionResult,
  type UserInfo,
} from "@/lib/messages";

/** Clerk session JWT (same syncHost session the popup shows). SDK first (dev
 * instances), then the production Native-API fallback (see lib/native-session).
 * Null when signed out or Clerk is unreachable — saves still work against the
 * open local server; the auth-enforcing deployed server rejects them. */
async function getSessionToken(): Promise<string | null> {
  try {
    const clerk = await createClerkClient({
      publishableKey: CLERK_PUBLISHABLE_KEY,
      syncHost: CLERK_SYNC_HOST,
    });
    const token = (await clerk.session?.getToken()) ?? null;
    if (token) return token;
  } catch {
    // fall through to native
  }
  return getNativeSessionToken();
}

const SIGNED_OUT: UserInfo = { signedIn: false, name: null, email: null };

/** TEMP migration cleanup: the domain switched Clerk instances (dev → prod) on
 * 2026-07-22; browsers that used the dev era carry stale dev-suffixed cookies
 * (`*_vm2h_-wW`) that can shadow the prod session for the sync SDK. Surgically
 * remove exactly those. */
async function purgeDevEraCookies(): Promise<void> {
  for (const url of [CLERK_SYNC_HOST, "https://www.bookmark-ai.cloud"]) {
    try {
      const all = await browser.cookies.getAll({ url });
      for (const c of all) {
        if (c.name.endsWith("_vm2h_-wW")) {
          await browser.cookies.remove({ url, name: c.name });
        }
      }
    } catch {
      // best-effort
    }
  }
}

/** Resolve the signed-in identity from the mirrored web session (syncHost). The
 * popup polls this to drive its gate; any failure (Clerk unreachable, no synced
 * session) degrades to signed-out so the popup shows the sign-in prompt. */
async function handleGetUser(): Promise<UserInfo> {
  try {
    await purgeDevEraCookies();
    const clerk = await createClerkClient({
      publishableKey: CLERK_PUBLISHABLE_KEY,
      syncHost: CLERK_SYNC_HOST,
    });
    const user = clerk.user;
    if (clerk.session && user) {
      return {
        signedIn: true,
        name: fullName(user),
        email: user.primaryEmailAddress?.emailAddress ?? null,
      };
    }
  } catch {
    // fall through to native
  }
  // Production Native-API fallback (see lib/native-session for why).
  const native = await getNativeSession();
  if (native) {
    return { signedIn: true, name: native.name, email: native.email };
  }
  return SIGNED_OUT;
}

/** Sign out of the mirrored session: SDK first, then the native fallback
 * (which ends the same client session the WEB app uses — signing out of the
 * extension signs out of the site too, which is the honest behavior). */
async function handleSignOut(): Promise<{ ok: boolean }> {
  let ok = false;
  try {
    const clerk = await createClerkClient({
      publishableKey: CLERK_PUBLISHABLE_KEY,
      syncHost: CLERK_SYNC_HOST,
    });
    if (clerk.session) {
      await clerk.signOut();
      ok = true;
    }
  } catch {
    // fall through to native
  }
  if (!ok) ok = await nativeSignOut();
  return { ok };
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
      // Installed-check ping: the web app uses this to detect the extension.
      if (isBookmarkAiPingMessage(message)) {
        sendResponse({ ok: true });
        return undefined; // responded synchronously
      }
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
        response:
          | SaveBookmarkResult
          | SaveSessionResult
          | LiveSetEnabledResult
          | UserInfo
          | { ok: boolean },
      ) => void,
    ) => {
      if (isGetUserMessage(message)) {
        void handleGetUser().then(sendResponse);
        return true; // keep the channel open for the async response
      }
      if (isSignOutMessage(message)) {
        void handleSignOut().then(sendResponse);
        return true;
      }
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
      if (isLivePushNowMessage(message)) {
        void pushLiveNow().then(() => sendResponse({ ok: true }));
        return true;
      }
      return undefined;
    },
  );
});
