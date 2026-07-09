import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";

export const maxDuration = 60;

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

const searchInput = z.object({
  query: z.string().min(1).describe("The search query to run against the bookmark library"),
  limit: z.number().int().min(1).max(20).default(8),
});

/** Both tools proxy the Express API so the agent and the UI share one search stack. */
async function runSearch(query: string, mode: "text" | "ai", limit: number) {
  const params = new URLSearchParams({ q: query, mode, limit: String(limit) });
  const res = await fetch(`${API_URL}/api/search?${params}`);
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
      "Cite the bookmarks you used as markdown links [title](url). If nothing relevant exists, say so plainly.",
      "Keep answers short and concrete; the UI already shows the matched bookmarks under your tool calls.",
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
    },
    stopWhen: stepCountIs(5),
  });

  return result.toUIMessageStreamResponse();
}
