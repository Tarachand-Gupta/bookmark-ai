import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import {
  BOOKMARK_IMPORT_MAX_BYTES,
  type BookmarkImportApplyRequest,
  type BookmarkImportPreview,
  type BookmarkImportPreviewRequest,
  type BookmarkImportResult,
} from "@bookmark-ai/types";
import { apiHeaders, getApiUrl } from "../api";

export function mobileImportSource(name: string): "html" | "markdown" | "text" {
  if (/\.zip$/i.test(name))
    throw new Error(
      "Extract the ZIP in Files, then choose its bookmarks HTML file. For Safari, export Bookmarks only on a Mac.",
    );
  if (/\.json$/i.test(name))
    throw new Error("Restore a Bookmark AI JSON backup from Data settings in the web or Mac app.");
  if (/\.html?$/i.test(name)) return "html";
  if (/\.(md|markdown)$/i.test(name)) return "markdown";
  if (/\.txt$/i.test(name)) return "text";
  throw new Error("Choose a bookmarks HTML, Markdown or plain text file.");
}

export async function mobileImportRequest<T>(accountId: string, body: unknown): Promise<T> {
  const headers = await apiHeaders();
  const bearer = headers.authorization ?? headers.Authorization;
  if (bearer) {
    let subject: unknown;
    try {
      subject = JSON.parse(atob(bearer.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub;
    } catch {
      /* Refuse an unidentifiable account. */
    }
    if (subject !== accountId)
      throw new Error("Your account changed. Reopen Import for the current account.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(`${getApiUrl()}/api/import/bookmarks`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        response.status === 404
          ? "This server needs an update before it can import bookmarks."
          : (result?.error ??
              "Import could not be confirmed. Check your connection and sign-in, then retry."),
      );
    return result as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function previewMobileImport(
  accountId: string,
  input: BookmarkImportPreviewRequest,
): Promise<BookmarkImportPreview> {
  return (await mobileImportRequest<{ preview: BookmarkImportPreview }>(accountId, input)).preview;
}
export async function applyMobileImport(
  accountId: string,
  input: BookmarkImportApplyRequest,
): Promise<BookmarkImportResult> {
  return (await mobileImportRequest<{ result: BookmarkImportResult }>(accountId, input)).result;
}
export async function pickBookmarkImportFile(): Promise<{
  name: string;
  request: BookmarkImportPreviewRequest;
} | null> {
  const picked = await DocumentPicker.getDocumentAsync({
    type: "*/*",
    multiple: false,
    copyToCacheDirectory: true,
  });
  if (picked.canceled) return null;
  const asset = picked.assets[0];
  const source = mobileImportSource(asset.name);
  const file = new File(asset.uri);
  if (Math.max(asset.size ?? 0, file.size) > BOOKMARK_IMPORT_MAX_BYTES)
    throw new Error("Import files must be 5 MB or smaller.");
  try {
    const content = await file.text();
    return { name: asset.name, request: { action: "preview", source, content } };
  } finally {
    // The picker made this app-owned cache copy; leave the original export untouched.
    try {
      file.delete();
    } catch {
      /* The OS also reclaims picker cache files. */
    }
  }
}
