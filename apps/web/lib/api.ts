import type {
  Bookmark,
  CreateBookmarkInput,
  HealthResponse,
  ListBookmarksResponse,
  ListSessionsResponse,
  MetaResponse,
  SearchMode,
  SearchResponse,
} from "@bookmark-ai/types";

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4545";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error((body as { error?: string })?.error ?? `Request failed (${res.status})`);
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
  const params = new URLSearchParams({ q, mode });
  return request<SearchResponse>(`/api/search?${params}`, { signal });
}

export function createBookmark(input: CreateBookmarkInput): Promise<{ bookmark: Bookmark }> {
  return request<{ bookmark: Bookmark }>("/api/bookmarks", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteBookmark(id: string): Promise<void> {
  return fetch(`${API_URL}/api/bookmarks/${id}`, { method: "DELETE" }).then((res) => {
    if (!res.ok && res.status !== 404) throw new Error(`Delete failed (${res.status})`);
  });
}

export function getSessions(signal?: AbortSignal): Promise<ListSessionsResponse> {
  return request<ListSessionsResponse>("/api/sessions", { signal });
}

export function deleteSession(id: string): Promise<void> {
  return fetch(`${API_URL}/api/sessions/${id}`, { method: "DELETE" }).then((res) => {
    if (!res.ok && res.status !== 404) throw new Error(`Delete failed (${res.status})`);
  });
}
