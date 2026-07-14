# Architecture & Decisions

## Data flow

```
 Chrome/Firefox/Safari         Web app            Desktop (Zig)
 extension popup               Add dialog         refresh/boot
        │                         │                    │
        │                         │  (same origin)     │  (local only)
        └── POST bookmark-ai.cloud/api/bookmarks ──┐    └── POST 127.0.0.1:4545/api/bookmarks
                                                    ▼                          │
                                    apps/web/app/api/*  (Next.js, deployed)    ▼
                                                    │              apps/server (Express, local-only)
                                                    └──────────┬───────────────┘
                                                                ▼
                                              packages/engine (shared pipeline)
                                     1. scrapeOpenGraph(url)         (og.ts)
                                     2. categorize(page)             (categorize.ts)
                                     3. saveBookmarkFast (upsert by URL, ingest.ts)
                                     4. embed — after()+cron (deployed) or
                                        startEmbedWorker (local)      (embeddings.ts)
                                                                │
                                                    libSQL DB (Turso in production)
                                          bookmarks table · FTS5 (trigger-synced)
                                          · embedding F32_BLOB(768)
```

Reads: `GET /api/bookmarks` (facet filters), `/api/search` (`text` → FTS5 bm25;
`ai` → embed query → `vector_distance_cos` ORDER BY; `hybrid` → RRF of both), `/api/meta`
(sidebar facets) — all via `packages/engine`'s `performSearch`, on both adapters.

## Key decisions (user-confirmed)

1. **Server-side search for v1.** All search runs in the API against one libSQL file.
   The originally-envisioned client-side vector DB with sync is DEFERRED (next step:
   libSQL embedded replicas / sync to push data into clients).
2. **Gemini** (`gemini-2.5-flash` categorize, `gemini-embedding-001` embed at
   `outputDimensionality:768`, re-normalized in `packages/engine/src/gemini.ts` since
   Gemini only pre-normalizes 3072-dim). "GNI embedding" in the original brief = Gemini.
   Provider is swappable: only `packages/engine/src/gemini.ts` + `EMBEDDING_DIM` in
   `packages/db/src/schema.ts` care (changing dims requires re-embedding + column DDL).
3. **Graceful degradation everywhere**: no API key → heuristic categorization
   (domain/keyword rules) + text-only search with `fallback: true`; OG scrape failure →
   bookmark still saves; Gemini failure during search → text fallback; embed failures
   self-heal via the local server's 30 s sweep or the deployed API's daily cron.
4. **Saves are fast**: embedding is async — the local Express server kicks a worker after
   each save; the deployed Next.js API fires an `after()` instead — so POST latency ≈
   OG fetch + categorize only either way.
5. **Upsert by URL**: re-saving updates metadata/provenance and nulls the embedding for
   re-embed. Intentional — no duplicate cards.
6. **One contract**: every client builds `CreateBookmarkInput` from `packages/types` and
   detects its own provenance (extension `lib/detect.ts` uses WXT's `import.meta.env.BROWSER`
   build constant + UA; web `lib/detect.ts` uses UA; desktop is a consumer only for now).
7. **Branding**: `packages/ui/src/theme.css` (shadcn neutral, oklch) is the single token
   source for web; the extension mirrors the same token block in `assets/tailwind.css`
   (kept duplicated deliberately to avoid a build-order coupling — sync manually when
   retheming). Desktop uses the native SDK's stock tokens which follow OS light/dark.
   User plans to retheme later — do it in theme.css first.
8. **Category vocabulary is closed** (`CATEGORIES` in `packages/engine/src/categorize.ts`)
   so the sidebar stays tidy; Gemini is schema-constrained to it. Extend the list there.
9. **Tags converge on a shared vocabulary**: at save time the AI tagger receives the
   existing tags with usage counts (`listTagCounts`) and is instructed to reuse them
   before inventing new ones; a tag that merely repeats the category is always dropped.
   The homepage tag rail (`/api/meta` `tags`) and `?tag=` filtering ride on the same data.

## Shipped from the original roadmap (2026-07-09)

- **AI search chat**: `apps/web/app/api/chat/route.ts` (AI SDK v7 + Gemini) with
  `searchFullText`/`searchSemantic` tools; UI in `components/library/ai-chat.tsx` on
  AI Elements (`components/ai-elements/`, `response.tsx` is a local Streamdown wrapper —
  the registry retired that component; it disables Streamdown's link-safety modal so
  citations are real anchors). "Ask AI" in the header opens it seeded with the current
  query. Tool calls render as a status strip + always-visible bookmark cards with
  actions (open, copy link, category/tag chips that jump to the filtered library);
  closing the chat clears the query so the user lands back on the library.
- **Turso cloud**: production `DATABASE_URL` is `libsql://` + `DATABASE_AUTH_TOKEN`;
  data migrated with embeddings intact (sqlite3 `.mode insert` dump → `turso db shell`).
- **Browser-bookmark import (one-way)**: `apps/server/scripts/import-browser-bookmarks.ts`
  reads Chrome's Bookmarks JSON (all profiles) + Safari's plist (needs Full Disk Access),
  dedupes against the library, dry-run by default, `--apply` imports through the full
  ingest pipeline with per-browser provenance.

## Deferred / roadmap

- **Write-through bookmark sync**: settings toggle so extension saves also land in
  Chrome/Safari bookmarks — in a fitting existing folder or one the AI suggests/creates —
  so users are never locked in while our store keeps the rich copy.
- Client-side synced DB + on-device vector search (libSQL embedded replicas).
- Desktop: save-from-desktop, images in cards (needs Zig-side `ui.image` + ImageId
  pipeline — markup can't express images), menu-bar quick-save. (Search UI shipped
  2026-07-09 — text mode; AI-mode toggle still open.)
- Extension: context-menu "save link", options page, Arc-specific detection polish.
- Auth/multi-user (everything is single-user local today).

## Engine + adapter internals worth knowing

- `packages/engine` has no HTTP framework dependency — that's what lets the Express
  server and the Next.js route handlers both sit on top of it as thin adapters instead of
  forking the save/search logic.
- `apps/server/src/app.ts` (local-only) wires routers with injected deps (`db`, `gemini`,
  `onSaved` = embed-worker kick) — add new local-only routes in `src/routes/` there.
  Errors: throw `HttpError` (`lib/http-error.ts`); async routes wrap in `asyncHandler`
  (Express 4 doesn't catch rejections). The deployed side has no equivalent wiring file —
  each `apps/web/app/api/*/route.ts` calls `getApiContext()` and `packages/engine`
  directly.
- OG scraper (`packages/engine/src/og.ts`) is dependency-free regex-over-meta-tags with
  10 s timeout, 512 KB cap, attribute-order-agnostic, entity decoding,
  relative→absolute URL resolution, favicon fallback to `/favicon.ico`. It never throws.
- FTS5 external-content-free design: separate `bookmarks_fts` table synced by three
  triggers (see `packages/db/src/schema.ts`); `id` column is UNINDEXED.
- Vector search is a brute-force `vector_distance_cos` scan (fine ≤ ~10k rows). An ANN
  index (`libsql_vector_idx`) is created opportunistically; switch the query to
  `vector_top_k` when scale demands.
