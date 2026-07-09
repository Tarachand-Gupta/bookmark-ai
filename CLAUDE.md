# Bookmark AI — Agent Guide

Save bookmarks from any browser → local Express API scrapes Open Graph data, AI-categorizes,
embeds → browse/search in a Next.js web app, a native (Zig) desktop app, and a cross-browser
extension. Everything is verified working as of 2026-07-09; see `docs/TESTING.md` to re-verify.

## Monorepo map (Turborepo + pnpm, Node ≥20)

| Path | What | Dev command |
| --- | --- | --- |
| `apps/server` | Express API :4000, libSQL file DB, OG scrape, Gemini categorize+embed, FTS+vector search | `pnpm --filter @bookmark-ai/server dev` |
| `apps/web` | Next.js 15 + shadcn sidebar shell :3000 | `pnpm --filter @bookmark-ai/web dev` |
| `apps/extension` | WXT + React popup → chrome-mv3 / firefox-mv2 / safari-mv2 | `pnpm --filter @bookmark-ai/extension dev` (chrome) |
| `apps/desktop` | zero-native (vercel-labs/native) Zig app — **see `apps/desktop/CLAUDE.md`** | `cd apps/desktop && native dev` |
| `packages/types` | Zod schemas = THE api contract (`CreateBookmarkInput`, `Bookmark`, search/meta responses) | — |
| `packages/db` | libSQL client, schema (FTS5 triggers + F32_BLOB(768) vector), query modules | — |
| `packages/ui` | `src/theme.css` = single branding source (shadcn neutral) + shared `BookmarkCard` | — |

Whole-repo: `pnpm build` · `pnpm check-types` · desktop: `cd apps/desktop && native test`.

## Environment / current state

- **No `GEMINI_API_KEY` set** → server uses heuristic categorization; AI search falls back to
  full-text with `fallback: true`. Set it in `.env` (copy `.env.example`) to enable Gemini
  `gemini-2.5-flash` categorization + `gemini-embedding-001` 768-dim embeddings. The embed
  worker (30s sweep + kick after save) back-fills embeddings for existing rows automatically.
- **DB**: `apps/server/data/bookmarks.db` (gitignored). Contains ~5 test bookmarks. Delete the
  file for a clean slate; schema recreates on boot. `DATABASE_URL` accepts a `libsql://` Turso
  URL later — query code is URL-agnostic.
- **Git**: repo initialized, **nothing committed yet** (user hasn't asked).
- Zig 0.16 + `@native-sdk/cli` 0.4.0 (`native` on PATH) are installed globally on this machine.

## API quick reference (all JSON, permissive CORS)

- `POST /api/bookmarks` — body `CreateBookmarkInput` `{url, title?, browser?, device?, deviceName?, os?, savedAt?}` (`browser`/`device` default to `"other"` when omitted) → `201 {bookmark}`. Upserts by URL (re-save updates + clears embedding).
- `GET /api/bookmarks?category=&browser=&device=&day=YYYY-MM-DD&tag=&limit=&offset=` → `{bookmarks, total}`
- `GET /api/search?q=…&mode=text|ai&limit=` → `{mode, results:[{bookmark,score}], fallback?}`
- `GET /api/meta` → sidebar facets + tag rail `{categories, browsers, devices, days, tags, total}`
- `GET /api/health` → `{ok, ai}` · `DELETE /api/bookmarks/:id` → 204

## Hard-won gotchas (do not rediscover these)

1. **No `.js` extensions in relative imports** anywhere in `packages/*` — Next's webpack can't
   resolve `./foo.js` → `foo.tsx`. Extensionless only. tsconfigs use `moduleResolution: Bundler`.
2. **Port 4000 stale process**: the server runs as `node`, so `pkill -f tsx` misses it. Use
   `lsof -i :4000 -P` and kill the PID before restarting, or you get EADDRINUSE while the OLD
   code keeps serving (very confusing).
3. **shadcn CLI appends duplicate theme tokens** to `apps/web/app/globals.css` when adding
   components. Brand tokens live ONLY in `packages/ui/src/theme.css` — delete whatever the CLI
   appends after `@layer base`.
4. **`bm25()` FTS ranks are negative** (lower=better); db layer negates them. FTS queries are
   sanitized in `packages/db/src/queries/search.ts:toFtsQuery` — never interpolate raw user text.
5. **`BOOKMARK_COLUMNS`** in `packages/db/src/rows.ts` is table-qualified because of the FTS
   join; the `embedding` column is selected as `(embedding IS NOT NULL)` → 0/1, mapped with
   `Boolean(Number(...))`.
6. Web build warning "no output files for @bookmark-ai/server#build" is cosmetic (its build is
   a typecheck).
7. Preview tool `launch.json` must live at `/Users/tara/Developer/.claude/launch.json` (session
   root), not the repo — one exists there already with `web` and `server` configs.
8. Never run `pnpm turbo build` (it runs `next build`) while the web dev server is up — the
   prod build clobbers `.next` and the dev server serves webpack-runtime 500s until you
   `rm -rf apps/web/.next` and restart it.

## Adding features — where things go

- **New API field**: add to Zod schema in `packages/types` first; server validates with
  `safeParse`, clients get the type for free. DB columns: `packages/db/src/schema.ts`
  (`ensureSchema` is idempotent `IF NOT EXISTS` DDL — for ALTERs, add a guarded try/catch
  migration next to it) + `rows.ts` mapper + query modules.
- **New web UI**: shadcn primitives via `cd apps/web && pnpm dlx shadcn@latest add <x> --yes`
  (then fix globals.css per gotcha 3). Feature components in `apps/web/components/library/`.
  Shared/brandable presentational components in `packages/ui` (extension also imports these).
- **Extension**: `apps/extension/lib/` for logic, `entrypoints/popup/components/` for UI,
  message contracts in `lib/messages.ts`. Keep multi-file — the user explicitly banned monoliths.
- **Desktop**: read `apps/desktop/CLAUDE.md` FIRST — the native SDK is not guessable from
  general knowledge.

## Docs

- `docs/TESTING.md` — full verification playbook (curl flows, UI checks, extension loading,
  desktop automation harness). Run it after any nontrivial change.
- `docs/ARCHITECTURE.md` — data flow, design decisions, deferred work (client-side vector
  sync, Turso cloud, desktop search UI).
