/** One device-local layout shared by every bookmark context. No bookmark data is stored. */
export const BOOKMARK_TABLE_STORAGE_KEY = "bookmark-ai:bookmark-table";
export const BOOKMARK_TABLE_VERSION = 2;
export const BOOKMARK_TABLE_COLUMNS = [
  "title",
  "website",
  "added",
  "folder",
  "topic",
  "tags",
  "browser",
  "device",
] as const;
export type BookmarkTableColumn = (typeof BOOKMARK_TABLE_COLUMNS)[number];

export const BOOKMARK_TABLE_LABELS: Record<BookmarkTableColumn, string> = {
  title: "Title",
  website: "Website",
  added: "Added date",
  folder: "Folder",
  topic: "Topic",
  tags: "Tags",
  browser: "Browser",
  device: "Device",
};
export const BOOKMARK_TABLE_SIZES: Record<
  BookmarkTableColumn,
  { size: number; min: number; max: number }
> = {
  title: { size: 440, min: 280, max: 1200 },
  website: { size: 180, min: 140, max: 600 },
  added: { size: 148, min: 132, max: 400 },
  folder: { size: 170, min: 120, max: 600 },
  topic: { size: 160, min: 120, max: 600 },
  tags: { size: 220, min: 140, max: 800 },
  browser: { size: 130, min: 112, max: 400 },
  device: { size: 160, min: 120, max: 600 },
};

export interface BookmarkTablePreferences {
  version: typeof BOOKMARK_TABLE_VERSION;
  autoFitTitle: boolean;
  columnOrder: BookmarkTableColumn[];
  columnVisibility: Record<string, boolean>;
  columnSizing: Record<string, number>;
}

export function defaultBookmarkTablePreferences(): BookmarkTablePreferences {
  return {
    version: BOOKMARK_TABLE_VERSION,
    autoFitTitle: true,
    columnOrder: [...BOOKMARK_TABLE_COLUMNS],
    columnVisibility: Object.fromEntries(
      BOOKMARK_TABLE_COLUMNS.map((id) => [id, ["title", "website", "added"].includes(id)]),
    ),
    columnSizing: Object.fromEntries(
      BOOKMARK_TABLE_COLUMNS.map((id) => [id, BOOKMARK_TABLE_SIZES[id].size]),
    ),
  };
}

export function isBookmarkTableColumn(id: unknown): id is BookmarkTableColumn {
  return typeof id === "string" && (BOOKMARK_TABLE_COLUMNS as readonly string[]).includes(id);
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** v1 used category/addedAt identifiers. Unknown future versions reset safely. */
export function validateBookmarkTablePreferences(value: unknown): BookmarkTablePreferences {
  const defaults = defaultBookmarkTablePreferences();
  const data = record(value);
  if (data.version !== 1 && data.version !== BOOKMARK_TABLE_VERSION) return defaults;
  defaults.autoFitTitle = typeof data.autoFitTitle === "boolean" ? data.autoFitTitle : true;
  const migrateId = (id: string) =>
    data.version === 1 ? ({ category: "topic", addedAt: "added" }[id] ?? id) : id;
  const order = Array.isArray(data.columnOrder)
    ? data.columnOrder
        .filter((id): id is string => typeof id === "string")
        .map(migrateId)
        .filter(isBookmarkTableColumn)
    : [];
  defaults.columnOrder = [...new Set([...order, ...BOOKMARK_TABLE_COLUMNS])];
  for (const [key, visible] of Object.entries(record(data.columnVisibility))) {
    const id = migrateId(key);
    if (isBookmarkTableColumn(id) && typeof visible === "boolean" && id !== "title")
      defaults.columnVisibility[id] = visible;
  }
  for (const [key, size] of Object.entries(record(data.columnSizing))) {
    const id = migrateId(key);
    if (!isBookmarkTableColumn(id) || typeof size !== "number" || !Number.isFinite(size)) continue;
    defaults.columnSizing[id] = Math.round(
      Math.min(BOOKMARK_TABLE_SIZES[id].max, Math.max(BOOKMARK_TABLE_SIZES[id].min, size)),
    );
  }
  return defaults;
}

export function parseBookmarkTablePreferences(raw: string | null): BookmarkTablePreferences {
  try {
    return validateBookmarkTablePreferences(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultBookmarkTablePreferences();
  }
}

/** Move relative to visible neighbours, preserving hidden columns in the full order. */
export function moveBookmarkTableColumn(
  order: readonly BookmarkTableColumn[],
  active: string,
  over: string,
): BookmarkTableColumn[] {
  const from = order.indexOf(active as BookmarkTableColumn);
  const to = order.indexOf(over as BookmarkTableColumn);
  if (from < 0 || to < 0 || from === to) return [...order];
  const next = [...order];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

export function loadedBookmarkSelection(
  ids: readonly string[],
  selected: ReadonlySet<string>,
): boolean | "indeterminate" {
  const count = ids.filter((id) => selected.has(id)).length;
  return count === 0 ? false : count === ids.length ? true : "indeterminate";
}

/** Select/deselect only loaded rows; retain selections outside this batch. */
export function setLoadedBookmarkSelection(
  ids: readonly string[],
  selected: ReadonlySet<string>,
  checked: boolean,
): string[] {
  const next = new Set(selected);
  for (const id of ids) {
    if (checked) next.add(id);
    else next.delete(id);
  }
  return [...next];
}

/** Injectable storage keeps persistence, blocked storage and cross-context state testable. */
export function createBookmarkTablePreferencesStore(
  getStorage: () => Pick<Storage, "getItem" | "setItem">,
) {
  let snapshot = defaultBookmarkTablePreferences();
  let previousRaw: string | null | undefined;
  let volatile = false;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  function receiveStorage(key: string | null, raw: string | null) {
    if (key !== BOOKMARK_TABLE_STORAGE_KEY && key !== null) return;
    const wasVolatile = volatile;
    volatile = false;
    if (raw === previousRaw && !wasVolatile) return;
    previousRaw = raw;
    snapshot = parseBookmarkTablePreferences(raw);
    notify();
  }
  function refresh() {
    if (volatile) return;
    try {
      receiveStorage(BOOKMARK_TABLE_STORAGE_KEY, getStorage().getItem(BOOKMARK_TABLE_STORAGE_KEY));
    } catch {
      /* Storage denied; retain session state. */
    }
  }
  function update(updater: (previous: BookmarkTablePreferences) => BookmarkTablePreferences) {
    refresh();
    snapshot = validateBookmarkTablePreferences(updater(snapshot));
    const raw = JSON.stringify(snapshot);
    try {
      getStorage().setItem(BOOKMARK_TABLE_STORAGE_KEY, raw);
      previousRaw = raw;
      volatile = false;
    } catch {
      volatile = true;
    }
    notify();
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      refresh();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    refresh,
    receiveStorage,
    update,
    reset: () => update(defaultBookmarkTablePreferences),
  };
}
