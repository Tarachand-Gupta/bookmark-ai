# @bookmark-ai/web — the web app

Next.js 15 + shadcn/ui on **:3000**. Sidebar shell with facet filters (categories,
browsers, devices, days, tags), bookmark card grid, keyword + AI search, saved sessions
view, and an AI chat that can search your library with tools.

## Auth

Every route is Clerk-gated by `middleware.ts` (`auth.protect()`) except `/sign-in` and
`/sign-up`. Keys live in `apps/web/.env.local` (gitignored). The browser extension
piggybacks on this app's session via Clerk `syncHost` — sign in here once and the
extension is signed in too.

## How it talks to the API

- `lib/api.ts` — every fetch attaches `Authorization: Bearer <token>` from the live
  Clerk session (`window.Clerk`). `NEXT_PUBLIC_API_URL` picks the API host (localhost
  in dev, Render in production).
- `app/api/chat/route.ts` — the one **server-side** route: an AI SDK v7 agent
  (Gemini) streaming UI messages, with `searchFullText` / `searchSemantic` tools that
  proxy `/api/search`. It gets tokens fresh per tool call via `auth().getToken()`
  (session JWTs expire in 60 s, chat streams run longer).
- `lib/extension-bridge.ts` — messages the installed extension
  (`chrome.runtime.sendMessage` to its pinned id) so "Open all" can restore a session
  into a new window or a tab group. Falls back to popup-blocked-prone `window.open`
  loops when the extension isn't installed.

## Layout

| Path | What |
| --- | --- |
| `app/` | App Router pages + the chat API route |
| `components/library/` | feature components (cards grid, sidebar facets, search, sessions view, chat) |
| `components/ui/` | shadcn primitives (generated — `pnpm dlx shadcn@latest add <x>`) |
| `lib/` | API client, extension bridge, utils |
| `middleware.ts` | Clerk route protection |

Branding comes from [`packages/ui`](../../packages/ui/README.md)'s `theme.css` — do
**not** let the shadcn CLI append duplicate tokens to `app/globals.css` (delete whatever
it adds after `@layer base`).

## Run / deploy

```bash
pnpm --filter @bookmark-ai/web dev     # http://localhost:3000
```

Deployed on **Vercel** (`bookmark-ai-theta.vercel.app`), project Root Directory
`apps/web`. Deploy with `vercel --prod`. Never run `pnpm turbo build` while the dev
server is up — the prod build clobbers `.next` (then `rm -rf apps/web/.next` and restart).
