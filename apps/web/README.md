# @bookmark-ai/web — the web app

Next.js 15 + shadcn/ui on **:3000**. Sidebar shell with facet filters (categories,
browsers, devices, days, tags), bookmark card grid, keyword + AI search, saved sessions
view, and an AI chat that can search your library with tools.

## Auth

Every **page** is Clerk-gated by `middleware.ts` (`auth.protect()`) except `/sign-in` and
`/sign-up`. Keys live in `apps/web/.env.local` (gitignored). The browser extension
piggybacks on this app's session via Clerk `syncHost` — sign in here once and the
extension is signed in too. `/api/*` routes are **not** `protect()`ed by the middleware —
they self-protect (see below), so Bearer-token clients (extension, mobile) get clean
JSON errors instead of an HTML sign-in redirect.

## This app IS the deployed API

`app/api/*` holds the deployed API itself — bookmarks, search, meta, sessions, health,
and `cron/embed` — one Vercel deployment serves both the web UI and these routes at
[bookmark-ai.cloud](https://bookmark-ai.cloud). Each route handler is a thin adapter over
[`packages/engine`](../../packages/engine/README.md), which owns the actual scrape /
categorize / embed / search logic (shared with the local-only Express server in
`apps/server`).

- `lib/server/context.ts` — a singleton `{ db, gemini }` per warm serverless instance
  (survives dev HMR too), so routes don't reconnect on every request.
- `lib/server/require-user.ts` — `requireUser()`: every route calls this first. Checks
  the Clerk session (cookie or `Authorization: Bearer` JWT), an azp origin check, and the
  `CLERK_ALLOWED_USER_IDS` allowlist — returns a `401`/`403` JSON response to short-circuit
  with, or `null` to proceed.
- `middleware.ts` also owns API CORS (it's the one thing middleware still does for
  `/api/*`): known web origins (`bookmark-ai.cloud` apex + `www`, localhost, the Vercel
  alias) plus any browser-extension scheme get `Access-Control-Allow-Origin`; `OPTIONS`
  preflights get a `204`.
- Embedding runs inline via Next's `after()` right after a save completes, plus a daily
  Vercel Cron hitting `GET /api/cron/embed` (`vercel.json`, gated by `CRON_SECRET`) as a
  safety net for anything that fell through.

## How it talks to the API

- `lib/api.ts` — every fetch is **same-origin** (`API_URL` defaults to `""`, so calls are
  relative `/api/...`) and attaches `Authorization: Bearer <token>` from the live Clerk
  session (`window.Clerk`). `NEXT_PUBLIC_API_URL` is an optional override for anyone
  hosting the API separately — unset in every deployed/local env today.
- `app/api/chat/route.ts` — the one route that's a full agent, not a thin adapter: an AI
  SDK v7 agent (Gemini) streaming UI messages, with `searchFullText` / `searchSemantic`
  tools that call `packages/engine`'s `performSearch` **directly** — no HTTP hop, and no
  per-tool-call token fetch (that only mattered when tools proxied `/api/search` over
  HTTP and session JWTs — good for 60 s — could expire mid-stream).
- `lib/extension-bridge.ts` — messages the installed extension
  (`chrome.runtime.sendMessage` to its pinned id) so "Open all" can restore a session
  into a new window or a tab group. Falls back to popup-blocked-prone `window.open`
  loops when the extension isn't installed.

## Layout

| Path | What |
| --- | --- |
| `app/` | App Router pages + `api/*` route handlers (the deployed API) |
| `components/library/` | feature components (cards grid, sidebar facets, search, sessions view, chat) |
| `components/ui/` | shadcn primitives (generated — `pnpm dlx shadcn@latest add <x>`) |
| `lib/` | API client, extension bridge, utils |
| `lib/server/` | `context.ts` (singleton db/Gemini clients), `require-user.ts` (per-route Clerk auth) |
| `middleware.ts` | Clerk page protection + API CORS |

Branding comes from [`packages/ui`](../../packages/ui/README.md)'s `theme.css` — do
**not** let the shadcn CLI append duplicate tokens to `app/globals.css` (delete whatever
it adds after `@layer base`).

## Run / deploy

```bash
pnpm --filter @bookmark-ai/web dev     # http://localhost:3000 — web + API together
```

Deployed on **Vercel** at [bookmark-ai.cloud](https://bookmark-ai.cloud) (alias:
`bookmark-ai-theta.vercel.app`), project Root Directory `apps/web` — this one deployment
serves the frontend and `/api/*`. Deploy with `vercel --prod`. Never run
`pnpm turbo build` while the dev server is up — the prod build clobbers `.next` (then
`rm -rf apps/web/.next` and restart).
