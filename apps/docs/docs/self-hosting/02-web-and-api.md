---
slug: /self-hosting/web-and-api
title: Web & API
description: Deploy the Next.js web app and API that serve the whole product.
sidebar_custom_props:
  icon: 🌐
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

# AI provider key — powers categorization, embeddings (search by meaning), and
# the chat agent. Optional: without it, categorization uses heuristics and
# search is text-only.
GEMINI_API_KEY=

# Sign-in (Clerk). Both keys, or neither — see "Auth modes" below.
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
CLERK_SECRET_KEY=sk_...
```

:::note
`DATABASE_URL` decides where your data lives. A `file:` URL keeps everything on
local disk — fully offline. A `libsql://` URL points at Turso cloud and needs
`DATABASE_AUTH_TOKEN`. The query code doesn't care which you use.
:::

## Secrets for tokens and stored keys

Two secrets don't gate the app booting, but features quietly stay off without
them. Both are also declared in the build environment, so set them wherever you
build as well as wherever you run.

```bash
# HMAC-SHA256 secret signing the extension's long-lived `bkd_…` device tokens
# AND the `bkmcp_…` MCP tokens (same secret, separate token families).
# 64-char hex: openssl rand -hex 32
DEVICE_TOKEN_SECRET=

# 32 random bytes, base64, encrypting AI provider keys users save in Settings.
# Generate: openssl rand -base64 32
AI_KEY_ENCRYPTION_SECRET=
```

**`DEVICE_TOKEN_SECRET`** is required for two things:

- **Extension device tokens.** Unset, the API declines `bkd_` tokens and the
  extension falls back to the Clerk session path — which is the fragile path
  Safari can't use at all.
- **MCP.** Unset, no MCP token can be minted or verified, so `POST /api/mcp`
  answers `503 { "error": "MCP not configured" }` and the mint/list routes
  answer `503` too. This is deliberately a config error, not an auth error, so
  a self-hoster can tell the two apart.

If you also run the [live server](/self-hosting/live-server), give it the
**same** `DEVICE_TOKEN_SECRET` so it can verify the same device tokens offline.

**`AI_KEY_ENCRYPTION_SECRET`** encrypts AI provider keys that users save in
Settings (AES-256-GCM, stored as `enc:v1:<iv>:<ciphertext>`). Be aware of the
honest fallback: if the secret is **missing or invalid, a saved key is written
to the database in plaintext** with a loud warning in the logs rather than the
save failing. The read path tolerates those legacy plaintext rows and
re-encrypts them on the next write once a secret is present. Set it before
anyone saves a key.

## AI is optional — graceful degradation

If `GEMINI_API_KEY` is unset, the server still runs. It degrades:

- categorization falls back to domain/keyword **heuristics**,
- search falls back to **full-text only** and marks responses `fallback: true`,
- Open Graph scrape failures don't block a save,
- chat returns `503` until either you set a server key or the user configures
  their own provider in Settings.

## AI metering on a self-hosted instance

The hosted service's "free AI credits" are a metering concept, and it's worth
knowing exactly how it behaves on your own instance, because it is **not** off
by default.

Chat requests that run on the **server's** `GEMINI_API_KEY` are counted
(input + output tokens, tool-call rounds included) against a weekly budget that
resets Monday 00:00 UTC. With no control-plane database configured, the compiled
default applies: **1,000,000 tokens per week**, tracked in the database those
chats read — so per user on a multi-tenant instance, and instance-wide on a
single shared database. Past the limit, `POST /api/chat` returns `402
free-limit-exceeded`.

Two ways out:

- **A user's own provider key is never metered.** Once someone sets a provider,
  key, and model in Settings → AI, their chats bypass the meter entirely. On a
  single-user self-host that's the simplest answer.
- **Raise or lower the budget** with `PATCH /api/admin/ai-limit`, which needs a
  master (control-plane) database — see
  [Multi-tenant](/self-hosting/multi-tenant) — and an admin allowlist:

  ```bash
  ADMIN_USER_IDS=user_abc,user_def   # CSV of Clerk user ids
  ```

Embeddings and categorization are never metered, so search by meaning keeps
working regardless of the chat budget.

## Auth modes

Sign-in uses [Clerk](https://clerk.com). For self-hosting there are open modes
so you don't have to wire up Clerk just to use the API:

- **Keyless mode.** If `CLERK_SECRET_KEY` is unset/empty, the API skips Clerk
  entirely — a self-host, single-tenant mode. (The web *page* UI still needs a
  Clerk publishable key to render its sign-in components, so a fully self-hosted
  web UI still wants your own free Clerk instance; the API alone does not.)

  **In production this fails closed.** A missing secret in production would
  otherwise serve every request unauthenticated, so instead the API returns
  `503 { "error": "Server auth misconfigured" }` unless you opt in explicitly:

  ```bash
  ALLOW_OPEN_MODE=1     # only needed to run open with NODE_ENV=production
  ```

- **Dev bypass.** `DEV_OPEN_API=1` (ignored when `NODE_ENV=production`) opens
  the API even when Clerk is configured. This is how tokenless local clients —
  like the desktop app, which can't attach auth headers — talk to a local dev
  server:

  ```bash
  DEV_OPEN_API=1 pnpm --filter @bookmark-ai/web dev
  ```

When Clerk *is* configured, API routes accept a browser session cookie, an
`Authorization: Bearer <token>` session JWT, or — on the extension's small route
allowlist — a `bkd_` device token. You can additionally restrict who may use the
instance at all:

```bash
CLERK_ALLOWED_USER_IDS=user_abc,user_def   # CSV; unset = any signed-in user
```

Anyone outside the list gets `403 { "code": "forbidden" }`.

## Rate limiting

Every route (except `/api/health`) is behind a simple in-memory sliding-window
rate limit — **120 requests per 60 seconds per client IP** — returning
`429 { "error": "Too many requests" }` when exceeded. It's per instance, so on
serverless it's a coarse abuse guard rather than a precise quota. Per-account
daily quotas are a [multi-tenant](/self-hosting/multi-tenant) feature.

## The embedding sweep (cron)

Embedding runs right after each save, and a daily sweep picks up anything that
fell through. That sweep is an endpoint, so it needs a shared secret:

```bash
CRON_SECRET=...        # any long random string
```

`GET /api/cron/embed` requires `Authorization: Bearer $CRON_SECRET` and returns
`401` otherwise. On the reference deployment Vercel's cron calls it daily and
attaches the header itself (`apps/web/vercel.json`); on your own host, schedule
it however you like — once a day is plenty.

## Optional extras

```bash
# Live sessions: the separate live server's base URL, baked into the client.
NEXT_PUBLIC_LIVE_API_URL=https://live.your-domain.example

# Clerk webhook signing secret (svix) — needed for account provisioning and
# teardown, i.e. any multi-tenant deployment.
CLERK_WEBHOOK_SECRET=whsec_...
```

:::warning `NEXT_PUBLIC_API_URL`
There's also a `NEXT_PUBLIC_API_URL` override for pointing the client at a
separately hosted API. Leave it **unset** unless you truly mean it: the value is
inlined into the production client bundle at build time, so a stale one makes
your deployed app call the wrong origin.
:::

The repository's `.env.example` is the full list, and `turbo.json`'s
`build.env` array is the set of variables the build itself reads — if you add
one, it has to be declared there or strict mode prunes it.

## Running it

```bash
pnpm install
pnpm --filter @bookmark-ai/web dev      # local dev on http://localhost:3000
```

The same `apps/web` code serves local dev and a production deployment (the
reference deployment runs on Vercel). See the repository README for the full
build and deploy details.
