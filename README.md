# Bookmark AI

Save bookmarks from any browser, on any device — organized automatically by AI and
browsable everywhere: **web**, **iOS/iPad**, a **native desktop app**, and a
**cross-browser extension**.

Every save captures the page's Open Graph data (title, description, preview image, site,
favicon) plus provenance: which browser, which device, which day. An AI pass categorizes
and tags each bookmark; embeddings power semantic ("AI") search next to classic full-text
search. You can also snapshot every open tab as a **session** and restore it later as a
new window or a tab group.

## The big picture

```
   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐
   │   Web app   │  │  Extension  │  │  Mobile app │  │   Desktop   │
   │  Next.js 15 │  │ WXT (Chrome │  │  Expo / RN  │  │  Zig native │
   │   (Vercel)  │  │ FF, Safari) │  │  iOS + iPad │  │    (macOS)  │
   └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘
          │    Clerk JWT   │    Clerk JWT   │   Clerk JWT    │ (local only)
          ▼                ▼                ▼                ▼
   ┌──────────────────────────────────────────────────────────────────┐
   │                    Express API  (apps/server)                    │
   │   auth → rate limit → routes:  bookmarks · search · meta ·       │
   │                                sessions · health                 │
   │                                                                  │
   │   save pipeline:  scrape OG data → AI categorize + tag →         │
   │                   embed (async worker, self-healing 30s sweep)   │
   └───────────┬───────────────────────────────┬──────────────────────┘
               │                               │
               ▼                               ▼
   ┌───────────────────────┐       ┌───────────────────────┐
   │   libSQL / Turso DB   │       │     Google Gemini     │
   │  FTS5 full-text index │       │  2.5-flash categorize │
   │  768-dim vector col   │       │  gemini-embedding-001 │
   └───────────────────────┘       └───────────────────────┘
```

One rule keeps every surface thin: **clients only construct a `CreateBookmarkInput` and
POST it**. The server owns scraping, categorization, and embedding, so saves are instant
from the client's point of view and all four UIs stay simple.

## Repo layout (Turborepo + pnpm workspaces)

| Path | What it is | README |
| --- | --- | --- |
| `apps/server` | Express API :4545 — scraping, AI, search, auth, rate limiting | [apps/server/README.md](apps/server/README.md) |
| `apps/web` | Next.js 15 + shadcn/ui web app :3000, Clerk-gated, AI chat | [apps/web/README.md](apps/web/README.md) |
| `apps/extension` | WXT + React popup → Chrome MV3, Firefox MV2, Safari | [apps/extension/README.md](apps/extension/README.md) |
| `apps/desktop` | Native SDK (vercel-labs/native, Zig) macOS app | [apps/desktop/README.md](apps/desktop/README.md) |
| `apps/mobile` | Expo (React Native) iOS/iPad app, native iOS design | [apps/mobile/README.md](apps/mobile/README.md) |
| `packages/types` | Zod schemas — **the** API contract every surface shares | [packages/types/README.md](packages/types/README.md) |
| `packages/db` | libSQL client, schema, query modules (FTS5 + vectors) | [packages/db/README.md](packages/db/README.md) |
| `packages/ui` | Design tokens (`theme.css`) + shared React components | [packages/ui/README.md](packages/ui/README.md) |

### How the apps share code (and why `@bookmark-ai/…` shows up inside `node_modules`)

The three `packages/*` folders are real npm packages — they have names like
`@bookmark-ai/types` — but they are **never published to the internet**. The root
`pnpm-workspace.yaml` declares them as *workspace packages*, and each app depends on them
with the version `"workspace:*"` in its `package.json`.

When `pnpm install` runs, it doesn't download those packages — it creates **symlinks**:

```
apps/extension/node_modules/@bookmark-ai/types  →  packages/types   (symlink, not a copy)
apps/web/node_modules/@bookmark-ai/ui           →  packages/ui      (symlink, not a copy)
```

So if you browse an app's `node_modules` and find Bookmark AI source (or this repo's
README) in there — that's your own `packages/*` code showing through a symlink. Editing
`packages/types/src/…` instantly updates every app that imports it; there is no publish
or copy step. That's the whole point: one schema change in `packages/types` and the
server, web app, extension, and mobile app all get the new type at once.

## Quick start

```bash
pnpm install

# 1. API (needs .env — see "Environment" below)
pnpm --filter @bookmark-ai/server dev        # http://localhost:4545

# 2. Web app
pnpm --filter @bookmark-ai/web dev           # http://localhost:3000

# 3. Extension (pick your browser)
pnpm --filter @bookmark-ai/extension build            # → .output/chrome-mv3
pnpm --filter @bookmark-ai/extension build:firefox    # → .output/firefox-mv2
pnpm --filter @bookmark-ai/extension build:safari     # → .output/safari-mv2

# 4. Desktop (needs Zig 0.16 + @native-sdk/cli)
cd apps/desktop && native dev

# 5. Mobile (needs Xcode; Android needs JDK + Android SDK)
cd apps/mobile && npx expo run:ios       # build + install on simulator
npx expo start                           # Metro bundler
```

Whole-repo: `pnpm build` (never while the web dev server is running) ·
`pnpm check-types` · desktop tests: `cd apps/desktop && native test`.

## Environment

Secrets live in the **gitignored** root `.env` (server + scripts) and
`apps/web/.env.local` (web). Never commit them.

| Variable | Where | What |
| --- | --- | --- |
| `GEMINI_API_KEY` | `.env` | Enables AI categorization, embeddings, and AI search. Without it everything degrades gracefully to heuristics/full-text (`fallback: true`). |
| `DATABASE_URL` + `DATABASE_AUTH_TOKEN` | `.env` | Turso cloud libSQL. Point `DATABASE_URL` at a local `file:` path for fully-local mode — query code is URL-agnostic. |
| `CLERK_JWT_KEY`, `CLERK_AUTHORIZED_PARTIES`, `CLERK_ALLOWED_USER_IDS` | server (Render) | Turn on API auth enforcement. Unset locally = open API for desktop app / curl / scripts. |
| Clerk publishable + secret keys | `apps/web/.env.local` | Web sign-in. The publishable key is also baked into the extension and mobile app (public by design). |
| `NEXT_PUBLIC_API_URL` | web env | Where the web app finds the API (Vercel points it at Render). |

## Authentication (Clerk)

- **Web**: every route is gated by `middleware.ts` except sign-in/sign-up.
- **Extension**: no in-popup sign-in — it mirrors the web app's session via Clerk's
  `syncHost` (sign in on the web app once; the extension picks it up).
- **Mobile**: native sign-in screen (Google SSO or emailed code); the session lives in
  the iOS keychain.
- **API**: with `CLERK_JWT_KEY` set, every `/api` route except `/api/health` requires
  `Authorization: Bearer <session JWT>`, verified **networklessly** (public key only —
  the server never holds the Clerk secret). Plus a CORS origin allowlist and a
  120 req/min/IP rate limit. Without the key (local dev) the API is open on purpose.

## Deployment (live)

| Surface | Where | How it deploys |
| --- | --- | --- |
| Web | Vercel — `bookmark-ai-theta.vercel.app` | `vercel --prod` (project root dir = `apps/web`) |
| API | Render — `bookmark-ai-server.onrender.com` | auto-deploys on push to `main` (free tier: cold-starts after idle, first request can take ~50 s) |
| DB | Turso (`aws-ap-south-1`) | managed; `turso` CLI |

## Docs

- [`CLAUDE.md`](CLAUDE.md) — agent/contributor guide: current state, hard-won gotchas, where features go
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — data flow + design decisions + roadmap
- [`docs/TESTING.md`](docs/TESTING.md) — full verification playbook for every surface
- [`docs/PRODUCTION.md`](docs/PRODUCTION.md) — store-submission + production checklist (web, extension stores, mobile)
