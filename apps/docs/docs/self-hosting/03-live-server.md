---
slug: /self-hosting/live-server
title: Live server
description: Run the optional Fastify + Redis service that powers live tabs.
sidebar_custom_props:
  icon: 🖥
---

# Live server

The **live server** (`apps/live-server`) is the optional service that powers
[live sessions](/guides/live-sessions). You only need it if you want that
feature — bookmarks, search, chat, and saved sessions all work without it.

## What it is

A small, always-on **Fastify** server backed by **Redis**. It's the sole
authority for live sessions, so it needs only Clerk (for auth) and Redis — no
database. Design choices:

- **Reads are Server-Sent Events** (`GET /live/stream`) instead of polling, so an
  idle viewer generates zero traffic and updates arrive instantly.
- **Retention is Redis TTL** — live tab data expires after 7 days of a device
  going quiet, with no background reaper.
- **Auth reuses the same Clerk tokens** the clients already send, verified
  offline.
- The **enabled flag defaults to off** — if it's ever missing, the fail-safe is
  privacy (nothing is shared).

## Running it locally

The repo ships docker-compose files for local development:

```bash
# Just a Redis to talk to
docker run -d --name live-redis -p 6379:6379 redis:7-alpine --appendonly yes

# The server (tokenless dev mode)
cd apps/live-server
DEV_OPEN_API=1 NODE_ENV=development REDIS_URL=redis://127.0.0.1:6379 pnpm dev

# Or the whole dev stack (server + its own Redis) in containers:
docker compose -p live-dev -f apps/live-server/docker-compose.live.dev.yml up
```

## Environment variables

```bash
PORT=8080                             # what it listens on behind your proxy
REDIS_URL=redis://127.0.0.1:6379      # Redis connection

# Auth — EITHER the Clerk secret key (fetches JWKS once, then offline)…
CLERK_SECRET_KEY=sk_...
# …OR a pinned public key + issuer for a fully egress-free server:
# CLERK_JWT_KEY="-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
# CLERK_ISSUER=https://clerk.your-domain

# Who may use it, and which token `azp` values are accepted (both CSV).
# CLERK_ALLOWED_USER_IDS empty = any signed-in user. An absent azp always
# passes (native mobile tokens carry none); a wrong one is rejected.
CLERK_ALLOWED_USER_IDS=
CLERK_AUTHORIZED_PARTIES=https://your-app.example.com,chrome-extension://<id>

# CORS: browser origins allowed to call the server (CSV). Mirror your web app.
# REQUIRED when NODE_ENV=production — the server refuses to start rather than
# reflect any origin. Empty is a dev-only convenience.
LIVE_ALLOWED_ORIGINS=https://your-app.example.com

# Device tokens: the SAME HMAC secret the web app signs `bkd_…` tokens with, so
# this server can verify them offline. Optional — unset means device tokens are
# declined here and clients use the Clerk path (which Safari can't).
DEVICE_TOKEN_SECRET=

# Retention / abuse bounds (defaults shown)
LIVE_TTL_DAYS=7
LIVE_PUSH_QUOTA_PER_DAY=2000

# SSE fan-out tuning (defaults shown). The first batches a user's pushes into
# one broadcast; the second re-emits state while someone is watching so "last
# seen" ages stay current. 0 disables coalescing.
LIVE_FANOUT_COALESCE_MS=500
LIVE_REFRESH_EMIT_MS=60000
```

## Pointing the clients at it

Once the live server is running, point each client at its URL:

- **Web** — `NEXT_PUBLIC_LIVE_API_URL`.
- **Per-user override** — set a **Live server URL** in the app under
  **Settings → Live sessions**, behind the advanced "Use my own live server"
  disclosure; it overrides the app default for that user.
- **Extension** — the live server URL in the popup settings.

With neither set, the clients treat live sessions as unconfigured and don't
attempt a connection.

See the endpoint list in the [API reference](/reference/api#live-server-endpoints).
The main API also carries database-backed `/api/live*` routes, but no shipped
client uses them — running this service is how live sessions actually work.

:::note
The live server is pure JavaScript with no native bindings, so a CI-built build
runs as-is on common architectures. The reference deployment runs under systemd
behind a reverse proxy that flushes SSE immediately; docker-compose files are
provided for local development.
:::
