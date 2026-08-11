import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ListBookmarksQuery } from "@bookmark-ai/types";
import type { AnyMcpTool, McpToolContext } from "@/lib/server/mcp/tool-kit";

/**
 * The tool catalog's argument contract. These tests are deliberately about the
 * WIRE and the PASS-THROUGH, not about querying: the db module is mocked, so what
 * is asserted is "the JSON Schema a client sees matches the parser that runs, and
 * the parsed query reaching packages/db is the same shape GET /api/bookmarks
 * builds". Anything that needs a real DB lives in the smoke tests in
 * docs/features/mcp.md.
 */

const listBookmarks = vi.fn(async () => ({ bookmarks: [], total: 0 }));
const getMeta = vi.fn(async () => ({}));

vi.mock("@bookmark-ai/db", () => ({ listBookmarks, getMeta }));
// The engine is imported by sibling tools (search/save) that these tests never
// call; stubbing it keeps the module graph off the Gemini/network code.
vi.mock("@bookmark-ai/engine", () => ({
  embedPending: vi.fn(),
  enrichBookmark: vi.fn(),
  performSearch: vi.fn(),
  saveBookmarkFast: vi.fn(),
}));

const { enabledTools } = await import("@/lib/server/mcp/tools");

/** Context stub: `ready` resolves, `schedule` is never reached by list/overview. */
const ctx = {
  db: {} as McpToolContext["db"],
  gemini: null,
  ready: Promise.resolve(),
  schedule: () => {},
} satisfies McpToolContext;

function tool(name: string): AnyMcpTool {
  const found = enabledTools(null).find((t) => t.name === name);
  if (!found) throw new Error(`no such tool: ${name}`);
  return found;
}

/** The query `list_bookmarks` handed to db.listBookmarks on its last run. */
function lastQuery(): ListBookmarksQuery {
  const call = listBookmarks.mock.calls.at(-1) as unknown as [unknown, ListBookmarksQuery];
  if (!call) throw new Error("listBookmarks was not called");
  return call[1];
}

beforeEach(() => {
  listBookmarks.mockClear();
});

describe("list_bookmarks — from/to range", () => {
  it("advertises from and to in the tools/list input schema", () => {
    const props = tool("list_bookmarks").inputSchema.properties as Record<
      string,
      { type: string; description?: string }
    >;
    for (const key of ["from", "to"]) {
      expect(props[key]?.type).toBe("string");
      // The description has to state both accepted shapes, or a model guesses.
      expect(props[key]?.description).toMatch(/YYYY-MM-DD/);
      expect(props[key]?.description).toMatch(/ISO 8601/);
    }
    // Optional: neither end may be required.
    expect(tool("list_bookmarks").inputSchema.required).toBeUndefined();
  });

  it("mentions the range in its description so a client knows it exists", () => {
    expect(tool("list_bookmarks").description).toMatch(/'from'\/'to'|from.*to/);
    expect(tool("list_bookmarks").description).toMatch(/range/i);
  });

  it("passes a date-only range through to db.listBookmarks untouched", async () => {
    await tool("list_bookmarks").run(ctx, { from: "2026-08-01", to: "2026-08-11" });
    // Bounds stay verbatim — widening them into a half-open saved_at interval is
    // packages/db's job (date-bounds.ts), not the tool's.
    expect(lastQuery().from).toBe("2026-08-01");
    expect(lastQuery().to).toBe("2026-08-11");
  });

  it("accepts full ISO datetimes, with and without an offset", async () => {
    await tool("list_bookmarks").run(ctx, {
      from: "2026-08-11T15:00:00Z",
      to: "2026-08-11T21:30:00+05:30",
    });
    expect(lastQuery().from).toBe("2026-08-11T15:00:00Z");
    expect(lastQuery().to).toBe("2026-08-11T21:30:00+05:30");
  });

  it("accepts one end on its own", async () => {
    await tool("list_bookmarks").run(ctx, { from: "2026-08-01" });
    expect(lastQuery().from).toBe("2026-08-01");
    expect(lastQuery().to).toBeUndefined();

    await tool("list_bookmarks").run(ctx, { to: "2026-08-01" });
    expect(lastQuery().from).toBeUndefined();
    expect(lastQuery().to).toBe("2026-08-01");
  });

  it("keeps the other filters and paging defaults alongside a range", async () => {
    await tool("list_bookmarks").run(ctx, {
      category: "Development",
      tag: "rust",
      browser: "chrome",
      from: "2026-08-01",
    });
    expect(lastQuery()).toMatchObject({
      category: "Development",
      tag: "rust",
      browser: "chrome",
      from: "2026-08-01",
      limit: 20,
      offset: 0,
    });
  });

  it("rejects a malformed bound with a correctable message, and never queries", async () => {
    for (const bad of ["yesterday", "2026-8-1", "2026-08-11 15:00", ""]) {
      await expect(tool("list_bookmarks").run(ctx, { from: bad })).rejects.toThrow(
        /Invalid arguments for list_bookmarks/,
      );
    }
    expect(listBookmarks).not.toHaveBeenCalled();
  });

  it("rejects a bound that is not a string", async () => {
    await expect(tool("list_bookmarks").run(ctx, { to: 20260811 })).rejects.toThrow(
      /Invalid arguments for list_bookmarks/,
    );
  });

  it("still works with no arguments at all", async () => {
    await tool("list_bookmarks").run(ctx, {});
    expect(lastQuery()).toMatchObject({ limit: 20, offset: 0 });
    expect(lastQuery().from).toBeUndefined();
  });
});

describe("get_library_overview", () => {
  it("tells the caller its facets do not gate the from/to range", () => {
    expect(tool("get_library_overview").description).toMatch(/'from'\/'to'/);
  });
});
