import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";
import { listSessions } from "@bookmark-ai/db";
import { performSearch } from "@bookmark-ai/engine";
import { getApiContext } from "@/lib/server/context";
import { requireUser } from "@/lib/server/require-user";

export const maxDuration = 60;

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

/** Newest-first saved sessions, optionally filtered by substring. */
async function runListSessions(query: string | undefined, limit: number) {
  const { db, ready } = getApiContext();
  await ready;
  const sessions = await listSessions(db);
  const q = query?.trim().toLowerCase();
  const filtered = q
    ? sessions.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.tabs.some(
            (t) => (t.title ?? "").toLowerCase().includes(q) || t.url.toLowerCase().includes(q),
          ),
      )
    : sessions;
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

/** Both tools call the shared search engine directly — the agent and the UI
 * share one search stack without an HTTP hop. */
async function runSearch(query: string, mode: "text" | "ai", limit: number) {
  const { db, gemini, ready } = getApiContext();
  await ready;
  const data = await performSearch(db, gemini, { q: query, mode, limit });
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
  const denied = await requireUser();
  if (denied) return denied;
  if (!process.env.GEMINI_API_KEY) {
    return Response.json(
      { error: "GEMINI_API_KEY is not configured — AI chat is unavailable." },
      { status: 503 },
    );
  }
  const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
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
        execute: ({ query, limit }) => runSearch(query, "text", limit),
      }),
      searchSemantic: tool({
        description:
          "Semantic vector (RAG) search over the user's saved bookmarks. Best for natural-language questions and concepts.",
        inputSchema: searchInput,
        execute: ({ query, limit }) => runSearch(query, "ai", limit),
      }),
      listSessions: tool({
        description:
          "List the user's saved browser sessions (named snapshots of open tabs), newest first, optionally filtered by text. Use for any question about saved sessions.",
        inputSchema: listSessionsInput,
        execute: ({ query, limit }) => runListSessions(query, limit),
      }),
    },
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
