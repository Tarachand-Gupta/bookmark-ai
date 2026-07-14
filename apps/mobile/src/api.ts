import { Platform } from "react-native";
import type {
  Bookmark,
  CreateBookmarkInput,
  ListBookmarksResponse,
  ListSessionsResponse,
  MetaResponse,
  SearchMode,
  SearchResponse,
} from "@bookmark-ai/types";

/**
 * API client — same contract as apps/web/lib/api.ts. Two selectable servers:
 * the open local one (iOS simulator reaches the host's localhost directly;
 * the Android emulator sees it as 10.0.2.2) and the deployed API — Next.js
 * route handlers on the web app's Vercel domain — which requires the Clerk
 * bearer token. EXPO_PUBLIC_API_URL overrides both.
 */
export const LOCAL_API_URL =
  Platform.OS === "android" ? "http://10.0.2.2:4545" : "http://localhost:4545";
export const PROD_API_URL = "https://bookmark-ai.cloud";

export type ServerTarget = "local" | "production";

// Owned by PreferencesContext (persisted there); mirrored here so the
// data layer stays hook-free.
let serverTarget: ServerTarget = "local";

export function setServerTarget(target: ServerTarget): void {
  serverTarget = target;
}

export function getApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) return process.env.EXPO_PUBLIC_API_URL;
  return serverTarget === "production" ? PROD_API_URL : LOCAL_API_URL;
}

/** Clerk session token (registered from the ClerkProvider tree). Null →
 * unauthenticated request, which the open local server accepts and the
 * deployed server 401s. */
let authTokenProvider: (() => Promise<string | null>) | null = null;

export function setAuthTokenProvider(provider: () => Promise<string | null>): void {
  authTokenProvider = provider;
}

async function authHeaders(): Promise<Record<string, string>> {
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

/** Save a URL — the server scrapes OG data, categorizes, and embeds it. */
export function createBookmark(input: CreateBookmarkInput): Promise<{ bookmark: Bookmark }> {
  return request<{ bookmark: Bookmark }>("/api/bookmarks", { method: "POST", body: input });
}

export function listSessions(signal?: AbortSignal): Promise<ListSessionsResponse> {
  return request<ListSessionsResponse>("/api/sessions", { signal });
}

export function deleteSession(id: string): Promise<void> {
  return request<void>(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
}
