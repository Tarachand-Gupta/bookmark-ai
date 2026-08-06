---
slug: /reference/api
title: API reference
description: Every REST endpoint, with request and response shapes.
sidebar_custom_props:
  icon: 🔗
---

# API reference

All responses are JSON. The API is served by the Next.js app at the same origin
as the web app — `https://bookmark-ai.cloud/api/*` in the hosted service, or
`http://localhost:3000/api/*` in local dev.

## Authentication

Every route **except `/api/health`** requires authentication. Attach a
[Clerk](https://clerk.com) session — either a browser session **cookie** or an
`Authorization: Bearer <session-jwt>` header.

```bash
curl https://bookmark-ai.cloud/api/meta \
  -H "Authorization: Bearer $TOKEN"
```

Common non-2xx responses:

| Status | Body | Meaning |
| --- | --- | --- |
| `401` | `{ "error": "Missing or invalid bearer token" }` / `{ "error": "Invalid or expired token" }` | Not signed in, or a bad/expired token. |
| `403` | `{ "error": "This account may not use this API", "code": "forbidden" }` | Signed in but not permitted on this instance. |
| `429` | `{ "error": "Too many requests" }` | Rate limit exceeded — 120 requests / 60 s per client IP. |

:::note Self-hosting
When `CLERK_SECRET_KEY` is unset the API runs in keyless mode and skips auth; a
local dev server started with `DEV_OPEN_API=1` also bypasses it. See
[Self-hosting → Web & API](/self-hosting/web-and-api).
:::

---

## Bookmarks

### POST /api/bookmarks

Save a URL. Open Graph scraping, categorization, tagging, and embedding happen
server-side. Upserts by URL (re-saving updates the existing bookmark and clears
its embedding for re-embedding).

Body:

```json
{
  "url": "https://example.com/article",
  "title": "Optional client-seen title",
  "browser": "chrome",
  "device": "laptop",
  "deviceName": "Work MacBook",
  "os": "macOS",
  "savedAt": "2026-07-22T10:00:00.000Z"
}
```

Only `url` is required. `browser` (`chrome` \| `firefox` \| `safari` \| `edge` \|
`arc` \| `other`) and `device` (`desktop` \| `laptop` \| `mobile` \| `tablet` \|
`other`) default to `other`. Optional `tags` (array of ≤10 short strings) are
merged into the auto-generated tags — the extension's native-sync uses this for
reading-list saves (`reading`, `article`).

Returns `201 { "bookmark": Bookmark }`.

```bash
curl -X POST https://bookmark-ai.cloud/api/bookmarks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com/article","browser":"chrome","device":"laptop"}'
```

### GET /api/bookmarks

List bookmarks with optional facet filters.

Query params: `category`, `browser`, `device`, `tag`, `url` (exact match),
`day` (`YYYY-MM-DD`), `from` / `to` (`YYYY-MM-DD` range bounds), `limit`
(1–200, default 100), `offset` (default 0).

Returns `{ "bookmarks": Bookmark[], "total": number }`.

```bash
curl "https://bookmark-ai.cloud/api/bookmarks?category=Dev&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

### DELETE /api/bookmarks/:id

Delete a bookmark. Returns `204`.

---

## Search

### GET /api/search

Search your library.

Query params: `q` (required), `mode` (`text` \| `ai` \| `hybrid`, default
`text`), `limit` (1–50, default 20).

Returns:

```json
{
  "mode": "hybrid",
  "results": [
    { "bookmark": { "...": "Bookmark" }, "score": 0.83, "exact": true }
  ],
  "sessionResults": [
    { "session": { "...": "Session" }, "score": 0.6 }
  ],
  "fallback": false
}
```

- `mode` — `text` (full-text bm25), `ai` (semantic), `hybrid` (RRF blend).
- `results[].exact` — hybrid only: `true` when the keyword side matched this
  result (clients section these as direct "matches" vs meaning-based "related").
- `sessionResults` — matching saved sessions, kept separate from bookmarks.
- `fallback` — `true` when an `ai`/`hybrid` search silently fell back to
  full-text (e.g. embeddings unavailable).

```bash
curl "https://bookmark-ai.cloud/api/search?q=slow+database+queries&mode=hybrid" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Metadata

### GET /api/meta

Sidebar facets and the tag rail.

Returns `{ categories, browsers, devices, days, tags, total }`, where each facet
is an array of `{ name, count }` (`days` uses `{ day, count }`).

### GET /api/health

**Public** — the only route that doesn't require auth. Returns
`{ "ok": true, "ai": boolean }`, where `ai` reports whether an AI provider is
configured.

```bash
curl https://bookmark-ai.cloud/api/health
```

---

## Sessions

### POST /api/sessions

Save a snapshot of open tabs.

Body:

```json
{
  "name": "Research",
  "tabs": [
    { "url": "https://example.com", "title": "Example", "favIconUrl": "...", "windowId": 1 }
  ],
  "browser": "chrome",
  "device": "laptop",
  "savedAt": "2026-07-22T10:00:00.000Z"
}
```

`tabs` must have at least one entry. Returns `201 { "session": Session }`.

### GET /api/sessions

Returns `{ "sessions": Session[] }`.

### DELETE /api/sessions/:id

Delete a saved session. Returns `204`.

---

## AI settings

### GET /api/settings

Returns `{ "settings": UserSettings }`. The API **never returns your API key** —
only `apiKeySet` and `apiKeyLast4`.

```json
{
  "settings": {
    "provider": "custom",
    "baseUrl": "https://openrouter.ai/api/v1",
    "model": "...",
    "apiKeySet": true,
    "apiKeyLast4": "1234",
    "liveServerUrl": null
  }
}
```

### PUT /api/settings

Update AI settings. Body fields: `provider` (`google` \| `openai` \|
`anthropic` \| `custom`), `apiKey`, `baseUrl` (required for `custom`), `model`,
`liveServerUrl`.

`apiKey` semantics: **absent** = keep the existing key, **`""`** = clear it, any
other string = set it. `liveServerUrl` follows the same keep/clear rule.

### POST /api/settings/ai/models

Validate a key by listing a provider's models. Body: `provider`, optional
`apiKey` (reuses the stored one if omitted), `baseUrl` (required for `custom`).
Returns `{ "models": [{ "id": "...", "label": "..." }] }`.

---

## Export & import

### GET /api/export

Download a lossless, versioned bundle of your data (bookmarks + saved sessions +
chat conversations + custom new-tab templates). Embeddings are omitted (regenerable).
Returns an export bundle JSON object.

```bash
curl https://bookmark-ai.cloud/api/export \
  -H "Authorization: Bearer $TOKEN" -o bookmark-ai-export.json
```

### POST /api/import

Import an export bundle. Bookmarks upsert by URL (re-importing merges rather than
duplicates). Returns `{ "imported": { "bookmarks": number, "sessions": number, "conversations": number, "newtabTemplates": number } }`.

```bash
curl -X POST https://bookmark-ai.cloud/api/import \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @bookmark-ai-export.json
```

---

## New Tab Canvas

Server side of the Chrome extension's new-tab page (chat-designed HTML templates
rendering live bookmark data in a sandbox). Design: `docs/features/newtab-canvas.md`.

### GET /api/newtab/templates

Returns `{ "templates": NewTabTemplate[] }`, newest updated first. The six built-in
presets are seeded on the first read of an empty table.

### POST /api/newtab/templates

Create a template with `{ html, config, name?, activate? }` → `201 { "template" }`.
`config` = `{ launcherPosition, thumbnail, themeTokens? }`.

### PATCH /api/newtab/templates/:id

Update name/html/config (config merges partial-over-current). Presets are read-only → `409`.

### DELETE /api/newtab/templates/:id

`204`. Presets → `409`. Deleting the active template re-activates a preset fallback.

### POST /api/newtab/templates/:id/activate

Make a template the active tab. `200 { "template" }`.

### GET /api/newtab/settings · PATCH /api/newtab/settings

Launcher corner + sidebar collapse. GET returns `{ "settings": null }` while no row
exists — that's what makes the first-run wizard render.

### GET /api/newtab/wizard

All six "wizard features" in one read-only fan-out: favorites, recent,
continueWhereYouLeft, workingOn, mostUsed, timeSpent.

---

## Ask AI

### POST /api/chat

The AI chat agent. Body `{ "messages": UIMessage[] }`; it streams UI messages
back. Its tools search your library (full-text, semantic) and list your sessions
to answer with citations. Runs on the AI provider you configured in
[Settings → AI](/guides/ai-providers).

---

## Live server endpoints

[Live sessions](/guides/live-sessions) are served by a **separate**
[live server](/self-hosting/live-server), not the main API — these paths have
**no `/api` prefix** and live at that server's origin. Auth uses the same Clerk
tokens.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness (no auth); pings Redis. |
| `POST` | `/live` | Push a device's open-tab checkpoint. `403 { ok, enabled: false }` when the feature is off; `429` over quota. |
| `GET` | `/live` | Full device list (first paint / non-SSE fallback). Returns `{ devices, enabled, ttlHours }`. |
| `GET` | `/live/stream` | **SSE** — a `state` event on connect and on every change. |
| `DELETE` | `/live/:deviceId` | Forget one device. Returns `204`. |
| `DELETE` | `/live` | Forget all devices (purge only; doesn't flip the flag). `204`. |
| `POST` | `/live/settings` | Toggle the account-wide enabled flag. Turning it off purges all devices. |

The push body is a per-device checkpoint (`deviceId`, `label`, `browser`,
`device`, `os`, `capturedAt`, `windows`). Omitting `windows` is a heartbeat that
just refreshes the TTL; `windows: []` records that every window is closed.
