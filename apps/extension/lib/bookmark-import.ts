import { browser } from "wxt/browser";
import {
  flattenBrowserBookmarks,
  type BookmarkImportApplyRequest,
  type BookmarkImportPreview,
  type BookmarkImportResult,
} from "@bookmark-ai/types";
import { getApiBaseUrl } from "./api";
import { getOAuthToken, SUPABASE_AUTH } from "./supabase-oauth";
import { fetchWithTimeout } from "./net";

/** Subject is only a local account boundary; the API verifies the credential. */
export function importAccountSubject(token: string | null): string | null {
  if (!token) return null;
  try {
    const segment = token.split(".")[1];
    if (!segment) return null;
    const payload = JSON.parse(atob(segment.replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.sub === "string" && payload.sub.length > 0 ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function getImportAccount(): Promise<{ accountId: string; origin: string } | null> {
  if (!SUPABASE_AUTH) return null;
  const accountId = importAccountSubject(await getOAuthToken());
  return accountId ? { accountId, origin: await getApiBaseUrl() } : null;
}

export async function extensionImportRequest<T>(accountId: string, body?: unknown): Promise<T> {
  return extensionAccountRequest<T>(accountId, "/api/import/bookmarks", body);
}

async function extensionAccountRequest<T>(
  accountId: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = await getOAuthToken();
  if (!token || importAccountSubject(token) !== accountId)
    throw new Error("Your account changed. Reopen Import for the current account.");
  const origin = await getApiBaseUrl();
  // Use the captured credential for this exact account; never retry a mutation with another account's credential.
  const response = await fetchWithTimeout(`${origin}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "X-Bookmark-Client": "extension",
    },
    credentials: "omit",
    redirect: "error",
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok)
    throw new Error(
      response.status === 404
        ? "This server needs an update to import existing bookmarks."
        : (result?.error ?? "Import could not be confirmed. Check your sign-in and retry."),
    );
  return result as T;
}

export async function readBrowserImportPreview(accountId: string): Promise<BookmarkImportPreview> {
  if (import.meta.env.BROWSER === "safari" || !browser.bookmarks?.getTree)
    throw new Error(
      "This browser does not expose its bookmark library. Import an exported HTML file in the web app.",
    );
  if (!(await browser.permissions.contains({ permissions: ["bookmarks"] })))
    throw new Error(
      "Allow bookmark access to preview this browser's library, or import a file instead.",
    );
  const items = flattenBrowserBookmarks(await browser.bookmarks.getTree());
  return (
    await extensionImportRequest<{ preview: BookmarkImportPreview }>(accountId, {
      action: "preview",
      source: "browser",
      items,
    })
  ).preview;
}

export async function applyExtensionImportBatch(
  accountId: string,
  input: BookmarkImportApplyRequest,
): Promise<BookmarkImportResult> {
  return (await extensionImportRequest<{ result: BookmarkImportResult }>(accountId, input)).result;
}

/** Refresh the exact account setting used by the background, using a captured credential. */
export async function readExtensionImportSyncSettings(
  accountId: string,
): Promise<{ nativeSyncEnabled?: boolean; nativeSyncFull?: boolean } | null> {
  try {
    const result = await extensionAccountRequest<{
      settings?: { nativeSyncEnabled?: boolean; nativeSyncFull?: boolean };
    }>(accountId, "/api/settings");
    if ((await getImportAccount())?.accountId !== accountId) return null;
    const settings = result.settings;
    if (
      typeof settings?.nativeSyncEnabled !== "boolean" ||
      typeof settings.nativeSyncFull !== "boolean"
    )
      return null;
    await browser.storage.local.set({
      nativeSyncEnabled: settings.nativeSyncEnabled,
      nativeSyncFull: settings.nativeSyncFull,
    });
    return settings;
  } catch {
    return null;
  }
}
