import type {
  Bookmark,
  CreateBookmarkInput,
  CreateSessionInput,
  Session,
} from "@bookmark-ai/types";
import { storage } from "#imports";

/** A freshly installed extension talks to production; developers point this at
 * http://localhost:3000 (the web dev server, which serves the same /api) via
 * the popup settings row. */
export const DEFAULT_API_URL = "https://bookmark-ai.cloud";
export const DEFAULT_WEB_URL = "http://localhost:3000";

/** API base URL, user-configurable from the popup settings row. */
export const apiUrlItem = storage.defineItem<string>("local:apiUrl", {
  fallback: DEFAULT_API_URL,
});

/** Web app base URL — for the "Open website" button and post-session redirect. */
export const webUrlItem = storage.defineItem<string>("local:webUrl", {
  fallback: DEFAULT_WEB_URL,
});

export async function getApiBaseUrl(): Promise<string> {
  const value = await apiUrlItem.getValue();
  return (value || DEFAULT_API_URL).trim().replace(/\/+$/, "");
}

export async function getWebBaseUrl(): Promise<string> {
  const value = await webUrlItem.getValue();
  return (value || DEFAULT_WEB_URL).trim().replace(/\/+$/, "");
}

/** The background script registers Clerk's token getter here — keeps this
 * module importable from the popup without pulling in background-only Clerk
 * code. Unset/null token → request goes out unauthenticated (the deployed
 * default 401s it; a local dev server accepts it only with DEV_OPEN_API=1). */
let authTokenProvider: (() => Promise<string | null>) | null = null;

export function setAuthTokenProvider(provider: () => Promise<string | null>): void {
  authTokenProvider = provider;
}

async function authHeaders(): Promise<Record<string, string>> {
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
