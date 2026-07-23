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

Every client — the browser extension, web app, mobile app, and desktop app —
saves and reads through **one API**: the Next.js route handlers in `apps/web`.
There's no separate API server; the same code serves local dev and production.

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

## Graceful degradation

Every AI-dependent step has a fallback: no provider key → heuristic
categorization + text-only search (`fallback: true`); an Open Graph scrape
failure → the bookmark still saves; an embedding failure → the daily sweep
retries it later.

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
