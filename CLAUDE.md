# Bookmark AI — Agent Guide

Save bookmarks from any browser → the API (Next.js route handlers in `apps/web` — the same
code serves local dev on :3000 and the Vercel deployment) scrapes Open Graph data,
AI-categorizes, embeds → browse/search in the web app, a native (Zig) desktop app, an Expo
mobile app, and a cross-browser extension. See `docs/TESTING.md` to re-verify.

## Monorepo map (Turborepo + pnpm, Node ≥20)

| Path | What | Dev command |
| --- | --- | --- |
| `apps/web` | Next.js 15 + shadcn sidebar shell :3000 — **also serves the API** (`app/api/*` route handlers; the SAME code runs local dev and deploys as Vercel functions — no separate server) | `pnpm --filter @bookmark-ai/web dev` |
| `apps/extension` | WXT + React popup → chrome-mv3 / firefox-mv2 / safari-mv2 | `pnpm --filter @bookmark-ai/extension dev` (chrome) |
| `apps/desktop` | zero-native (vercel-labs/native) Zig app — **see `apps/desktop/CLAUDE.md`**; talks to the local web dev server on :3000 | `cd apps/desktop && native dev` |
| `apps/mobile` | Expo SDK 57 iOS/iPad/Android app (tabs, filter sheet, Clerk sign-in incl. Google SSO, local/prod server switch, glass tab bar) | `cd apps/mobile && npx expo run:ios` + `npx expo start` |
| `packages/types` | Zod schemas = THE api contract (`CreateBookmarkInput`, `Bookmark`, search/meta responses) | — |
| `packages/db` | libSQL client, schema (FTS5 triggers + F32_BLOB(768) vector), query modules | — |
| `packages/engine` | Shared API logic: OG scrape, Gemini categorize/embed, `performSearch` (RRF hybrid), `saveBookmarkFast`/`enrichBookmark`, `embedPending` sweep. The Next route handlers are a thin adapter over it | — |
| `packages/ui` | `src/theme.css` = single branding source (shadcn neutral) + shared `BookmarkCard` | — |

Whole-repo: `pnpm build` · `pnpm check-types` · desktop: `cd apps/desktop && native test`.

## Environment / current state

- **`GEMINI_API_KEY` is set** in the root `.env`, loaded by a dependency-free loader in
  `apps/web/next.config.ts` → Gemini `gemini-2.5-flash`
  categorization, `gemini-embedding-001` 768-dim embeddings, and the `/api/chat` agent.
  Embedding runs post-save via Next's `after()` right after each save, plus a daily Vercel
  cron (`/api/cron/embed`, `CRON_SECRET`-gated, see `apps/web/vercel.json`) that sweeps
  anything that fell through — this is the ONLY embedding path.
  Without a key everything degrades to heuristics/full-text with `fallback: true`.
- **DB is Turso cloud**: `DATABASE_URL=libsql://bookmark-ai-tara.aws-ap-south-1.turso.io` +
  `DATABASE_AUTH_TOKEN` in `.env` (manage with the `turso` CLI). The old local file
  `data/bookmarks.db` (repo root, gitignored) is a pre-migration backup — it's also the
  `apps/web` dev fallback when `DATABASE_URL` is unset (`file:../../data/bookmarks.db` in
  `lib/server/context.ts`); pointing `DATABASE_URL` back at it restores fully-local mode;
  query code is URL-agnostic.
- **Git**: pushed to GitHub `Tarachand-Gupta/bookmark-ai` (private).
- **Auth (Clerk)**: `apps/web` requires login — `middleware.ts` `auth.protect()`s every PAGE
  except `/sign-in` and `/sign-up`; `/api` routes self-protect via `lib/server/require-user.ts`
  (clean 401 JSON; Bearer or cookie). Middleware also handles API CORS (extension schemes +
  known web origins); the `azp` origin check lives in `require-user.ts` instead (Express
  semantics: absent = pass so native mobile tokens work, wrong = reject). Dev-instance keys live in
  `apps/web/.env.local` (gitignored); a production Clerk instance is possible now that
  `bookmark-ai.cloud` exists but is not set up. Because of the gate, headless/preview browser
  testing of app content needs a signed-in session. The **extension** mirrors the web session
  via Clerk `syncHost` (no in-popup sign-in — see `apps/extension/CLAUDE.md`), and the
  instance's `allowed_origins` is an explicit RESTRICTION list (extension id + localhost:3000 +
  127.0.0.1:3000 + vercel.app alias + bookmark-ai.cloud apex/www) — keep the web origins in it
  when adding new ones.
- **Deployment (single Vercel deployment — frontend + API)**: production domain
  **`https://bookmark-ai.cloud`** (plus `bookmark-ai-theta.vercel.app` alias). Project Root
  Directory `apps/web`, install filtered to `pnpm … --filter @bookmark-ai/web...`, root
  `.vercelignore` excludes build caches, generated mobile dirs, AND all `.env*` files (see
  gotcha 9). Vercel env: Clerk keys + `GEMINI_API_KEY` + `DATABASE_URL` + `DATABASE_AUTH_TOKEN`
  + `CLERK_ALLOWED_USER_IDS` + `CRON_SECRET` (no `NEXT_PUBLIC_API_URL` — the web app calls its
  own origin). The old **Render** service `bookmark-ai-server` (`srv-d98flodaeets73fse1f0`) is
  SUSPENDED and can no longer redeploy from `main` (`render.yaml` is deleted); rollback = revert
  the git commit that removed `apps/server`. **The local API is just the web dev server on
  :3000** — there is no separate local server anymore. Tokenless clients (the Zig desktop app,
  which can't attach auth headers) need `DEV_OPEN_API=1 pnpm --filter @bookmark-ai/web dev`.
- Zig 0.16 + `@native-sdk/cli` 0.4.0 (`native` on PATH) are installed globally on this machine.

## API quick reference (all JSON)

ONE implementation: Next route handlers under `apps/web/app/api/*`, serving both local dev
(`http://localhost:3000/api/*`) and production (`https://bookmark-ai.cloud/api/*`). Every route
except `/api/health` (public liveness) calls `requireUser()` (`lib/server/require-user.ts`)
first, which does, in order:

1. **Rate limit** — in-memory sliding window, 120 req / 60s per client IP, else `429
   {error:"Too many requests"}` (`lib/server/rate-limit.ts`). Per-instance state on serverless,
   so it's coarse; per-user quotas come with multi-tenancy later.
2. **Open modes** (skip Clerk, warn once per process): `CLERK_SECRET_KEY` unset/empty → keyless
   self-host mode; OR `DEV_OPEN_API=1` AND `NODE_ENV!=production` → dev bypass even with Clerk
   configured (this is how the Zig desktop app, which can't send auth headers, talks to a local
   dev server — run `DEV_OPEN_API=1 pnpm --filter @bookmark-ai/web dev`; ignored in production).
   `middleware.ts` separately keys page protection off `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`: unset
   → CORS-only middleware, pages unprotected (the page UI still needs Clerk to render, so keyless
   mode is primarily for the API; a full self-hosted web UI needs your own free Clerk instance).
3. **Clerk** — a session (browser cookie or `Authorization: Bearer` session JWT), an `azp` origin
   check (absent = pass, wrong = reject), and the `CLERK_ALLOWED_USER_IDS` allowlist (Tara =
   `user_3GIhPt5Na3tYRP3XaPPU3PpI55e`).

Clients attach tokens: web `apps/web/lib/api.ts` (window.Clerk, same-origin `/api`),
extension background via `createClerkClient` from `@clerk/chrome-extension/background`
(popup API URL setting → `https://bookmark-ai.cloud` in prod, `http://localhost:3000` for dev),
mobile via Clerk Expo. The route handlers delegate to `packages/engine` — change behavior THERE.

- `POST /api/bookmarks` — body `CreateBookmarkInput` `{url, title?, browser?, device?, deviceName?, os?, savedAt?}` (`browser`/`device` default to `"other"` when omitted) → `201 {bookmark}`. Upserts by URL (re-save updates + clears embedding).
- `GET /api/bookmarks?category=&browser=&device=&day=YYYY-MM-DD&tag=&limit=&offset=` → `{bookmarks, total}`
- `GET /api/search?q=…&mode=text|ai|hybrid&limit=` → `{mode, results:[{bookmark,score}], fallback?}` (`hybrid` = RRF blend of FTS + vector lists; the web grid and mobile both use it, limit 40)
- `GET /api/meta` → sidebar facets + tag rail `{categories, browsers, devices, days, tags, total}`
- `GET /api/health` → `{ok, ai}` · `DELETE /api/bookmarks/:id` → 204
- `POST /api/sessions` — body `{name?, tabs:[{url,title?,favIconUrl?,windowId?}], browser?, device?, savedAt?}` → `201 {session}` (a saved browser-tab snapshot). `GET /api/sessions` → `{sessions}` · `DELETE /api/sessions/:id` → 204
- `POST /api/chat` — the one route that's a full agent, not a thin engine adapter: AI SDK v7
  agent chat. Body `{messages: UIMessage[]}`; streams UI messages; tools `searchFullText`/`searchSemantic`/
  `listSessions` call `packages/engine` directly (no HTTP hop). Import existing browser
  bookmarks against a dev server started with `DEV_OPEN_API=1` (or set `BOOKMARK_API_TOKEN` to
  import against prod): `cd apps/web && pnpm tsx scripts/import-browser-bookmarks.ts [--apply]`.

## Hard-won gotchas (do not rediscover these)

1. **No `.js` extensions in relative imports** anywhere in `packages/*` — Next's webpack can't
   resolve `./foo.js` → `foo.tsx`. Extensionless only. tsconfigs use `moduleResolution: Bundler`.
2. **Port 3000 stale process**: the Next dev server runs as `next-server`, so `pkill -f tsx`
   misses it. Use `lsof -i :3000 -P` and kill the PID before restarting, or you get EADDRINUSE
   while the OLD code keeps serving (very confusing).
3. **shadcn CLI appends duplicate theme tokens** to `apps/web/app/globals.css` when adding
   components. Brand tokens live ONLY in `packages/ui/src/theme.css` — delete whatever the CLI
   appends after `@layer base`.
4. **`bm25()` FTS ranks are negative** (lower=better); db layer negates them. FTS queries are
   sanitized in `packages/db/src/queries/search.ts:toFtsQuery` — never interpolate raw user text.
5. **`BOOKMARK_COLUMNS`** in `packages/db/src/rows.ts` is table-qualified because of the FTS
   join; the `embedding` column is selected as `(embedding IS NOT NULL)` → 0/1, mapped with
   `Boolean(Number(...))`.
6. Preview tool `launch.json` must live at `/Users/tara/Developer/.claude/launch.json` (session
   root), not the repo — one exists there already with a `web` config (the API is served by that
   same web dev server now).
7. Never run `pnpm turbo build` (it runs `next build`) while the web dev server is up — the
   prod build clobbers `.next` and the dev server serves webpack-runtime 500s until you
   `rm -rf apps/web/.next` and restart it.
8. **Never let `.env` files reach a Vercel upload.** `vercel --prod` uploads the working tree,
   and `apps/web/next.config.ts` reads the root `.env` at build time — a stale
   `NEXT_PUBLIC_API_URL` in it got INLINED into the production client bundle once (deployed app
   called a localhost dev URL instead of its own origin). `.vercelignore` now excludes `.env*`;
   keep it that way.
9. **`@libsql/client` must be a direct dependency of `apps/web`** even though `packages/db`
   owns it: Next's `serverExternalPackages` can only externalize packages the app itself can
   resolve (pnpm isolation), otherwise webpack tries to bundle the native `libsql` bindings
   and the build fails on its README/LICENSE files.

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

## Database migrations (read before ANY schema change)

Production is **Turso cloud (libSQL/SQLite) holding REAL user data** — treat it like it.

There is **NO migration framework and NO version table**. `ensureSchema` in
`packages/db/src/schema.ts` **IS** the migration mechanism — idempotent `IF NOT EXISTS` DDL
run at boot by the adapter (`apps/web/lib/server/context.ts`). Schema
changes = extend it. Column adds = a guarded try/catch `ALTER TABLE … ADD COLUMN` next to it
(idempotent: swallow the "duplicate column" error ONLY, rethrow everything else).

1. **Additive-only for anything automated.** Allowed: `CREATE TABLE/INDEX IF NOT EXISTS` and
   `ADD COLUMN` (nullable or defaulted). NEVER `DROP` or `RENAME` a table/column holding data,
   and never rewrite the FTS5 table or the `F32_BLOB(768)` embedding column in place. If a shape
   must truly change: new table → copy data → swap, and ONLY under an explicit user-approved plan.
2. **Deploys are not atomic with the schema.** Mid-rollout the previous build still serves
   traffic against the same DB, so every change must keep the OLD code working — two-phase: ship
   the additive schema change first, switch the code after.
3. **Destructive ops (`DROP`, bulk data rewrites, FTS rebuilds) need a backup FIRST** —
   `turso db shell <db> ".dump" > backup.sql` — AND explicit user sign-off. Never bundle one
   silently into a feature commit.
4. **Promote = migrate.** The schema change ships in the SAME commit as the code; prod applies
   it on first boot via `ensureSchema`/guarded ALTERs. Never hand-run DDL against prod outside
   this path.
5. **Forward-pointer (planned, NOT built yet):** multi-tenant per-user Turso DBs behind a
   master/control-plane DB. Turso's "schema database" feature is DEPRECATED for new users
   (2026), so tenant migrations will use our own runner: a `schema_migrations` version table in
   every tenant DB, versioned additive migrations applied per-tenant on first touch after a
   deploy — the additive-only + backup-first rules then apply across ALL tenant DBs at once,
   raising the stakes further.

## Docs

- `docs/TESTING.md` — full verification playbook (curl flows, UI checks, extension loading,
  desktop automation harness). Run it after any nontrivial change.
- `docs/ARCHITECTURE.md` — data flow, design decisions, deferred work (client-side vector
  sync, Turso cloud, desktop search UI).
