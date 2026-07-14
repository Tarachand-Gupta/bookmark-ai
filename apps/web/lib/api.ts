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

/** Same-origin by default — the API lives in this Next.js app's /api routes.
 * Set NEXT_PUBLIC_API_URL only to point at a separately hosted API. */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "";

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

async function authHeaders(): Promise<Record<string, string>> {
  const token = await getAuthToken();
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(await authHeaders()), ...init?.headers },
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
