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
import { setDeviceTokenReminter } from "@/lib/auth-refresh";
import { CLERK_PUBLISHABLE_KEY, CLERK_SYNC_HOST } from "@/lib/clerk";
import { detectSource } from "@/lib/detect";
import {
  clearDeviceToken,
  getStoredDeviceToken,
  getUsableDeviceToken,
  isDeviceTokenRenewalDue,
  renewDeviceTokenIfNeeded,
  storeDeviceToken,
  type DeviceTokenResponse,
} from "@/lib/device-token";
import { diag } from "@/lib/diag";
import { fullName } from "@/lib/identity";
import { MintGate } from "@/lib/mint-gate";
import { getNativeSession, getNativeSessionToken, nativeSignOut } from "@/lib/native-session";
import { PerfTrace } from "@/lib/perf";
import {
  drainNativeSyncQueue,
  refreshNativeSyncSettings,
  registerNativeSync,
} from "@/lib/native-sync";
import { pushLiveNow, registerLiveCheckpoint, setLiveEnabled } from "@/lib/live-checkpoint";
import { getNewWindowsPolicy, isWindowShared, setWindowShared } from "@/lib/live-windows";
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

/** How long a constructed Clerk client is reused (see `racedClerkClient`). Short
 * enough that a sign-out on the website is reflected on the next popup open, long
 * enough that "open the popup, click save" doesn't build the client twice. */
const CLERK_CLIENT_TTL_MS = 60_000;
type ClerkClient = Awaited<ReturnType<typeof createClerkClient>>;
let clerkClientCache: { client: Promise<ClerkClient>; at: number } | null = null;

/** The Clerk SDK client, bounded by the race timeout and MEMOIZED for
 * `CLERK_CLIENT_TTL_MS`.
 *
 * Constructing the client is the expensive part — it handshakes with the syncHost
 * to adopt the web session — and it used to happen on EVERY `GET_USER` **and**
 * again on EVERY authenticated request. A session save therefore paid a full
 * client construction plus a token mint (measured: ~355ms of a ~420ms local save)
 * even though the popup had built one seconds earlier. Reads of `.session`/`.user`
 * and `session.getToken()` are all we do with it, and `getToken()` refreshes the
 * JWT itself, so reusing the instance is safe; a construction that throws/times
 * out is NOT cached, and sign-out drops the cache immediately. */
function racedClerkClient(): Promise<ClerkClient> {
  const now = Date.now();
  if (clerkClientCache && now - clerkClientCache.at < CLERK_CLIENT_TTL_MS) {
    return clerkClientCache.client;
  }
  const client = withTimeout(
    createClerkClient({ publishableKey: CLERK_PUBLISHABLE_KEY, syncHost: CLERK_SYNC_HOST }),
    CLERK_RACE_MS,
    "createClerkClient",
  );
  clerkClientCache = { client, at: now };
  // A failed/timed-out construction must not be remembered — the next call has to
  // be free to try again (and to fall through to the native/device paths).
  void client.catch(() => {
    if (clerkClientCache?.client === client) clerkClientCache = null;
  });
  return client;
}

/** Drop the memoized client (sign-out, or a rejected credential). */
function resetClerkClient(): void {
  clerkClientCache = null;
}

/** Clerk session JWT (same syncHost session the popup shows). SDK first (dev
 * instances), then the production Native-API fallback (see lib/native-session).
 * Null when signed out or Clerk is unreachable — saves still work against the
 * open local server; the auth-enforcing deployed server rejects them. */
async function getSessionToken(): Promise<string | null> {
  // Rung 1 — the persisted DEVICE TOKEN, whenever one is stored. It is a plain
  // 90-day Bearer scoped to exactly the routes the background calls
  // (`DEVICE_TOKEN_ROUTES` in apps/web/lib/server/require-user.ts: bookmark/session
  // saves, settings, /api/me, its own renewal, plus the live server by contract),
  // so resolving it is ONE storage read — no network, no Clerk.
  //
  // This used to be gated on `winningPath === "device"`, i.e. it was skipped
  // whenever identity happened to resolve through the SDK or the Native API —
  // which is the normal case. Every save then rebuilt a Clerk client and minted a
  // fresh session JWT (~355ms locally, and a FAPI round trip in production) to
  // authenticate a request that the token already in storage authenticates for
  // free. That was the single largest slice of "Save session takes a lot of time".
  //
  // `winningPath` is deliberately NOT set from here: it drives IDENTITY and
  // sign-out semantics (a "device" pin makes sign-out hand off to the web app),
  // and which bearer a request carries must not silently change those.
  // `getUsableDeviceToken` (not `getStoredDeviceToken`) so a token in its last 60s
  // renews INLINE instead of returning null and dropping us down a ladder whose
  // Clerk session is probably long gone.
  {
    const deviceToken = await getUsableDeviceToken();
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
  // Last rung: rung 1 found no device token, but one of the fire-and-forget mints
  // kicked off by `handleGetUser` may have landed WHILE we were racing the SDK /
  // native paths — so re-read before giving up. Returning null here means the
  // request goes out unauthenticated (fine against an open local server, a 401
  // against the deployed one, which `authFetch` then recovers from).
  {
    const deviceToken = await getUsableDeviceToken();
    if (deviceToken) {
      winningPath = "device";
      diag("token", "device token fallback", { hasToken: true });
      return deviceToken;
    }
  }
  return token; // null
}

/**
 * Resolve the request credential NOW so the next authenticated call doesn't have
 * to. Called (fire-and-forget) right after the popup's `GET_USER` is answered.
 *
 * With a device token stored this is a storage read; without one it walks the
 * SDK/native rungs, which both leave a warm client + a cached Clerk JWT behind —
 * so either way the save click starts from a hot credential. Never throws.
 */
async function warmCredential(): Promise<void> {
  const started = Date.now();
  try {
    const token = await getSessionToken();
    diag("perf", "credential warm", { ms: Date.now() - started, hasToken: !!token });
  } catch (e) {
    diag("perf", "credential warm failed", { error: errMsg(e) });
  }
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

/** Success-latched, backoff-on-failure guard so a bridge re-mint fires at most
 * once per boot instead of on every bridge-resolved getUser/write (Safari
 * respawns the worker often) — WITHOUT a transient failure blocking every later
 * attempt in that context (see lib/mint-gate.ts). */
const bridgeMintGate = new MintGate("bridge mint");

/** Bootstrap (or re-mint) the long-lived device token THROUGH an open app tab's
 * bridge — the one context that can reach the web Clerk session. Called from the
 * bridge-signed-in paths, so a live bridge tab is present. Mints when there's no
 * usable stored token, or when the stored one is renewal-due but the plain-Bearer
 * renewal is blocked on "reauth" (only a fresh Clerk-authed mint can replace it).
 * `force` (401 recovery) ignores the gate and the freshness check. Best-effort: a
 * failure just leaves the extension on the bridge/cookie paths. */
async function mintDeviceTokenViaBridge(options: { force?: boolean } = {}): Promise<boolean> {
  const force = options.force === true;
  if (force) bridgeMintGate.reset();
  if (bridgeMintGate.blocked()) return false;
  const existing = await getStoredDeviceToken();
  if (existing && !force && !(await isDeviceTokenRenewalDue())) return false; // fresh, nothing to do
  const res = await bridgeFetch("/api/device-token", "POST", "{}");
  if (!res) {
    // No bridge tab is a MISSING PRECONDITION, not a failed mint — don't burn the
    // backoff on it; the next resolve with a tab open should try immediately.
    diag("deviceToken", "bridge mint: no bridge tab");
    return false;
  }
  if (!res.ok) {
    bridgeMintGate.failed();
    diag("deviceToken", "device token minted via bridge", { ok: false, status: res.status });
    return false;
  }
  try {
    const body = (await res.json()) as DeviceTokenResponse;
    if (body?.token) {
      await storeDeviceToken(body);
      bridgeMintGate.succeeded();
    } else {
      bridgeMintGate.failed();
    }
    diag("deviceToken", "device token minted via bridge", { ok: !!body?.token, status: res.status });
    return !!body?.token;
  } catch {
    bridgeMintGate.failed();
    diag("deviceToken", "bridge mint: parse failed", { status: res.status });
    return false;
  }
}

/** Guard so a session-token mint fires at most once per boot after it SUCCEEDS
 * (instead of on every getUser/alarm wake). A failure only backs off — the old
 * permanent `mintAttempted = true`, set before the request, meant one transient
 * error blocked every re-mint for the context's lifetime, which on Firefox MV2's
 * PERSISTENT background page is the whole browser session (see lib/mint-gate.ts). */
const sessionMintGate = new MintGate("mint");

/** A fresh Clerk session JWT (SDK or Native), NOT a device token — the bearer
 * used to mint the long-lived device token. Null when no live Clerk session
 * exists (signed out, or the session expired and only a device token remains).
 * Distinct from `getSessionToken` so the mint bearer is always a Clerk session,
 * never the device token itself — posting the device token would turn a mint
 * into a renewal and hit the `code:"reauth"` wall instead of seeding a fresh
 * chain. Mirrors `getSessionToken`'s path gating so the two never diverge. */
async function freshSessionTokenForMint(): Promise<string | null> {
  if (
    winningPath !== "native" &&
    winningPath !== "device" &&
    winningPath !== "cookie" &&
    winningPath !== "bridge"
  ) {
    try {
      const clerk = await racedClerkClient();
      if (clerk.session) {
        const t = await withTimeout(
          Promise.resolve(clerk.session.getToken()),
          CLERK_RACE_MS,
          "getToken",
        );
        if (t) return t;
      }
    } catch {
      // fall through to the native mint
    }
  }
  return getNativeSessionToken();
}

/** Bootstrap (or re-mint) the long-lived device token using a fresh Clerk
 * session JWT (SDK or Native-API) — the path Chrome/Firefox reach DIRECTLY
 * from the background (the FAPI `__client` cookie is visible to their network
 * context, so no content-script bridge is needed, unlike Safari which uses
 * `mintDeviceTokenViaBridge`). Called from `handleGetUser` when a live session
 * is resolved, from the periodic auth alarm, and at boot — so the 90-day token
 * is seeded within the session lifetime even if the popup is never opened
 * (the root cause of the every-7-day "open the web app to refresh" bug). Mints
 * when there's no usable stored token, or when the stored one is renewal-due
 * (a plain-Bearer renewal that hit `reauth` can only be replaced by a fresh
 * Clerk-authed mint). `force` (401 recovery) ignores the gate and the freshness
 * check — the caller already knows the current credential is rejected.
 * Best-effort: a failure just leaves the extension on the sdk/native paths until
 * the next attempt. Resolves whether a token is now stored. */
async function mintDeviceToken(options: { force?: boolean } = {}): Promise<boolean> {
  const force = options.force === true;
  if (force) sessionMintGate.reset();
  if (sessionMintGate.blocked()) return false;
  const existing = await getStoredDeviceToken();
  if (existing && !force && !(await isDeviceTokenRenewalDue())) return false; // fresh, nothing to do
  const token = await freshSessionTokenForMint();
  if (!token) {
    diag("deviceToken", "mint: no clerk session token");
    // No backoff: "not signed in yet" is a missing precondition, not a failure,
    // and a later poll/alarm (after sign-in completes) must be able to seed the
    // token immediately rather than 10 minutes later.
    return false;
  }
  const base = await getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/device-token`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: "{}",
    });
    if (!res.ok) {
      sessionMintGate.failed();
      diag("deviceToken", "mint via session token", { ok: false, status: res.status });
      return false;
    }
    const body = (await res.json()) as DeviceTokenResponse;
    if (body?.token) {
      await storeDeviceToken(body);
      sessionMintGate.succeeded();
    } else {
      sessionMintGate.failed();
    }
    diag("deviceToken", "mint via session token", { ok: !!body?.token, status: res.status });
    return !!body?.token;
  } catch (e) {
    sessionMintGate.failed();
    diag("deviceToken", "mint error", { error: errMsg(e) });
    return false;
  }
}

/**
 * The FRESH-MINT rung of the 401 recovery ladder (registered into
 * lib/auth-refresh.ts at boot): a forced Clerk-authed mint through whichever path
 * this browser actually has. Chrome/Firefox reach the Native-API session directly;
 * Safari's extension context is partitioned from it, so it falls back to an open
 * app tab's bridge. Resolves whether a new device token is now stored.
 */
async function remintDeviceToken(): Promise<boolean> {
  if (await mintDeviceToken({ force: true })) return true;
  if (SAFARI) return mintDeviceTokenViaBridge({ force: true });
  return false;
}

/**
 * Ask `GET /api/me` who the stored device token belongs to. This is the ONLY
 * check that catches a token that is invalid but not yet EXPIRED (revoked
 * server-side, a wiped tenant DB, a token minted against a different instance) —
 * renewal can't tell the difference and the local expiry says it's fine. It used
 * to live inline in `handleGetUser`, which meant the popup was the only thing in
 * the whole extension that ever cleared a bad token; now the 6h alarm runs it too.
 *
 * Returns identity on success, `{ok:false}` when the token was rejected AND
 * cleared, or null when the probe proved nothing (network error, a non-401
 * status, or a 401 that arrived after a redirect).
 */
type DeviceProbe =
  | { ok: true; name: string | null; email: string | null }
  | { ok: false; cleared: true };

async function probeDeviceToken(token: string, scope: string): Promise<DeviceProbe | null> {
  const base = await getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/me`, {
      headers: { accept: "application/json", authorization: `Bearer ${token}` },
    });
    diag(scope, "device /api/me", { status: res.status });
    if (res.ok) {
      const body = (await res.json()) as { name?: string | null; email?: string | null };
      return { ok: true, name: body.name ?? null, email: body.email ?? null };
    }
    if (res.status === 401 && !res.redirected) {
      // Token invalid (not merely aging) — drop it so the caller can fall through
      // to the other paths / force a fresh mint.
      await clearDeviceToken();
      diag(scope, "device token invalid (cleared)", { status: 401 });
      return { ok: false, cleared: true };
    }
    if (res.status === 401) {
      // 401 AFTER a redirect proves nothing about the token: browsers strip the
      // Authorization header on a cross-origin hop (this exact failure signed
      // everyone out when the build targeted the apex domain and Vercel 308'd
      // every /api call to www). Keep the token; the base URL is what needs fixing.
      diag(scope, "device /api/me 401 via redirect (token kept)", { url: res.url });
    }
    return null; // any other status → leave the token, prove nothing
  } catch (e) {
    // Network error — leave the token in place.
    diag(scope, "device /api/me error", { error: errMsg(e) });
    return null;
  }
}

/** TEMP migration cleanup: the PRODUCTION domain switched Clerk instances
 * (dev → prod) on 2026-07-22; browsers that used the dev era carry stale
 * dev-suffixed cookies (`*_vm2h_-wW`) that can shadow the prod session for the
 * sync SDK. Surgically remove exactly those.
 *
 * PRODUCTION BUILDS ONLY, and once per background lifetime.
 *  • `_vm2h_-wW` is the DEV instance's cookie suffix, and the local (`localhost:3000`)
 *    and dev (`bookmark-ai-dev`) targets legitimately run on that instance — so on
 *    those builds this "cleanup" deleted the CURRENT session cookies of the very
 *    origin it syncs with (`__session_vm2h_-wW` & friends on `http://localhost`),
 *    signing the user out of the web app every time the popup was opened. Gating on
 *    the live publishable key confines it to the one instance pair it was written for.
 *  • It also ran on EVERY `GET_USER`, i.e. twice per popup open, for a one-time
 *    migration — two full cookie scans on the path the popup blocks its UI on. */
let devEraCookiesPurged = false;

async function purgeDevEraCookies(): Promise<void> {
  if (devEraCookiesPurged) return;
  devEraCookiesPurged = true;
  if (!CLERK_PUBLISHABLE_KEY.startsWith("pk_live_")) return;
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
 * session) degrades to signed-out so the popup shows the sign-in prompt.
 *
 * `reentered` guards the ONE self-heal re-run: see Path B.5, where a rejected
 * device token un-pins `winningPath` and the ladder starts over. */
async function handleGetUser(reentered = false): Promise<UserInfo> {
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
        // Seed the long-lived device token while the SDK session is alive (dev
        // instances) — fire-and-forget; `freshSessionTokenForMint` re-derives the
        // SDK token as the mint bearer.
        void mintDeviceToken();
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
      // Seed the long-lived device token WHILE the Clerk session is alive — the
      // native session JWT is the bearer the mint needs. Fire-and-forget; once
      // minted, saves stop depending on the live session (the 7-day fix).
      void mintDeviceToken();
      return { signedIn: true, name: native.name, email: native.email };
    }
  }
  // Path B.5 — device token: a long-lived bearer minted once (via the native
  // session on Chrome/Firefox, via the content-script bridge on Safari) and
  // silently self-renewing, so identity resolves with NO app tab open even AFTER
  // the server-side Clerk session expires. Tried BEFORE the cookie/bridge paths
  // (both of which need an open app tab); the cookie jar is invisible on Safari,
  // but the device token is a plain Bearer that works in every browser context.
  const deviceToken = await getUsableDeviceToken();
  if (deviceToken) {
    const probe = await probeDeviceToken(deviceToken, "getUser");
    if (probe?.ok) {
      winningPath = "device";
      rememberIdentity(probe.name, probe.email);
      diag("getUser", "reply", { path: "device", signedIn: true });
      void renewDeviceTokenIfNeeded();
      return { signedIn: true, name: probe.name, email: probe.email };
    }
    if (probe && !probe.ok && winningPath === "device") {
      // The token we were PINNED to is gone. Paths A and B were skipped on the way
      // in precisely because `winningPath === "device"`, so falling through from
      // here would report signed-out on Chrome/Firefox even with a perfectly live
      // Clerk session — i.e. it would tell the user to go sign in on the web app,
      // the exact dead end this hardening removes. Un-pin and re-run the ladder
      // once; the SDK/native rungs get their chance and re-mint on success.
      winningPath = null;
      diag("getUser", "device token rejected → re-running the ladder");
      if (!reentered) return handleGetUser(true);
    }
    // Otherwise (inconclusive, or already re-run) fall through to the remaining
    // paths, which may still see a live session and re-mint.
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
  // Drop the memoized Clerk client: whatever happens below, the session it holds
  // is on its way out, and the next resolve must build a fresh one rather than
  // report the signed-out user as still signed in.
  resetClerkClient();
  // The device token is our OWN long-lived bearer, not a Clerk session — clear it
  // locally on any sign-out (all browsers) so it's never reused. Ending the
  // shared web session itself still happens via the SDK/native paths below or
  // the web handoff.
  void clearDeviceToken();
  let ok = false;
  // "device" joins cookie/bridge as tokenless-for-sign-out: a device token can't
  // end the shared Clerk session, so we hand off to the web app just like those.
  // (cookie/bridge are Safari-only paths, but "device" is now cross-browser.)
  const tokenless =
    winningPath === "cookie" || winningPath === "bridge" || winningPath === "device";
  if (winningPath !== "native" && !tokenless) {
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
  if (!ok && !tokenless) ok = await nativeSignOut();
  if (!ok && (SAFARI || tokenless)) {
    // Cookie/bridge (Safari) or device (any browser): the client token is an
    // HttpOnly cookie we can't present (and the bridge is read-only for
    // identity), or the session is already gone (device path), so we can't end
    // the shared session from here. Hand off to the web app — the user signs out
    // there, and the popup's next resolve then reports signed-out to the gate.
    diag("signOut", "tokenless handoff (open web)", { path: winningPath });
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
  const perf = new PerfTrace("session save (bg)");
  try {
    const tabs = await gatherOpenTabs(message.windowId);
    perf.mark("gatherTabs");
    if (tabs.length === 0) throw new Error("No open tabs in this window to save.");
    const src = detectSource();
    const session = await saveSession({
      name: message.name,
      tabs,
      browser: src.browser,
      device: src.device,
      os: src.os,
      savedAt: src.savedAt,
    });
    perf.mark("save");
    // Saved successfully — only now is it safe to close the window + open the app.
    // HARD RULE: nothing closes before the server has confirmed the save, so a
    // failed save can never cost the user their tabs. `keepOpen` is the checkpoint
    // path: nothing closes, nothing opens, the user stays exactly where they are.
    if (!message.keepOpen) {
      const webUrl = await getWebBaseUrl();
      perf.mark("webUrl");
      await closeWindowsAndOpen(`${webUrl}/app?section=sessions`, message.windowId);
      perf.mark("closeWindows");
    }
    perf.end({ tabs: tabs.length, keepOpen: message.keepOpen === true });
    return { ok: true, session };
  } catch (error) {
    perf.end({ failed: true });
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Read whether the popup's window is currently shared: the global publish switch,
 * the resolved per-window decision (override ?? policy), and the device policy
 * itself (so the popup can word its "future windows…" hint). */
async function handleLiveWindowGet(
  message: LiveWindowGetMessage,
): Promise<LiveWindowGetResult> {
  const [enabled, shared, policyDefault] = await Promise.all([
    liveEnabledItem.getValue(),
    isWindowShared(message.windowId),
    getNewWindowsPolicy(),
  ]);
  return { enabled, shared, policyDefault };
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

/**
 * The periodic auth tick (6h alarm) and the boot tick share this: renew → VALIDATE
 * → mint → settings → drain the mirror retry queue.
 *
 * The VALIDATE step is the reason this exists as a function. Renewal only looks at
 * the local expiry, so a token that the server no longer accepts survived every
 * alarm forever; the only thing that ever noticed was a popup open, i.e. the user
 * was required to interact with the extension to un-stick their own saves. Now the
 * alarm probes `/api/me`, and a rejection clears the token and forces a fresh mint
 * on the spot.
 *
 * The probe is ALARM-ONLY on purpose. This function also runs at boot, and an MV3
 * worker boots on every wake (a tab event, a message, Safari's ~2-minute
 * teardown) — probing there would turn a 6-hourly check into a request on every
 * wake. Six hours is well inside the token's 90-day life, and any real 401 in
 * between is caught inline by `authFetch`'s recovery.
 */
async function authTick(reason: "boot" | "alarm"): Promise<void> {
  await renewDeviceTokenIfNeeded();
  if (reason === "alarm") {
    const token = await getUsableDeviceToken();
    if (token) {
      const probe = await probeDeviceToken(token, "authTick");
      if (probe && !probe.ok) {
        const minted = await remintDeviceToken();
        diag("authTick", "rejected token → forced re-mint", { reason, minted });
      }
    }
  }
  await mintDeviceToken();
  await refreshNativeSyncSettings();
  await drainNativeSyncQueue();
}

export default defineBackground(() => {
  diag("bg", "boot", { browser: import.meta.env.BROWSER, syncHost: CLERK_SYNC_HOST });
  setAuthTokenProvider(getSessionToken);
  // The fresh-mint rung of the 401 recovery ladder (lib/auth-refresh.ts). Every
  // authFetch 401 on every target now routes through here, which is what removes
  // "open the web app to fix it" from the user's job description.
  setDeviceTokenReminter(remintDeviceToken);

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
      // Logged because the web side can only ever see "no answer" — this is the
      // only place that distinguishes "the worker woke and replied" from "the
      // ping never arrived" (wrong id / origin missing from
      // externally_connectable). Answered synchronously, so a cold MV3 worker
      // replies the moment it finishes booting; the web app retries to cover the
      // wake latency.
      if (isBookmarkAiPingMessage(message)) {
        diag("bg", "external ping", { url: sender.url ?? null });
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
        const started = Date.now();
        void handleGetUser().then((info) => {
          // The popup blocks its whole UI on this answer, so its cost is part of
          // "the extension feels slow" — measure it alongside the save path.
          diag("perf", "getUser", { ms: Date.now() - started, signedIn: info.signedIn });
          sendResponse(info);
          // PRE-WARM: the popup opening is the earliest possible signal that a
          // save click is coming, and `GET_USER` is the message it always sends
          // first. Resolving the credential now (off the reply path — the popup is
          // already rendering) means the click starts with a warm one instead of
          // paying for it inside the save.
          if (info.signedIn) void warmCredential();
        });
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

  // Auth keep-alive: a periodic alarm wakes the MV3 worker to mint (first time)
  // and renew the long-lived device token, so saves keep working for the full
  // 90-day TTL with NO popup open and NO web-app tab — the fix for the
  // every-7-day "open the site to refresh the token" failure. Registered
  // synchronously so the worker wakes on the alarm; 6h is far inside the 7-day
  // server-side session window, so the first mint lands while the session that
  // the user just signed in with is still alive. The same alarm refreshes the
  // native-sync settings cache, and the native-sync listeners register here too
  // (all synchronous — MV3 only wakes for listeners registered at evaluation).
  const AUTH_ALARM = "bkm-auth-mint";
  try {
    registerNativeSync();
    browser.alarms.create(AUTH_ALARM, { periodInMinutes: 6 * 60 });
    browser.alarms.onAlarm.addListener((a) => {
      if (a.name !== AUTH_ALARM) return;
      void authTick("alarm");
    });
    // Seed opportunistically at boot (throttled; no-op if a fresh token exists
    // or no live session yet — the alarm and handleGetUser retry afterward). The
    // boot tick also drains any mirror adds a previous session couldn't deliver.
    void authTick("boot");
    diag("bg", "auth alarm registered");
  } catch (error) {
    diag("bg", "auth alarm failed", { error: errMsg(error) });
  }
});
