---
slug: /self-hosting/overview
title: Overview
---

# Self-hosting overview

Bookmark AI is open source and self-hostable. The code lives at
[github.com/Tarachand-Gupta/bookmark-ai](https://github.com/Tarachand-Gupta/bookmark-ai).

## Architecture at a glance

```
  Browser extension ─┐
  Mobile app ────────┤   HTTPS + JSON
  Desktop app ───────┼──────────────►  Web app + API (Next.js)
  Web app ───────────┘                 apps/web/app/api/*
                                                │
                                                ▼
                                  libSQL database (Turso cloud
                                  or a local sqlite file)
```

The core is a single **Next.js** app (`apps/web`) that serves both the web UI
and the JSON API from the same deployment — there's no separate API server. It
talks to a **libSQL** database, which can be a **local sqlite file** or a
**Turso cloud** database (the query code is URL-agnostic).

One optional extra piece is the **live server** (`apps/live-server`) — a small
always-on service that powers [live sessions](/guides/live-sessions). You only
need it if you want that feature; everything else works without it.

## The pieces

| Piece | What it is | Required? |
| --- | --- | --- |
| **Web + API** | Next.js app; UI + all durable API routes | Yes |
| **Database** | libSQL — local sqlite file or Turso cloud | Yes |
| **AI provider** | Google Gemini / OpenAI / Anthropic / OpenAI-compatible | Optional (degrades to heuristics + text search) |
| **Auth (Clerk)** | Sign-in; can run in keyless mode for API-only self-host | Optional for the API |
| **Live server** | Fastify + Redis; real-time live sessions | Optional |

## Where to go next

- [Web & API](/self-hosting/web-and-api) — env vars and run modes.
- [Live server](/self-hosting/live-server) — the optional real-time service.
- [Multi-tenant](/self-hosting/multi-tenant) — running per-user databases.
