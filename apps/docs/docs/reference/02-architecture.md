---
slug: /reference/architecture
title: Architecture
description: A condensed tour of how Bookmark AI is put together.
sidebar_custom_props:
  icon: 🏗
---

# Architecture

A condensed tour of how Bookmark AI is put together. For self-hosting specifics,
see [Self-hosting](/self-hosting/overview).

## Data flow

Every client — the browser extension, web app, mobile app, desktop app, and any
AI agent connected over [MCP](/guides/mcp) — saves and reads through **one
API**: the Next.js route handlers in `apps/web`. There's no separate API server;
the same code serves local dev and production.

```
 Extension popup      Web add dialog       Mobile / Desktop
        │                   │                     │
        └──── POST /api/bookmarks ────────────────┘
                            │
              apps/web/app/api/*  (Next.js route handlers)
                            ▼
                  shared engine pipeline
             1. scrape Open Graph metadata
             2. categorize + tag
             3. save (upsert by URL)
             4. embed  (async, after the response)
                            │
                  libSQL DB (local sqlite or Turso cloud)
             bookmarks · FTS5 (trigger-synced) · embedding vector
```

The route handlers are a thin adapter over a shared engine that has no HTTP
framework dependency — that's what lets one code path back every client.

## The MCP server is another adapter, not another data path

The [MCP](/guides/mcp) endpoint (`POST /api/mcp`) is a stateless JSON-RPC
adapter sitting on the same shared engine. Its `search_bookmarks` tool runs the
identical `performSearch` the web grid runs; its `save_bookmark` tool runs the
identical save-then-enrich pipeline the extension triggers. So an agent gets the
same results, the same categorization, and the same embeddings as every other
client — there is no separate index, no separate store, and nothing to keep in
sync. What differs is only the credential (a `bkmcp_` token confined to that one
endpoint) and the per-account tool-call budget layered on top.

## The dashboard is one read, not many

The Home dashboard would naturally be six requests — recent saves, reading
queue, sessions, last session's tabs, cross-device saves, activity. It's
deliberately a single aggregated read (`GET /api/dashboard`) computed
server-side, with the client keeping a snapshot of the last response so a
revisit repaints instantly and then reconciles. Cards with nothing to show
render nothing rather than an empty frame, and the activity block stays hidden
until there's enough history to be worth drawing.

## Search: FTS5 + vectors, blended with RRF

The database is **libSQL** (SQLite-compatible). Two indexes power search:

- a full-text **FTS5** table, kept in sync by triggers, ranked with bm25;
- a **768-dimension embedding vector** per bookmark, searched by cosine distance.

The three search modes map onto these:

- **text** → FTS5 bm25.
- **ai** → embed the query, rank bookmarks by vector similarity.
- **hybrid** → **Reciprocal Rank Fusion (RRF)** of the two ranked lists, so exact
  keyword hits and meaning-based matches both surface.

Vector search is a brute-force scan (fine at small scale); an approximate-nearest
-neighbour index is created opportunistically for when a library grows.

## Embedding pipeline

Saves are fast because embedding is **asynchronous**. When you save a bookmark,
the API returns as soon as the row is written, then embeds the page in a
follow-up task (`after()`) once the response is sent. A **daily sweep** re-checks
for any bookmark still missing an embedding and fills it in, so nothing is left
unsearchable if a single attempt fails. This is the only embedding path, and it
self-heals.

## AI metering, and what isn't metered

Chat is the only AI feature that's metered, and only when it runs on the
**shared service key**. Those requests count input plus output tokens across
every tool-call round against a weekly budget stored alongside the account's own
data, which resets **Monday 00:00 UTC**; at the limit the chat route answers
`402` before anything streams instead of failing mid-response.

Two things fall outside that on purpose:

- **Your own provider key bypasses metering entirely.** When settings resolve to
  a user-configured provider, the request never touches the meter and never
  records against it.
- **Embeddings and categorization are never metered.** Search-by-meaning and
  auto-tagging run on the service's own key regardless, because a library that
  stops being searchable when a chat budget runs out would be a library you
  can't trust.

## Handling of user AI keys

A key you save in settings is encrypted at rest (AES-256-GCM) and never returned
to any client — the API only ever reports whether one is set and its last four
characters. A custom OpenAI-compatible **base URL** is validated before it's
stored and again before it's used to build an outbound request: the host is
resolved and rejected if it lands on a loopback, private, link-local, or
cloud-metadata address, so a base URL can't be used to make the server fetch
something internal on the caller's behalf.

## Graceful degradation

Every AI-dependent step has a fallback: no provider key → heuristic
categorization + text-only search (`fallback: true`); an Open Graph scrape
failure → the bookmark still saves; an embedding failure → the daily sweep
retries it later; an AI session name that can't be generated → a heuristic name
flagged with `fallback: true`.

## Migrations

Each database carries a `schema_migrations` version table, and a self-managed
migration runner applies pending, versioned migrations in order the first time
an instance is touched after a deploy. Migrations are **additive-only** for
anything automated (`CREATE TABLE/INDEX IF NOT EXISTS`, `ADD COLUMN`) so a new
build never breaks the data an older build is still serving. In multi-tenant
mode the same runner migrates every per-user database.

## Live sessions

[Live sessions](/guides/live-sessions) are deliberately split out from this
durable path. Because they're high-frequency and ephemeral, they live on a
separate [live server](/self-hosting/live-server) (Fastify + Redis) using
Server-Sent Events for reads and Redis TTL for retention — keeping that traffic
off the main database entirely.

The main API still carries a database-backed implementation of the same live
endpoints (`/api/live*`), which is where the feature started. It's served, but
the shipped clients all point at the live server instead; see the
[API reference](/reference/api#live-sessions-on-the-main-api).
