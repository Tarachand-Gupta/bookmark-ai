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

Every route **except `/api/health`** requires a credential. There are three
kinds, and they are not interchangeable.

**Clerk sessions** are the full-power credential and the one to use for anything
you'd do in the web app. Attach either a browser session **cookie** or an
`Authorization: Bearer <session-jwt>` header.

```bash
curl https://bookmark-ai.cloud/api/meta \
  -H "Authorization: Bearer $TOKEN"
```

**Device tokens** (`bkd_…`) are what the browser extension holds so it can keep
saving without the web app open. They last **90 days** and renew themselves
through `POST /api/device-token`; a renewal chain is capped at 365 days from its
root, after which the extension mints a fresh one from your signed-in session.
A device token is **scoped to a small allowlist of routes** — exactly the
extension's saving surface:

- `POST /api/bookmarks`
- `DELETE /api/bookmarks/:id`
- `POST /api/sessions`
- `GET /api/me`
- `POST /api/device-token`
- `GET /api/settings`

Anything else returns
`403 { "error": "This token may not access this endpoint", "code": "token-scope" }`. So a leaked device token cannot list,
search, export, or chat over your library.

**MCP tokens** (`bkmcp_…`) authenticate AI agents and are accepted **only** on
`/api/mcp`. They last **1 year** and have no renewal path — you mint a new one
and revoke the old. See [MCP](#mcp) below.

Common non-2xx responses:

| Status | Body | Meaning |
| --- | --- | --- |
| `401` | `{ "error": "Missing or invalid bearer token" }` / `{ "error": "Invalid or expired token" }` | Not signed in, or a bad/expired token. |
| `403` | `{ "error": "This account may not use this API", "code": "forbidden" }` | Signed in but not permitted on this instance. |
| `403` | `{ "error": "This token may not access this endpoint", "code": "token-scope" }` | A device token on a route it isn't scoped for. |
| `429` | `{ "error": "Too many requests" }` | Rate limit exceeded — 120 requests / 60 s per client IP. |
| `503` | `{ "error": "Account not provisioned yet", "code": "provisioning" }` | Multi-tenant instance where your database isn't ready yet; retry. |

:::note Self-hosting / keyless mode
When `CLERK_SECRET_KEY` is unset the API can run in keyless mode and skip auth
entirely. Outside production that's automatic; **in production it fails closed**
with `503 { "error": "Server auth misconfigured" }` unless you explicitly set
`ALLOW_OPEN_MODE=1`, so a secret that goes missing can't quietly expose
everything. Separately, a dev server started with `DEV_OPEN_API=1` opens the API
even with Clerk configured (ignored when `NODE_ENV=production`). See
[Self-hosting → Web & API](/self-hosting/web-and-api).
:::

## Rate limits and daily quotas

Two separate things apply.

**Per-IP rate limit** — every route (except `/api/health`) is behind an
in-memory sliding window of **120 requests / 60 s per client IP**, returning
`429 { "error": "Too many requests" }`.

**Per-account daily quotas** — these exist only on a multi-tenant deployment
such as the hosted service. Per account, per UTC day:

| Action | Limit |
| --- | --- |
| Bookmark saves (`POST /api/bookmarks`, and one unit per import) | 200 |
| Session saves (`POST /api/sessions`) | 50 |
| Chat requests (`POST /api/chat`) | 100 |
| Searches (`GET /api/search`, `hybrid` and `ai` modes only) | 500 |

Plain `text` search costs nothing — it never calls an AI provider, so it isn't
charged. Over a quota the response is:

```json
{ "error": "Daily limit reached (saves). Resets at midnight UTC." }
```

with status `429`. A single-database self-host doesn't enforce quotas at all.

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

List bookmarks with optional filters. Every filter is ANDed, and results are
always ordered by `savedAt` descending.

| Param | Accepts | Notes |
| --- | --- | --- |
| `category` | string | Exact category name. |
| `browser` | `chrome` \| `firefox` \| `safari` \| `edge` \| `arc` \| `other` | |
| `device` | `desktop` \| `laptop` \| `mobile` \| `tablet` \| `other` | |
| `tag` | string | Exact match; tags are stored lowercased. |
| `url` | http(s) URL | Exact match. |
| `day` | `YYYY-MM-DD` | Bookmarks saved on that day. |
| `from` | `YYYY-MM-DD` or ISO-8601 datetime | Inclusive lower bound — see below. |
| `to` | `YYYY-MM-DD` or ISO-8601 datetime | Inclusive upper bound — see below. |
| `limit` | 1–200 | Default `100`. |
| `offset` | ≥ 0 | Default `0`. |

Returns `{ "bookmarks": Bookmark[], "total": number }`.

```bash
curl "https://bookmark-ai.cloud/api/bookmarks?category=Dev&limit=20" \
  -H "Authorization: Bearer $TOKEN"
```

#### Date ranges: `from` and `to`

Both bounds are independent, optional, and **inclusive**. Each one accepts
either a calendar day or a full ISO-8601 datetime with an offset:

- `from=2026-08-11` starts at that day's first instant (`2026-08-11T00:00:00Z`).
- `to=2026-08-11` includes all of the 11th.
- `from=2026-08-11T15:00:00Z` is exact to the instant, and that instant itself
  is included. `+05:30`-style offsets work too.

The datetime form is what makes sub-day windows work — "everything I saved in
the last hour" is a `from` with a time on it. The library's **Date** picker
(**Last hour**, **Last 12 hours**, …) is built on exactly these params; see
[Library](/guides/library).

A malformed bound returns `400` with:

```json
{ "error": "Expected YYYY-MM-DD or an ISO 8601 datetime (e.g. 2026-08-11T15:00:00Z)" }
```

```bash
curl "https://bookmark-ai.cloud/api/bookmarks?from=2026-08-11T15:00:00Z" \
  -H "Authorization: Bearer $TOKEN"
```

:::note
`from`/`to` exist **only** on this route. `GET /api/search` has no date bounds,
and neither does the MCP `list_bookmarks` tool (it takes a single `day`).
:::

### GET /api/bookmarks/:id

Fetch one bookmark. Returns `{ "bookmark": Bookmark }`, or
`404 { "error": "Bookmark not found" }`.

### DELETE /api/bookmarks/:id

Delete a bookmark. Returns `204`, or `404` if it doesn't exist.

---

## Search

### GET /api/search

Search your library.

| Param | Accepts | Notes |
| --- | --- | --- |
| `q` | string | **Required.** |
| `mode` | `text` \| `ai` \| `hybrid` | Default **`text`**. |
| `limit` | 1–50 | Default `20`. |

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
  Note the default is `text`: ask for `hybrid` explicitly if you want blended
  results (the web and mobile clients do).
- `results[].exact` — hybrid only: `true` when the keyword side matched this
  result (clients section these as direct "matches" vs meaning-based "related").
- `sessionResults` — matching saved sessions, kept separate from bookmarks, and
  returned in **every** mode (up to 5).
- `fallback` — `true` when an `ai`/`hybrid` search silently fell back to
  full-text (e.g. embeddings unavailable).

`hybrid` and `ai` embed the query, so on a multi-tenant deployment they count
against the daily **searches** quota; `text` doesn't.

```bash
curl "https://bookmark-ai.cloud/api/search?q=slow+database+queries&mode=hybrid" \
  -H "Authorization: Bearer $TOKEN"
```

---

## Metadata

### GET /api/meta

Sidebar facets and the tag rail.

Returns `{ categories, browsers, devices, days, tags, total }`, where each facet
is an array of `{ name, count }` (`days` uses `{ day, count }`; `days` covers the
last 30, `tags` the top 24).

### GET /api/dashboard

The Home dashboard in **one** aggregated read, so the page doesn't fan out into
half a dozen requests. Clerk sessions only — a device token gets `403
token-scope`, because this is a whole-library read.

Optional `?device=<desktop|laptop|mobile|tablet|other>` is the caller's own
device class, and only feeds `otherDeviceBookmarks`.

```json
{
  "recentBookmarks": [],
  "readingQueue": { "total": 12, "items": [] },
  "recentSessions": [],
  "lastSessionTabs": { "id": "...", "tabs": [] },
  "otherDeviceBookmarks": [],
  "activity": {
    "days": [{ "day": "2026-08-01", "count": 3 }],
    "topCategories": [],
    "browserSplit": []
  },
  "totalBookmarks": 412,
  "totalSessions": 9
}
```

`lastSessionTabs` is `null` when there's no saved session, and `activity` is
`null` until the account has 20+ bookmarks. `otherDeviceBookmarks` is empty
unless `?device=` is given. See [Dashboard](/guides/dashboard) for what each
piece renders as.

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
  "os": "macOS",
  "savedAt": "2026-07-22T10:00:00.000Z"
}
```

`tabs` is required, 1–500 entries. Returns `201 { "session": Session }`
immediately; an AI title and description are generated after the response is
sent, and never overwrite a name you typed.

### GET /api/sessions

Returns `{ "sessions": Session[] }`.

### GET /api/sessions/:id

Returns `{ "session": Session }`, or `404`.

### PATCH /api/sessions/:id

Rename a saved session. Body `{ "name": string }` (1–200 characters, trimmed).
Returns `{ "session": Session }`, or `404`.

### POST /api/sessions/:id/ai-name

Ask the AI to name and describe the session from its tabs — the **Summarize**
button in the UI. Takes no body. Returns:

```json
{
  "session": { "...": "Session" },
  "name": "Zig build system, libSQL vectors",
  "description": "…",
  "fallback": false
}
```

It never fails on an AI error: without a working provider it degrades to a
heuristic name and sets `fallback: true`.

### DELETE /api/sessions/:id

Delete a saved session. Returns `204`, or `404`.

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
    "liveServerUrl": null,
    "onboardedAt": "2026-08-01T09:12:00.000Z",
    "nativeSyncEnabled": true,
    "nativeSyncFull": false,
    "mcpTools": null,
    "aiUsage": {
      "usedTokens": 312000,
      "limitTokens": 1000000,
      "resetsAt": "2026-08-17T00:00:00.000Z"
    }
  }
}
```

- `onboardedAt` — when this account finished the onboarding tour, or `null`.
- `nativeSyncEnabled` / `nativeSyncFull` — the extension's browser-bookmark
  mirroring switches (default on / off). See
  [Saving bookmarks](/guides/saving-bookmarks).
- `mcpTools` — the MCP tool allowlist, or `null` meaning "all tools".
- `aiUsage` — the free AI credit meter: tokens used this week, the current
  weekly limit, and `resetsAt`, the next **Monday 00:00 UTC**. It's `null` if
  the meter can't be read, which the UI treats as "no meter to show" rather
  than an error.

### PUT /api/settings

Update settings. Body fields, all optional — an omitted field is left alone:

| Field | Accepts |
| --- | --- |
| `provider` | `google` \| `openai` \| `anthropic` \| `custom` |
| `apiKey` | string — **absent** keeps the existing key, `""` clears it, anything else sets it |
| `baseUrl` | http(s) URL — required when `provider` is `custom` |
| `model` | string |
| `liveServerUrl` | http(s) URL, ≤200 chars; `""` or `null` clears it |
| `onboarded` | `true` stamps `onboardedAt`; it is never un-set |
| `nativeSyncEnabled` | boolean |
| `nativeSyncFull` | boolean |
| `mcpTools` | array of tool names (an exact allowlist), or `null` to reset to all |

Stored API keys are encrypted at rest. A `custom` base URL is validated at write
time against private, loopback, link-local, and cloud-metadata addresses, and
`400 { "error": "Base URL must be a reachable public http(s) endpoint" }` when it
fails. `PUT` returns the same `{ "settings": … }` shape as `GET`, meter included.

### POST /api/settings/ai/models

Validate a key by listing a provider's models. Body: `provider`, optional
`apiKey` (reuses the stored one if omitted), `baseUrl` (required for `custom`).
Returns `{ "models": [{ "id": "...", "label": "..." }] }`. Failure modes are
`400 { "error": "An API key is required" }`,
`401 { "error": "Invalid API key" }`, and
`502 { "error": "Could not reach provider" }`.

---

## Export & import

### GET /api/export

Download a lossless, versioned bundle of your data — every bookmark, saved
session, and saved Ask AI conversation. Embeddings are omitted (they're
regenerable). Takes **no query parameters**. The response sets
`content-disposition: attachment; filename="bookmark-ai-export.json"` so a plain
browser navigation saves it straight to disk.

```json
{
  "schemaVersion": 4,
  "exportedAt": "2026-08-11T09:00:00.000Z",
  "counts": { "bookmarks": 412, "sessions": 9, "conversations": 14 },
  "bookmarks": [],
  "sessions": [],
  "conversations": []
}
```

```bash
curl https://bookmark-ai.cloud/api/export \
  -H "Authorization: Bearer $TOKEN" -o bookmark-ai-export.json
```

:::note There is no CSV endpoint
CSV export is a client-side feature: tick rows in the library and the browser
builds the file from what's on screen — nothing is uploaded and no API is
involved. See [Library](/guides/library). This endpoint is JSON only.
:::

### POST /api/import

Import an export bundle as the raw request body. Bookmarks upsert by URL and
original timestamps are preserved, so re-importing the same file is a safe
no-op. Older bundles are version-upgraded on the way in.

Returns:

```json
{ "imported": { "bookmarks": 412, "sessions": 9, "conversations": 14 } }
```

The body is capped at **20 MB** — over that you get
`413 { "error": "Import is too large (max 20 MB)" }`. An invalid, unknown, or
newer-than-supported bundle returns `400` with the reason.

```bash
curl -X POST https://bookmark-ai.cloud/api/import \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data @bookmark-ai-export.json
```

---

## Ask AI

### POST /api/chat

The AI chat agent. It streams AI SDK UI messages back.

Body — send either the whole transcript or just the newest message:

```json
{
  "messages": [{ "id": "...", "role": "user", "parts": [] }],
  "conversationId": "optional-existing-conversation"
}
```

`{ "message": UIMessage }` is accepted in place of `messages`. Omit
`conversationId` and a new conversation is created, titled from your first
message. Either way the response carries an **`X-Conversation-Id`** header with
the conversation the turn was written to.

The agent's tools are:

| Tool | What it does |
| --- | --- |
| `searchBookmarks` | Full-text, semantic, or hybrid search of your library. |
| `queryDatabase` | A single **read-only** SQL `SELECT`/`WITH` over your bookmarks and sessions — counts, aggregates, date math. Row-capped. |
| `listSessions` | Your saved sessions, optionally filtered by text. |
| `listLiveTabs` | Read-only view of tabs open **right now** across your devices, if you've turned live sharing on. |
| `webSearch` | Public web search, for things not in your library. |
| `fetchUrl` | Fetch one page and read its text. |

Answers are grounded in tool results and cite sources as markdown links. Fetched
and searched web content is treated strictly as untrusted data, never as
instructions.

Failure modes worth handling:

- `402 { "error": "free-limit-exceeded", "usedTokens": …, "limitTokens": … }` —
  this week's free AI credits are spent and the request is running on the shared
  service key. Configure your own provider key (never metered) or wait for the
  Monday reset.
- `503 { "error": "No AI model is configured — …" }` — no user key and no server
  key. See [AI providers](/guides/ai-providers).
- `404 { "error": "conversation-not-found" }` — unknown `conversationId`.
- `429` — over the daily chats quota.

### GET /api/chat/conversations

Your saved conversations, most recently updated first:

```json
{ "conversations": [{ "id": "...", "title": "...", "createdAt": "...", "updatedAt": "..." }] }
```

### GET /api/chat/conversations/:id

Returns `{ "conversation": …, "messages": [{ "id", "role", "parts" }] }` —
UIMessage-compatible, so a client can hydrate the transcript directly. `404`
when unknown.

### DELETE /api/chat/conversations/:id

Delete a conversation and its messages. Returns `204`, or `404`.

---

## Account & credentials

### GET /api/me

The current identity:
`{ "signedIn": true, "name": string|null, "email": string|null }`. Device tokens may call this — it's how the extension shows who
it's signed in as. In keyless/open mode `name` and `email` are `null`.

### DELETE /api/account

Delete your account. Returns `202 { "ok": true }`. This deletes the Clerk user;
the resulting webhook is what tears down that user's database. In keyless/open
mode there's no account to delete and it returns `400`.

### POST /api/device-token

Mint or renew the extension's long-lived credential. Takes no body.

```json
{ "token": "bkd_…", "expiresInSeconds": 7776000, "expiresAtMs": 1786000000000 }
```

Called with a **Clerk session** it mints a fresh 90-day token and starts a new
renewal chain. Called with an existing **device token** it renews while keeping
the chain's root — but only for 365 days from that root, after which it returns
`401 { "error": "Re-authentication required", "code": "reauth" }` so a stolen
token can't renew forever. Requires Clerk; keyless mode returns `501`.

### GET /api/live-token

Mint a short-lived Clerk session JWT for talking to the separate
[live server](/self-hosting/live-server), which is a different origin no cookie
reaches. Returns `{ "token": "…", "expiresInSeconds": 600 }`. Requires an active
Clerk session (`401` without one, `501` in keyless mode).

---

## Live sessions on the main API

The main API also carries endpoints for [live sessions](/guides/live-sessions),
backed by your database rather than Redis. They are served and supported, but
the shipped clients don't use them — web, extension, and mobile all talk to the
separate [live server](/self-hosting/live-server) instead, which is what
`NEXT_PUBLIC_LIVE_API_URL` (or a per-user **Live server URL**) points at. The
paths mirror each other deliberately, minus the `/api` prefix on the live
server.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/live` | The device list: `{ devices, enabled, ttlHours }`. |
| `POST` | `/api/live` | Push a device's open-tab checkpoint → `{ ok: true, enabled: true }`. `403 { ok: false, enabled: false }` when sharing is off; `429` over the per-device daily push limit. |
| `DELETE` | `/api/live` | Forget every device. `204`. A pure purge — it doesn't change the account flag. |
| `DELETE` | `/api/live/:id` | Forget one device. `204`, idempotent. |
| `POST` | `/api/live/settings` | Body `{ "enabled": boolean }` → `{ "enabled": … }`. Turning it **off** purges every device in the same request. |

---

## MCP

Bookmark AI ships a [Model Context Protocol](https://modelcontextprotocol.io)
server, so an AI agent can search and save through the same engine every other
client uses. For client configuration walkthroughs see [MCP](/guides/mcp) — this
section is the wire contract.

### POST /api/mcp

The endpoint. Transport is **streamable HTTP with stateless JSON-RPC 2.0**:
plain `application/json` responses, never SSE, no session ids (`Mcp-Session-Id`
is never issued), and no JSON-RPC batching. Only `POST` works —
`GET` and `DELETE` return
`405 { "error": "Method not allowed — this MCP endpoint is stateless JSON-RPC over POST" }`.

Protocol versions spoken: `2025-06-18` (preferred), `2025-03-26`, `2024-11-05`.
The negotiated version is echoed on every response, errors included.
`serverInfo` is `{ "name": "bookmark-ai", "version": "1.0.0" }`.

Auth is a bearer MCP token:

```bash
curl -X POST https://bookmark-ai.cloud/api/mcp \
  -H "Authorization: Bearer bkmcp_…" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Errors:

| Status | Body |
| --- | --- |
| `401` | `{ "error": "Missing MCP bearer token" }` / `{ "error": "Invalid or expired token" }` / `{ "error": "This token has been revoked" }` — all carry `WWW-Authenticate: Bearer realm="bookmark-ai-mcp"` |
| `429` | `{ "error": "Too many requests" }` |
| `503` | `{ "error": "MCP not configured" }` — the server has no `DEVICE_TOKEN_SECRET`, so no token could be minted or verified |

### The tools

| Tool | Parameters | Returns |
| --- | --- | --- |
| `search_bookmarks` | `query` (required); `mode` `text`\|`semantic`\|`hybrid` (default `hybrid`); `limit` 1–40 (default 10) | `{ mode, fallback, results }` |
| `save_bookmark` | `url` (http(s), required); `title` (≤500) | `{ bookmark }` — the only tool that writes. Re-saving a URL updates it. |
| `list_bookmarks` | `category`, `tag`, `browser`, `device`, `day` (`YYYY-MM-DD`), `limit` 1–100 (default 20), `offset` — all optional | `{ bookmarks, total }`, newest first |
| `get_library_overview` | none | `{ categories, browsers, devices, days, tags, total }` |

Every tool returns the same compact bookmark summary — `id`, `url`, `title`,
`description`, `category`, `tags`, `savedAt`, plus `score` on search. Never
embeddings, never the raw Open Graph blob. `mode: "semantic"` is the MCP name
for the REST API's `ai` mode.

All four tools are on by default and can be switched off individually in
**Settings → MCP → Tools** (`mcpTools` on `PUT /api/settings`). A disabled tool
disappears from `tools/list`, and calling it anyway errors with:

```text
Unknown or disabled tool "<name>". Call tools/list to see what this
server currently exposes.
```

### Token management

Minting and revoking is **Clerk-session only** — a token can never mint or
revoke a token, so a leaked one can't extend its own life or lock you out.

- `POST /api/mcp/tokens` — body `{ "name": string }` (≤60 chars) →
  `201 { token, id, name, createdAt }`. **The `token` value appears here and
  nowhere else** — nothing stores it and no other route can return it.
- `GET /api/mcp/tokens` →
  `{ "tokens": [{ id, name, createdAt, lastUsedAt, revokedAt, hint }] }`.
  `hint` is a non-secret fragment (`bkmcp_eyJhb…Qk3Fa`) so you can tell tokens
  apart; it's `null` for tokens minted before hints shipped.
- `DELETE /api/mcp/tokens/:id` → `204`. The row is kept, stamped revoked, so it
  stays visible as history. Revocation takes effect on that token's very next
  request.

Minting returns
`503 { "error": "MCP is not configured on this server (DEVICE_TOKEN_SECRET is unset)" }` on an instance without the signing secret —
there'd be nothing to sign the token with.

### MCP rate limits

Two independent layers.

**Per-IP**, on every request: the same 120 / 60 s window as the REST API, as
HTTP `429`.

**Per-account and tiered**, on `tools/call` only — the handshake, `ping`, and
`tools/list` are free. All windows are checked on every call, and the counters
are shared across every token you hold:

| Window | Max tool calls |
| --- | --- |
| 1 minute | 60 |
| 5 minutes | 250 |
| 1 hour | 1,500 |
| 1 day (UTC) | 8,000 |
| 1 week (UTC, Monday-start) | 40,000 |

Exceeding a tier is reported as a **tool error, not an HTTP error** — the
response is still `200`, and the tool result reads
`Rate limit exceeded (<window>): retry after <n> seconds`.

---

## Operational endpoints

Not for client use, listed for completeness:

- `GET /api/cron/embed` — the daily embedding sweep, gated by
  `Authorization: Bearer $CRON_SECRET`.
- `POST /api/webhooks/clerk` — svix-signed Clerk events that provision and tear
  down accounts. Public, but every request is signature-verified.
- `GET|PATCH /api/admin/ai-limit` — platform-admin only (`ADMIN_USER_IDS`);
  reads and adjusts the fleet-wide free weekly AI budget.

---

## Live server endpoints

[Live sessions](/guides/live-sessions) as the shipped clients use them are
served by a **separate** [live server](/self-hosting/live-server), not the main
API — these paths have **no `/api` prefix** and live at that server's origin.
Auth uses the same Clerk tokens (see `GET /api/live-token` for clients that
can't mint one themselves).

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
