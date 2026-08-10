import { z } from "zod";
import { getMeta, listBookmarks } from "@bookmark-ai/db";
import {
  createBookmarkSchema,
  listBookmarksQuerySchema,
  MCP_TOOL_NAMES,
  type Bookmark,
  type McpToolName,
} from "@bookmark-ai/types";
import {
  embedPending,
  enrichBookmark,
  performSearch,
  saveBookmarkFast,
} from "@bookmark-ai/engine";
import { defineTool, type AnyMcpTool, type McpTool } from "./tool-kit";

/**
 * The MCP tool catalog. Each tool is a THIN adapter over packages/engine and
 * packages/db — exactly what the equivalent REST route does, so an agent and the
 * web UI can never drift apart in behavior.
 *
 * Descriptions are written FOR an LLM caller (what it does, when to reach for it,
 * what it returns), because they are the only documentation the model gets. Input
 * schemas are declared twice on purpose: `inputSchema` is the JSON Schema handed
 * to the client in `tools/list`, and `args` is the Zod parser that actually
 * validates the call — hand-written JSON Schema keeps the wire contract readable
 * and stable without pulling in a zod→JSON-Schema converter.
 */

// ── search_bookmarks ──

const searchArgs = z.object({
  query: z.string().min(1),
  mode: z.enum(["text", "semantic", "hybrid"]).default("hybrid"),
  limit: z.number().int().min(1).max(40).default(10),
});

/** The compact bookmark shape every tool returns. Never includes embeddings or
 * the raw Open Graph blob — an agent pays for every token it reads. */
function summarize(b: Bookmark) {
  return {
    id: b.id,
    url: b.url,
    title: b.title,
    description: b.description ?? null,
    category: b.category,
    tags: b.tags,
    savedAt: b.source.savedAt,
  };
}

const searchBookmarks: McpTool<z.infer<typeof searchArgs>> = {
  name: "search_bookmarks",
  description:
    "Search the user's saved bookmarks and return the best matches. Use this whenever the user refers to something they saved, bookmarked, or read before, or when you need a link they already have. 'hybrid' (default) blends keyword and meaning-based matching and is almost always the right choice; 'text' matches exact words, domains, and phrases; 'semantic' matches by meaning when the user's wording differs from the page's. Returns id, url, title, description, category, tags, savedAt, and a relevance score.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "What to look for in the user's saved bookmarks." },
      mode: {
        type: "string",
        enum: ["text", "semantic", "hybrid"],
        default: "hybrid",
        description: "Retrieval strategy. Default 'hybrid' unless you specifically want one.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 40,
        default: 10,
        description: "Maximum results to return.",
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  args: searchArgs,
  execute: async (ctx, { query, mode, limit }) => {
    await ctx.ready;
    // The engine speaks "ai" for the vector path; the tool exposes "semantic".
    const engineMode = mode === "semantic" ? "ai" : mode;
    const data = await performSearch(ctx.db, ctx.gemini, { q: query, mode: engineMode, limit });
    return {
      mode: data.mode,
      // Surfaced so the agent knows a semantic request silently degraded to
      // keyword matching (no embeddings available) rather than found nothing.
      fallback: data.fallback ?? false,
      results: data.results.map(({ bookmark, score }) => ({
        ...summarize(bookmark),
        score: Math.round(score * 1000) / 1000,
      })),
    };
  },
};

// ── save_bookmark ──

const saveArgs = z.object({
  url: z.string().url().refine((v) => /^https?:\/\//i.test(v), "URL must be http(s)"),
  title: z.string().max(500).optional(),
});

const saveBookmark: McpTool<z.infer<typeof saveArgs>> = {
  name: "save_bookmark",
  description:
    "Save a URL to the user's library. Use it when the user asks to bookmark, save, or keep a link for later. The page's title, description, category, and tags are filled in automatically by scraping and AI shortly after saving, so pass only the URL (and a title if you already know it). Saving a URL that already exists updates it instead of creating a duplicate. Returns the saved bookmark.",
  inputSchema: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Absolute http(s) URL to save.",
      },
      title: {
        type: "string",
        description: "Optional page title. Omit it and the server scrapes one.",
      },
    },
    required: ["url"],
    additionalProperties: false,
  },
  args: saveArgs,
  execute: async (ctx, { url, title }) => {
    await ctx.ready;
    // Same contract POST /api/bookmarks applies (browser/device default "other"
    // for a non-browser client), validated through the SAME schema so the MCP
    // path can't accept anything the REST path would reject.
    const input = createBookmarkSchema.parse({ url, title: title ?? null });
    const bookmark = await saveBookmarkFast(ctx.db, input);
    // Instant save; OG scrape + AI categorization + embedding run after the
    // response, exactly as the REST route does it.
    ctx.schedule(async () => {
      try {
        await enrichBookmark(ctx.db, ctx.gemini, bookmark.id, input);
      } catch (err) {
        console.warn(
          `[mcp] enrich ${bookmark.url}: ${(err as Error).message} — keeping instant-save data`,
        );
      }
      if (ctx.gemini) {
        await embedPending(ctx.gemini, ctx.db, 5).catch((err: unknown) => {
          console.warn(`[mcp] post-save embed sweep failed: ${(err as Error).message}`);
        });
      }
    });
    return { bookmark: summarize(bookmark) };
  },
};

// ── list_bookmarks ──

const listArgs = z.object({
  category: z.string().max(100).optional(),
  tag: z.string().max(60).optional(),
  browser: z.enum(["chrome", "firefox", "safari", "edge", "arc", "other"]).optional(),
  device: z.enum(["desktop", "laptop", "mobile", "tablet", "other"]).optional(),
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0),
});

const listBookmarksTool: McpTool<z.infer<typeof listArgs>> = {
  name: "list_bookmarks",
  description:
    "Browse the user's bookmarks newest-first, optionally filtered by category, tag, browser, device, or the day they were saved. Use this for 'what did I save yesterday', 'show me everything tagged X', or paging through a category — NOT for topical lookup (use search_bookmarks for that). Call get_library_overview first to learn which categories, tags, and days actually exist. Returns the bookmarks plus the total number of matches, for paging via offset.",
  inputSchema: {
    type: "object",
    properties: {
      category: { type: "string", description: "Exact category name, e.g. 'Development'." },
      tag: { type: "string", description: "Exact tag (tags are stored lowercased)." },
      browser: {
        type: "string",
        enum: ["chrome", "firefox", "safari", "edge", "arc", "other"],
        description: "Only bookmarks saved from this browser.",
      },
      device: {
        type: "string",
        enum: ["desktop", "laptop", "mobile", "tablet", "other"],
        description: "Only bookmarks saved from this kind of device.",
      },
      day: { type: "string", description: "A single saved day, YYYY-MM-DD (UTC)." },
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
      offset: { type: "integer", minimum: 0, default: 0, description: "Skip this many results." },
    },
    additionalProperties: false,
  },
  args: listArgs,
  execute: async (ctx, args) => {
    await ctx.ready;
    // Reuse the REST query schema so filters/caps stay identical to GET /api/bookmarks.
    const query = listBookmarksQuerySchema.parse(args);
    const { bookmarks, total } = await listBookmarks(ctx.db, query);
    return { bookmarks: bookmarks.map(summarize), total };
  },
};

// ── get_library_overview ──

const overviewArgs = z.object({}).strict();

const getLibraryOverview: McpTool<z.infer<typeof overviewArgs>> = {
  name: "get_library_overview",
  description:
    "Get the shape of the user's library: every category, tag, browser, device, and saved day with counts, plus the total number of bookmarks. Call this FIRST when you need to know what filter values are valid before calling list_bookmarks, or to answer questions about how much the user has saved and where it came from. Takes no arguments.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  args: overviewArgs,
  execute: async (ctx) => {
    await ctx.ready;
    return getMeta(ctx.db);
  },
};

/** Every tool, keyed by name. Iteration order follows MCP_TOOL_NAMES so
 * `tools/list` is stable for clients that cache it. */
const TOOLS: Record<McpToolName, AnyMcpTool> = {
  search_bookmarks: defineTool(searchBookmarks),
  save_bookmark: defineTool(saveBookmark),
  list_bookmarks: defineTool(listBookmarksTool),
  get_library_overview: defineTool(getLibraryOverview),
};

/**
 * The tools this user exposes. `enabled` is their allowlist (null = every tool,
 * the default for an account that never touched the setting); unknown names in a
 * stored allowlist are ignored rather than trusted.
 */
export function enabledTools(enabled: readonly string[] | null): AnyMcpTool[] {
  return MCP_TOOL_NAMES.filter((name) => enabled === null || enabled.includes(name)).map(
    (name) => TOOLS[name],
  );
}
