import { defineBackground } from "#imports";
import { browser } from "wxt/browser";
import { createClerkClient } from "@clerk/chrome-extension/background";
import {
  createBookmark,
  fetchMe,
  getApiBaseUrl,
  getLiveToken,
  getWebBaseUrl,
  saveSession,
  setAuthTokenProvider,
  setNoTokenFetcher,
} from "@/lib/api";
import { CLERK_PUBLISHABLE_KEY, CLERK_SYNC_HOST } from "@/lib/clerk";
import { detectSource } from "@/lib/detect";
import { diag } from "@/lib/diag";
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
  requestBridgeFetch,
  requestBridgeMe,
  type BridgeFetchResult,
  type BridgeMeResult,
  type LiveSetEnabledResult,
  type RestoreSessionMessage,
  type SaveBookmarkMessage,
  type SaveBookmarkResult,
  type SaveSessionMessage,
  type SaveSessionResult,
  type SignOutResult,
  type UserInfo,
} from "@/lib/messages";

/** Build-target browser (Vite inlines this). The cookie-credentialed identity
 * probe (Path C) is Safari-only. */
const SAFARI = import.meta.env.BROWSER === "safari";

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** How long to wait for a Clerk SDK call before giving up and using the native
 * fallback. `@clerk/chrome-extension`'s client can hang indefinitely under
 * Safari (never resolves, never throws), which is what wedged the popup — so
 * every SDK interaction is bounded by this and a timeout is treated exactly like
 * a throw: fall through to the cookie→Native-API path (lib/native-session). */
const CLERK_RACE_MS = 3000;

type AuthPath = "sdk" | "native" | "cookie" | "bridge";
/** Which path last resolved a session, cached for THIS background lifetime so
 * repeat popup opens don't re-pay the SDK race once we know which path works.
 * A browser restart spins up a fresh background script → `null` again → the SDK
 * path is retried. Stays null while fully signed out so no path is skipped (a
 * pending web sign-in must still be picked up). "cookie" = the Safari
 * credentialed /api/me path (SDK + native cookie both blind). */
let winningPath: AuthPath | null = null;

/** Reject if `p` doesn't settle within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolvePromise(v);
      },
      (e) => {
        clearTimeout(timer);
        rejectPromise(e);
      },
    );
  });
}

/** The Clerk SDK client, bounded by the race timeout. */
function racedClerkClient() {
  return withTimeout(
    createClerkClient({ publishableKey: CLERK_PUBLISHABLE_KEY, syncHost: CLERK_SYNC_HOST }),
    CLERK_RACE_MS,
    "createClerkClient",
  );
}

/** Clerk session JWT (same syncHost session the popup shows). SDK first (dev
 * instances), then the production Native-API fallback (see lib/native-session).
 * Null when signed out or Clerk is unreachable — saves still work against the
 * open local server; the auth-enforcing deployed server rejects them. */
async function getSessionToken(): Promise<string | null> {
  // Cookie/bridge paths yield no mintable token — writes go out via authFetch's
  // no-token strategy (bridge tab, else credentialed fetch) — so short-circuit.
  if (winningPath === "cookie" || winningPath === "bridge") return null;
  if (winningPath !== "native") {
    const started = Date.now();
    try {
      const clerk = await racedClerkClient();
      const token = clerk.session
        ? await withTimeout(Promise.resolve(clerk.session.getToken()), CLERK_RACE_MS, "getToken")
        : null;
      diag("token", "sdk settled", { ms: Date.now() - started, hasToken: !!token });
      if (token) {
        winningPath = "sdk";
        return token;
      }
    } catch (e) {
      diag("token", "sdk failed", { ms: Date.now() - started, error: errMsg(e) });
    }
  }
  const token = await getNativeSessionToken();
  if (token) winningPath = "native";
  diag("token", "native fallback", { hasToken: !!token });
  return token;
}

const SIGNED_OUT: UserInfo = { signedIn: false, name: null, email: null };

/* ── Path D: content-script session bridge (Safari) ─────────────────────────
 * Safari 26 partitions the extension's network/cookie context from the browser
 * jar, so an OPEN app tab's content script is the only context that can make a
 * credentialed same-origin request. These helpers drive that bridge. */

const BRIDGE_MATCHES = ["https://bookmark-ai.cloud/*", "https://www.bookmark-ai.cloud/*"];
/** Statuses whose Response MUST have a null body (constructor throws otherwise). */
const NULL_BODY_STATUS = new Set([101, 103, 204, 205, 304]);

async function bridgeTabIds(): Promise<number[]> {
  try {
    const tabs = await browser.tabs.query({ url: BRIDGE_MATCHES });
    return tabs.map((t) => t.id).filter((id): id is number => typeof id === "number");
  } catch {
    return [];
  }
}

/** Path D identity: ask an open app tab's bridge who is signed in. Returns null
 * when no tab has a live bridge (predates install / none open). */
async function bridgeGetUser(): Promise<UserInfo | null> {
  const ids = await bridgeTabIds();
  diag("bridge", "tabs found", { count: ids.length });
  for (const tabId of ids) {
    try {
      const res = (await browser.tabs.sendMessage(tabId, requestBridgeMe())) as
        | BridgeMeResult
        | undefined;
      if (res?.ok) {
        diag("bridge", "BRIDGE_ME result", { got: true, signedIn: res.signedIn });
        return res.signedIn ? { signedIn: true, name: res.name, email: res.email } : SIGNED_OUT;
      }
    } catch {
      // Tab predates the install (no content script) — try the next.
    }
  }
  diag("bridge", "BRIDGE_ME result", { got: false, signedIn: null });
  return null;
}

/** Path D write: proxy a same-origin API request through an app tab's bridge and
 * rebuild it as a Response. Null when no live bridge tab answered. */
async function bridgeFetch(
  path: string,
  method: string,
  bodyJson?: string,
): Promise<Response | null> {
  const ids = await bridgeTabIds();
  for (const tabId of ids) {
    try {
      const res = (await browser.tabs.sendMessage(
        tabId,
        requestBridgeFetch(path, method, bodyJson),
      )) as BridgeFetchResult | undefined;
      if (res && typeof res.status === "number" && res.status > 0) {
        diag("bridge", "BRIDGE_FETCH", { path, status: res.status });
        const body = NULL_BODY_STATUS.has(res.status) ? null : (res.bodyJson ?? null);
        return new Response(body, { status: res.status });
      }
    } catch {
      // Try the next tab.
    }
  }
  return null;
}

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
  diag("getUser", "entry", { cachedPath: winningPath });
  // Path A — SDK (dev instances; settles empty on the prod custom domain).
  if (winningPath !== "native" && winningPath !== "cookie" && winningPath !== "bridge") {
    const started = Date.now();
    try {
      await purgeDevEraCookies();
      diag("getUser", "purge done");
      const clerk = await racedClerkClient();
      diag("getUser", "sdk settled", {
        ms: Date.now() - started,
        hasSession: !!clerk.session,
        hasUser: !!clerk.user,
      });
      const user = clerk.user;
      if (clerk.session && user) {
        winningPath = "sdk";
        diag("getUser", "reply", { path: "sdk", signedIn: true });
        return {
          signedIn: true,
          name: fullName(user),
          email: user.primaryEmailAddress?.emailAddress ?? null,
        };
      }
    } catch (e) {
      diag("getUser", "sdk failed", { ms: Date.now() - started, error: errMsg(e) });
    }
  }
  // Path B — Native API via the FAPI __client cookie (see lib/native-session).
  if (winningPath !== "cookie" && winningPath !== "bridge") {
    const native = await getNativeSession();
    if (native) {
      winningPath = "native";
      diag("getUser", "reply", { path: "native", signedIn: true });
      return { signedIn: true, name: native.name, email: native.email };
    }
  }
  // Path C — Safari cookie path: /api/me authenticated by the SITE's own session
  // cookie (credentials:'include'), which Safari sends without us reading it.
  // Tried on EVERY Safari resolve (cheap, one fetch) so it wins the moment a
  // site-access grant makes the extension's cookie context work — ahead of D.
  if (SAFARI) {
    const me = await fetchMe();
    diag("getUser", "cookie /api/me", { got: !!me, signedIn: me?.signedIn ?? null });
    if (me?.signedIn) {
      winningPath = "cookie";
      diag("getUser", "reply", { path: "cookie", signedIn: true });
      return { signedIn: true, name: me.name, email: me.email };
    }
  }
  // Path D — Safari content-script bridge: an open app tab's page context makes
  // the credentialed same-origin request the extension context can't. Only
  // engages when A/B/C all came up empty (never on Chrome/Firefox).
  if (SAFARI) {
    const bridged = await bridgeGetUser();
    if (bridged) {
      winningPath = "bridge";
      diag("getUser", "reply", { path: "bridge", signedIn: bridged.signedIn });
      return bridged;
    }
  }
  diag("getUser", "reply", { path: "none", signedIn: false });
  return SIGNED_OUT;
}

/** Sign out of the mirrored session: SDK first, then the native fallback
 * (which ends the same client session the WEB app uses — signing out of the
 * extension signs out of the site too, which is the honest behavior). */
async function handleSignOut(): Promise<SignOutResult> {
  let ok = false;
  const tokenlessSafari = winningPath === "cookie" || winningPath === "bridge";
  if (winningPath !== "native" && !tokenlessSafari) {
    try {
      const clerk = await racedClerkClient();
      if (clerk.session) {
        await withTimeout(clerk.signOut(), CLERK_RACE_MS, "signOut");
        ok = true;
      }
    } catch (e) {
      diag("signOut", "sdk failed", { error: errMsg(e) });
    }
  }
  if (!ok && !tokenlessSafari) ok = await nativeSignOut();
  if (!ok && SAFARI) {
    // Cookie/bridge path: the client token is an HttpOnly cookie we can't present
    // (and the bridge is read-only for identity), so we can't end the shared
    // session from here. Hand off to the web app — the user signs out there, and
    // the popup's next resolve then reports signed-out to the gate.
    diag("signOut", "cookie/bridge handoff (open web)");
    return { ok: false, openWeb: true };
  }
  diag("signOut", "done", { ok });
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
  diag("bg", "boot", { browser: import.meta.env.BROWSER, syncHost: CLERK_SYNC_HOST });
  setAuthTokenProvider(getSessionToken);

  // No-token request strategy — SAFARI ONLY (gated so the whole closure, and
  // bridgeFetch/getLiveToken with it, tree-shakes out of the Chrome/Firefox
  // bundles). Three cases on a tokenless Safari path:
  //  • main origin + bridge path → proxy the write through the content script.
  //  • cross-origin authed call (the Live server) → mint a session JWT via the
  //    main origin and attach it as Bearer (the live server verifies it offline);
  //    on a 401, force one refresh and retry once.
  //  • otherwise → a direct credentialed fetch (works only if the cookie jar
  //    ever opens up for the extension context; today it 401s, harmlessly).
  if (SAFARI) {
    setNoTokenFetcher(async (url, init) => {
      const tokenless = winningPath === "bridge" || winningPath === "cookie";
      if (tokenless) {
        let appOrigin = "";
        try {
          appOrigin = new URL(await getApiBaseUrl()).origin;
        } catch {
          // leave appOrigin empty → skip the origin-specific branches
        }
        const target = new URL(url);

        if (winningPath === "bridge" && appOrigin && target.origin === appOrigin) {
          const body = typeof init.body === "string" ? init.body : undefined;
          const bridged = await bridgeFetch(
            target.pathname + target.search,
            (init.method as string) ?? "GET",
            body,
          );
          if (bridged) return bridged;
        } else if (appOrigin && target.origin !== appOrigin) {
          const withBearer = (t: string): Promise<Response> =>
            fetch(url, {
              ...init,
              headers: {
                ...(init.headers as Record<string, string> | undefined),
                authorization: `Bearer ${t}`,
              },
            });
          const token = await getLiveToken();
          if (token) {
            const res = await withBearer(token);
            diag("live", "live call", { path: target.pathname, status: res.status });
            if (res.status !== 401) return res;
            const fresh = await getLiveToken(true);
            if (fresh) return withBearer(fresh);
            return res;
          }
        }
      }
      return fetch(url, { ...init, credentials: "include" });
    });
  }

  // Register the popup↔background message listeners FIRST (still synchronous, so
  // MV3-worker wake is unaffected). If the optional live-tabs wiring below ever
  // throws at init — e.g. a `browser.tabs.*`/`windows.*` event object that a
  // given browser doesn't expose makes `.addListener` throw, which one thrown
  // error in an MV2 background SCRIPT (Firefox/Safari) would let escape and kill
  // the ENTIRE script — the GET_USER/SAVE_* listeners are already installed, so
  // the popup still gets answers instead of spinning forever with a dead port.

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
          | SignOutResult
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

  // Live-tabs checkpoint: registers its tab/window/alarm listeners SYNCHRONOUSLY
  // (must run before the first await, or the MV3 worker won't wake — §4.5). It
  // gates every wake on the storage flag, so this is inert until the popup opts
  // in. Wrapped so a browser missing one of the events it subscribes to (Safari)
  // degrades to "no live tabs" instead of taking the whole background down with
  // it — the auth/save listeners above are already live regardless.
  diag("bg", "listeners registered");
  try {
    registerLiveCheckpoint();
    diag("bg", "live checkpoint registered");
  } catch (error) {
    diag("bg", "live checkpoint failed", { error: errMsg(error) });
    console.error("[Bookmark AI] live-tabs checkpoint failed to register", error);
  }
});
