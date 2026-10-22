/** A device preference only: never include account IDs or bookmark metadata. */
export type BookmarkView = "grid" | "table";
export const BOOKMARK_VIEW_KEY = "bookmark-ai:view";
export const BOOKMARK_VIEW_BREAKPOINT = 768;
export const SMALL_BOOKMARK_GRID_COLUMNS = "grid-cols-[repeat(auto-fill,minmax(min(100%,280px),1fr))]";

export function parseBookmarkView(value: unknown): BookmarkView | null {
  if (value === "list" || value === "compact") return "table";
  return value === "grid" || value === "table" ? value : null;
}

export function resolveBookmarkView(choice: BookmarkView | null, width: number): BookmarkView {
  // Phones retain the original image-led cards regardless of the desktop choice.
  return width < BOOKMARK_VIEW_BREAKPOINT ? "grid" : choice ?? "grid";
}

type StorageAccess = () => Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Framework-free shared store. Storage failures leave the current tab usable. */
export function createBookmarkViewStore(storage: StorageAccess) {
  let choice: BookmarkView | null = null;
  const listeners = new Set<() => void>();
  const publish = (next: BookmarkView | null) => {
    if (choice === next) return;
    choice = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => choice,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    refresh() {
      try { publish(parseBookmarkView(storage().getItem(BOOKMARK_VIEW_KEY))); } catch { /* blocked storage */ }
    },
    receiveStorage(key: string | null, value: string | null) {
      if (key === BOOKMARK_VIEW_KEY || key === null) publish(parseBookmarkView(value));
    },
    set(next: BookmarkView | null) {
      publish(next);
      try {
        if (next === null) storage().removeItem(BOOKMARK_VIEW_KEY);
        else storage().setItem(BOOKMARK_VIEW_KEY, next);
      } catch { /* Keep the explicit choice in memory for this tab. */ }
    },
  };
}
