import { describe, expect, it } from "vitest";
import { BOOKMARK_VIEW_KEY, createBookmarkViewStore, parseBookmarkView, resolveBookmarkView } from "./bookmark-view";

function fixture(initial: string | null = null) {
  const values = new Map<string, string>();
  if (initial !== null) values.set(BOOKMARK_VIEW_KEY, initial);
  const writes: string[] = [];
  const store = createBookmarkViewStore(() => ({
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { writes.push(key); values.set(key, value); },
    removeItem: (key) => { writes.push(key); values.delete(key); },
  }));
  return { store, values, writes };
}

describe("device-local bookmark view", () => {
  it("keeps original cards on phones and defaults desktop to grid without a stored write", () => {
    const { store, writes } = fixture();
    store.refresh();
    for (const width of [320, 390, 767.99, 768, 1600]) expect(resolveBookmarkView(store.getSnapshot(), width)).toBe("grid");
    expect(writes).toEqual([]);
  });
  it.each(["grid", "table"] as const)("preserves desktop %s across navigation while keeping phone cards", (choice) => {
    const { store, writes } = fixture(choice);
    store.refresh();
    for (const width of [320, 767]) expect(resolveBookmarkView(store.getSnapshot(), width)).toBe("grid");
    for (const width of [768, 1600]) expect(resolveBookmarkView(store.getSnapshot(), width)).toBe(choice);
    expect(writes).toEqual([]);
  });
  it.each(["list", "compact"])("migrates legacy %s to the table without changing phone cards", (choice) => {
    const { store } = fixture(choice);
    store.refresh();
    expect(resolveBookmarkView(store.getSnapshot(), 1280)).toBe("table");
    expect(resolveBookmarkView(store.getSnapshot(), 390)).toBe("grid");
  });
  it.each([null, "automatic", "GRID", "", '{"userId":"private"}', 1])("rejects invalid saved values: %s", (value) => {
    expect(parseBookmarkView(value)).toBeNull();
  });
  it("notifies all same-tab consumers and persists only the view token under the existing key", () => {
    const { store, values, writes } = fixture();
    const library: unknown[] = [], dashboard: unknown[] = [];
    const unsubscribe = store.subscribe(() => library.push(store.getSnapshot()));
    store.subscribe(() => dashboard.push(store.getSnapshot()));
    store.set("table");
    store.set("table");
    unsubscribe();
    store.set("grid");
    expect(library).toEqual(["table"]);
    expect(dashboard).toEqual(["table", "grid"]);
    expect([...values]).toEqual([[BOOKMARK_VIEW_KEY, "grid"]]);
    expect(writes.every((key) => key === BOOKMARK_VIEW_KEY)).toBe(true);
  });
  it("receives cross-tab changes, key removal and clear without echo writes", () => {
    const { store, writes } = fixture("grid");
    store.refresh();
    store.receiveStorage("unrelated", "list");
    expect(store.getSnapshot()).toBe("grid");
    store.receiveStorage(BOOKMARK_VIEW_KEY, "list");
    expect(store.getSnapshot()).toBe("table");
    store.receiveStorage(BOOKMARK_VIEW_KEY, null);
    expect(resolveBookmarkView(store.getSnapshot(), 390)).toBe("grid");
    store.receiveStorage(BOOKMARK_VIEW_KEY, "compact");
    store.receiveStorage(null, null);
    expect(resolveBookmarkView(store.getSnapshot(), 1440)).toBe("grid");
    expect(writes).toEqual([]);
  });
  it("reset removes the explicit choice and resumes automatic behavior", () => {
    const { store, values } = fixture("list");
    store.refresh();
    store.set(null);
    expect(values.has(BOOKMARK_VIEW_KEY)).toBe(false);
    expect(resolveBookmarkView(store.getSnapshot(), 390)).toBe("grid");
    expect(resolveBookmarkView(store.getSnapshot(), 1200)).toBe("grid");
  });
  it("works in memory when access to localStorage itself throws", () => {
    const store = createBookmarkViewStore(() => { throw new Error("SecurityError"); });
    expect(() => store.refresh()).not.toThrow();
    store.set("table");
    store.refresh();
    expect(resolveBookmarkView(store.getSnapshot(), 390)).toBe("grid");
    expect(resolveBookmarkView(store.getSnapshot(), 1200)).toBe("table");
    expect(() => store.set(null)).not.toThrow();
  });
  it("keeps changes in memory when storage reads, writes or removal fail", () => {
    const store = createBookmarkViewStore(() => ({
      getItem() { throw new Error("read blocked"); },
      setItem() { throw new Error("quota exceeded"); },
      removeItem() { throw new Error("blocked"); },
    }));
    store.set("grid");
    store.refresh();
    expect(store.getSnapshot()).toBe("grid");
    store.set(null);
    expect(store.getSnapshot()).toBeNull();
  });
});
