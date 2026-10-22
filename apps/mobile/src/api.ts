import { Platform } from "react-native";
import { BUILD_VARIANT } from "./lib/auth-config";
import { nativeEndpoint } from "./lib/native-endpoints";
import { parseReleasesResponse, type AppReleasesResponse } from "./lib/appUpdate";
import type {
  AccountResponse,
  OrganizationResponse, OrganizationOperation, OrganizationOperationInput, OrganizationSelection,
  BookmarkChanges, BulkBookmarkChanges, ChatContext,
  Bookmark,
  ChatConversationDetailResponse,
  ChatConversationsResponse,
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
  ToolPageMeta,
  UpdateUserSettingsInput,
  UserSettingsResponse,
} from "@bookmark-ai/types";

/** Only main API calls carry analytics attribution, never the live origin. */
export async function apiHeaders(): Promise<Record<string, string>> {
  return { ...(await authHeaders()), "X-Bookmark-Client": Platform.OS === "ios" ? "ios" : Platform.OS === "android" ? "android" : "unknown" };
}

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

/** API endpoints are fixed at bundle time. QA requires explicit isolated
 * API/live overrides and authenticated Supabase requests. */
export const LOCAL_API_URL =
  Platform.OS === "android" ? "http://10.0.2.2:3000" : "http://localhost:3000";
/** Legacy canonical production origin, retained for future non-QA builds. */
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

/** Fixed at build time; the QA wrapper supplies explicit API/live origins. */
function resolveServerTarget(): ServerTarget {
  const explicit = process.env.EXPO_PUBLIC_SERVER_TARGET;
  if (explicit === "local" || explicit === "production") return explicit;
  return __DEV__ ? "local" : "production";
}

export const SERVER_TARGET: ServerTarget = resolveServerTarget();

export function getApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return nativeEndpoint(process.env.EXPO_PUBLIC_API_URL, Platform.OS);
  return SERVER_TARGET === "production" ? PROD_API_URL : LOCAL_API_URL;
}

export function getLiveUrl(): string {
  if (process.env.EXPO_PUBLIC_LIVE_API_URL) return nativeEndpoint(process.env.EXPO_PUBLIC_LIVE_API_URL, Platform.OS);
  return SERVER_TARGET === "production" ? PROD_LIVE_URL : LOCAL_LIVE_URL;
}

/**
 * The web/extension let a user pin a personal live-server URL in their account
 * settings (GET /api/settings → `{settings.liveServerUrl}`). Supabase builds
 * always pin their validated live origin. Legacy authentication builds may
 * honor the personal-server override. Their resolution:
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
  // Supabase builds bind bearer credentials to their validated live origin.
  // A persisted personal-server setting must never reroute that credential.
  if (BUILD_VARIANT === "supabase-qa" || BUILD_VARIANT === "supabase-production") return getLiveUrl();
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

/** SDK-owned Supabase access token. Provider failures propagate for retry. */
let authTokenProvider: (() => Promise<string | null>) | null = null;
let unauthorizedHandler: (() => void) | null = null;
let mfaRequiredHandler: (() => void) | null = null;
let accountGeneration = 0;
export function setUnauthorizedHandler(handler: (() => void) | null): void { unauthorizedHandler = handler; }
export function reportUnauthorized(): void { unauthorizedHandler?.(); }
export function setMfaRequiredHandler(handler: (() => void) | null): void { mfaRequiredHandler = handler; }
export function resetAccountApiState(): void { accountGeneration++; resetLiveBaseCache(); }

export function setAuthTokenProvider(provider: () => Promise<string | null>): void {
  authTokenProvider = provider;
}

/** Exported so the SSE stream (react-native-sse can't reuse `request()`, it
 * needs raw headers up front) can attach the same Bearer token as everything
 * else. */
export async function authHeaders(): Promise<Record<string, string>> {
  // Temporary SDK failures must never become anonymous API requests.
  const generation = accountGeneration;
  const token = await authTokenProvider?.();
  if (generation !== accountGeneration) throw new Error("The account changed; please retry this action");
  return token ? { authorization: `Bearer ${token}` } : {};
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
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
 * The request authenticated fine, but this account isn't on the API's
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
  if (status === 403 && body?.code === "mfa-required") mfaRequiredHandler?.();
  if (body?.code === "provisioning") return new ProvisioningError(message);
  if (status === 403 && (body?.code === "forbidden" || body?.error === FORBIDDEN_MESSAGE)) {
    return new ForbiddenError(message);
  }
  return new ApiRequestError(message, status);
}

export class ApiRequestError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = "ApiRequestError"; }
}

export async function request<T>(
  path: string,
  { method = "GET", body, signal }: RequestOptions = {},
): Promise<T> {
  const generation = accountGeneration;
  const headers = await apiHeaders();
  if (generation !== accountGeneration) throw new Error("The account changed; please retry this action");
  const res = await fetch(`${getApiUrl()}${path}`, {
    method,
    signal,
    headers: { "content-type": "application/json", ...headers, "cache-control": "no-store" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  if (generation !== accountGeneration) throw new Error("The account changed; please retry this action");
  if (!res.ok) {
    if (res.status === 401) unauthorizedHandler?.();
    const errBody = (await res.json().catch(() => null)) as {
      error?: string;
      code?: string;
    } | null;
    if (generation !== accountGeneration) throw new Error("The account changed; please retry this action");
    throw errorFromBody(res.status, errBody);
  }
  if (res.status === 204) return undefined as T;
  const result = (await res.json()) as T;
  if (generation !== accountGeneration) throw new Error("The account changed; please retry this action");
  return result;
}

export interface AuthSession {
  id: string; displayName: string; clientType: string | null; browser: string | null;
  os: string | null; createdAt: string; lastActiveAt: string | null; isCurrent: boolean;
}
export function listAuthSessions(): Promise<{ sessions: AuthSession[] }> { return request("/api/auth/sessions"); }
export function registerAuthSession(input: { clientType: "ios" | "android"; deviceName: string; os: string; appVersion?: string }): Promise<{ session: AuthSession }> {
  return request("/api/auth/sessions/current", { method: "POST", body: input });
}
export function renameAuthSession(id: string, displayName: string): Promise<{ session: AuthSession }> {
  return request(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: "PATCH", body: { displayName } });
}
export function revokeAuthSession(id: string): Promise<void> { return request(`/api/auth/sessions/${encodeURIComponent(id)}`, { method: "DELETE" }); }
export function signOutAuthSessions(scope: "local" | "global" | "others"): Promise<void> { return request("/api/auth/sessions/sign-out", { method: "POST", body: { scope } }); }

/**
 * Permanently delete the signed-in account — the App Store's required
 * "delete your account in-app" primitive (Guideline 5.1.1(v)). Same contract as
 * the web app's `deleteAccount` (apps/web/lib/api.ts): `DELETE /api/account`
 * accepts the durable provider/tenant deletion job. A202 is acceptance; server
 * processing may continue. Recent authentication is required server-side.
 */
export async function deleteAccount(): Promise<void> {
  const generation = accountGeneration;
  const headers = await apiHeaders();
  if (generation !== accountGeneration) throw new Error("The account changed; please retry this action");
  const res = await fetch(`${getApiUrl()}/api/account`, {
    method: "DELETE",
    headers,
  });
  if (generation !== accountGeneration) throw new Error("The account changed; please retry this action");
  if (res.status === 202) return;
  if (res.status === 401) reportUnauthorized();
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
  categoryId?: string;
  tagId?: string;
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

/**
 * `GET /api/app/releases` — the latest published build per platform (CONTRACT
 * §12). PUBLIC like /api/health, so a bare fetch rather than `request()`: no
 * Bearer (the banner must work before a session exists), and none of the
 * provisioning/forbidden mapping applies. The body is shape-checked, never
 * trusted — a rate-limit `{error}` or a proxy page is a thrown error, which the
 * caller (useAppUpdate) treats as "no banner".
 */
export async function getAppReleases(signal?: AbortSignal): Promise<AppReleasesResponse> {
  const res = await fetch(`${getApiUrl()}/api/app/releases`, {
    signal,
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  const parsed = parseReleasesResponse(await res.json());
  if (parsed === null) throw new Error("Unexpected /api/app/releases response");
  return parsed;
}

/**
 * One PAGE of a search — the chat's bookmarks card re-runs the tool's query
 * against `/api/search?offset=` for "Load next 50" without a model turn. The
 * `offset` param opts into paging, so the response carries `hasMore`.
 */
export function searchBookmarksPage(
  q: string,
  mode: SearchMode,
  page: { limit: number; offset: number },
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const params = new URLSearchParams({
    q,
    mode,
    limit: String(page.limit),
    offset: String(page.offset),
  });
  return request<SearchResponse>(`/api/search?${params}`, { signal });
}

/** `POST /api/query` — one page of the chat's read-only SELECT (the SQL card's
 * "Load next 50"). Same engine path and guards as the `queryDatabase` tool;
 * `page.total` is always null here because the route never recounts — the
 * card keeps the total its first page established. */
export interface ChatQueryPageResponse {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  page: ToolPageMeta;
}

export function runChatQueryPage(
  sql: string,
  page: { limit: number; offset: number },
  signal?: AbortSignal,
): Promise<ChatQueryPageResponse> {
  return request<ChatQueryPageResponse>("/api/query", {
    method: "POST",
    body: { sql, limit: page.limit, offset: page.offset },
    signal,
  });
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
export function createBookmark(input: CreateBookmarkInput): Promise<{ bookmark: Bookmark; existing?: boolean; operation?: OrganizationOperation }> {
  return request<{ bookmark: Bookmark; existing?: boolean; operation?: OrganizationOperation }>("/api/bookmarks", { method: "POST", body: input });
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
 * The chat agent's streaming endpoint (POST). NOT called through `request()`:
 * the AI SDK transport owns that fetch so it can read the response body as a
 * stream (see src/hooks/useAiChat.ts). Exported so the URL is derived from
 * `getApiUrl()` in exactly one place, like every other route here.
 */
export function getChatApiUrl(): string {
  return `${getApiUrl()}/api/chat`;
}

/** Conversation summaries, newest updated first (the Ask AI history list). */
export function listChatConversations(signal?: AbortSignal): Promise<ChatConversationsResponse> {
  return request<ChatConversationsResponse>("/api/chat/conversations", { signal });
}

/** One stored conversation with its UIMessage-shaped transcript. */
export function getChatConversation(
  id: string,
  signal?: AbortSignal,
): Promise<ChatConversationDetailResponse> {
  return request<ChatConversationDetailResponse>(
    `/api/chat/conversations/${encodeURIComponent(id)}`,
    { signal },
  );
}

/** Delete a conversation and its messages (204). */
export function deleteChatConversation(id: string): Promise<void> {
  return request<void>(`/api/chat/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** GET /api/account → the caller's plan (`"free"` for everyone today; literal
 * `"free"` in single-tenant/open mode). Feature copy for a plan is
 * `PLAN_FEATURES[plan]` in @bookmark-ai/types — render from that, not from here. */
export function getAccount(signal?: AbortSignal): Promise<AccountResponse> {
  return request<AccountResponse>("/api/account", { signal });
}

/** GET /api/settings — AI mode, saved-key summary (never the key), weekly meter. */
export function getSettings(signal?: AbortSignal): Promise<UserSettingsResponse> {
  return request<UserSettingsResponse>("/api/settings", { signal });
}

/**
 * PUT /api/settings — absent = keep for every field. Mobile only ever sends
 * `{ aiMode }`: switching between the included free AI and a saved key NEVER
 * touches the key itself (only an explicit `apiKey: ""`, a web-app action, does).
 */
export function updateSettings(patch: UpdateUserSettingsInput): Promise<UserSettingsResponse> {
  return request<UserSettingsResponse>("/api/settings", { method: "PUT", body: patch });
}

/** GET /live on the dedicated live server — the tabs every armed device is
 * currently mirroring. Used for the instant first paint before the SSE
 * stream (see useLiveDevices) takes over, and as its reconnect fallback.
 * Its own fetch (not `request()`) because the live server is a different origin,
 * but it classifies failures through the same `errorFromBody` so a provisioning
 * 503 / forbidden 403 from the live server reads exactly like one from /api. */
export async function listLiveDevices(signal?: AbortSignal): Promise<ListLiveResponse> {
  const generation = accountGeneration;
  const base = await getLiveBaseUrl(), headers = await authHeaders();
  if (generation !== accountGeneration) throw new Error("The account changed; please retry this action");
  const res = await fetch(`${base}/live`, {
    signal,
    headers: { "content-type": "application/json", ...headers },
  });
  if (generation !== accountGeneration) throw new Error("The account changed; please retry this action");
  if (!res.ok) {
    if (res.status === 401) reportUnauthorized();
    const errBody = (await res.json().catch(() => null)) as {
      error?: string;
      code?: string;
    } | null;
    if (generation !== accountGeneration) throw new Error("The account changed; please retry this action");
    throw errorFromBody(res.status, errBody);
  }
  const result = (await res.json()) as ListLiveResponse;
  if (generation !== accountGeneration) throw new Error("The account changed; please retry this action");
  return result;
}

/** Additive Release 1 endpoints. No controls are enabled until capabilities load. */
export function getOrganization(): Promise<OrganizationResponse> { return request("/api/organization"); }
export function getAccountIdentity(): Promise<{ accountId: string | null }> { return request("/api/me"); }
export function getOrganizationHistory(): Promise<{ operations: OrganizationOperation[] }> { return request("/api/organization/operations?limit=50"); }
export function getOrganizationOperation(id: string): Promise<{ operation: OrganizationOperation }> { return request(`/api/organization/operations/${encodeURIComponent(id)}`); }
export type SelectionInput = {bookmarkIds: string[]} | {query: LibraryFilters} | {search: {q: string; mode: "keyword" | "semantic" | "hybrid"} & LibraryFilters};
export function freezeOrganizationSelection(input: SelectionInput): Promise<{selection: OrganizationSelection}> { return request("/api/organization/selections", {method:"POST",body:input}); }
export function resolveComposerContext(context: ChatContext): Promise<{resolved:{context:ChatContext;bookmarkIds:string[];sources:unknown[];unavailable:string[]}}> { return request("/api/composer/context", {method:"POST",body:{context}}); }
