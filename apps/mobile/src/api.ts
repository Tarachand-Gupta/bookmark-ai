import { Platform } from "react-native";
import type {
  Bookmark,
  CreateBookmarkInput,
  CreateSessionInput,
  DashboardResponse,
  DeviceType,
  ListBookmarksResponse,
  ListLiveResponse,
  ListSessionsResponse,
  MetaResponse,
  SearchMode,
  SearchResponse,
  Session,
  UserSettingsResponse,
} from "@bookmark-ai/types";

/**
 * The device class this build reports — sent with every save (see
 * AddBookmarkSheet) AND to /api/dashboard, so "saved on another device" can
 * exclude this phone's own saves. iPadOS reports Platform.OS === "ios", so
 * Platform.isPad is what separates tablet from mobile.
 */
export const CURRENT_DEVICE: DeviceType =
  Platform.OS === "ios" && Platform.isPad ? "tablet" : "mobile";

/**
 * This build's save provenance — the mobile counterpart of the web/extension
 * `detectSource()`. `browser: "other"` because a save comes from the app, not a
 * browser (even a share from Safari arrives through our own extension). One
 * source of truth for the Add sheet AND the share-sheet save path.
 */
export function detectSource(): Pick<
  CreateBookmarkInput,
  "browser" | "device" | "deviceName" | "os"
> {
  return {
    browser: "other",
    device: CURRENT_DEVICE,
    deviceName: Platform.OS === "ios" ? (Platform.isPad ? "iPad" : "iPhone") : "Android",
    os: Platform.OS,
  };
}

/**
 * API client — same contract as apps/web/lib/api.ts. Two selectable servers:
 * the local Next dev server (iOS simulator reaches the host's localhost
 * directly; the Android emulator sees it as 10.0.2.2) and the deployed API —
 * Next.js route handlers on the web app's Vercel domain. Both require the Clerk
 * bearer token; the local dev server only accepts tokenless requests when
 * started with DEV_OPEN_API=1. EXPO_PUBLIC_API_URL overrides both.
 */
export const LOCAL_API_URL =
  Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000";
/**
 * `www` is the CANONICAL host and the ONLY correct base for a Bearer client:
 * the apex 308s every path (including `/api/*`) to www, and every HTTP stack —
 * URLSession on iOS, OkHttp on Android, curl, browsers — strips the
 * `Authorization` header when following a redirect to a different origin. The
 * retried request arrives bare, so the server correctly answers
 * `401 {"error":"Missing or invalid bearer token"}` while the app looks signed
 * in. Cookies survive the hop (Clerk's is a `.bookmark-ai.cloud` domain
 * cookie), which is why the web app never saw this and the app did.
 * The extension hit the identical trap once — see apps/extension/.env.production.
 */
export const PROD_API_URL = "https://www.bookmark-ai.cloud";

/**
 * The dedicated live server (Live Sessions reads only — no `/api` prefix).
 * Same local/production split as the main API, just a different port/host in
 * dev since it's a standalone process, not the Next dev server.
 */
export const LOCAL_LIVE_URL =
  Platform.OS === "android" ? "http://10.0.2.2:8091" : "http://localhost:8091";
export const PROD_LIVE_URL = "https://live.bookmark-ai.cloud";

export type ServerTarget = "local" | "production";

/**
 * The server target is chosen ONCE at BUILD/BUNDLE time — it is NOT toggleable
 * in-app. This keeps the API, the live server, and the Clerk instance (see
 * src/lib/clerk.ts) locked together to a single environment, so a session
 * minted by one instance is never sent to the other API (which would 401).
 *
 * Rule (evaluated at bundle time):
 *   1. `EXPO_PUBLIC_SERVER_TARGET=local|production` — explicit override, wins.
 *   2. else `__DEV__` — a dev run (Expo Go / dev client / `expo start`) → local,
 *      a release build (`eas build` / production bundle) → production.
 *
 * So: `expo start` / `expo run:*` in dev talks to the local Next dev server +
 * dev Clerk instance; a shipped release build talks to bookmark-ai.cloud + the
 * prod Clerk instance. To point a dev run at prod for testing, run with
 * `EXPO_PUBLIC_SERVER_TARGET=production`.
 */
function resolveServerTarget(): ServerTarget {
  const explicit = process.env.EXPO_PUBLIC_SERVER_TARGET;
  if (explicit === "local" || explicit === "production") return explicit;
  return __DEV__ ? "local" : "production";
}

export const SERVER_TARGET: ServerTarget = resolveServerTarget();

export function getApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  return SERVER_TARGET === "production" ? PROD_API_URL : LOCAL_API_URL;
}

export function getLiveUrl(): string {
  if (process.env.EXPO_PUBLIC_LIVE_API_URL) return process.env.EXPO_PUBLIC_LIVE_API_URL;
  return SERVER_TARGET === "production" ? PROD_LIVE_URL : LOCAL_LIVE_URL;
}

/**
 * The web/extension let a user pin a personal live-server URL in their account
 * settings (GET /api/settings → `{settings.liveServerUrl}`); mobile honors the
 * same override so all clients follow one source of truth. Resolution:
 *   1. `settings.liveServerUrl` when truthy, else
 *   2. `getLiveUrl()` — the target-based (or EXPO_PUBLIC_LIVE_API_URL) default.
 * Any failure (offline, 401, provisioning) falls back to `getLiveUrl()` exactly
 * as before, so live never breaks on a settings hiccup.
 *
 * Cached for ~5 min per app session — so a settings change after the TTL is
 * picked up without a restart.
 */
const LIVE_BASE_TTL_MS = 5 * 60 * 1000;
let liveBaseCache: { url: string; expires: number } | null = null;

export async function getLiveBaseUrl(): Promise<string> {
  const now = Date.now();
  if (liveBaseCache && liveBaseCache.expires > now) {
    return liveBaseCache.url;
  }
  const fallback = getLiveUrl();
  try {
    const { settings } = await request<UserSettingsResponse>("/api/settings");
    const url = settings.liveServerUrl || fallback;
    // Cache only successful resolutions, so a transient failure retries on the
    // next live connect instead of pinning the fallback for the whole TTL.
    liveBaseCache = { url, expires: now + LIVE_BASE_TTL_MS };
    return url;
  } catch {
    return fallback;
  }
}

/** Drop the cached live base so the next `getLiveBaseUrl()` re-reads settings —
 * for a future in-app "live server URL" editor (parity with the web's reset). */
export function resetLiveBaseCache(): void {
  liveBaseCache = null;
}

/** Clerk session token (registered from the ClerkProvider tree). Mobile
 * normally sends a token; null → unauthenticated request, which the local Next
 * dev server accepts only when run with DEV_OPEN_API=1, and the deployed server
 * always 401s. */
let authTokenProvider: (() => Promise<string | null>) | null = null;

export function setAuthTokenProvider(provider: () => Promise<string | null>): void {
  authTokenProvider = provider;
}

/** Exported so the SSE stream (react-native-sse can't reuse `request()`, it
 * needs raw headers up front) can attach the same Bearer token as everything
 * else. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await authTokenProvider?.().catch(() => null);
  return token ? { authorization: `Bearer ${token}` } : {};
}

interface RequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Thrown for the 503 a tenant gets while its DB is still being provisioned
 * (server contract: `{code: "provisioning"}` — see apps/web/lib/server/api-context.ts).
 * NOT a real failure: a brand-new signup waits ~10-15s for its own isolated
 * database, so callers retry instead of surfacing an error (useAccountStatus
 * polls, and the Shell is replaced by AccountSetupScreen while it does).
 *
 * A subclass rather than a string match on the message, so the check survives
 * any rewording of the server's prose. Mirrors ProvisioningError in
 * apps/web/lib/api.ts.
 */
export class ProvisioningError extends Error {
  constructor(message = "Account not provisioned yet") {
    super(message);
    this.name = "ProvisioningError";
  }
}

/**
 * The request authenticated fine, but this Clerk account isn't on the API's
 * allowlist (server 403 `{code: "forbidden"}` from
 * apps/web/lib/server/require-user.ts). NOT a "you're signed out / bad token"
 * failure — the user IS signed in, just with an identity that has no access
 * (Google's account picker landing on the wrong one is the common cause). A
 * distinct type so the UI can say "this account doesn't have access" and offer
 * a sign-out, instead of the misleading "check your connection" error.
 * Mirrors ForbiddenError in apps/web/lib/api.ts.
 */
export class ForbiddenError extends Error {
  constructor(message = "This account may not use this API") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** The exact 403 body the server emits for an allowlist rejection — the message
 * fallback for detecting a ForbiddenError when `code` is absent (older server
 * builds). Keep in sync with apps/web/lib/server/require-user.ts. */
const FORBIDDEN_MESSAGE = "This account may not use this API";

/**
 * Map a failed response's parsed body to the right typed Error. Shared by
 * `request()` and the direct-fetch live-server calls so every surface in the app
 * classifies provisioning/forbidden identically (same rules as the web client's
 * errorFromBody).
 */
function errorFromBody(status: number, body: { error?: string; code?: string } | null): Error {
  const message = body?.error ?? `Request failed (${status})`;
  if (body?.code === "provisioning") return new ProvisioningError(message);
  if (status === 403 && (body?.code === "forbidden" || body?.error === FORBIDDEN_MESSAGE)) {
    return new ForbiddenError(message);
  }
  return new Error(message);
}

async function request<T>(
  path: string,
  { method = "GET", body, signal }: RequestOptions = {},
): Promise<T> {
  const res = await fetch(`${getApiUrl()}${path}`, {
    method,
    signal,
    headers: { "content-type": "application/json", ...(await authHeaders()) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as
      | { error?: string; code?: string }
      | null;
    throw errorFromBody(res.status, errBody);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Permanently delete the signed-in account — the App Store's required
 * "delete your account in-app" primitive (Guideline 5.1.1(v)). Same contract as
 * the web app's `deleteAccount` (apps/web/lib/api.ts): `DELETE /api/account`
 * removes the Clerk user, whose `user.deleted` webhook then tears down the
 * tenant DB. Raw fetch rather than `request()` so the 202/400 status codes can
 * be told apart — 400 is the local/open-mode case (no Clerk user to delete).
 */
export async function deleteAccount(): Promise<void> {
  const res = await fetch(`${getApiUrl()}/api/account`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (res.status === 202) return;
  if (res.status === 400) {
    throw new Error("Account deletion isn't available in local mode.");
  }
  const body = (await res.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error ?? `Delete failed (${res.status})`);
}

export interface LibraryFilters {
  category?: string;
  tag?: string;
  day?: string;
}

export function listBookmarks(
  filters: LibraryFilters,
  page: { limit: number; offset: number },
  signal?: AbortSignal,
): Promise<ListBookmarksResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  params.set("limit", String(page.limit));
  params.set("offset", String(page.offset));
  return request<ListBookmarksResponse>(`/api/bookmarks?${params}`, { signal });
}

export function getMeta(signal?: AbortSignal): Promise<MetaResponse> {
  return request<MetaResponse>("/api/meta", { signal });
}

export function searchBookmarks(
  q: string,
  mode: SearchMode,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  // 40 (schema max 50): hybrid unions two retrieval pipelines — give the
  // blend room; relevance decays down the list.
  const params = new URLSearchParams({ q, mode, limit: "40" });
  return request<SearchResponse>(`/api/search?${params}`, { signal });
}

/**
 * Exact-URL lookup (`GET /api/bookmarks?url=`). Used right after a share-sheet
 * save to pick up the title the server scrapes a moment later, so the
 * confirmation banner can show the real page title instead of the raw link.
 */
export function getBookmarkByUrl(
  url: string,
  signal?: AbortSignal,
): Promise<ListBookmarksResponse> {
  const params = new URLSearchParams({ url, limit: "1" });
  return request<ListBookmarksResponse>(`/api/bookmarks?${params}`, { signal });
}

/** Save a URL — the server scrapes OG data, categorizes, and embeds it. */
export function createBookmark(input: CreateBookmarkInput): Promise<{ bookmark: Bookmark }> {
  return request<{ bookmark: Bookmark }>("/api/bookmarks", { method: "POST", body: input });
}

/**
 * One aggregated round-trip for the whole Home tab (docs/features/dashboard.md §5).
 * `?device=` is this build's own device class, and only feeds the response's
 * `otherDeviceBookmarks` — the "resume what you were reading on the laptop" row.
 */
export function getDashboard(signal?: AbortSignal): Promise<DashboardResponse> {
  const params = new URLSearchParams({ device: CURRENT_DEVICE });
  return request<DashboardResponse>(`/api/dashboard?${params}`, { signal });
}

export function listSessions(signal?: AbortSignal): Promise<ListSessionsResponse> {
  return request<ListSessionsResponse>("/api/sessions", { signal });
}

export function deleteSession(id: string): Promise<void> {
  return request<void>(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Save a snapshot of open tabs (one live window → a saved session). */
export function createSession(input: CreateSessionInput): Promise<{ session: Session }> {
  return request<{ session: Session }>("/api/sessions", { method: "POST", body: input });
}

/** GET /live on the dedicated live server — the tabs every armed device is
 * currently mirroring. Used for the instant first paint before the SSE
 * stream (see useLiveDevices) takes over, and as its reconnect fallback.
 * Its own fetch (not `request()`) because the live server is a different origin,
 * but it classifies failures through the same `errorFromBody` so a provisioning
 * 503 / forbidden 403 from the live server reads exactly like one from /api. */
export async function listLiveDevices(signal?: AbortSignal): Promise<ListLiveResponse> {
  const res = await fetch(`${await getLiveBaseUrl()}/live`, {
    signal,
    headers: { "content-type": "application/json", ...(await authHeaders()) },
  });
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as
      | { error?: string; code?: string }
      | null;
    throw errorFromBody(res.status, errBody);
  }
  return (await res.json()) as ListLiveResponse;
}
