import { Platform } from "react-native";
import type {
  ListBookmarksResponse,
  MetaResponse,
  SearchMode,
  SearchResponse,
} from "@bookmark-ai/types";

/**
 * API client — same contract as apps/web/lib/api.ts. Two selectable servers:
 * the open local one (iOS simulator reaches the host's localhost directly;
 * the Android emulator sees it as 10.0.2.2) and the deployed Render API,
 * which requires the Clerk bearer token. EXPO_PUBLIC_API_URL overrides both.
 */
export const LOCAL_API_URL =
  Platform.OS === "android" ? "http://10.0.2.2:4545" : "http://localhost:4545";
export const PROD_API_URL = "https://bookmark-ai-server.onrender.com";

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

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${getApiUrl()}${path}`, {
    signal,
    headers: { "content-type": "application/json", ...(await authHeaders()) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${res.status})`);
  }
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
  return request<ListBookmarksResponse>(`/api/bookmarks?${params}`, signal);
}

export function getMeta(signal?: AbortSignal): Promise<MetaResponse> {
  return request<MetaResponse>("/api/meta", signal);
}

export function searchBookmarks(
  q: string,
  mode: SearchMode,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q, mode });
  return request<SearchResponse>(`/api/search?${params}`, signal);
}
