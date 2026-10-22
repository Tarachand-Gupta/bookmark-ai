import { describe, expect, it } from "vitest";
import type { OrganizationFolder } from "@bookmark-ai/types";
import { childFolders, folderAncestors, folderHref } from "./folder-browser";

const folder = (id: string, name: string, parentId: string | null = null): OrganizationFolder => ({ id, name, parentId, path: name, count: 0, directCount: 0, fieldVersions: {} });
const folders = [folder("leaf", "Design", "child"), folder("work", "Work"), folder("other", "Personal"), folder("child", "Research", "work"), folder("sibling", "Archive", "work")];

describe("folder browsing navigation", () => {
  it("links to direct contents while preserving the open AI panel", () => {
    const url = new URL(folderHref("work & research/日本語", true), "https://bookmark.test");
    expect(url.pathname).toBe("/app/library");
    expect(Object.fromEntries(url.searchParams)).toEqual({ folderId: "work & research/日本語", includeSubfolders: "false", ai: "1" });
    expect(folderHref()).toBe("/app/library");
    expect(folderHref(null, true)).toBe("/app/library?ai=1");
  });
  it("builds real ancestry by IDs independent of response order or slashes in names", () => {
    const input = [...folders, folder("slash", "Docs / Reference", "leaf")];
    expect(folderAncestors(input, "slash").map(f => f.id)).toEqual(["work", "child", "leaf", "slash"]);
    expect(folderAncestors(input, "missing")).toEqual([]);
  });
  it("shows only immediate children and leaves counts and the source response intact", () => {
    const input = folders.map(f => ({ ...f, count: 10, directCount: 2 }));
    const before = JSON.stringify(input);
    expect(childFolders(input, null).map(f => f.id)).toEqual(["other", "work"]);
    expect(childFolders(input, "work").map(f => f.id)).toEqual(["sibling", "child"]);
    expect(childFolders(input, "child").map(f => f.id)).toEqual(["leaf"]);
    expect(childFolders(input, "leaf")).toEqual([]);
    expect(JSON.stringify(input)).toBe(before);
  });
  it("bounds missing-parent and cyclic breadcrumbs without inventing ancestors", () => {
    expect(folderAncestors([folder("orphan", "Orphan", "gone")], "orphan").map(f => f.id)).toEqual(["orphan"]);
    const cyclic = [folder("a", "A", "b"), folder("b", "B", "a")];
    const result = folderAncestors(cyclic, "a").map(f => f.id);
    expect(result).toEqual(["b", "a"]);
    expect(new Set(result).size).toBe(result.length);
  });
});
