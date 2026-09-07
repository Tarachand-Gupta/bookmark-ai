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
  categorization and `gemini-embedding-001` 768-dim embeddings.
- **`OPENROUTER_API_KEY` is set** in the root `.env` (and Vercel prod+preview). The included
  (free) AI tier for `/api/chat` runs **`z-ai/glm-5.3-flash` via OpenRouter at LOW reasoning
  effort**, with **`gemini-3.8-flash` (medium thinking) as an automatic fallback** whenever
  OpenRouter has no key, errors, rate-limits or emits nothing before the first chunk
  (`lib/server/ai-fallback-model.ts` wraps the two as one model;
  `lib/server/ai-model.ts` owns the ids + provider options). Both halves stream reasoning, so
  the chat's thinking disclosure works either way. `X-Ai-Model-Tier: primary|fallback` reports
  which one answered; model names are NEVER shown in the UI. `OPENROUTER_BASE_URL` overrides the
  endpoint (point it at a dead port to exercise the fallback).
  Embedding runs post-save via Next's `after()`: each save embeds ITS OWN row
  (`embedBookmarkById`) plus at most one straggler — never an oldest-first sweep, which made
  burst saves embed the same rows N times and skip the new ones (`lib/server/post-save-embed.ts`).
  A daily Vercel cron (`/api/cron/embed`, `CRON_SECRET`-gated, see `apps/web/vercel.json`)
  drains the rest — these are the ONLY embedding paths.
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
- `GET /api/bookmarks?category=&browser=&device=&day=YYYY-MM-DD&tag=&url=&limit=&offset=` → `{bookmarks, total}` (`url` = exact match, Clerk sessions only — device tokens may not list bookmarks)
- `GET /api/search?q=…&mode=text|ai|hybrid&limit=&offset=` → `{mode, results:[{bookmark,score}], fallback?}` (`hybrid` = RRF blend of FTS + vector lists; the web grid and mobile both use it, limit 40). `offset` is OPTIONAL and opts into paging: the response then also carries `{offset, hasMore}` and you page with `offset += limit` while `hasMore` (`offset + limit` ≤ `MAX_SEARCH_DEPTH` = 200). Omitting it is byte-for-byte the pre-paging response. Every page re-retrieves from rank 0 to its end — for `hybrid` BOTH candidate lists reach that depth BEFORE the RRF merge, then the fused ranking is sliced (see `docs/features/mcp.md` → "Paging a search"); `search_bookmarks` over MCP is the same surface.
- `GET /api/meta` → sidebar facets + tag rail `{categories, browsers, devices, days, tags, total}`
- `GET /api/health` → `{ok, ai}` · `DELETE /api/bookmarks/:id` → 204
- `POST /api/sessions` — body `{name?, tabs:[{url,title?,favIconUrl?,windowId?}], browser?, device?, savedAt?}` → `201 {session}` (a saved browser-tab snapshot). `GET /api/sessions` → `{sessions}` · `DELETE /api/sessions/:id` → 204
- `POST /api/chat` — the one route that's a full agent, not a thin engine adapter: AI SDK v7
  agent chat. Body `{messages: UIMessage[], conversationId?, timezone?}` (first turn / legacy full
  history) or `{message: UIMessage, conversationId, timezone?}` (later turns — the server loads the
  stored history and appends; see `docs/features/skills.md`). Streams UI messages incl.
  `reasoning-*` chunks (Gemini `includeThoughts`); tools `searchBookmarks`/`queryDatabase`/
  `listSessions`/`listLiveTabs`/`useSkill`/`createSkill`/`installSkill`/`webSearch`/`fetchUrl` call `packages/engine` directly
  (no HTTP hop). Response headers `X-Conversation-Id` + `X-Ai-Source: included|own|own-fallback`
  (own-fallback = free credits exhausted, stored own key took over) + optional
  `X-Ai-Model-Tier: primary|fallback` (which half of the included stack answered) + optional
  `X-Ai-Note: own-key-incomplete` (mode is `own` but the key config can't run — e.g. OpenAI key, no
  model — so the included AI answered). Attachments = AI SDK `file`
  parts with `data:` URLs on the user message; rules in `CHAT_ATTACHMENT_RULES`/`classifyAttachment`
  (`packages/types/src/chat.ts`) — server answers `415 attachment-type-not-allowed`,
  `413 attachments-too-large`, `400 too-many-attachments` before any model call. System prompt =
  `apps/web/lib/server/chat-prompt.ts` (pure, tested). Message ids are scoped per conversation (a
  client id re-used across conversations is re-minted, never relocated); an attachment-only first
  message titles the thread after the file. Import existing browser
  bookmarks against a dev server started with `DEV_OPEN_API=1` (or set `BOOKMARK_API_TOKEN` to
  import against prod): `cd apps/web && pnpm tsx scripts/import-browser-bookmarks.ts [--apply]`.
- `GET|PUT /api/settings` — `{settings}` incl. `aiMode: "included"|"own"` (explicit, persisted;
  NULL column derives key-stored→own) and `ownKeyReady` (own config complete: provider + key, plus a
  model for openai/anthropic/custom — Google defaults to `gemini-3.8-flash`). PUT: `{aiMode}` switches WITHOUT touching the key (`own`
  needs a stored key, else 400); `{apiKey:"sk…"}` stores + sets `own`; `{apiKey:""}` removes + sets
  `included`; `{provider}` never clears model/key (`model:""` clears the model).
- `GET|POST /api/skills` → `{skills}` / `201 {skill}` (409 duplicate name, case-insensitive);
  `GET|PUT|DELETE /api/skills/:id` → `{skill}` / `{skill}` / 204. Body `createSkillSchema`
  (`packages/types/src/skills.ts`). `POST /api/skills/import {markdown, enabled?}` → 201 from a
  SKILL.md (`parseSkillMarkdown`: YAML frontmatter name/description + body, or `# Heading` +
  paragraph fallback; 400 `{error}` readable, 409 conflict). Enabled skills are indexed in the chat
  prompt + loadable via the `useSkill` tool; the chat can also `createSkill` (drafted or pasted
  SKILL.md) and `installSkill(url)` (net-guarded fetch, 64 KB, user-typed URLs only).
- `GET /api/account` → `{plan:"free"}` (master `tenants.plan`; features from `PLAN_FEATURES`).
  `DELETE /api/account` → 202 (deletes the Clerk user; the webhook tears down the tenant).
- `GET /api/app/releases` — PUBLIC like `/api/health` (rate-limited, `Cache-Control: public,
  max-age=300`) → `{releases:{macos?,ios?,android?}}` from master `app_releases` (migration v5);
  `{releases:{}}` without a master DB. Admin: `PUT /api/admin/releases/:platform`
  (`upsertAppReleaseSchema`: semver version, numeric build, https downloadUrl, optional
  minSupportedVersion/releaseNotes) → `{release}`; `DELETE` → 204. Native apps compare with
  `compareVersions`/`updateState` from `packages/types/src/releases.ts` — see
  `docs/features/releases.md`.

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

## Dev → test → prod procedure (NO HALF FEATURES)

Hard-learned rule: **a feature is not "built" until it runs in every environment it targets.**
Code that works locally but needs someone to "later" create a DNS record, set an env var, add a
Clerk origin, provision a DB, or flip a flag is a HALF FEATURE and is banned. Enablement ships
WITH the code, using the CLIs available on this machine (`vercel`, `turso`, `gh`, `clerk`,
Cloudflare API when a token is provided) — never offloaded to the user unless it's a genuine
access/permission blocker (then surface exactly what's blocked and why).

**Environments (strictly separated):**

| Env | Web/API | Data | Notes |
| --- | --- | --- | --- |
| local | `localhost:3000` | local sqlite: `DATABASE_URL=file:../../data/bookmarks-dev.db`, `MULTI_TENANT=1` + `TENANT_PLATFORM=local` → `data/tenants-dev/` (see `.env.example`) | dev Clerk instance; NEVER point local dev at prod Turso (this once leaked test data into prod) |
| preview | Vercel preview deploys / `bookmark-ai-wine.vercel.app` | prod Turso (until a preview DB split exists) | dev Clerk instance; preview env vars on Vercel are incomplete — check before relying on it |
| prod | `bookmark-ai.cloud` (Cloudflare DNS → Vercel; www is primary) | Turso cloud, multi-tenant (master + per-user DBs) | env vars live in Vercel as sensitive values (not readable back — keep root `.env` as source of truth) |

**Definition of done for any feature/change:**
1. Schema/migration ships in the SAME commit as the code (see next section).
2. Every env var it needs is set in root `.env`/`.env.local` (local), added to Vercel prod+preview
   (`vercel env add`), declared in `turbo.json` `build.env` (strict mode prunes undeclared vars),
   and documented in `.env.example`.
3. External surface updated: DNS records, Clerk `allowed_origins`/`AUTHORIZED_PARTIES`
   (`apps/web/lib/authorized-parties.ts`), extension `host_permissions`, per-target extension
   `.env.{development,preview,production}` files.
4. ALL clients that touch the feature are repointed (web, extension, mobile, desktop) — for their
   respective build targets, not just local.
5. Verified locally AND smoke-tested after the prod deploy (sign-in, `/api/health`, the feature's
   own flow). Deploy = `vercel deploy --prod` from the REPO ROOT (rootDirectory is set to
   `apps/web` in the project, so deploying from `apps/web/` double-nests the path).

## Database migrations (read before ANY schema change)

Production is **Turso cloud (libSQL/SQLite) holding REAL user data** — treat it like it.

There **IS** a self-managed migration runner now (`runMigrations` in
`packages/db/src/migrations.ts`): every DB carries a `schema_migrations` version table, and
pending versioned migrations are applied in ascending order on first touch after a deploy.
`ensureSchema`/`ensureMasterSchema` are thin wrappers that hand the runner
`TENANT_MIGRATIONS` (per-user DBs) / `MASTER_MIGRATIONS` (control plane). Each migration is a
list of statements run sequentially; the version row is recorded only after ALL of that
migration's statements succeed (per-migration all-or-nothing), so a throw leaves the version
pending and it re-runs next boot. v1 "baseline" is fully idempotent (`IF NOT EXISTS`
everywhere) so it's a no-op against pre-existing prod DBs — never edit v1; **append** a new
`Migration` for any change. A statement may be a bare `string` (a throw aborts the migration)
or `{ sql, tolerant: true }` — a tolerant statement that throws is warned-and-skipped so
optional/degrade-gracefully DDL (e.g. the libSQL vector ANN index on builds without vector
support) can't wedge that migration and every later one behind a permanently-pending version.

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
   it on first boot via the migration runner (`ensureSchema`). Never hand-run DDL against prod
   outside this path.
5. **Multi-tenant per-user Turso DBs behind a master/control-plane DB (BUILT).** Turso's
   "schema database" feature is DEPRECATED for new users (2026), so tenant migrations use our
   own runner (above): the additive-only + backup-first rules apply across ALL tenant DBs at
   once, raising the stakes further. Appending a `Migration` mutates every tenant DB on their
   next touch — treat it as a fleet-wide DDL, not a single-DB change.
6. **Schema change to user data ⇒ bump the export format.** Any migration that adds or renames
   a user-data column MUST also bump `SCHEMA_VERSION` in `packages/types/src/export.ts` and add
   a `migrateExportBundle` vN→vN+1 upgrader step, so previously-exported bundles keep importing
   losslessly. The export/import core lives in `packages/engine/src/export-import.ts`.

## Docs

- `docs/TESTING.md` — full verification playbook (curl flows, UI checks, extension loading,
  desktop automation harness). Run it after any nontrivial change.
- `docs/ARCHITECTURE.md` — data flow, design decisions, deferred work (client-side vector
  sync, Turso cloud, desktop search UI).
