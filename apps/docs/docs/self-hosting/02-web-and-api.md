---
slug: /self-hosting/web-and-api
title: Web & API
---

# Web & API

The web app and API are one Next.js app (`apps/web`). This page covers the
environment variables and run modes for self-hosting it.

## Core environment variables

```bash
# Database (libSQL). A local sqlite file…
DATABASE_URL=file:./data/bookmarks.db
# …or a Turso cloud database (libsql://…) plus its auth token:
# DATABASE_URL=libsql://your-db.turso.io
# DATABASE_AUTH_TOKEN=...            # required only for libsql:// URLs

# AI provider key — powers categorization, and the built-in fallbacks.
# Optional: without it, categorization uses heuristics and search is text-only.
GEMINI_API_KEY=
```

:::note
`DATABASE_URL` decides where your data lives. A `file:` URL keeps everything on
local disk — fully offline. A `libsql://` URL points at Turso cloud and needs
`DATABASE_AUTH_TOKEN`. The query code doesn't care which you use.
:::

## AI is optional — graceful degradation

If `GEMINI_API_KEY` is unset, the server still runs. It degrades:

- categorization falls back to domain/keyword **heuristics**,
- search falls back to **full-text only** and marks responses `fallback: true`,
- Open Graph scrape failures don't block a save.

## Auth modes

Sign-in uses [Clerk](https://clerk.com). For self-hosting there are open modes
so you don't have to wire up Clerk just to use the API:

- **Keyless mode.** If `CLERK_SECRET_KEY` is unset/empty, the API skips Clerk
  entirely — a self-host, single-tenant mode. (The web *page* UI still needs a
  Clerk publishable key to render its sign-in components, so a fully self-hosted
  web UI still wants your own free Clerk instance; the API alone does not.)
- **Dev bypass.** `DEV_OPEN_API=1` (ignored when `NODE_ENV=production`) opens
  the API even when Clerk is configured. This is how tokenless local clients —
  like the desktop app, which can't attach auth headers — talk to a local dev
  server:

  ```bash
  DEV_OPEN_API=1 pnpm --filter @bookmark-ai/web dev
  ```

When Clerk *is* configured, API routes accept either a browser session cookie or
an `Authorization: Bearer <token>` session JWT.

## Rate limiting

Every route (except `/api/health`) is behind a simple in-memory sliding-window
rate limit — **120 requests per 60 seconds per client IP** — returning
`429 { "error": "Too many requests" }` when exceeded.

## Running it

```bash
pnpm install
pnpm --filter @bookmark-ai/web dev      # local dev on http://localhost:3000
```

The same `apps/web` code serves local dev and a production deployment (the
reference deployment runs on Vercel). See the repository README for the full
build and deploy details.
