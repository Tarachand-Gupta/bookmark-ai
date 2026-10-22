import { describe, expect, it } from "vitest";
import { bookmarkChangesSchema, type Bookmark, type ReadingState } from "@bookmark-ai/types";
import { changedBookmarkFields, expectedBookmarkVersions } from "./organization-ui";

const bookmark = (readingState: ReadingState, count = 2): Bookmark => ({
  id: "saved-article",
  url: "https://example.com/article",
  domain: "example.com",
  og: {},
  source: { browser: "chrome", device: "desktop", savedAt: "2026-10-16T00:00:00Z" },
  category: "Research",
  createdAt: "2026-10-16T00:00:00Z",
  embedded: false,
  title: "A saved article",
  folderId: "folder-a",
  categoryId: "topic-a",
  tags: Array.from({ length: count }, (_, index) => `tag-${index}`),
  readingState,
  fieldVersions: { title: "2", folderId: "3", categoryId: "4", tags: "5", readingState: "6" },
});
const draft = (saved: Bookmark) => ({
  title: saved.title, folderId: saved.folderId ?? null, categoryId: saved.categoryId ?? null,
  tags: saved.tags, readingState: saved.readingState ?? "not_on_list",
});

describe("bookmark editor field preservation", () => {
  it.each(["read", "unread", "not_on_list"] as const)("keeps %s reading status on a title edit", state => {
    const saved = bookmark(state);
    expect(changedBookmarkFields(saved, { ...draft(saved), title: "Edited title" })).toEqual({ title: "Edited title" });
  });
  it("only removes reading-list membership when explicitly changed", () => {
    const saved = bookmark("read");
    expect(changedBookmarkFields(saved, { ...draft(saved), readingState: "not_on_list" })).toEqual({ readingState: "not_on_list" });
    expect(changedBookmarkFields(saved, { ...draft(saved), readingState: "unread" })).toEqual({ readingState: "unread" });
  });
  it("preserves all legacy tags above ten during organization edits", () => {
    const saved = bookmark("read", 15);
    const changes = changedBookmarkFields(saved, { ...draft(saved), folderId: "folder-b", categoryId: null });
    expect(changes).toEqual({ folderId: "folder-b", categoryId: null });
    expect(bookmarkChangesSchema.safeParse(changes).success).toBe(true);
    expect(saved.tags).toHaveLength(15);
  });
  it("allows removing legacy tags without silently truncating the remainder", () => {
    const saved = bookmark("unread", 15);
    const remaining = saved.tags.slice(1);
    const changes = changedBookmarkFields(saved, { ...draft(saved), tags: remaining });
    expect(changes).toEqual({ tags: remaining });
    expect(bookmarkChangesSchema.safeParse(changes).success).toBe(true);
    expect(remaining).toHaveLength(14);
  });
  it("uses the original per-field versions and treats an unchanged editor as clean", () => {
    const saved = bookmark("read");
    expect(changedBookmarkFields(saved, draft(saved))).toBeNull();
    expect(expectedBookmarkVersions(saved)).toEqual(saved.fieldVersions);
  });
});
