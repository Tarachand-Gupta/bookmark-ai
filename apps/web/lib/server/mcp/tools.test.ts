import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_SEARCH_DEPTH, type ListBookmarksQuery } from "@bookmark-ai/types";
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
/** What the engine hands back for a page; the tool only reshapes it. The engine
 * is the authority on which page was served, so the stub echoes the offset it
 * was asked for rather than a constant. */
const performSearch = vi.fn(
  async (_db: unknown, _gemini: unknown, params: { offset?: number }) => ({
    mode: "hybrid" as const,
    results: [],
    offset: params.offset ?? 0,
    hasMore: true,
  }),
);
// The engine is stubbed so the module graph stays off the Gemini/network code —
// these tests are about the tool's argument contract, not about retrieval.
vi.mock("@bookmark-ai/engine", () => ({
  embedBookmarkById: vi.fn(),
  embedPending: vi.fn(),
  enrichBookmark: vi.fn(),
  performSearch,
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

/** The SearchParams `search_bookmarks` handed to the engine on its last run. */
function lastSearch(): { q: string; mode: string; limit: number; offset?: number } {
  const call = performSearch.mock.calls.at(-1) as unknown as [
    unknown,
    unknown,
    { q: string; mode: string; limit: number; offset?: number },
  ];
  if (!call) throw new Error("performSearch was not called");
  return call[2];
}

beforeEach(() => {
  listBookmarks.mockClear();
  performSearch.mockClear();
});

describe("search_bookmarks — paging", () => {
  it("advertises offset in the tools/list input schema, with the depth cap", () => {
    const props = tool("search_bookmarks").inputSchema.properties as Record<
      string,
      { type: string; minimum?: number; maximum?: number; default?: number; description?: string }
    >;
    expect(props.offset).toMatchObject({ type: "integer", minimum: 0, default: 0 });
    // The cap has to be discoverable from the schema, not only from a 400.
    expect(props.offset?.maximum).toBe(MAX_SEARCH_DEPTH - 1);
    expect(props.offset?.description).toMatch(String(MAX_SEARCH_DEPTH));
    // Still the only required argument — paging must not become mandatory.
    expect(tool("search_bookmarks").inputSchema.required).toEqual(["query"]);
  });

  it("tells the model how to page in its description", () => {
    const description = tool("search_bookmarks").description;
    expect(description).toMatch(/hasMore/);
    expect(description).toMatch(/offset/);
    expect(description).toMatch(new RegExp(String(MAX_SEARCH_DEPTH)));
  });

  it("passes offset through to the engine and echoes the page back", async () => {
    const out = (await tool("search_bookmarks").run(ctx, {
      query: "rust async",
      mode: "semantic",
      limit: 5,
      offset: 10,
    })) as { offset: number; limit: number; hasMore: boolean };
    // "semantic" is the tool's word for the engine's "ai" mode.
    expect(lastSearch()).toMatchObject({ q: "rust async", mode: "ai", limit: 5, offset: 10 });
    expect(out).toMatchObject({ offset: 10, limit: 5, hasMore: true });
  });

  it("defaults to the first page and still asks the engine for paging fields", async () => {
    const out = (await tool("search_bookmarks").run(ctx, { query: "rust" })) as {
      offset: number;
      hasMore: boolean;
    };
    // offset 0 is passed EXPLICITLY: that is what opts the engine into returning
    // hasMore, which an agent needs to know a second page exists at all.
    expect(lastSearch()).toMatchObject({ mode: "hybrid", limit: 10, offset: 0 });
    expect(out.offset).toBe(0);
    expect(out.hasMore).toBe(true);
  });

  it("rejects a negative, fractional, or non-numeric offset, and never searches", async () => {
    for (const bad of [-1, -20, 1.5, "10", null]) {
      await expect(
        tool("search_bookmarks").run(ctx, { query: "rust", offset: bad }),
      ).rejects.toThrow(/Invalid arguments for search_bookmarks/);
    }
    expect(performSearch).not.toHaveBeenCalled();
  });

  it("rejects a page deeper than the retrieval cap", async () => {
    await expect(
      tool("search_bookmarks").run(ctx, { query: "rust", limit: 40, offset: 170 }),
    ).rejects.toThrow(/Invalid arguments for search_bookmarks/);
    // The last page the cap allows at limit 40 is still accepted.
    await tool("search_bookmarks").run(ctx, { query: "rust", limit: 40, offset: 160 });
    expect(lastSearch()).toMatchObject({ limit: 40, offset: 160 });
  });
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
