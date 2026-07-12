# @bookmark-ai/server — the API

Express server on **:4545**. This is the only process that talks to the database and to
Gemini — every client (web, extension, mobile, desktop) goes through it.

## What happens on a save

`POST /api/bookmarks` with just a URL is enough. The server then:

1. **Scrapes** the page's Open Graph data (title, description, image, site name, favicon).
2. **Categorizes + tags** it with `gemini-2.5-flash` (domain/keyword heuristics if no
   `GEMINI_API_KEY` — responses then carry `fallback: true`).
3. **Embeds** it with `gemini-embedding-001` (768-dim vector) — asynchronously: an embed
   worker is kicked after each save and also sweeps every 30 s, so transient AI failures
   self-heal without blocking the save.

Saves **upsert by URL**: re-saving updates the row and clears the embedding for re-embed.

## Routes (all JSON)

| Route | What |
| --- | --- |
| `POST /api/bookmarks` | body = `CreateBookmarkInput` → `201 {bookmark}` |
| `GET /api/bookmarks?category=&browser=&device=&day=&tag=&limit=&offset=` | `{bookmarks, total}` |
| `GET /api/search?q=&mode=text\|ai&limit=` | `{mode, results: [{bookmark, score}], fallback?}` |
| `GET /api/meta` | facet counts for sidebars/filters `{categories, browsers, devices, days, tags, total}` |
| `POST /api/sessions` / `GET /api/sessions` / `DELETE /api/sessions/:id` | saved browser-tab snapshots |
| `DELETE /api/bookmarks/:id` | `204` |
| `GET /api/health` | `{ok, ai}` — never requires auth |

Search modes: `text` = SQLite FTS5 (bm25 ranking), `ai` = cosine similarity over the
vector column (`vector_distance_cos`), degrading to text transparently when embeddings
are unavailable.

## Auth, CORS, rate limiting (`src/auth.ts`, `src/app.ts`)

- With `CLERK_JWT_KEY` set (production on Render), every `/api` route except health
  requires `Authorization: Bearer <Clerk session JWT>`. Verification is **networkless**
  (public key only — this server never holds the Clerk secret key). Extra gates:
  `CLERK_AUTHORIZED_PARTIES` (origin allowlist) and `CLERK_ALLOWED_USER_IDS` (user
  allowlist, because the dev Clerk instance has open sign-up).
- **Unset locally = open API on purpose** — the desktop app, curl, and the import script
  rely on it.
- CORS: allowlist + browser-extension origins; requests without an `Origin` header
  (native apps, curl) pass.
- Rate limit: 120 req/min/IP (health exempt), `trust proxy 1` for Render.

## Files

| Path | What |
| --- | --- |
| `src/index.ts` | boot: env → deps wiring → listen |
| `src/app.ts` | middleware order: CORS → rate limit → auth → routes |
| `src/auth.ts` | Clerk JWT middleware + CORS origin check |
| `src/env.ts` | dependency-free `.env` loader (root `.env`) |
| `src/routes/` | route handlers |
| `src/services/` | scraping, categorization, embeddings, embed worker |
| `scripts/import-browser-bookmarks.ts` | one-shot import of existing browser bookmarks (`--apply` to write) |

Database code lives in [`packages/db`](../../packages/db/README.md); request/response
shapes in [`packages/types`](../../packages/types/README.md).

## Run it

```bash
pnpm --filter @bookmark-ai/server dev    # tsx watch on :4545
```

Deployed on **Render** (`bookmark-ai-server.onrender.com`), auto-deploys on push to
`main`. Free tier: cold-starts after idle — first request can take ~50 s.

Gotcha: the dev server runs as `node`, so `pkill -f tsx` misses it. If :4545 is stuck,
`lsof -i :4545 -P` and kill that PID.
