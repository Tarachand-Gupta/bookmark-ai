import type { Bookmark } from "@bookmark-ai/types";

/** Resolve the frozen IDs, including search hits and rows beyond the loaded page.
 * A failed lookup aborts export rather than silently producing a partial CSV. */
export async function resolveSelectedBookmarks(
  ids: readonly string[],
  loaded: readonly Bookmark[],
  load: (id: string) => Promise<Bookmark>,
): Promise<Bookmark[]> {
  const selected = [...new Set(ids)];
  const rows = new Map(loaded.map(bookmark => [bookmark.id, bookmark]));
  const missing = selected.filter(id => !rows.has(id));
  for (let offset = 0; offset < missing.length; offset += 6) {
    const batch = await Promise.all(missing.slice(offset, offset + 6).map(id => load(id)));
    for (const bookmark of batch) rows.set(bookmark.id, bookmark);
  }
  return selected.map(id => {
    const bookmark = rows.get(id);
    if (!bookmark) throw new Error("A selected bookmark is no longer available. Refresh the selection and try again.");
    return bookmark;
  });
}
