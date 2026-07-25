import type {
  Bookmark,
  CreateBookmarkInput,
  CreateSessionInput,
  Session,
} from "@bookmark-ai/types";
import { storage } from "#imports";
import { getStoredDeviceToken, renewDeviceTokenIfNeeded } from "./device-token";
import { diag } from "./diag";
import { tokenFresh, type CachedToken } from "./live-token";

/** The app origin (web UI + its `/api/*` routes — one deployment serves both).
 * Selected at BUILD time per target via WXT's env/mode: `.env.production` →
 * https://bookmark-ai.cloud, `.env.development` → http://localhost:3000,
 * `.env.preview` → the Vercel preview alias. The `WXT_APP_URL` fallback here is
 * only for a build with no env file loaded. A developer can still override the
 * default at RUNTIME from the popup settings row. */
const DEFAULT_APP_URL = import.meta.env.WXT_APP_URL || "https://bookmark-ai.cloud";

/** Build-target browser (Vite inlines `import.meta.env.BROWSER`). The cookie-
 * credentialed auth fallback (Path C) is Safari-ONLY: Chrome/Firefox always
 * resolve a bearer token, so gating on this leaves their request shape
 * byte-identical and the branch is dead-code-eliminated from their bundles. */
const SAFARI = import.meta.env.BROWSER === "safari";
/** API base and web base are the SAME origin in every build target, so both
 * derive from `DEFAULT_APP_URL`; the single "API server" setting drives the
 * website links too (see `getWebBaseUrl`). */
export const DEFAULT_API_URL = DEFAULT_APP_URL;
export const DEFAULT_WEB_URL = DEFAULT_APP_URL;
/** Live Sessions has its own dedicated server (Fastify, no `/api` prefix) —
 * separate from the Vercel-hosted `/api/*` routes. Build-time default via
 * `WXT_LIVE_API_URL` (dev points it at a local server; the `http://localhost/*`
 * host_permissions entry covers that). Also overridable in popup settings. */
export const DEFAULT_LIVE_API_URL =
  import.meta.env.WXT_LIVE_API_URL || "https://live.bookmark-ai.cloud";

/** API base URL, user-configurable from the popup settings row. */
export const apiUrlItem = storage.defineItem<string>("local:apiUrl", {
  fallback: DEFAULT_API_URL,
});

/** Live Sessions server base URL, user-configurable from the popup settings row. */
export const liveApiUrlItem = storage.defineItem<string>("local:liveApiUrl", {
  fallback: DEFAULT_LIVE_API_URL,
});

export async function getApiBaseUrl(): Promise<string> {
  const value = await apiUrlItem.getValue();
  return (value || DEFAULT_API_URL).trim().replace(/\/+$/, "");
}

/** Web app base URL — for the "Open website" button, the sign-in link, and the
 * post-session redirect. The web UI shares the API origin in every build target,
 * so it follows the single "API server" setting (and its build-time default)
 * rather than a separate, unsettable web URL that used to drift to production
 * while the API pointed at localhost. */
export async function getWebBaseUrl(): Promise<string> {
  return getApiBaseUrl();
}

function normalizeBase(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

/** Live server base URL now FOLLOWS the account: the user edits it on the web
 * app, GET /api/settings returns it. Short-lived module cache (a restarted MV3
 * worker just refetches). */
const LIVE_BASE_TTL_MS = 5 * 60_000;
let liveBaseCache: { value: string; at: number } | null = null;

async function resolveLiveBaseUrl(): Promise<string> {
  try {
    const base = await getApiBaseUrl();
    // authFetch carries a token only in the BACKGROUND (that's where all live
    // calls run); a popup-context call has no token so it goes out credentialed
    // on Safari (cookie session) or unauthenticated elsewhere — 401s there fall
    // through to the mirror below.
    const res = await authFetch(`${base}/api/settings`);
    if (res.ok) {
      const body = (await res.json()) as { settings?: { liveServerUrl?: string | null } };
      const url = body.settings?.liveServerUrl;
      if (url) {
        const clean = normalizeBase(url);
        // Mirror so the last-known value survives offline / signed-out.
        await liveApiUrlItem.setValue(clean);
        return clean;
      }
    }
  } catch {
    // network/parse failure — fall back exactly as before
  }
  return normalizeBase((await liveApiUrlItem.getValue()) || DEFAULT_LIVE_API_URL);
}

export async function getLiveBaseUrl(): Promise<string> {
  const now = Date.now();
  if (liveBaseCache && now - liveBaseCache.at < LIVE_BASE_TTL_MS) return liveBaseCache.value;
  const value = await resolveLiveBaseUrl();
  liveBaseCache = { value, at: now };
  return value;
}

/** The background script registers Clerk's token getter here — keeps this
 * module importable from the popup without pulling in background-only Clerk
 * code. Unset/null token → request goes out unauthenticated (the deployed
 * default 401s it; a local dev server accepts it only with DEV_OPEN_API=1). */
let authTokenProvider: (() => Promise<string | null>) | null = null;

export function setAuthTokenProvider(provider: () => Promise<string | null>): void {
  authTokenProvider = provider;
}

/** Background-registered strategy for authenticated requests that have NO bearer
 * token — the Safari cookie/bridge paths. Given the same (url, init) as fetch, it
 * returns a Response (via the content-script bridge when a bridge tab is live,
 * else a direct credentialed fetch). Unset in the popup and on Chrome/Firefox. */
let noTokenFetcher: ((url: string, init: RequestInit) => Promise<Response>) | null = null;

export function setNoTokenFetcher(
  fetcher: (url: string, init: RequestInit) => Promise<Response>,
): void {
  noTokenFetcher = fetcher;
}

/** Bearer header from the background's registered Clerk provider, or `{}` when
 * signed out. Exported so the live-tabs client (lib/live-api.ts) reuses the same
 * token path. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await authTokenProvider?.().catch(() => null);
  return token ? { authorization: `Bearer ${token}` } : {};
}

/**
 * Authenticated fetch — the single choke point for every background-originated
 * API call. Attaches the bearer token when one is mintable (unchanged path for
 * Chrome/Firefox and for Safari's SDK/native paths when they ever work). When NO
 * token is mintable, on Safari ONLY it retries the request credentialed:
 * `credentials:'include'` makes Safari attach the SITE's own Clerk session cookie
 * to a host-permission origin without the extension reading it, and
 * `requireUser()` accepts a cookie session (its azp = the web origin, which
 * passes the azp check). Chrome/Firefox with no token = signed out, so no
 * fallback — the request goes out exactly as before and 401s if auth is enforced.
 */
export async function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await authTokenProvider?.().catch(() => null);
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) {
    headers.authorization = `Bearer ${token}`;
    return fetch(url, { ...init, headers });
  }
  if (SAFARI) {
    // No token. The background's registered strategy (bridge tab, else direct
    // credentialed fetch) handles it; without one (popup context) fall back to a
    // direct credentialed fetch.
    if (noTokenFetcher) return noTokenFetcher(url, { ...init, headers });
    return fetch(url, { ...init, headers, credentials: "include" });
  }
  return fetch(url, { ...init, headers });
}

export interface MeResponse {
  signedIn: boolean;
  name: string | null;
  email: string | null;
}

/**
 * Safari cookie path (Path C) identity probe: ask GET /api/me who we are using
 * the site's own session cookie (`credentials:'include'`). 200 → identity; 401 →
 * genuinely signed out; network/parse failure → null (unknown — leave the other
 * paths in play). Only the background calls this, and only on Safari.
 */
export async function fetchMe(): Promise<MeResponse | null> {
  const base = await getApiBaseUrl();
  try {
    const res = await fetch(`${base}/api/me`, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    if (res.status === 401) return { signedIn: false, name: null, email: null };
    if (!res.ok) return null;
    const body = (await res.json()) as { name?: string | null; email?: string | null };
    return { signedIn: true, name: body.name ?? null, email: body.email ?? null };
  } catch {
    return null;
  }
}

/* ── Live-server token (Safari) ──────────────────────────────────────────────
 * The Live Sessions server is a DIFFERENT origin, so neither the cookie nor the
 * content-script bridge authenticates it, and the tokenless Safari paths mint no
 * Clerk JWT. We instead mint one through the MAIN origin's /api/live-token
 * (itself reached via the bridge on the bridge path — it's a whitelisted /api/
 * path) and attach it as Bearer. Cached in memory with its expiry; refreshed
 * when within the skew window or on a forced 401-retry. Never persisted. */
const LIVE_TOKEN_SKEW_MS = 10_000;
let liveTokenCache: CachedToken | null = null;

/** Storage mirror of the live-token cache: Safari restarts the background
 * worker every couple of minutes, and minting needs a live bridge tab — so a
 * memory-only cache would re-pay a bridge round-trip (and fail entirely with no
 * app tab open) on every heartbeat. The token is short-lived (server-set TTL)
 * and scoped to the live server; value is never logged. */
const liveTokenItem = storage.defineItem<CachedToken | null>("local:liveToken", {
  fallback: null,
});

async function mintLiveToken(): Promise<CachedToken | null> {
  const base = await getApiBaseUrl();
  try {
    const res = await authFetch(`${base}/api/live-token`, { headers: { accept: "application/json" } });
    if (!res.ok) {
      diag("live", "live-token fetch", { status: res.status });
      return null;
    }
    const body = (await res.json()) as { token?: string; expiresInSeconds?: number };
    diag("live", "live-token fetch", { status: res.status, expiresIn: body.expiresInSeconds ?? null });
    if (!body.token) return null;
    const ttlMs = Math.max(0, (body.expiresInSeconds ?? 60) * 1000);
    return { token: body.token, exp: Date.now() + ttlMs };
  } catch {
    return null;
  }
}

/** A live-server session JWT, reusing the in-memory cache unless it's within the
 * skew window (or `forceRefresh` after a 401). Null when none can be minted. */
export async function getLiveToken(forceRefresh = false): Promise<string | null> {
  // Safari: once a long-lived device token exists it's a plain Bearer the LIVE
  // server accepts DIRECTLY (contract) — no /api/live-token mint or its caches.
  // `forceRefresh` is a 401-retry: give the token its chance to self-renew, then
  // reuse whatever's stored (often unchanged). Only if there's no device token
  // (never minted / cleared) do we fall through to the legacy live-token mint.
  if (SAFARI) {
    if (forceRefresh) {
      await renewDeviceTokenIfNeeded();
      const renewed = await getStoredDeviceToken();
      if (renewed) return renewed;
    } else {
      const deviceToken = await getStoredDeviceToken();
      if (deviceToken) return deviceToken;
    }
  }
  if (!forceRefresh) {
    if (tokenFresh(liveTokenCache, Date.now(), LIVE_TOKEN_SKEW_MS)) {
      return liveTokenCache!.token;
    }
    // Fresh worker: fall back to the persisted cache before re-minting.
    const stored = await liveTokenItem.getValue().catch(() => null);
    if (tokenFresh(stored, Date.now(), LIVE_TOKEN_SKEW_MS)) {
      liveTokenCache = stored;
      return stored!.token;
    }
  }
  liveTokenCache = await mintLiveToken();
  await liveTokenItem.setValue(liveTokenCache).catch(() => {});
  return liveTokenCache?.token ?? null;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const base = await getApiBaseUrl();
  let res: Response;
  try {
    res = await authFetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error(`Could not reach ${base}. Is the Bookmark AI server running?`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Save failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  return (await res.json()) as T;
}

/** POST /api/bookmarks — the server scrapes OG data and AI-categorizes. */
export async function createBookmark(input: CreateBookmarkInput): Promise<Bookmark> {
  const data = await postJson<{ bookmark: Bookmark }>("/api/bookmarks", input);
  return data.bookmark;
}

/** POST /api/sessions — save a snapshot of the open tabs. */
export async function saveSession(input: CreateSessionInput): Promise<Session> {
  const data = await postJson<{ session: Session }>("/api/sessions", input);
  return data.session;
}
