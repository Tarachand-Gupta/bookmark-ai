import { describe, expect, it } from "vitest";
import { bookmarkChangesSchema, type Bookmark } from "@bookmark-ai/types";
import { changedBookmarkFields, expectedBookmarkVersions } from "./organization-ui";

const bookmark = (count = 2): Bookmark => ({
  id: "saved-article",
  url: "https://example.com/article",
  domain: "example.com",
  og: {},
  source: { browser: "chrome", device: "desktop", savedAt: "2026-10-16T00:00:00Z" },
  category: "Research",
  createdAt: "2026-10-16T00:00:00Z",
  embedded: false,
  title: "A saved article",
  categoryId: "category-a",
  tags: Array.from({ length: count }, (_, index) => `tag-${index}`),
  fieldVersions: { title: "2", categoryId: "4", tags: "5" },
});
const draft = (saved: Bookmark) => ({
  title: saved.title, categoryId: saved.categoryId ?? null,
  tags: saved.tags,
});

describe("bookmark editor field preservation", () => {
  it("preserves category and tags on a title edit", () => {
    const saved = bookmark();
    expect(changedBookmarkFields(saved, { ...draft(saved), title: "Edited title" })).toEqual({ title: "Edited title" });
  });
  it("preserves all legacy tags above ten during organization edits", () => {
    const saved = bookmark(15);
    const changes = changedBookmarkFields(saved, { ...draft(saved), categoryId: null });
    expect(changes).toEqual({ categoryId: null });
    expect(bookmarkChangesSchema.safeParse(changes).success).toBe(true);
    expect(saved.tags).toHaveLength(15);
  });
  it("allows removing legacy tags without silently truncating the remainder", () => {
    const saved = bookmark(15);
    const remaining = saved.tags.slice(1);
    const changes = changedBookmarkFields(saved, { ...draft(saved), tags: remaining });
    expect(changes).toEqual({ tags: remaining });
    expect(bookmarkChangesSchema.safeParse(changes).success).toBe(true);
    expect(remaining).toHaveLength(14);
  });
  it("uses the original per-field versions and treats an unchanged editor as clean", () => {
    const saved = bookmark();
    expect(changedBookmarkFields(saved, draft(saved))).toBeNull();
    expect(expectedBookmarkVersions(saved)).toEqual(saved.fieldVersions);
  });
});
