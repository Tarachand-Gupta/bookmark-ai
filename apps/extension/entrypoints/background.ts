import { defineBackground, storage } from "#imports";
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
import {
  clearDeviceToken,
  getStoredDeviceToken,
  isDeviceTokenRenewalDue,
  renewDeviceTokenIfNeeded,
  storeDeviceToken,
  type DeviceTokenResponse,
} from "@/lib/device-token";
import { diag } from "@/lib/diag";
import { fullName } from "@/lib/identity";
import { getNativeSession, getNativeSessionToken, nativeSignOut } from "@/lib/native-session";
import { pushLiveNow, registerLiveCheckpoint, setLiveEnabled } from "@/lib/live-checkpoint";
import { isWindowExcluded, setWindowShared } from "@/lib/live-windows";
import { liveEnabledItem } from "@/lib/live-storage";
import { closeWindowsAndOpen, gatherOpenTabs } from "@/lib/session";
import {
  isBookmarkAiPingMessage,
  isGetUserMessage,
  isLivePushNowMessage,
  isLiveSetEnabledMessage,
  isLiveWindowGetMessage,
  isLiveWindowSetMessage,
  isRestoreSessionMessage,
  isSaveBookmarkMessage,
  isSaveSessionMessage,
  isSignOutMessage,
  requestBridgeFetch,
  requestBridgeMe,
  type BridgeFetchResult,
  type BridgeMeResult,
  type LiveSetEnabledResult,
  type LiveWindowGetMessage,
  type LiveWindowGetResult,
  type LiveWindowSetMessage,
  type LiveWindowSetResult,
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

type AuthPath = "sdk" | "native" | "device" | "cookie" | "bridge";
/** Which path last resolved a session, cached for THIS background lifetime so
 * repeat popup opens don't re-pay the SDK race once we know which path works.
 * A browser restart spins up a fresh background script → `null` again → the SDK
 * path is retried. Stays null while fully signed out so no path is skipped (a
 * pending web sign-in must still be picked up). "cookie" = the Safari
 * credentialed /api/me path (SDK + native cookie both blind); "device" = the
 * Safari long-lived device-token bearer (a token-bearing path, like sdk/native —
 * see lib/device-token.ts). */
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
  // Device path (Safari): the persisted device token IS the bearer — a
  // token-bearing path like sdk/native, so skip the SDK race and native mint and
  // hand it straight to authFetch. If it vanished (cleared out from under us),
  // fall through to re-resolve.
  if (SAFARI && winningPath === "device") {
    const deviceToken = await getStoredDeviceToken();
    if (deviceToken) return deviceToken;
  }
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
  if (token) return token;
  // Safari fallback: the SDK/native mints came up empty, but a device token may
  // persist (a fresh worker boots winningPath === null; the token survives in
  // storage.local). Attach it so authFetch carries a Bearer on every API call.
  if (SAFARI) {
    const deviceToken = await getStoredDeviceToken();
    if (deviceToken) {
      winningPath = "device";
      diag("token", "device token fallback", { hasToken: true });
      return deviceToken;
    }
  }
  return token; // null
}

const SIGNED_OUT: UserInfo = { signedIn: false, name: null, email: null };

/* ── Last-known identity (Safari reconnect UX) ───────────────────────────────
 * On Safari every auth path needs an OPEN app tab (bridge), so a fresh browser
 * launch resolves "signed out" even though the web session is alive in the
 * site's cookie jar. Remember who was signed in (name/email only — NEVER a
 * token or cookie) so the gate can honestly say "reconnect" instead of asking
 * for a sign-in that isn't needed. Cleared on a DEFINITIVE signed-out answer
 * (a bridge tab that says so, or a non-Safari resolve). */
interface LastIdentity {
  name: string | null;
  email: string | null;
  at: number;
}
const LAST_IDENTITY_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const lastIdentityItem = storage.defineItem<LastIdentity | null>("local:lastIdentity", {
  fallback: null,
});

function rememberIdentity(name: string | null, email: string | null): void {
  void lastIdentityItem.setValue({ name, email, at: Date.now() }).catch(() => {});
}

async function staleIdentityReply(): Promise<UserInfo> {
  const last = await lastIdentityItem.getValue().catch(() => null);
  if (last && Date.now() - last.at < LAST_IDENTITY_MAX_AGE_MS) {
    return { signedIn: false, name: last.name, email: last.email, stale: true };
  }
  return SIGNED_OUT;
}

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

/** Re-inject the bridge content script into a tab whose bridge didn't answer.
 * Manifest content scripts only reach tabs opened AFTER install, so an app tab
 * from before the current install (or a reinstall/update — Safari orphans the
 * old script) has no live bridge. The script's own double-injection guard makes
 * this safe to call on a tab that does have one. */
async function injectBridge(tabId: number): Promise<boolean> {
  try {
    const scripting = (browser as unknown as {
      scripting?: {
        executeScript: (opts: { target: { tabId: number }; files: string[] }) => Promise<unknown>;
      };
    }).scripting;
    if (!scripting) return false;
    await scripting.executeScript({ target: { tabId }, files: ["content-scripts/bridge.js"] });
    diag("bridge", "re-injected", { tabId });
    return true;
  } catch (e) {
    diag("bridge", "inject failed", { error: errMsg(e) });
    return false;
  }
}

/** sendMessage to a tab's bridge, re-injecting once when it doesn't answer. */
async function bridgeSend<T>(tabId: number, message: unknown): Promise<T | undefined> {
  try {
    const res = (await browser.tabs.sendMessage(tabId, message)) as T | undefined;
    if (res !== undefined) return res;
  } catch {
    // fall through to injection
  }
  if (!(await injectBridge(tabId))) return undefined;
  try {
    return (await browser.tabs.sendMessage(tabId, message)) as T | undefined;
  } catch {
    return undefined;
  }
}

/** Path D identity: ask an open app tab's bridge who is signed in. Returns null
 * when no tab has a live bridge (predates install / none open). */
async function bridgeGetUser(): Promise<UserInfo | null> {
  const ids = await bridgeTabIds();
  diag("bridge", "tabs found", { count: ids.length });
  for (const tabId of ids) {
    const res = await bridgeSend<BridgeMeResult>(tabId, requestBridgeMe());
    if (res?.ok) {
      diag("bridge", "BRIDGE_ME result", { got: true, signedIn: res.signedIn });
      return res.signedIn ? { signedIn: true, name: res.name, email: res.email } : SIGNED_OUT;
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
  diag("bridge", "fetch tabs found", { count: ids.length, path });
  for (const tabId of ids) {
    const res = await bridgeSend<BridgeFetchResult>(tabId, requestBridgeFetch(path, method, bodyJson));
    if (res && typeof res.status === "number" && res.status > 0) {
      diag("bridge", "BRIDGE_FETCH", { path, status: res.status });
      const body = NULL_BODY_STATUS.has(res.status) ? null : (res.bodyJson ?? null);
      return new Response(body, { status: res.status });
    }
  }
  return null;
}

/** Once-per-worker guard so a bridge re-mint fires at most once per boot instead
 * of on every bridge-resolved getUser/write (Safari respawns the worker often). */
let bridgeMintAttempted = false;

/** Bootstrap (or re-mint) the long-lived device token THROUGH an open app tab's
 * bridge — the one context that can reach the web Clerk session. Called from the
 * bridge-signed-in paths, so a live bridge tab is present. Mints when there's no
 * usable stored token, or when the stored one is renewal-due but the plain-Bearer
 * renewal is blocked on "reauth" (only a fresh Clerk-authed mint can replace it).
 * Best-effort: a failure just leaves the extension on the bridge/cookie paths. */
async function mintDeviceTokenViaBridge(): Promise<void> {
  if (bridgeMintAttempted) return;
  const existing = await getStoredDeviceToken();
  if (existing && !(await isDeviceTokenRenewalDue())) return; // fresh token, nothing to do
  bridgeMintAttempted = true;
  const res = await bridgeFetch("/api/device-token", "POST", "{}");
  if (!res) {
    diag("deviceToken", "bridge mint: no bridge tab");
    return;
  }
  if (!res.ok) {
    diag("deviceToken", "device token minted via bridge", { ok: false, status: res.status });
    return;
  }
  try {
    const body = (await res.json()) as DeviceTokenResponse;
    if (body?.token) await storeDeviceToken(body);
    diag("deviceToken", "device token minted via bridge", { ok: !!body?.token, status: res.status });
  } catch {
    diag("deviceToken", "bridge mint: parse failed", { status: res.status });
  }
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
  if (
    winningPath !== "native" &&
    winningPath !== "device" &&
    winningPath !== "cookie" &&
    winningPath !== "bridge"
  ) {
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
        const email = user.primaryEmailAddress?.emailAddress ?? null;
        rememberIdentity(fullName(user), email);
        return { signedIn: true, name: fullName(user), email };
      }
    } catch (e) {
      diag("getUser", "sdk failed", { ms: Date.now() - started, error: errMsg(e) });
    }
  }
  // Path B — Native API via the FAPI __client cookie (see lib/native-session).
  if (winningPath !== "device" && winningPath !== "cookie" && winningPath !== "bridge") {
    const native = await getNativeSession();
    if (native) {
      winningPath = "native";
      diag("getUser", "reply", { path: "native", signedIn: true });
      rememberIdentity(native.name, native.email);
      return { signedIn: true, name: native.name, email: native.email };
    }
  }
  // Path B.5 — device token (Safari): a long-lived bearer minted once through the
  // bridge (right after sign-in) and silently self-renewing, so identity resolves
  // with NO app tab open — Chrome-parity. Header auth works in Safari's
  // partitioned context where the cookie jar is invisible; tried BEFORE the
  // cookie/bridge paths (both of which need an open app tab).
  if (SAFARI) {
    const deviceToken = await getStoredDeviceToken();
    if (deviceToken) {
      const base = await getApiBaseUrl();
      try {
        const res = await fetch(`${base}/api/me`, {
          headers: { accept: "application/json", authorization: `Bearer ${deviceToken}` },
        });
        diag("getUser", "device /api/me", { status: res.status });
        if (res.ok) {
          const body = (await res.json()) as { name?: string | null; email?: string | null };
          winningPath = "device";
          rememberIdentity(body.name ?? null, body.email ?? null);
          diag("getUser", "reply", { path: "device", signedIn: true });
          void renewDeviceTokenIfNeeded();
          return { signedIn: true, name: body.name ?? null, email: body.email ?? null };
        }
        if (res.status === 401) {
          // Token invalid (not merely aging) — drop it and fall through to the
          // cookie/bridge paths, which may still see a live session.
          await clearDeviceToken();
          diag("getUser", "device token invalid (cleared)", { status: 401 });
        }
        // Any other status → leave the token, fall through.
      } catch (e) {
        // Network error — leave the token in place, fall through to other paths.
        diag("getUser", "device /api/me error", { error: errMsg(e) });
      }
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
      rememberIdentity(me.name, me.email);
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
      if (bridged.signedIn) {
        rememberIdentity(bridged.name, bridged.email);
        // Seize the open-tab moment to mint (or re-mint) the device token, so the
        // NEXT resolve — and every API call — needs no app tab at all (Path B.5).
        void mintDeviceTokenViaBridge();
      } else {
        // The ONE definitive signed-out signal on Safari: an app tab's own
        // credentialed request says there is no session. Forget the identity so
        // the gate goes back to a real sign-in prompt (Path C's /api/me always
        // reports signed-out on Safari — partitioned — so it proves nothing), and
        // drop the device token — the session it represented is gone.
        void lastIdentityItem.setValue(null).catch(() => {});
        void clearDeviceToken();
      }
      return bridged;
    }
  }
  diag("getUser", "reply", { path: "none", signedIn: false });
  // Safari with no app tab open: the session is probably alive but invisible.
  // Offer reconnect instead of a false "sign in" when we knew this account.
  if (SAFARI) return staleIdentityReply();
  return SIGNED_OUT;
}

/** Sign out of the mirrored session: SDK first, then the native fallback
 * (which ends the same client session the WEB app uses — signing out of the
 * extension signs out of the site too, which is the honest behavior). */
async function handleSignOut(): Promise<SignOutResult> {
  // The device token is our OWN long-lived bearer, not a Clerk session — clear it
  // locally on any sign-out so it's never reused. Ending the shared web session
  // itself still happens via the SDK/native paths below or the web handoff.
  if (SAFARI) void clearDeviceToken();
  let ok = false;
  // "device" joins cookie/bridge as tokenless-for-sign-out: a device token can't
  // end the shared Clerk session, so we hand off to the web app just like those.
  const tokenlessSafari =
    winningPath === "cookie" || winningPath === "bridge" || winningPath === "device";
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

/** Read whether the popup's window is currently shared: the global publish
 * switch plus this window not being on the exclude list. */
async function handleLiveWindowGet(
  message: LiveWindowGetMessage,
): Promise<LiveWindowGetResult> {
  const enabled = await liveEnabledItem.getValue();
  const shared = !(await isWindowExcluded(message.windowId));
  return { enabled, shared };
}

/** Include/exclude the popup's window, then force an IMMEDIATE full push so the
 * mirror gains or drops the window right away (pushes are full-replace) instead
 * of waiting for the next tab change. Reply after the storage write; the push is
 * fire-and-forget, mirroring the rename path (LIVE_PUSH_NOW). */
async function handleLiveWindowSet(
  message: LiveWindowSetMessage,
): Promise<LiveWindowSetResult> {
  await setWindowShared(message.windowId, message.shared);
  void pushLiveNow();
  return { ok: true, shared: message.shared };
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
      // Deliberately NOT gated on `winningPath`: Safari kills this worker every
      // couple of minutes, and a fresh worker boots with winningPath === null —
      // gating here made every alarm-driven live push go out tokenless (401 →
      // backoff → frozen mirror). Each strategy below is a cheap no-op when
      // unavailable (no bridge tab → null; no mintable token → fall through).
      let appOrigin = "";
      try {
        appOrigin = new URL(await getApiBaseUrl()).origin;
      } catch {
        // leave appOrigin empty → skip the origin-specific branches
      }
      const target = new URL(url);

      if (appOrigin && target.origin === appOrigin) {
        const body = typeof init.body === "string" ? init.body : undefined;
        const bridged = await bridgeFetch(
          target.pathname + target.search,
          (init.method as string) ?? "GET",
          body,
        );
        if (bridged) {
          // A working bridge proves an app tab is open and signed in — the moment
          // to seed the device token so future calls need no tab (once per worker).
          void mintDeviceTokenViaBridge();
          return bridged;
        }
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
        diag("live", "live call unauthed", { path: target.pathname });
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
          | LiveWindowGetResult
          | LiveWindowSetResult
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
      if (isLiveWindowGetMessage(message)) {
        void handleLiveWindowGet(message).then(sendResponse);
        return true;
      }
      if (isLiveWindowSetMessage(message)) {
        void handleLiveWindowSet(message).then(sendResponse);
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
