import type { Bookmark, Session } from "@bookmark-ai/types";
import { browser } from "wxt/browser";
import { diag } from "./diag";

/** Message contracts between the popup and the background script. */

export const SAVE_BOOKMARK = "SAVE_BOOKMARK" as const;
export const SAVE_SESSION = "SAVE_SESSION" as const;
/** Popup → background: who is signed in? The background owns the Clerk client
 * (createClerkClient + syncHost), so it is the authority on the mirrored web
 * session; the popup polls this to drive the signed-in/out gate. */
export const GET_USER = "GET_USER" as const;
/** Popup → background: flip the live-tabs opt-in. The background owns the Clerk
 * token, so the settings POST + local mirror + push loop all run there (§4.9). */
export const LIVE_SET_ENABLED = "LIVE_SET_ENABLED" as const;
/** External contract: sent by the WEB APP (externally_connectable origins)
 * to restore a saved session — either as one new window with all its tabs,
 * or as a named tab group in the user's current window. */
export const RESTORE_SESSION = "RESTORE_SESSION" as const;
/** External contract: the web app pings this to detect whether the extension
 * is installed (chrome.runtime.sendMessage(extensionId, {type}, cb)). Answered
 * from the same onMessageExternal listener as RESTORE_SESSION. */
export const BOOKMARK_AI_PING = "BOOKMARK_AI_PING" as const;

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

export interface BookmarkAiPingMessage {
  type: typeof BOOKMARK_AI_PING;
}

export function isBookmarkAiPingMessage(message: unknown): message is BookmarkAiPingMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as BookmarkAiPingMessage).type === BOOKMARK_AI_PING
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

export interface GetUserMessage {
  type: typeof GET_USER;
}

/** Popup → background: sign out of the mirrored session. The background owns
 * the Clerk client (SDK + native fallback), so sign-out must run there too —
 * the popup-side Clerk client can't see a production custom-domain session. */
export const SIGN_OUT = "SIGN_OUT" as const;

export interface SignOutMessage {
  type: typeof SIGN_OUT;
}

export interface SignOutResult {
  ok: boolean;
  /** Safari cookie path: the extension can't end the shared session itself, so
   * the popup should open the web app (`<webBase>/app`) for the user to sign out
   * there. Set only when `ok` is false and a web handoff is the correct action. */
  openWeb?: boolean;
}

export function isSignOutMessage(message: unknown): message is SignOutMessage {
  return (
    typeof message === "object" && message !== null && (message as SignOutMessage).type === SIGN_OUT
  );
}

/** Popup-side helper: sign out via the background. Never rejects. */
export function requestSignOut(): Promise<SignOutResult> {
  const message: SignOutMessage = { type: SIGN_OUT };
  return (browser.runtime.sendMessage(message) as Promise<SignOutResult>).catch(() => ({
    ok: false,
  }));
}

/** The current signed-in identity as the background resolves it from the
 * mirrored web session. `name` is a display name (full name or username) or
 * null; the popup falls back to `email` when there is no name. */
export interface UserInfo {
  signedIn: boolean;
  name: string | null;
  email: string | null;
  /** Safari only: no auth path could SEE a session right now (no app tab open
   * to bridge through), but this account was signed in recently and was never
   * definitively signed out — the web session is almost certainly still alive.
   * The gate should offer "reconnect" (open the app) rather than "sign in". */
  stale?: boolean;
}

export function isGetUserMessage(message: unknown): message is GetUserMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as GetUserMessage).type === GET_USER
  );
}

const SIGNED_OUT_INFO: UserInfo = { signedIn: false, name: null, email: null };

/** Popup-side helper: ask the background for the current signed-in user. Never
 * rejects into the caller — an unreachable background resolves to signed-out.
 * Also coerces a non-`UserInfo` reply (e.g. `undefined`, which some browsers
 * hand back when no listener answers instead of rejecting) to signed-out, so
 * the caller never stores an ambiguous value that would leave the gate stuck. */
export function requestUser(): Promise<UserInfo> {
  const message: GetUserMessage = { type: GET_USER };
  return (browser.runtime.sendMessage(message) as Promise<unknown>)
    .then((info) => {
      // Diagnostic: the raw reply shape distinguishes "no listener answered"
      // (undefined — background never ran) from a real signed-out reply
      // (object — background ran and answered). Values are never logged.
      diag("popup", "raw GET_USER reply", {
        type: typeof info,
        keys: info && typeof info === "object" ? Object.keys(info).slice(0, 8) : null,
      });
      return info && typeof info === "object" && typeof (info as UserInfo).signedIn === "boolean"
        ? (info as UserInfo)
        : SIGNED_OUT_INFO;
    })
    .catch((err: unknown) => {
      diag("popup", "GET_USER rejected", { error: err instanceof Error ? err.message : String(err) });
      return SIGNED_OUT_INFO;
    });
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

/** Popup → background: force an immediate live push, bypassing the 5s debounce.
 * A device rename writes only storage.local and carries NO tab event, so without
 * this the new label never reaches the mirror until the next tab change (the
 * ~2min heartbeat deliberately doesn't touch the mirror). No-op when off. */
export const LIVE_PUSH_NOW = "LIVE_PUSH_NOW" as const;

export interface LivePushNowMessage {
  type: typeof LIVE_PUSH_NOW;
}

export function isLivePushNowMessage(message: unknown): message is LivePushNowMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as LivePushNowMessage).type === LIVE_PUSH_NOW
  );
}

/** Popup-side helper: push current state now (after a rename). Never rejects. */
export function requestLivePushNow(): Promise<{ ok: boolean }> {
  const message: LivePushNowMessage = { type: LIVE_PUSH_NOW };
  return (browser.runtime.sendMessage(message) as Promise<{ ok: boolean }>).catch(() => ({
    ok: false,
  }));
}

/* ── Per-window share opt-out ─────────────────────────────────────────────────
 * The global live toggle shares every window by default; these let the popup
 * read and flip whether the CURRENT window is excluded from this device's pushes.
 * The popup resolves its own window id (background contexts can't), so it travels
 * in the message. */

/** Popup → background: is the current window shared? `enabled` is the global live
 * toggle; `shared` is this window not being on the exclude list. */
export const LIVE_WINDOW_GET = "LIVE_WINDOW_GET" as const;
/** Popup → background: include/exclude the current window, then push immediately. */
export const LIVE_WINDOW_SET = "LIVE_WINDOW_SET" as const;

export interface LiveWindowGetMessage {
  type: typeof LIVE_WINDOW_GET;
  windowId: number;
}

/** `enabled` = the global publish switch; `shared` = this window is not excluded. */
export type LiveWindowGetResult = { enabled: boolean; shared: boolean };

export function isLiveWindowGetMessage(message: unknown): message is LiveWindowGetMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as LiveWindowGetMessage).type === LIVE_WINDOW_GET &&
    typeof (message as LiveWindowGetMessage).windowId === "number"
  );
}

export interface LiveWindowSetMessage {
  type: typeof LIVE_WINDOW_SET;
  windowId: number;
  shared: boolean;
}

/** `ok` = the storage write succeeded; `shared` echoes the settled state. */
export type LiveWindowSetResult = { ok: boolean; shared: boolean };

export function isLiveWindowSetMessage(message: unknown): message is LiveWindowSetMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as LiveWindowSetMessage).type === LIVE_WINDOW_SET &&
    typeof (message as LiveWindowSetMessage).windowId === "number" &&
    typeof (message as LiveWindowSetMessage).shared === "boolean"
  );
}

/** Popup-side helper: read the current window's share state. Never rejects — an
 * unreachable background resolves to "off, shared" so the row simply doesn't show. */
export function requestLiveWindowGet(windowId: number): Promise<LiveWindowGetResult> {
  const message: LiveWindowGetMessage = { type: LIVE_WINDOW_GET, windowId };
  return (browser.runtime.sendMessage(message) as Promise<LiveWindowGetResult>).catch(() => ({
    enabled: false,
    shared: true,
  }));
}

/** Popup-side helper: include/exclude the current window. Never rejects — a
 * failure reports `ok:false` and leaves the requested `shared` for the optimistic UI. */
export function requestLiveWindowSet(
  windowId: number,
  shared: boolean,
): Promise<LiveWindowSetResult> {
  const message: LiveWindowSetMessage = { type: LIVE_WINDOW_SET, windowId, shared };
  return (browser.runtime.sendMessage(message) as Promise<LiveWindowSetResult>).catch(() => ({
    ok: false,
    shared,
  }));
}

/* ── Path D: content-script session bridge (Safari) ──────────────────────────
 * Safari 26 fully partitions the extension's network/cookie context from the
 * browser jar, so neither the SDK, the Native-API cookie, nor a direct
 * credentialed extension fetch can see the web session. These messages go
 * BACKGROUND → CONTENT SCRIPT (running IN an open app tab, same-origin), which
 * does the credentialed fetch the page context is trusted for and relays the
 * result. The content script only accepts messages from our own extension
 * background (never the page) and only proxies whitelisted /api/ paths. */

/** Background → bridge: who is signed in on this app origin? */
export const BRIDGE_ME = "BRIDGE_ME" as const;
/** Background → bridge: perform a same-origin credentialed API request. */
export const BRIDGE_FETCH = "BRIDGE_FETCH" as const;

export interface BridgeMeMessage {
  type: typeof BRIDGE_ME;
}

/** `ok` = the bridge fetch itself completed (not a connection/parse failure);
 * `signedIn` is the /api/me verdict. */
export interface BridgeMeResult {
  ok: boolean;
  signedIn: boolean;
  name: string | null;
  email: string | null;
}

export function isBridgeMeMessage(message: unknown): message is BridgeMeMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as BridgeMeMessage).type === BRIDGE_ME
  );
}

export function requestBridgeMe(): BridgeMeMessage {
  return { type: BRIDGE_ME };
}

export interface BridgeFetchMessage {
  type: typeof BRIDGE_FETCH;
  /** Relative API path only — validated against isAllowedBridgePath. */
  path: string;
  method?: string;
  /** Pre-serialized JSON request body (bridge sends it with content-type json). */
  bodyJson?: string;
}

/** `status` is the upstream HTTP status (0 = the bridge fetch never completed).
 * `bodyJson` is the raw response text for the caller to parse. */
export interface BridgeFetchResult {
  ok: boolean;
  status: number;
  bodyJson?: string;
}

export function isBridgeFetchMessage(message: unknown): message is BridgeFetchMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    (message as BridgeFetchMessage).type === BRIDGE_FETCH &&
    typeof (message as BridgeFetchMessage).path === "string"
  );
}

export function requestBridgeFetch(
  path: string,
  method?: string,
  bodyJson?: string,
): BridgeFetchMessage {
  return { type: BRIDGE_FETCH, path, method, bodyJson };
}
