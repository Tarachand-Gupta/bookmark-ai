import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { auth } from "@clerk/nextjs/server";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";

export const maxDuration = 60;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4545";

/** The user's Clerk session JWT for the Express API. Fetched per tool call —
 * session tokens expire after 60s and a chat stream can outlive that. */
type TokenGetter = () => Promise<string | null>;

async function apiHeaders(getToken: TokenGetter): Promise<Record<string, string>> {
  const token = await getToken().catch(() => null);
  return token ? { authorization: `Bearer ${token}` } : {};
}

const searchInput = z.object({
  query: z.string().min(1).describe("The search query to run against the bookmark library"),
  limit: z.number().int().min(1).max(20).default(8),
});

const listSessionsInput = z.object({
  query: z
    .string()
    .optional()
    .describe("Optional text filter — matches session names and tab titles/URLs"),
  limit: z.number().int().min(1).max(50).default(20),
});

interface ApiSession {
  id: string;
  name: string;
  tabCount: number;
  browser: string;
  device: string;
  savedAt: string;
  tabs: { url: string; title: string }[];
}

/** Newest-first saved sessions, optionally filtered by substring. */
async function runListSessions(getToken: TokenGetter, query: string | undefined, limit: number) {
  const res = await fetch(`${API_URL}/api/sessions`, { headers: await apiHeaders(getToken) });
  if (!res.ok) throw new Error(`Session list failed (${res.status})`);
  const data = (await res.json()) as { sessions: ApiSession[] };
  const q = query?.trim().toLowerCase();
  const filtered = q
    ? data.sessions.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.tabs.some(
            (t) => (t.title ?? "").toLowerCase().includes(q) || t.url.toLowerCase().includes(q),
          ),
      )
    : data.sessions;
  return {
    total: filtered.length,
    sessions: filtered.slice(0, limit).map((s) => ({
      id: s.id,
      name: s.name,
      tabCount: s.tabCount,
      browser: s.browser,
      savedAt: s.savedAt,
      tabs: s.tabs.slice(0, 15).map((t) => ({ title: t.title, url: t.url })),
    })),
  };
}

/** Both tools proxy the Express API so the agent and the UI share one search stack. */
async function runSearch(getToken: TokenGetter, query: string, mode: "text" | "ai", limit: number) {
  const params = new URLSearchParams({ q: query, mode, limit: String(limit) });
  const res = await fetch(`${API_URL}/api/search?${params}`, {
    headers: await apiHeaders(getToken),
  });
  if (!res.ok) throw new Error(`Bookmark search failed (${res.status})`);
  const data = (await res.json()) as {
    mode: string;
    fallback?: boolean;
    results: {
      score: number;
      bookmark: {
        id: string;
        title: string;
        url: string;
        domain: string;
        description: string | null;
        category: string;
        tags: string[];
        og: { favicon?: string | null };
      };
    }[];
    sessionResults?: {
      score: number;
      session: {
        id: string;
        name: string;
        tabCount: number;
        savedAt: string;
        tabs: { url: string; title: string }[];
      };
    }[];
  };
  return {
    modeUsed: data.mode,
    fallback: data.fallback ?? false,
    results: data.results.map(({ score, bookmark: b }) => ({
      id: b.id,
      title: b.title,
      url: b.url,
      domain: b.domain,
      description: b.description,
      category: b.category,
      tags: b.tags,
      favicon: b.og?.favicon ?? null,
      score: Math.round(score * 1000) / 1000,
    })),
    // Saved browser sessions whose name or tab text matched the query.
    sessions: (data.sessionResults ?? []).map(({ session: s }) => ({
      id: s.id,
      name: s.name,
      tabCount: s.tabCount,
      savedAt: s.savedAt,
      tabs: s.tabs.slice(0, 10).map((t) => ({ title: t.title, url: t.url })),
    })),
  };
}

export async function POST(req: Request) {
  if (!process.env.GEMINI_API_KEY) {
    return Response.json(
      { error: "GEMINI_API_KEY is not configured — AI chat is unavailable." },
      { status: 503 },
    );
  }
  const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
  // Tool calls hit the Express API as the signed-in user (middleware already
  // guarantees a session on this route).
  const { getToken } = await auth();
  // The client transport pins the body to { messages }, but accept the
  // last-message-only shape too so default transports keep working.
  const body = (await req.json()) as { messages?: UIMessage[]; message?: UIMessage };
  const messages: UIMessage[] = Array.isArray(body.messages)
    ? body.messages
    : body.message
      ? [body.message]
      : [];

  const result = streamText({
    model: google("gemini-2.5-flash"),
    system: [
      "You are Bookmark AI, the librarian for the user's personal bookmark collection.",
      "Always ground answers in the library: call a search tool before answering anything about bookmarks.",
      "Use searchSemantic for questions, concepts, and fuzzy intent; use searchFullText for exact words, names, or domains. Call both when unsure.",
      "Search results can also include the user's saved browser sessions (named snapshots of open tabs) under `sessions` — when one matches the question, mention it by name and what it contains.",
      "For any question about saved sessions themselves (listing them, what was in one, when tabs were saved), call listSessions — with a text filter when the user narrows it down.",
      "The UI already renders every search result as a rich card, so NEVER repeat the result list.",
      "Answer in 1-3 sentences that synthesize the results: name the best pick(s) inline as markdown links [title](url) and say why they fit. Bare, unlinked titles are forbidden.",
      "If nothing relevant exists, say so plainly and suggest a different phrasing.",
    ].join("\n"),
    messages: await convertToModelMessages(messages),
    tools: {
      searchFullText: tool({
        description:
          "Keyword/full-text (BM25) search over the user's saved bookmarks. Best for exact words, product names, or domains.",
        inputSchema: searchInput,
        execute: ({ query, limit }) => runSearch(getToken, query, "text", limit),
      }),
      searchSemantic: tool({
        description:
          "Semantic vector (RAG) search over the user's saved bookmarks. Best for natural-language questions and concepts.",
        inputSchema: searchInput,
        execute: ({ query, limit }) => runSearch(getToken, query, "ai", limit),
      }),
      listSessions: tool({
        description:
          "List the user's saved browser sessions (named snapshots of open tabs), newest first, optionally filtered by text. Use for any question about saved sessions.",
        inputSchema: listSessionsInput,
        execute: ({ query, limit }) => runListSessions(getToken, query, limit),
      }),
    },
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
