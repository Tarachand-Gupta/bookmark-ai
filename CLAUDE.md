# Bookmark AI — Agent Guide

Save bookmarks from any browser → local Express API scrapes Open Graph data, AI-categorizes,
embeds → browse/search in a Next.js web app, a native (Zig) desktop app, and a cross-browser
extension. Everything is verified working as of 2026-07-09; see `docs/TESTING.md` to re-verify.

## Monorepo map (Turborepo + pnpm, Node ≥20)

| Path | What | Dev command |
| --- | --- | --- |
| `apps/server` | Express API :4545, libSQL file DB, OG scrape, Gemini categorize+embed, FTS+vector search | `pnpm --filter @bookmark-ai/server dev` |
| `apps/web` | Next.js 15 + shadcn sidebar shell :3000 | `pnpm --filter @bookmark-ai/web dev` |
| `apps/extension` | WXT + React popup → chrome-mv3 / firefox-mv2 / safari-mv2 | `pnpm --filter @bookmark-ai/extension dev` (chrome) |
| `apps/desktop` | zero-native (vercel-labs/native) Zig app — **see `apps/desktop/CLAUDE.md`** | `cd apps/desktop && native dev` |
| `apps/mobile` | Expo SDK 57 iOS/iPad app (tabs, filter sheet, Clerk sign-in, local/prod server switch); Android untested (no toolchain) | `cd apps/mobile && npx expo run:ios` + `npx expo start` |
| `packages/types` | Zod schemas = THE api contract (`CreateBookmarkInput`, `Bookmark`, search/meta responses) | — |
| `packages/db` | libSQL client, schema (FTS5 triggers + F32_BLOB(768) vector), query modules | — |
| `packages/ui` | `src/theme.css` = single branding source (shadcn neutral) + shared `BookmarkCard` | — |

Whole-repo: `pnpm build` · `pnpm check-types` · desktop: `cd apps/desktop && native test`.

## Environment / current state

- **`GEMINI_API_KEY` is set** in the root `.env`, loaded by dependency-free loaders in
  `apps/server/src/env.ts` and `apps/web/next.config.ts` → Gemini `gemini-2.5-flash`
  categorization, `gemini-embedding-001` 768-dim embeddings (embed worker: 30s sweep + kick
  after save), and the `/api/chat` agent. Without a key everything degrades to
  heuristics/full-text with `fallback: true`.
- **DB is Turso cloud**: `DATABASE_URL=libsql://bookmark-ai-tara.aws-ap-south-1.turso.io` +
  `DATABASE_AUTH_TOKEN` in `.env` (manage with the `turso` CLI). The old local file
  `apps/server/data/bookmarks.db` is a pre-migration backup — pointing `DATABASE_URL` back at
  it restores fully-local mode; query code is URL-agnostic.
- **Git**: pushed to GitHub `Tarachand-Gupta/bookmark-ai` (private).
- **Auth (Clerk)**: `apps/web` requires login — `middleware.ts` `auth.protect()`s every route
  except `/sign-in` and `/sign-up`. Dev-instance keys live in `apps/web/.env.local` (gitignored)
  and work on any origin; a production Clerk instance (needs a custom domain) is not set up yet.
  Because of the gate, headless/preview browser testing of app content needs a signed-in session.
  The **extension** mirrors the web session via Clerk `syncHost` (no in-popup sign-in — see
  `apps/extension/CLAUDE.md`), and the instance's `allowed_origins` is now an explicit RESTRICTION
  list (extension id + localhost:3000 + 127.0.0.1:3000 + vercel.app alias) — keep the web origins
  in it when adding new ones.
- **Deployment (fully live, E2E-verified 2026-07-10)**: web on Vercel
  (`bookmark-ai-theta.vercel.app`) — project Root Directory `apps/web`, install filtered to
  `pnpm … --filter @bookmark-ai/web...`, a root `.vercelignore` excludes build caches. Vercel env:
  Clerk keys + `GEMINI_API_KEY` + `NEXT_PUBLIC_API_URL=https://bookmark-ai-server.onrender.com`.
  Server is **live on Render**: service `bookmark-ai-server` (`srv-d98flodaeets73fse1f0`,
  free tier — cold-starts after idle, first request can take ~50s), auto-deploys on push to
  `main`, build `corepack enable && pnpm install --prod=false`, managed via API with
  `RENDER_API_KEY` in root `.env` (the committed `render.yaml` is reference only — the service
  was created via API, not blueprint). API port
  is **4545** (was 4000).
- Zig 0.16 + `@native-sdk/cli` 0.4.0 (`native` on PATH) are installed globally on this machine.

## API quick reference (all JSON)

**Auth**: with `CLERK_JWT_KEY` set (Render has it), every `/api` route except `/api/health`
requires `Authorization: Bearer <Clerk session JWT>` — networkless verification in
`apps/server/src/auth.ts`, azp allowlist `CLERK_AUTHORIZED_PARTIES`, user allowlist
`CLERK_ALLOWED_USER_IDS` (Tara = `user_3GIhPt5Na3tYRP3XaPPU3PpI55e`). Unset (local dev) =
open + permissive CORS, for the desktop app / curl / import script. Clients attach tokens:
web `apps/web/lib/api.ts` (window.Clerk), chat route via `auth().getToken()`, extension
background via `createClerkClient` from `@clerk/chrome-extension/background`. Rate limit:
120 req/min/IP (health exempt).

- `POST /api/bookmarks` — body `CreateBookmarkInput` `{url, title?, browser?, device?, deviceName?, os?, savedAt?}` (`browser`/`device` default to `"other"` when omitted) → `201 {bookmark}`. Upserts by URL (re-save updates + clears embedding).
- `GET /api/bookmarks?category=&browser=&device=&day=YYYY-MM-DD&tag=&limit=&offset=` → `{bookmarks, total}`
- `GET /api/search?q=…&mode=text|ai|hybrid&limit=` → `{mode, results:[{bookmark,score}], fallback?}` (`hybrid` = RRF blend of FTS + vector lists; the web grid and mobile both use it, limit 40)
- `GET /api/meta` → sidebar facets + tag rail `{categories, browsers, devices, days, tags, total}`
- `GET /api/health` → `{ok, ai}` · `DELETE /api/bookmarks/:id` → 204
- `POST /api/sessions` — body `{name?, tabs:[{url,title?,favIconUrl?,windowId?}], browser?, device?, savedAt?}` → `201 {session}` (a saved browser-tab snapshot). `GET /api/sessions` → `{sessions}` · `DELETE /api/sessions/:id` → 204
- `POST /api/chat` — **Next.js route in `apps/web`** (not Express): AI SDK v7 agent chat.
  Body `{messages: UIMessage[]}`; streams UI messages; tools `searchFullText`/`searchSemantic`
  proxy `/api/search`. Import existing browser bookmarks:
  `cd apps/server && pnpm tsx scripts/import-browser-bookmarks.ts [--apply]`.

## Hard-won gotchas (do not rediscover these)

1. **No `.js` extensions in relative imports** anywhere in `packages/*` — Next's webpack can't
   resolve `./foo.js` → `foo.tsx`. Extensionless only. tsconfigs use `moduleResolution: Bundler`.
2. **Port 4545 stale process**: the server runs as `node`, so `pkill -f tsx` misses it. Use
   `lsof -i :4545 -P` and kill the PID before restarting, or you get EADDRINUSE while the OLD
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
