import { describe, expect, it, vi } from "vitest";
import type { Bookmark } from "@bookmark-ai/types";
import { resolveSelectedBookmarks } from "./organization-export";
const bookmark = (id: string) => ({ id, title: id } as Bookmark);
describe("selected bookmark export", () => {
  it("includes search hits and unloaded frozen IDs in selection order", async () => {
    const load = vi.fn(async id => bookmark(id));
    const rows = await resolveSelectedBookmarks(["off-page", "search-hit", "off-page"], [bookmark("search-hit"), bookmark("unselected")], load);
    expect(rows.map(row => row.id)).toEqual(["off-page", "search-hit"]);
    expect(load).toHaveBeenCalledExactlyOnceWith("off-page");
  });
  it("does not return a partial export when a selected row cannot be fetched", async () => {
    await expect(resolveSelectedBookmarks(["loaded", "removed"], [bookmark("loaded")], async () => { throw new Error("No longer available"); })).rejects.toThrow("No longer available");
  });
});
