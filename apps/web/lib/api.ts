import type {
  AccountResponse,
  AiProvider,
  Bookmark,
  CreateBookmarkInput,
  CreateMcpTokenResponse,
  CreateSessionInput,
  CreateSkillInput,
  DashboardResponse,
  ExportBundle,
  HealthResponse,
  ListBookmarksResponse,
  ListLiveResponse,
  ListMcpTokensResponse,
  ListModelsResponse,
  ListSessionsResponse,
  ListSkillsResponse,
  MetaResponse,
  ObservabilityResponse,
  SearchMode,
  SearchResponse,
  Session,
  SkillResponse,
  SummarizeSessionResponse,
  UpdateObservabilityInput,
  UpdateSkillInput,
  UpdateUserSettingsInput,
  UserSettingsResponse,
  ToolPageMeta,
} from "@bookmark-ai/types";
import { DEFAULT_PLAN, toPlanId } from "@/lib/plan";

/** POST /api/query response — one page of a read-only SELECT for the chat card. */
export interface ChatQueryPageResponse {
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  page: ToolPageMeta;
}

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
  /** Inclusive saved-at range bounds (the Date filter). Either a YYYY-MM-DD —
   * meaning that WHOLE day — or a full ISO datetime, which the sub-day quick
   * ranges ("last hour") need. Forwarded verbatim as query params; the server
   * widens both shapes into a half-open saved_at interval. */
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

import type { AppPlatform, AppRelease, AppReleasesResponse, UpsertAppReleaseInput } from "@/lib/releases";

/** GET /api/me — who the session belongs to. Open modes (keyless / dev bypass)
 * return `signedIn: true` with null name/email; a signed-out caller gets a 401
 * (surfaced by `request` as an error). */
export interface MeResponse {
  signedIn: boolean;
  name: string | null;
  email: string | null;
}

export function getMe(signal?: AbortSignal): Promise<MeResponse> {
  return request<MeResponse>("/api/me", { signal });
}

export function getMeta(signal?: AbortSignal): Promise<MetaResponse> {
  return request<MetaResponse>("/api/meta", { signal });
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request<HealthResponse>("/api/health", { signal });
}

/** The dashboard's one aggregated read. `device` is this client's own device
 * class — it only decides `otherDeviceBookmarks` (saves from somewhere else). */
export function getDashboard(
  device?: string | null,
  signal?: AbortSignal,
): Promise<DashboardResponse> {
  const params = new URLSearchParams();
  if (device) params.set("device", device);
  return request<DashboardResponse>(
    params.size ? `/api/dashboard?${params}` : "/api/dashboard",
    { signal },
  );
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

/**
 * One PAGE of search results — the chat's bookmark card "Load more". Same route
 * and engine path the `searchBookmarks` tool used, so page N+1 is consistent
 * with the page the model saw (`offset` opts the response into `hasMore`).
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

/** One PAGE of a read-only SELECT — the chat's SQL card "Load more". */
export function runChatQueryPage(
  sql: string,
  page: { limit: number; offset: number },
  signal?: AbortSignal,
): Promise<ChatQueryPageResponse> {
  return request<ChatQueryPageResponse>("/api/query", {
    method: "POST",
    body: JSON.stringify({ sql, limit: page.limit, offset: page.offset }),
    signal,
  });
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

/** Rename a saved session → the updated session. */
export function renameSession(id: string, name: string): Promise<{ session: Session }> {
  return request<{ session: Session }>(`/api/sessions/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

/**
 * Summarize a session from its tabs (Gemini, or a heuristic name when AI is
 * unavailable) and apply it: title AND description, in one call. The endpoint
 * keeps its historical `/ai-name` path from when it only renamed.
 */
export function summarizeSession(id: string): Promise<SummarizeSessionResponse> {
  return request<SummarizeSessionResponse>(`/api/sessions/${id}/ai-name`, {
    method: "POST",
  });
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

/** Drop the cached live base so the next `getLiveBaseUrl()` re-reads settings.
 * Call after saving a new `liveServerUrl` — otherwise the module-cached promise
 * keeps the next live connect pointed at the old URL for the rest of the page. */
export function resetLiveBaseCache(): void {
  liveBasePromise = null;
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

/** Rename one window of a live device (server-side override, survives pushes).
 * An empty `name` clears the override back to the default "Window N". Best-effort:
 * mirrors the other live mutators — swallows failures (the SSE stream re-delivers
 * the authoritative state) rather than throwing. */
export async function renameLiveWindow(
  deviceId: string,
  windowId: number | string,
  name: string,
): Promise<void> {
  try {
    await fetch(`${await requireLiveUrl()}/live/${deviceId}/windows/${windowId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify({ name }),
    });
  } catch {
    // Best-effort: the optimistic local update already showed the new name and the
    // next SSE frame reconciles; a rename failure shouldn't surface as an error.
  }
}

/** Set a device's "new windows join live sessions by default" policy (PATCH
 * /live/:deviceId/settings). Follows renameLiveWindow's shape; throws on failure
 * so the optimistic Settings toggle can revert. */
export async function updateLiveDeviceSettings(
  deviceId: string,
  input: { newWindowsShared: boolean },
): Promise<void> {
  const res = await fetch(`${await requireLiveUrl()}/live/${deviceId}/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json", ...(await authHeaders()) },
    body: JSON.stringify(input),
  });
  if (!res.ok) throw new Error(`Update failed (${res.status})`);
}

// ── Settings ────────────────────────────────────────────────────────────────

export function getSettings(signal?: AbortSignal): Promise<UserSettingsResponse> {
  return request<UserSettingsResponse>("/api/settings", { signal });
}

/** Persist settings. Include `apiKey` only when the user typed a new one
 * (absent = keep the stored key, "" = clear it — the ONLY thing that removes
 * a key). Sending `{ aiMode }` alone (CONTRACT §1) switches between the
 * included free AI and the user's own key WITHOUT touching the stored key,
 * provider or model. */
export function updateSettings(input: UpdateUserSettingsInput): Promise<UserSettingsResponse> {
  return request<UserSettingsResponse>("/api/settings", {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

// ── Admin: observability (Langfuse tracing) ─────────────────────────────────

// ── App releases (CONTRACT §12) ───────────────────────────────────────────────

/** PUBLIC: latest release per platform (empty object without a master DB). */
export function getAppReleases(signal?: AbortSignal): Promise<AppReleasesResponse> {
  return request<AppReleasesResponse>("/api/app/releases", { signal });
}

/** Admin-only. Creates or replaces the platform's record. */
export function upsertAppRelease(
  platform: AppPlatform,
  input: UpsertAppReleaseInput,
): Promise<{ release: AppRelease }> {
  return request<{ release: AppRelease }>(`/api/admin/releases/${platform}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

/** Admin-only. Removes the platform's record (204; a missing record is fine). */
export async function deleteAppRelease(platform: AppPlatform): Promise<void> {
  const res = await fetch(`${API_URL}/api/admin/releases/${platform}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.json().catch(() => null);
    throw errorFromBody(res.status, body as { error?: string; code?: string } | null);
  }
}

/** Admin-only. Throws ForbiddenError for non-admin accounts (the Settings
 * dialog uses that to hide the Observability section entirely). */
export function getObservability(signal?: AbortSignal): Promise<ObservabilityResponse> {
  return request<ObservabilityResponse>("/api/admin/observability", { signal });
}

/** Persist a subset of the per-surface tracing flags. Admin-only. */
export function updateObservability(
  patch: UpdateObservabilityInput,
): Promise<ObservabilityResponse> {
  return request<ObservabilityResponse>("/api/admin/observability", {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

// ── MCP tokens ──────────────────────────────────────────────────────────────

export function listMcpTokens(signal?: AbortSignal): Promise<ListMcpTokensResponse> {
  return request<ListMcpTokensResponse>("/api/mcp/tokens", { signal });
}

/** Mint a token. The returned `token` value is shown to the user ONCE and is not
 * recoverable — never persist or log it. */
export function createMcpToken(name: string): Promise<CreateMcpTokenResponse> {
  return request<CreateMcpTokenResponse>("/api/mcp/tokens", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/** Revoke a token. 404 is tolerated: it's already gone either way. */
export async function revokeMcpToken(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/mcp/tokens/${id}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok && res.status !== 404) throw new Error(`Revoke failed (${res.status})`);
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

/**
 * GET /api/account → the caller's plan (CONTRACT §2). Everyone is on Free
 * today, so a server that predates the field — or a failed read — reports
 * Free rather than nothing: the badge is a statement of what the account has,
 * and Free is always true. Aborts still propagate.
 */
export async function getAccount(signal?: AbortSignal): Promise<AccountResponse> {
  try {
    const body = await request<Partial<AccountResponse>>("/api/account", { signal });
    return { plan: toPlanId(body?.plan) };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return { plan: DEFAULT_PLAN };
  }
}

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

// ── Chat conversation history ─────────────────────────────────────────────────
// The contract is the Zod schema in @bookmark-ai/types (packages/types/src/chat.ts).

export type ChatConversationSummary = import("@bookmark-ai/types").ChatConversation;
export type StoredChatMessage = import("@bookmark-ai/types").StoredChatMessage;
export type ChatConversationDetail = import("@bookmark-ai/types").ChatConversationDetailResponse;

/** Newest-first list of the caller's saved chat conversations. */
export function listChatConversations(
  signal?: AbortSignal,
): Promise<{ conversations: ChatConversationSummary[] }> {
  return request<{ conversations: ChatConversationSummary[] }>("/api/chat/conversations", {
    signal,
  });
}

/** One conversation with its full (UIMessage-compatible) message history. */
export function getChatConversation(
  id: string,
  signal?: AbortSignal,
): Promise<ChatConversationDetail> {
  return request<ChatConversationDetail>(
    `/api/chat/conversations/${encodeURIComponent(id)}`,
    { signal },
  );
}

/** Delete a conversation. Idempotent (204 or 404 both resolve). */
export async function deleteChatConversation(id: string): Promise<void> {
  const res = await fetch(
    `${API_URL}/api/chat/conversations/${encodeURIComponent(id)}`,
    { method: "DELETE", headers: await authHeaders() },
  );
  if (!res.ok && res.status !== 404) throw new Error(`Delete failed (${res.status})`);
}

// ── Skills (CONTRACT §3) ──────────────────────────────────────────────────────
// The contract is the Zod schema in @bookmark-ai/types (packages/types/src/skills.ts).

/** Every skill, newest-updated first. */
export function listSkills(signal?: AbortSignal): Promise<ListSkillsResponse> {
  return request<ListSkillsResponse>("/api/skills", { signal });
}

/** Create a skill → 201 `{skill}`. A 409 ("A skill with this name already
 * exists" — names are unique, case-insensitively) surfaces as the thrown
 * Error's message so the editor can show it inline. */
export function createSkill(input: CreateSkillInput): Promise<SkillResponse> {
  return request<SkillResponse>("/api/skills", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Partial update (rename, edit, toggle `enabled`) → `{skill}`. */
export function updateSkill(id: string, patch: UpdateSkillInput): Promise<SkillResponse> {
  return request<SkillResponse>(`/api/skills/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}

/** Delete a skill. Idempotent (204 or 404 both resolve). */
export async function deleteSkill(id: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/skills/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: await authHeaders(),
  });
  if (!res.ok && res.status !== 404) throw new Error(`Delete failed (${res.status})`);
}
