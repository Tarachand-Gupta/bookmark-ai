import type {
  AiProvider,
  Bookmark,
  CreateBookmarkInput,
  CreateSessionInput,
  ExportBundle,
  HealthResponse,
  ListBookmarksResponse,
  ListLiveResponse,
  ListModelsResponse,
  ListSessionsResponse,
  MetaResponse,
  SearchMode,
  SearchResponse,
  Session,
  UpdateUserSettingsInput,
  UserSettingsResponse,
} from "@bookmark-ai/types";

/** Same-origin by default — the API lives in this Next.js app's /api routes.
 * Set NEXT_PUBLIC_API_URL only to point at a separately hosted API. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

/** The dedicated live server (SSE for "tabs from other devices"), separate
 * from the Next.js API above — no /api prefix, its own origin. Empty string
 * is a safe fallback (relative fetch that will 404) rather than throwing
 * when the env var isn't set yet. */
export const LIVE_API_URL = process.env.NEXT_PUBLIC_LIVE_API_URL ?? "";

export interface LibraryFilters {
  category?: string;
  browser?: string;
  device?: string;
  day?: string;
  tag?: string;
  /** Inclusive YYYY-MM-DD range bounds (date-range filter). */
  from?: string;
  to?: string;
}

interface ClerkGlobal {
  loaded?: boolean;
  session?: { getToken: () => Promise<string | null> } | null;
}

/** Clerk session JWT for the API. window.Clerk is the documented non-hook
 * escape hatch — this module is called outside React components. Null when
 * signed out or during SSR; the open local server accepts the tokenless
 * request, the auth-enforcing deployed server 401s it. */
async function getAuthToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  const w = window as Window & { Clerk?: ClerkGlobal };
  // Clerk loads async after hydration; the first data fetches can race it.
  for (let i = 0; i < 40 && !w.Clerk?.loaded; i++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  try {
    return (await w.Clerk?.session?.getToken()) ?? null;
  } catch {
    return null;
  }
}

/** Exported so the SSE hook (use-live.ts) can attach the same bearer token
 * to its fetch-event-source connection — that hook talks straight to
 * LIVE_API_URL and doesn't go through request() below. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

/**
 * The account's private DB isn't ready yet (503 `code: "provisioning"`). Not a
 * real failure — provisioning takes a second or two on a fresh signup — so
 * callers should retry rather than surface it. A subclass (not a string match on
 * the message) so the check survives any rewording of the server's prose.
 */
export class ProvisioningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProvisioningError";
  }
}

/**
 * The request authenticated fine, but this Clerk account isn't on the API's
 * allowlist (server 403). NOT a "you're signed out / bad token" failure — the
 * user IS signed in, just with an identity that has no access (e.g. Google's
 * account picker landed on the wrong one). A distinct type so the UI can tell
 * this apart and offer "switch account" instead of the misleading
 * "check that you're signed in" advice. Detected on `code: "forbidden"`
 * (preferred, stable) with a message fallback for older server builds.
 */
export class ForbiddenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** The exact 403 body the server emits for an allowlist rejection — the
 * message fallback for detecting a ForbiddenError when `code` is absent
 * (older server builds). Keep in sync with require-user.ts. */
const FORBIDDEN_MESSAGE = "This account may not use this API";

/** Map a failed response's parsed body to the right typed Error. Shared by the
 * `request()` helper and the direct-fetch live-server calls so every surface
 * classifies provisioning/forbidden the same way. */
function errorFromBody(
  status: number,
  body: { error?: string; code?: string } | null,
): Error {
  const message = body?.error ?? `Request failed (${status})`;
  if (body?.code === "provisioning") return new ProvisioningError(message);
  if (status === 403 && (body?.code === "forbidden" || body?.error === FORBIDDEN_MESSAGE)) {
    return new ForbiddenError(message);
  }
  return new Error(message);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(await authHeaders()), ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw errorFromBody(res.status, body as { error?: string; code?: string } | null);
  }
  return (await res.json()) as T;
}

export function getMeta(signal?: AbortSignal): Promise<MetaResponse> {
  return request<MetaResponse>("/api/meta", { signal });
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request<HealthResponse>("/api/health", { signal });
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

export function searchBookmarks(
  q: string,
  mode: SearchMode,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  // 40 (schema max 50): hybrid unions two retrieval pipelines, so give the
  // blend room — relevance decays down the list, which is fine.
  const params = new URLSearchParams({ q, mode, limit: "40" });
  return request<SearchResponse>(`/api/search?${params}`, { signal });
}

export function createBookmark(input: CreateBookmarkInput): Promise<{ bookmark: Bookmark }> {
  return request<{ bookmark: Bookmark }>("/api/bookmarks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function deleteBookmark(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/bookmarks/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok && res.status !== 404) throw new Error(`Delete failed (${res.status})`);
}

export function getSessions(signal?: AbortSignal): Promise<ListSessionsResponse> {
  return request<ListSessionsResponse>("/api/sessions", { signal });
}

export async function deleteSession(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/sessions/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok && res.status !== 404) throw new Error(`Delete failed (${res.status})`);
}

/** Save a snapshot of tabs as a session (the extension's POST /api/sessions).
 * Used by the Ongoing view's per-window Save — promotion needs no new endpoint. */
export function saveSession(input: CreateSessionInput): Promise<{ session: Session }> {
  return request<{ session: Session }>("/api/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ── Live Sessions (open tabs from other devices) ────────────────────────────
// Talks to the dedicated live server (LIVE_API_URL, no /api prefix) instead of
// this app's own /api routes — direct fetch calls (not request()) since that
// helper hardcodes API_URL. The Vercel /api/live/* routes still exist (kept
// for a later cutover step) but nothing here calls them anymore.

/** No live server configured. Surfaced verbatim by the Ongoing view's error
 * affordance and used to bail these fns before any network call — an empty
 * live base would otherwise fetch same-origin and 404. */
export const LIVE_NOT_CONFIGURED = "Live server is not configured";

/** Resolved once per page load, then reused. A user's saved
 * `settings.liveServerUrl` overrides the build-time `NEXT_PUBLIC_LIVE_API_URL`
 * default, so /api/settings must be consulted before the first live call. */
let liveBasePromise: Promise<string> | null = null;

/**
 * The live server base URL for this session: the user's saved `liveServerUrl`
 * override if set, else `LIVE_API_URL` (the env default). Fetches /api/settings
 * ONCE per page load (cached promise); a failed fetch falls back to the env
 * value so a settings hiccup never breaks a working env-configured live server.
 * Empty string when neither is set — callers treat that as "live off".
 */
export function getLiveBaseUrl(): Promise<string> {
  if (!liveBasePromise) {
    liveBasePromise = getSettings()
      .then((r) => r.settings.liveServerUrl || LIVE_API_URL)
      .catch(() => LIVE_API_URL);
  }
  return liveBasePromise;
}

/** Guard every live call: resolve the base (setting or env) and, with neither
 * configured, throw (rejected promise) instead of firing a doomed same-origin
 * request. */
async function requireLiveUrl(): Promise<string> {
  const base = await getLiveBaseUrl();
  if (!base) throw new Error(LIVE_NOT_CONFIGURED);
  return base;
}

/** The reader view: devices currently mirroring their open tabs, plus the
 * account opt-in flag and TTL. `enabled: false` tells "off" apart from "no
 * devices". Freshness is the server's `lastSeenAgeSeconds` — never subtracted
 * from a client clock. */
export async function getLive(signal?: AbortSignal): Promise<ListLiveResponse> {
  const res = await fetch(`${await requireLiveUrl()}/live`, {
    headers: await authHeaders(),
    signal,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    // Defensive: the live server doesn't emit these today, but keep the same
    // provisioning/forbidden-aware contract the old /api/live route had.
    throw errorFromBody(res.status, body as { error?: string; code?: string } | null);
  }
  return (await res.json()) as ListLiveResponse;
}

/** Flip the account-wide "Show my open tabs" flag. Turning it off purges every
 * device server-side in the same request. */
export async function setLiveEnabled(enabled: boolean): Promise<{ enabled: boolean }> {
  const res = await fetch(`${await requireLiveUrl()}/live/settings`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const message = (body as { error?: string } | null)?.error ?? `Request failed (${res.status})`;
    throw new Error(message);
  }
  return (await res.json()) as { enabled: boolean };
}

/** Forget one device — deletes its mirrored tabs. Idempotent (204 or 404). It
 * reappears on that browser's next check-in unless its own switch is off. */
export async function forgetLiveDevice(id: string): Promise<void> {
  const res = await fetch(`${await requireLiveUrl()}/live/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok && res.status !== 404) throw new Error(`Forget failed (${res.status})`);
}

/** Forget every device at once (the collection-level purge). Leaves the account
 * flag on — devices reappear on their next check-in. */
export async function forgetAllLiveDevices(): Promise<void> {
  const res = await fetch(`${await requireLiveUrl()}/live`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok && res.status !== 404) throw new Error(`Forget all failed (${res.status})`);
}

// ── Settings ────────────────────────────────────────────────────────────────

export function getSettings(signal?: AbortSignal): Promise<UserSettingsResponse> {
  return request<UserSettingsResponse>("/api/settings", { signal });
}

/** Persist settings. Include `apiKey` only when the user typed a new one
 * (absent = keep the stored key, "" = clear it). */
export function updateSettings(input: UpdateUserSettingsInput): Promise<UserSettingsResponse> {
  return request<UserSettingsResponse>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** Validate a provider key by listing its models (doubles as "test connection").
 * Sends the typed key, or omits it to reuse the stored one. */
export function fetchAiModels(input: {
  provider: AiProvider;
  apiKey?: string;
  baseUrl?: string;
}): Promise<ListModelsResponse> {
  return request<ListModelsResponse>("/api/settings/ai/models", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ── Data export / import ──────────────────────────────────────────────────────

/** Download the caller's full data as a versioned, lossless bundle. The route
 * also sets a Content-Disposition header, but the UI reads the JSON body and
 * builds its own Blob download so it can name the file with today's date. */
export function exportData(): Promise<ExportBundle> {
  return request<ExportBundle>("/api/export");
}

/** Import a previously-exported bundle. Bookmarks upsert by URL (idempotent) and
 * original timestamps are preserved. `bundle` is the parsed export object; the
 * server re-validates and upgrades it, throwing a 400 on anything unrecognized. */
export function importData(
  bundle: unknown,
): Promise<{ imported: { bookmarks: number; sessions: number } }> {
  return request<{ imported: { bookmarks: number; sessions: number } }>("/api/import", {
    method: "POST",
    body: JSON.stringify(bundle),
  });
}

// ── Account ───────────────────────────────────────────────────────────────────

/** Permanently delete the signed-in account (and, via the Clerk user.deleted
 * webhook, its tenant DB). Resolves on 202; throws a friendly message in local/
 * open mode (400, no Clerk user to delete) or on any other failure. Raw fetch
 * rather than `request` so we can branch on the 202/400 status codes. */
export async function deleteAccount(): Promise<void> {
  const res = await fetch(`${API_URL}/api/account`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (res.status === 202) return;
  if (res.status === 400) {
    throw new Error("Account deletion isn't available in local mode.");
  }
  const body = await res.json().catch(() => null);
  throw new Error((body as { error?: string })?.error ?? `Delete failed (${res.status})`);
}
