# @bookmark-ai/engine — the shared pipeline

The product's brain: scrape → categorize → embed → search. Two HTTP adapters sit on top
of it — the Express server (`apps/server`, local-only) and the Next.js route handlers
(`apps/web/app/api/*`, deployed) — and neither re-implements any of this logic; they just
call straight into this package. The `/api/chat` agent's tools call it directly too
(no HTTP hop, no per-tool-call token fetching).

## Modules (`src/`)

| Path | What |
| --- | --- |
| `og.ts` | `scrapeOpenGraph` — dependency-free regex-over-meta-tags OG scraper |
| `categorize.ts` | `categorize` (Gemini `gemini-2.5-flash`) + `heuristicCategorize` fallback; `CATEGORIES` is the closed vocabulary the sidebar and Gemini's schema both use |
| `gemini.ts` | `GeminiClient` — thin REST client: JSON generation (`gemini-2.5-flash`) + embeddings (`gemini-embedding-001`, 768-dim) |
| `embeddings.ts` | `bookmarkToEmbeddingText`, `embedQuery`, `embedBookmark`; `embedPending` (one-shot sweep) and `startEmbedWorker` (interval worker, used by Express) |
| `ingest.ts` | `saveBookmarkFast` (instant upsert-by-URL save) + `enrichBookmark` (post-save OG scrape + categorize) |
| `search.ts` | `performSearch` — `text` / `ai` / `hybrid` modes, plus matching saved sessions |
| `sessions.ts` | `saveSession` |

`src/index.ts` re-exports the public surface — both adapters import from
`@bookmark-ai/engine`, never from a module path directly.

## Save flow

`saveBookmarkFast` writes the row (upserting by URL, OG fields empty, no category yet) so
the caller's `POST` returns instantly. `enrichBookmark` runs after: it scrapes OG data and
categorizes. Embedding is deliberately a separate step (below), so a save is never
blocked on Gemini twice over.

## Embedding: two callers, one function

`embedBookmark` does the real work — build the embedding text with
`bookmarkToEmbeddingText`, call Gemini, write the vector column. Two things drive it,
one per adapter:

- **`embedPending`** — a one-shot sweep of everything with a null embedding (bounded
  batch). The deployed API calls this from a Next `after()` right after each save, plus a
  daily Vercel Cron hitting `GET /api/cron/embed` catches anything that fell through.
- **`startEmbedWorker`** — an interval worker (kicked after each save, plus a 30 s sweep)
  that the Express server starts on boot, since it has no `after()`/cron equivalent.

Both paths converge on the same `embedPending` sweep under the hood, so a bookmark saved
through either adapter gets embedded the same way.

## Search: `performSearch`

Three modes, degrading gracefully to `text` with `fallback: true` when Gemini/embeddings
are unavailable:

- `text` — SQLite FTS5, `bm25` ranking
- `ai` — cosine similarity over the vector column (`vector_distance_cos`)
- `hybrid` — both lists blended with Reciprocal Rank Fusion (keyword hits and
  meaning-level matches compete on rank; what both lists agree on rises to the top) —
  what the web grid, mobile app, and the `/api/chat` tools all use

It also returns matching saved **sessions** (name/tab text), not just bookmarks.

## Sharp edges

1. No `.js` extensions in relative imports — extensionless only (see root `CLAUDE.md`
   gotcha #1; Next's webpack can't resolve `./foo.js` → `foo.tsx`).
2. This package only depends on [`packages/db`](../db/README.md) and Gemini — no HTTP
   framework. That's what lets Express and Next.js both sit on top of it as thin
   adapters instead of forking the logic.
