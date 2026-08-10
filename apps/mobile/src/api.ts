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
export const PROD_API_URL = "https://bookmark-ai.cloud";

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
    const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errBody?.error ?? `Request failed (${res.status})`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
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
export function getBookmarkByUrl(url: string, signal?: AbortSignal): Promise<ListBookmarksResponse> {
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

/**
 * Thrown for the 503 a tenant gets while its DB is still being provisioned. The
 * generic `request()` collapses every non-2xx into a plain Error, losing the
 * machine-readable `code`; the live reader must branch on that code (never the
 * prose `error`) to show "Setting up your account…" instead of a failure, so
 * `listLiveDevices` does its own fetch and raises this distinct type.
 */
export class ProvisioningError extends Error {
  constructor() {
    super("Account not provisioned yet");
    this.name = "ProvisioningError";
  }
}

/** GET /live on the dedicated live server — the tabs every armed device is
 * currently mirroring. Used for the instant first paint before the SSE
 * stream (see useLiveDevices) takes over, and as its reconnect fallback. */
export async function listLiveDevices(signal?: AbortSignal): Promise<ListLiveResponse> {
  const res = await fetch(`${await getLiveBaseUrl()}/live`, {
    signal,
    headers: { "content-type": "application/json", ...(await authHeaders()) },
  });
  if (res.status === 503) {
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    if (body?.code === "provisioning") throw new ProvisioningError();
  }
  if (!res.ok) {
    const errBody = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(errBody?.error ?? `Request failed (${res.status})`);
  }
  return (await res.json()) as ListLiveResponse;
}
