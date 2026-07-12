# @bookmark-ai/db — database layer

libSQL client, schema, and query modules. Only the server imports this package — clients
never touch the database directly.

## Storage

`DATABASE_URL` decides where data lives; the query code is URL-agnostic:

- **Production**: Turso cloud (`libsql://…turso.io` + `DATABASE_AUTH_TOKEN`)
- **Local mode**: a plain file path — fully offline

## Schema (`src/schema.ts`)

`ensureSchema` runs idempotent `IF NOT EXISTS` DDL on boot:

- `bookmarks` — OG fields, AI category/tags, provenance, plus an
  `embedding F32_BLOB(768)` native vector column
- an **FTS5** virtual table kept in sync by triggers → full-text search
- `sessions` — saved browser-tab snapshots

For column changes, add a guarded try/catch `ALTER` migration next to `ensureSchema`.

## Queries (`src/queries/`)

- `bookmarks.ts` — list with facet filters + pagination, upsert-by-URL, delete, and the
  facet counts behind `/api/meta`
- `search.ts` — FTS (`bm25`) and vector (`vector_distance_cos`) search
- `sessions.ts` — session CRUD

## Sharp edges (already handled — don't re-learn them)

1. `bm25()` ranks are **negative** (lower = better); this layer negates them so callers
   see higher = better.
2. Raw user text is **never** interpolated into FTS queries — `toFtsQuery` in
   `src/queries/search.ts` sanitizes it.
3. `BOOKMARK_COLUMNS` in `src/rows.ts` is table-qualified (the FTS join needs it), and
   `embedding` is selected as `(embedding IS NOT NULL)` → mapped to a boolean.
