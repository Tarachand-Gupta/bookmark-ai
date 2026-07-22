import type {
  Bookmark,
  CreateBookmarkInput,
  CreateSessionInput,
  Session,
} from "@bookmark-ai/types";
import { storage } from "#imports";

/** The app origin (web UI + its `/api/*` routes — one deployment serves both).
 * Selected at BUILD time per target via WXT's env/mode: `.env.production` →
 * https://bookmark-ai.cloud, `.env.development` → http://localhost:3000,
 * `.env.preview` → the Vercel preview alias. The `WXT_APP_URL` fallback here is
 * only for a build with no env file loaded. A developer can still override the
 * default at RUNTIME from the popup settings row. */
const DEFAULT_APP_URL = import.meta.env.WXT_APP_URL || "https://bookmark-ai.cloud";
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
    // authHeaders only carries a token in the BACKGROUND (that's where all live
    // calls run); a popup-context call goes out unauthenticated, 401s, and falls
    // through to the mirror below.
    const res = await fetch(`${base}/api/settings`, { headers: { ...(await authHeaders()) } });
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

/** Bearer header from the background's registered Clerk provider, or `{}` when
 * signed out. Exported so the live-tabs client (lib/live-api.ts) reuses the same
 * token path. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await authTokenProvider?.().catch(() => null);
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const base = await getApiBaseUrl();
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
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
