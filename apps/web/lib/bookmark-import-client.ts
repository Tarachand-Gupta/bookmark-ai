import type {
  BookmarkImportApplyRequest,
  BookmarkImportPreview,
  BookmarkImportPreviewRequest,
  BookmarkImportResult,
} from "@bookmark-ai/types";
import { BOOKMARK_IMPORT_MAX_BYTES } from "@bookmark-ai/types";
import { API_URL, apiHeaders } from "./api";

export function importSourceForFilename(name: string): "html" | "markdown" | "text" {
  if (/\.zip$/i.test(name))
    throw new Error(
      "Extract the ZIP on your device, then select its bookmarks HTML file. In Safari, export Bookmarks only.",
    );
  if (/\.json$/i.test(name))
    throw new Error("For a Bookmark AI JSON backup, use Settings → Data → Restore backup.");
  if (/\.html?$/i.test(name)) return "html";
  if (/\.(md|markdown)$/i.test(name)) return "markdown";
  if (/\.txt$/i.test(name)) return "text";
  throw new Error("Choose a bookmarks HTML file, Markdown file or plain text file.");
}

export async function bookmarkImportRequest<T>(body?: unknown, accountId?: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const headers = await apiHeaders();
    if (accountId && headers.authorization) {
      let subject: unknown;
      try {
        subject = JSON.parse(
          atob(headers.authorization.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")),
        ).sub;
      } catch {
        /* Refuse an unidentifiable credential. */
      }
      if (subject !== accountId)
        throw new Error("Your account changed. Reopen Import for the current account.");
    }
    const response = await fetch(`${API_URL}/api/import/bookmarks`, {
      method: body ? "POST" : "GET",
      headers: { "content-type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const result = await response.json().catch(() => null);
    if (!response.ok)
      throw new Error(
        response.status === 404
          ? "This server needs an update before it can import browser bookmarks."
          : (result?.error ?? `Import could not be confirmed (${response.status}).`),
      );
    return result as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function previewBookmarkFile(
  file: File,
  accountId?: string,
): Promise<BookmarkImportPreview> {
  if (file.size > BOOKMARK_IMPORT_MAX_BYTES)
    throw new Error("Import files must be 5 MB or smaller.");
  const source = importSourceForFilename(file.name);
  return previewBookmarkSource(
    { action: "preview", source, content: await file.text() },
    accountId,
  );
}
export async function previewBookmarkSource(
  input: BookmarkImportPreviewRequest,
  accountId?: string,
): Promise<BookmarkImportPreview> {
  return (await bookmarkImportRequest<{ preview: BookmarkImportPreview }>(input, accountId))
    .preview;
}
export async function applyBookmarkBatch(
  input: BookmarkImportApplyRequest,
  accountId: string,
): Promise<BookmarkImportResult> {
  return (await bookmarkImportRequest<{ result: BookmarkImportResult }>(input, accountId)).result;
}
