import { Platform } from "react-native";
import type {
  ListBookmarksResponse,
  MetaResponse,
  SearchMode,
  SearchResponse,
} from "@bookmark-ai/types";

/**
 * API client — same contract as apps/web/lib/api.ts. The iOS simulator can
 * reach the host's localhost directly; the Android emulator sees the host as
 * 10.0.2.2. Override with EXPO_PUBLIC_API_URL (e.g. the Render URL — which
 * requires auth, so wire a token provider first).
 */
const DEFAULT_API_URL = Platform.OS === "android" ? "http://10.0.2.2:4545" : "http://localhost:4545";

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? DEFAULT_API_URL;

/** Clerk (Expo SDK) plugs in here once mobile auth lands — mirrors the
 * extension's setAuthTokenProvider pattern. Null → unauthenticated request,
 * which the open local server accepts and the deployed server 401s. */
let authTokenProvider: (() => Promise<string | null>) | null = null;

export function setAuthTokenProvider(provider: () => Promise<string | null>): void {
  authTokenProvider = provider;
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await authTokenProvider?.().catch(() => null);
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
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
