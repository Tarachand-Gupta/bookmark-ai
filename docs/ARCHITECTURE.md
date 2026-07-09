# Architecture & Decisions

## Data flow

```
 Chrome/Firefox/Safari         Web app            Desktop (Zig)
 extension popup               Add dialog         refresh/boot
        │                         │                    │
        └────── POST /api/bookmarks (CreateBookmarkInput) ──────┐
                                                                ▼
                                              apps/server ingest pipeline
                                     1. scrapeOpenGraph(url)   (services/og.ts)
                                     2. categorize(page)       (services/categorize.ts)
                                     3. insertBookmark (upsert by URL)
                                     4. embed worker (async)   (services/embeddings.ts)
                                                                │
                                                    libSQL file DB (Turso-ready)
                                          bookmarks table · FTS5 (trigger-synced)
                                          · embedding F32_BLOB(768)
```

Reads: `GET /api/bookmarks` (facet filters), `/api/search` (`text` → FTS5 bm25;
`ai` → embed query → `vector_distance_cos` ORDER BY), `/api/meta` (sidebar facets).

## Key decisions (user-confirmed)

1. **Server-side search for v1.** All search runs in the API against one libSQL file.
   The originally-envisioned client-side vector DB with sync is DEFERRED (next step:
   libSQL embedded replicas / sync to push data into clients).
2. **Gemini** (`gemini-2.5-flash` categorize, `gemini-embedding-001` embed at
   `outputDimensionality:768`, re-normalized in `services/gemini.ts` since Gemini only
   pre-normalizes 3072-dim). "GNI embedding" in the original brief = Gemini.
   Provider is swappable: only `services/gemini.ts` + `EMBEDDING_DIM` in
   `packages/db/src/schema.ts` care (changing dims requires re-embedding + column DDL).
3. **Graceful degradation everywhere**: no API key → heuristic categorization
   (domain/keyword rules) + text-only search with `fallback: true`; OG scrape failure →
   bookmark still saves; Gemini failure during search → text fallback; embed failures
   self-heal via the 30 s sweep.
4. **Saves are fast**: embedding is async (worker kicked after each save), so POST
   latency ≈ OG fetch + categorize only.
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
8. **Category vocabulary is closed** (`CATEGORIES` in `services/categorize.ts`) so the
   sidebar stays tidy; Gemini is schema-constrained to it. Extend the list there.

## Deferred / roadmap

- Client-side synced DB + on-device vector search (libSQL embedded replicas).
- Turso cloud: set `DATABASE_URL=libsql://…` + auth token in `createDb` — no query changes.
- Desktop: save-from-desktop, images in cards (needs Zig-side `ui.image` + ImageId
  pipeline — markup can't express images), menu-bar quick-save. (Search UI shipped
  2026-07-09 — text mode; AI-mode toggle still open.)
- Extension: context-menu "save link", options page, Arc-specific detection polish.
- Auth/multi-user (everything is single-user local today).
- Initial git commit (user hasn't asked yet).

## Server internals worth knowing

- `src/app.ts` wires routers with injected deps (`db`, `gemini`, `onSaved` = embed-worker
  kick) — add new routes in `src/routes/` and compose there. Errors: throw `HttpError`
  (`lib/http-error.ts`); async routes wrap in `asyncHandler` (Express 4 doesn't catch
  rejections).
- OG scraper is dependency-free regex-over-meta-tags with 10 s timeout, 512 KB cap,
  attribute-order-agnostic, entity decoding, relative→absolute URL resolution, favicon
  fallback to `/favicon.ico`. It never throws.
- FTS5 external-content-free design: separate `bookmarks_fts` table synced by three
  triggers (see `packages/db/src/schema.ts`); `id` column is UNINDEXED.
- Vector search is a brute-force `vector_distance_cos` scan (fine ≤ ~10k rows). An ANN
  index (`libsql_vector_idx`) is created opportunistically; switch the query to
  `vector_top_k` when scale demands.
