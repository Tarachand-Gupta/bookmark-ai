import { describe, expect, it, vi } from "vitest";
import {
  createTable,
  getCoreRowModel,
  getSortedRowModel,
  type TableState,
} from "@tanstack/react-table";
import {
  BOOKMARK_TABLE_COLUMNS,
  BOOKMARK_TABLE_STORAGE_KEY,
  createBookmarkTablePreferencesStore,
  defaultBookmarkTablePreferences,
  loadedBookmarkSelection,
  moveBookmarkTableColumn,
  parseBookmarkTablePreferences,
  setLoadedBookmarkSelection,
  validateBookmarkTablePreferences,
} from "./bookmark-table-preferences";

describe("bookmark table preference validation and migration", () => {
  it("defaults to Title, Website and Added date, with a dominant readable title", () => {
    const preferences = defaultBookmarkTablePreferences();
    expect(BOOKMARK_TABLE_COLUMNS.filter((id) => preferences.columnVisibility[id])).toEqual([
      "title",
      "website",
      "added",
    ]);
    expect(preferences.columnSizing.title).toBeGreaterThan(
      preferences.columnSizing.website + preferences.columnSizing.added,
    );
  });

  it.each([null, "", "{", "null", "[]", '{"version":99}', '{"version":"2"}'])(
    "recovers safely from invalid or future storage: %s",
    (raw) => {
      expect(parseBookmarkTablePreferences(raw)).toEqual(defaultBookmarkTablePreferences());
    },
  );

  it("deduplicates order, rejects unknown/fixed columns and appends missing columns", () => {
    const preferences = validateBookmarkTablePreferences({
      version: 2,
      columnOrder: ["tags", "tags", "actions", "selection", "missing", null, "title"],
    });
    expect(preferences.columnOrder.slice(0, 2)).toEqual(["tags", "title"]);
    expect(new Set(preferences.columnOrder)).toEqual(new Set(BOOKMARK_TABLE_COLUMNS));
    expect(preferences.columnOrder).toHaveLength(BOOKMARK_TABLE_COLUMNS.length);
  });

  it("keeps Title visible and clamps widths so corrupt storage cannot collapse it", () => {
    const preferences = validateBookmarkTablePreferences({
      version: 2,
      columnVisibility: { title: false, folder: true, tags: "false", actions: false },
      columnSizing: {
        title: 1,
        website: -100,
        tags: 999999,
        added: NaN,
        folder: Infinity,
        device: "1",
      },
    });
    expect(preferences.columnVisibility.title).toBe(true);
    expect(preferences.columnVisibility.folder).toBe(true);
    expect(preferences.columnVisibility.tags).toBe(false);
    expect(preferences.columnVisibility.actions).toBeUndefined();
    expect(preferences.columnSizing).toMatchObject({
      title: 280,
      website: 140,
      tags: 800,
      added: 148,
      folder: 170,
      device: 160,
    });
  });

  it("migrates v1 identifiers while preserving user choices", () => {
    const preferences = validateBookmarkTablePreferences({
      version: 1,
      columnOrder: ["category", "addedAt", "title"],
      columnVisibility: { category: true, addedAt: false },
      columnSizing: { category: 246, addedAt: 160 },
    });
    expect(preferences.version).toBe(2);
    expect(preferences.columnOrder.slice(0, 3)).toEqual(["topic", "added", "title"]);
    expect(preferences.columnVisibility).toMatchObject({ topic: true, added: false });
    expect(preferences.columnSizing).toMatchObject({ topic: 246, added: 160 });
  });

  it("round trips a customized layout and never persists content or unknown fields", () => {
    const preferences = validateBookmarkTablePreferences({
      ...defaultBookmarkTablePreferences(),
      columnOrder: ["website", "title"],
      userId: "private",
      bookmarks: ["private"],
      sorting: [{ id: "title", desc: true }],
    });
    expect(parseBookmarkTablePreferences(JSON.stringify(preferences))).toEqual(preferences);
    expect(Object.keys(preferences).sort()).toEqual([
      "autoFitTitle",
      "columnOrder",
      "columnSizing",
      "columnVisibility",
      "version",
    ]);
    expect(JSON.stringify(preferences)).not.toContain("private");
  });
});

describe("device-local table store", () => {
  function fixture(raw: string | null = null) {
    const values = new Map<string, string>();
    if (raw !== null) values.set(BOOKMARK_TABLE_STORAGE_KEY, raw);
    const setItem = vi.fn((key: string, value: string) => {
      values.set(key, value);
    });
    const store = createBookmarkTablePreferencesStore(() => ({
      getItem: (key) => values.get(key) ?? null,
      setItem,
    }));
    return { store, values, setItem };
  }

  it("loads saved choices without an initial default write", () => {
    const saved = { ...defaultBookmarkTablePreferences(), columnSizing: { title: 650 } };
    const { store, setItem } = fixture(JSON.stringify(saved));
    store.subscribe(() => {});
    expect(store.getSnapshot().columnSizing.title).toBe(650);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("updates all mounted contexts, survives remount and persists only one global key", () => {
    const { store, values } = fixture();
    const library = vi.fn(),
      folder = vi.fn();
    const unsubscribe = store.subscribe(library);
    store.subscribe(folder);
    store.update((previous) => ({
      ...previous,
      columnVisibility: { ...previous.columnVisibility, tags: true },
    }));
    expect(library).toHaveBeenCalledTimes(1);
    expect(folder).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.update((previous) => ({
      ...previous,
      columnSizing: { ...previous.columnSizing, title: 600 },
    }));
    expect(library).toHaveBeenCalledTimes(1);
    expect(folder).toHaveBeenCalledTimes(2);
    const reloaded = fixture(values.get(BOOKMARK_TABLE_STORAGE_KEY));
    reloaded.store.refresh();
    expect(reloaded.store.getSnapshot()).toEqual(store.getSnapshot());
    expect([...values.keys()]).toEqual([BOOKMARK_TABLE_STORAGE_KEY]);
  });

  it("receives cross-tab changes, removal and clear without echo writes", () => {
    const { store, setItem } = fixture();
    store.refresh();
    const initial = store.getSnapshot();
    store.receiveStorage("unrelated", "{}");
    expect(store.getSnapshot()).toBe(initial);
    const changed = JSON.stringify({ ...initial, columnOrder: ["added", "title"] });
    store.receiveStorage(BOOKMARK_TABLE_STORAGE_KEY, changed);
    expect(store.getSnapshot().columnOrder[0]).toBe("added");
    store.receiveStorage(BOOKMARK_TABLE_STORAGE_KEY, null);
    expect(store.getSnapshot()).toEqual(defaultBookmarkTablePreferences());
    store.receiveStorage(BOOKMARK_TABLE_STORAGE_KEY, changed);
    store.receiveStorage(null, null);
    expect(store.getSnapshot()).toEqual(defaultBookmarkTablePreferences());
    expect(setItem).not.toHaveBeenCalled();
  });

  it("resets order, visibility and sizes together", () => {
    const { store, values } = fixture();
    store.update((previous) => ({
      ...previous,
      autoFitTitle: false,
      columnOrder: ["tags", "title"],
      columnVisibility: { tags: true },
      columnSizing: { title: 900 },
    }));
    store.reset();
    expect(store.getSnapshot()).toEqual(defaultBookmarkTablePreferences());
    expect(parseBookmarkTablePreferences(values.get(BOOKMARK_TABLE_STORAGE_KEY)!)).toEqual(
      defaultBookmarkTablePreferences(),
    );
  });

  it("preserves explicit Title widths instead of filling over keyboard resize choices", () => {
    const saved = validateBookmarkTablePreferences({
      ...defaultBookmarkTablePreferences(),
      autoFitTitle: false,
      columnSizing: { title: 320 },
    });
    expect(parseBookmarkTablePreferences(JSON.stringify(saved))).toMatchObject({
      autoFitTitle: false,
      columnSizing: { title: 320 },
    });
  });

  it("retains session choices when localStorage access itself is blocked", () => {
    const store = createBookmarkTablePreferencesStore(() => {
      throw new Error("SecurityError");
    });
    store.update((previous) => ({ ...previous, columnSizing: { title: 600 } }));
    store.refresh();
    expect(store.getSnapshot().columnSizing.title).toBe(600);
    expect(() => store.reset()).not.toThrow();
    expect(store.getSnapshot()).toEqual(defaultBookmarkTablePreferences());
  });

  it("retains session choices after quota failure instead of restoring stale storage", () => {
    const store = createBookmarkTablePreferencesStore(() => ({
      getItem: () => JSON.stringify(defaultBookmarkTablePreferences()),
      setItem() {
        throw new Error("QuotaExceeded");
      },
    }));
    store.update((previous) => ({ ...previous, columnVisibility: { tags: true } }));
    store.refresh();
    expect(store.getSnapshot().columnVisibility.tags).toBe(true);
    // An external reset must still win if the failed write left the raw value unchanged.
    store.receiveStorage(
      BOOKMARK_TABLE_STORAGE_KEY,
      JSON.stringify(defaultBookmarkTablePreferences()),
    );
    expect(store.getSnapshot()).toEqual(defaultBookmarkTablePreferences());
  });
});

describe("column movement and loaded selection", () => {
  it("moves across hidden columns without dropping them or mutating the source", () => {
    const order = ["title", "folder", "website", "added"] as const;
    expect(moveBookmarkTableColumn(order, "title", "website")).toEqual([
      "folder",
      "website",
      "title",
      "added",
    ]);
    expect(moveBookmarkTableColumn(order, "added", "title")).toEqual([
      "added",
      "title",
      "folder",
      "website",
    ]);
    expect(moveBookmarkTableColumn(order, "selection", "title")).toEqual(order);
    expect(order).toEqual(["title", "folder", "website", "added"]);
  });

  it("derives header checked/indeterminate state only from loaded rows", () => {
    expect(loadedBookmarkSelection([], new Set(["offscreen"]))).toBe(false);
    expect(loadedBookmarkSelection(["a", "b"], new Set(["offscreen"]))).toBe(false);
    expect(loadedBookmarkSelection(["a", "b"], new Set(["a", "offscreen"]))).toBe("indeterminate");
    expect(loadedBookmarkSelection(["a", "b"], new Set(["a", "b", "offscreen"]))).toBe(true);
  });

  it("preserves offscreen selections when selecting and deselecting loaded rows", () => {
    const original = new Set(["offscreen", "a"]);
    const selected = setLoadedBookmarkSelection(["a", "b"], original, true);
    expect(new Set(selected)).toEqual(new Set(["offscreen", "a", "b"]));
    expect(setLoadedBookmarkSelection(["a", "b"], new Set(selected), false)).toEqual(["offscreen"]);
    expect(original).toEqual(new Set(["offscreen", "a"]));
  });

  it("uses the actual TanStack sorted row model for range order and retains all loaded rows", () => {
    const data = [
      { id: "z", title: "Zulu" },
      { id: "a", title: "Alpha" },
      { id: "m", title: "Mike" },
    ];
    const table = createTable({
      data,
      columns: [{ accessorKey: "title" }],
      state: {},
      onStateChange: () => {},
      renderFallbackValue: null,
      getRowId: (row) => row.id,
      getCoreRowModel: getCoreRowModel(),
      getSortedRowModel: getSortedRowModel(),
    });
    const state: TableState = { ...table.initialState, sorting: [{ id: "title", desc: false }] };
    table.setOptions((previous) => ({ ...previous, state }));
    const order = table.getRowModel().rows.map((row) => row.id);
    expect(order).toEqual(["a", "m", "z"]);
    // This is the order passed to the existing SelectionState.toggle range API.
    expect(order.slice(order.indexOf("a"), order.indexOf("z") + 1)).toEqual(["a", "m", "z"]);
    expect(new Set(setLoadedBookmarkSelection(order, new Set(["offscreen"]), true))).toEqual(
      new Set(["offscreen", "a", "m", "z"]),
    );
    expect(data.map((row) => row.id)).toEqual(["z", "a", "m"]);
  });
});
