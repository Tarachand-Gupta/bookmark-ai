# Bookmark AI

Save bookmarks from any browser, on any device — organized automatically by AI and
browsable everywhere: web, native desktop, and a cross-browser extension.

Every save captures the page's **Open Graph data** (title, description, preview image,
site, favicon) plus **provenance**: which browser it came from, which device, and the
day it was saved. An AI pass categorizes and tags each bookmark; embeddings power
semantic ("AI") search alongside classic full-text search.

## Layout (Turborepo + pnpm)

| Path | What it is |
| --- | --- |
| `apps/server` | Express API — OG scraping, Gemini categorization + embeddings, libSQL (Turso) file DB with FTS5 + native vector search |
| `apps/web` | Next.js + shadcn/ui — responsive app shell with sidebar facets, bookmark card grid, text/AI search |
| `apps/extension` | WXT + React — one codebase compiled to Chrome (MV3), Firefox (MV2), and Safari |
| `apps/desktop` | Native SDK (vercel-labs/native, Zig) — native-rendered sidebar + bookmark cards fed by the same API |
| `packages/types` | Zod schemas — the single API contract shared by every surface |
| `packages/db` | libSQL client, schema (FTS5 triggers, F32_BLOB vector column), query modules |
| `packages/ui` | Shared branding tokens (`theme.css`) + presentational components (`BookmarkCard`) |

## Quick start

```bash
pnpm install

# 1. API + database (SQLite file at apps/server/data/bookmarks.db)
pnpm --filter @bookmark-ai/server dev        # http://localhost:4545

# 2. Web app
pnpm --filter @bookmark-ai/web dev           # http://localhost:3000

# 3. Extension (pick your browser)
pnpm --filter @bookmark-ai/extension build            # → .output/chrome-mv3
pnpm --filter @bookmark-ai/extension build:firefox    # → .output/firefox-mv2
pnpm --filter @bookmark-ai/extension build:safari     # → .output/safari-mv2

# 4. Desktop (needs Zig 0.16 + @native-sdk/cli)
cd apps/desktop && native dev
```

Build/typecheck everything: `pnpm build` · `pnpm check-types` · desktop tests: `cd apps/desktop && native test`

### AI features

Set `GEMINI_API_KEY` (see `.env.example`) in the server's environment to enable:

- **Categorization + tags** via `gemini-2.5-flash` (falls back to domain/keyword heuristics without a key)
- **Semantic search** via `gemini-embedding-001` (768-dim vectors in libSQL's native
  vector column; AI search falls back to full-text without a key)

### Loading the extension

- **Chrome / Edge / Arc**: `chrome://extensions` → Developer mode → *Load unpacked* → `apps/extension/.output/chrome-mv3`
- **Firefox**: `about:debugging` → This Firefox → *Load Temporary Add-on* → `apps/extension/.output/firefox-mv2/manifest.json`
- **Safari**: `xcrun safari-web-extension-converter apps/extension/.output/safari-mv2 --app-name "Bookmark AI"`, then run the generated Xcode project

## For AI agents / contributors

- `CLAUDE.md` — repo-wide agent guide (state, gotchas, where features go)
- `docs/TESTING.md` — full verification playbook for every surface
- `docs/ARCHITECTURE.md` — data flow + design decisions + roadmap
- `apps/desktop/CLAUDE.md`, `apps/extension/CLAUDE.md` — surface-specific guides

## Architecture notes

- **One contract**: clients construct `CreateBookmarkInput` (`packages/types`); the server
  owns scraping, categorization, and embedding, so saves stay fast and clients stay thin.
- **Search**: `GET /api/search?q=…&mode=text|ai`. `text` = FTS5 (bm25), `ai` = cosine
  similarity over embeddings via `vector_distance_cos`. AI mode degrades to text
  transparently (`fallback: true`) when embeddings are unavailable.
- **Embed worker**: embeddings are written asynchronously after each save and swept
  every 30 s, so transient AI failures self-heal.
- **Database**: file-based libSQL today; point `DATABASE_URL` at a `libsql://` Turso URL
  later without touching query code. Client-side sync/vector replicas can layer on next.
- **Branding**: `packages/ui/src/theme.css` is the single source of design tokens
  (currently shadcn neutral); the desktop app follows the OS light/dark appearance with
  the Native SDK's stock tokens.
