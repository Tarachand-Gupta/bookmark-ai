# @bookmark-ai/server — local-mode API companion

Express server on **:4545**. The deployed API now lives in
[`apps/web/app/api/*`](../web/README.md) (Next.js route handlers, on Vercel) — this
server is the **local-only** counterpart: the desktop app talks to it directly at
`127.0.0.1:4545` (unauthenticated), and it's the entry point for curl and the bookmark
import script. All the actual save/search logic lives in
[`packages/engine`](../../packages/engine/README.md), shared with the deployed API — the
routes here are thin HTTP adapters over it, not where scraping/categorization/embedding
happen anymore.

## What happens on a save

`POST /api/bookmarks` with just a URL is enough. The route calls into
`packages/engine`'s `saveBookmarkFast` (instant upsert-by-URL save) then
`enrichBookmark`, which:

1. **Scrapes** the page's Open Graph data (title, description, image, site name, favicon).
2. **Categorizes + tags** it with `gemini-2.5-flash` (domain/keyword heuristics if no
   `GEMINI_API_KEY` — responses then carry `fallback: true`).
3. **Embeds** it with `gemini-embedding-001` (768-dim vector) — asynchronously: this
   server runs `packages/engine`'s `startEmbedWorker`, kicked after each save and also
   sweeping every 30 s, so transient AI failures self-heal without blocking the save.
   (The deployed API uses Next's `after()` + a daily cron instead of a worker — see
   `packages/engine/README.md`.)

Saves **upsert by URL**: re-saving updates the row and clears the embedding for re-embed.

## Routes (all JSON)

| Route | What |
| --- | --- |
| `POST /api/bookmarks` | body = `CreateBookmarkInput` → `201 {bookmark}` |
| `GET /api/bookmarks?category=&browser=&device=&day=&tag=&limit=&offset=` | `{bookmarks, total}` |
| `GET /api/search?q=&mode=text\|ai\|hybrid&limit=` | `{mode, results: [{bookmark, score}], fallback?}` |
| `GET /api/meta` | facet counts for sidebars/filters `{categories, browsers, devices, days, tags, total}` |
| `POST /api/sessions` / `GET /api/sessions` / `DELETE /api/sessions/:id` | saved browser-tab snapshots |
| `DELETE /api/bookmarks/:id` | `204` |
| `GET /api/health` | `{ok, ai}` — never requires auth |

Search modes: `text` = SQLite FTS5 (bm25 ranking), `ai` = cosine similarity over the
vector column (`vector_distance_cos`), `hybrid` = both lists blended with Reciprocal
Rank Fusion (keyword hits and meaning-level matches compete on rank; what both lists
agree on rises to the top). `ai` and `hybrid` degrade to text transparently
(`fallback: true`) when embeddings are unavailable.

## Auth, CORS, rate limiting (`src/auth.ts`, `src/app.ts`)

- With `CLERK_JWT_KEY` set, every `/api` route except health requires
  `Authorization: Bearer <Clerk session JWT>`. Verification is **networkless**
  (public key only — this server never holds the Clerk secret key). Extra gates:
  `CLERK_AUTHORIZED_PARTIES` (origin allowlist) and `CLERK_ALLOWED_USER_IDS` (user
  allowlist, because the dev Clerk instance has open sign-up).
- **Unset by default = open API on purpose** — since this server is local-only, the
  desktop app, curl, and the import script rely on it staying open.
- CORS: allowlist + browser-extension origins; requests without an `Origin` header
  (native apps, curl) pass.
- Rate limit: 120 req/min/IP (health exempt). The deployed API
  (`apps/web/app/api/*` on Vercel) has no equivalent limiter — Clerk auth + the
  `CLERK_ALLOWED_USER_IDS` allowlist are the gate there, with Vercel's platform DDoS
  protection in front.

## Files

| Path | What |
| --- | --- |
| `src/index.ts` | boot: env → deps wiring → listen |
| `src/app.ts` | middleware order: CORS → rate limit → auth → routes |
| `src/auth.ts` | Clerk JWT middleware + CORS origin check |
| `src/env.ts` | dependency-free `.env` loader (root `.env`) |
| `src/routes/` | route handlers — thin adapters over `packages/engine` |
| `src/services/` | **gone** — scraping, categorization, embeddings, and search moved to [`packages/engine`](../../packages/engine/README.md), shared with the Next.js API |
| `scripts/import-browser-bookmarks.ts` | one-shot import of existing browser bookmarks (`--apply` to write) |

Database code lives in [`packages/db`](../../packages/db/README.md); request/response
shapes in [`packages/types`](../../packages/types/README.md).

## Run it

```bash
pnpm --filter @bookmark-ai/server dev    # tsx watch on :4545
```

**Not deployed anywhere** — local-only. It used to run on Render
(`bookmark-ai-server.onrender.com`), auto-deploying on push to `main`; that service is
now suspended and kept only as a rollback path, not part of the live deployment (the
deployed API is [`apps/web/app/api/*`](../web/README.md) on Vercel).

Gotcha: the dev server runs as `node`, so `pkill -f tsx` misses it. If :4545 is stuck,
`lsof -i :4545 -P` and kill that PID.
