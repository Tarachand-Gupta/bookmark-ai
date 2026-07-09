import type { Bookmark, CreateBookmarkInput } from "@bookmark-ai/types";
import { storage } from "#imports";

export const DEFAULT_API_URL = "http://localhost:4000";

/** API base URL, user-configurable from the popup settings row. */
export const apiUrlItem = storage.defineItem<string>("local:apiUrl", {
  fallback: DEFAULT_API_URL,
});

export async function getApiBaseUrl(): Promise<string> {
  const value = await apiUrlItem.getValue();
  return (value || DEFAULT_API_URL).trim().replace(/\/+$/, "");
}

/** POST /api/bookmarks — the server scrapes OG data and AI-categorizes. */
export async function createBookmark(
  input: CreateBookmarkInput,
): Promise<Bookmark> {
  const base = await getApiBaseUrl();
  let res: Response;
  try {
    res = await fetch(`${base}/api/bookmarks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    throw new Error(
      `Could not reach ${base}. Is the Bookmark AI server running?`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Save failed (${res.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`,
    );
  }
  const data = (await res.json()) as { bookmark: Bookmark };
  return data.bookmark;
}
