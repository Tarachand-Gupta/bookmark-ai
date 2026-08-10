# MCP server (`POST /api/mcp`)

Bookmark AI exposes its search/browse/save surface as a **Model Context Protocol** server so any
MCP client — Claude Code, Claude Desktop, a custom agent — can work against the user's library.
It is a route handler in `apps/web`, so the same code serves `http://localhost:3000/api/mcp` in
dev and `https://bookmark-ai.cloud/api/mcp` in production. No new service, no new env var.

## Transport

Streamable HTTP, **stateless**, hand-rolled JSON-RPC 2.0 (no MCP SDK dependency).

| Request | Behavior |
| --- | --- |
| `POST /api/mcp` | The only real method. `application/json` in, `application/json` out — never SSE. |
| `GET`, `DELETE` | `405` JSON (`allow: POST, OPTIONS`). There is no stream to open and no session to end. |
| `OPTIONS` | Handled by `middleware.ts` CORS (`204`). MCP clients are non-browser and send no `Origin`, so the allowlist never applies to them. |
| `Mcp-Session-Id` | Accepted and **ignored**. We never issue one; nothing is resumable. |
| `MCP-Protocol-Version` | Set on **every** response (including errors). Echoes the client's if we speak it, else `2025-06-18`. |

Supported methods:

- `initialize` → `{protocolVersion, capabilities:{tools:{}}, serverInfo:{name:"bookmark-ai", version:"1.0.0"}}`.
  Version negotiation: the request's `protocolVersion` is echoed when it is one of
  `2025-06-18`, `2025-03-26`, `2024-11-05`; anything else is answered with `2025-06-18`.
- `notifications/initialized` (and any `notifications/*`, and any request without an `id`) → HTTP
  `202` with an empty body.
- `ping` → `{}`.
- `tools/list` → the tools this user has enabled, each with a JSON Schema `inputSchema`.
- `tools/call` → `{content:[{type:"text", text:"<JSON>"}]}`; failures come back as
  `{content:[…], isError:true}` with a message the model can act on.
- Anything else → JSON-RPC `-32601`.

Malformed input maps to `-32700` (unparseable JSON) / `-32600` (not an object, wrong `jsonrpc`,
missing `method`). **A JSON-RPC batch array is refused with `-32600`** — batching was removed in
the 2025-06-18 revision. All of these are HTTP `200` with a JSON-RPC `error` member; only
transport/auth problems use HTTP error statuses.

## Auth

`Authorization: Bearer bkmcp_…` — a long-lived token the user mints in **Settings → MCP**.

- Self-signed HS256 JWT over **`DEVICE_TOKEN_SECRET`** (reused deliberately: the extension's
  device tokens already use it, and the two families can never be confused because they differ in
  both prefix and `scp` claim). No new secret to provision. Unset ⇒ `/api/mcp` returns
  `503 {"error":"MCP not configured"}`.
- On the wire, `.` is swapped for `~`. **Load-bearing**, not cosmetic: a dotted three-segment
  bearer looks like a session JWT to Clerk's middleware, which crashes the whole request with
  `MIDDLEWARE_INVOCATION_FAILED` before the handler runs.
- Claims: `sub` (Clerk user id, or `"local"` in open/self-host mode), `iat`, `exp` = iat + 365d,
  `jti` (16-byte hex — the `mcp_tokens` row id), `scp: "mcp"`. A verifier rejects any other scope.
- `401` responses carry `WWW-Authenticate: Bearer realm="bookmark-ai-mcp"`.

The route authenticates itself and does **not** call `requireUser()`. Order: per-IP rate limit
(shared `checkRateLimit`, 120/60s) → configured check → signature verify → DB resolution
(`isMultiTenant()` ? tenant DB : shared DB) → **revocation check** (the `jti` row must exist with
`revoked_at IS NULL`) → `last_used_at` refresh (throttled to ≤1/hour, via `after()`) → load the
user's tool allowlist → dispatch.

Containment, all verified: an MCP token can search/browse/save and nothing else — it cannot list,
mint, or revoke tokens (`/api/mcp/tokens*` needs a real Clerk session), cannot delete library
data, and cannot drive the chat agent. A device token (`bkd_`) is refused on `/api/mcp`, and an
MCP token is refused everywhere `requireUser()` guards.

## Tools

| Tool | Arguments | Backed by |
| --- | --- | --- |
| `search_bookmarks` | `query`, `mode` `text\|semantic\|hybrid` (default `hybrid`), `limit` 1–40 (default 10) | engine `performSearch` (same stack as the web grid; `semantic` → the engine's `ai` mode) |
| `save_bookmark` | `url` (http/https), `title?` | engine `saveBookmarkFast` + `after()` `enrichBookmark`/`embedPending` — byte-for-byte the `POST /api/bookmarks` flow, `browser`/`device` = `"other"` |
| `list_bookmarks` | `category?`, `tag?`, `browser?`, `device?`, `day?` (YYYY-MM-DD), `limit` 1–100 (default 20), `offset?` | db `listBookmarks` (validated through the REST `listBookmarksQuerySchema`) |
| `get_library_overview` | none | db `getMeta` — the `/api/meta` facets |

Results are compact summaries (`id, url, title, description, category, tags, savedAt`, plus
`score` for search) — never embeddings or the raw Open Graph blob. Descriptions are written for an
LLM caller and live in `apps/web/lib/server/mcp/tools.ts`.

## Rate limits

Per **user** (shared across all of their tokens), counted in their own DB (`mcp_usage`). All five
tiers are checked on every `tools/call`; the handshake, `ping`, and `tools/list` are free so a
throttled client can still connect and read the reason.

| Window | Limit | Bucket |
| --- | --- | --- |
| minute | 60 | `minute:<epoch-floored ms>` |
| 5 minutes | 250 | `five_minutes:<epoch-floored ms>` |
| hour | 1500 | `hour:<epoch-floored ms>` |
| day | 8000 | `day:YYYY-MM-DD` (UTC date) |
| week | 40000 | `week:YYYY-MM-DD` (Monday of the ISO week, UTC) |

Exceeding one is a **tool result**, not an HTTP error: HTTP stays `200` and the result is
`isError: true` with `Rate limit exceeded (<window>): retry after <n> seconds`. Limits are
constants in `apps/web/lib/server/mcp/limits.ts` — deliberately not env-configurable. Counter rows
carry an `expires_at` and are swept opportunistically (~1% of bumps), so no cron is involved.

## Per-user configuration

- `user_settings.mcp_tools_json` — JSON array of enabled tool names. `NULL`/absent = **all tools
  enabled** (default-on). Read/written through `GET`/`PUT /api/settings` as `mcpTools`
  (`null` resets to the default; an array, including `[]`, sets the allowlist exactly). Unknown
  names are rejected by the Zod enum, and a malformed stored value degrades to "all tools".
- Disabling a tool removes it from `tools/list` and makes `tools/call` report it as
  `Unknown or disabled tool "…"`.

Token management (**Clerk session only**):

- `GET /api/mcp/tokens` → `{tokens:[{id,name,createdAt,lastUsedAt,revokedAt}]}` — never the value.
- `POST /api/mcp/tokens {name}` → `201 {token,id,name,createdAt}`. The `token` value is
  transmitted **once**; nothing stores it.
- `DELETE /api/mcp/tokens/:id` → `204`, stamping `revoked_at`. The row is kept as history and the
  token stops working on its very next request.

The Settings → MCP pane (`apps/web/components/library/mcp-settings.tsx`) surfaces all of this:
endpoint URL, the four tool switches, the token list with revoke confirmation, mint-and-copy-once,
and a collapsible client-setup snippet.

## Schema

Tenant migration **v9 "mcp"** (`packages/db/src/migrations.ts`, additive-only):

```sql
CREATE TABLE IF NOT EXISTS mcp_tokens (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL,
  last_used_at TEXT, revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS mcp_usage (
  bucket TEXT PRIMARY KEY, count INTEGER NOT NULL DEFAULT 0, expires_at TEXT NOT NULL
);
ALTER TABLE user_settings ADD COLUMN mcp_tools_json TEXT;  -- tolerant
```

None of it is exported user data (credentials + regenerable metering, like `ai_usage`), so the
export `SCHEMA_VERSION` stays **3**. Appending v9 mutates every tenant DB on its next touch — the
usual fleet-wide-DDL caveat applies, but all three statements are idempotent and additive.

## Client setup

Claude Code, one line:

```bash
claude mcp add --transport http bookmark-ai https://bookmark-ai.cloud/api/mcp \
  --header "Authorization: Bearer bkmcp_…"
```

Any client with a JSON config file:

```json
{
  "mcpServers": {
    "bookmark-ai": {
      "type": "http",
      "url": "https://bookmark-ai.cloud/api/mcp",
      "headers": { "Authorization": "Bearer bkmcp_…" }
    }
  }
}
```

## curl reference

```bash
TOKEN=bkmcp_…
B=https://bookmark-ai.cloud   # or http://localhost:3000

# handshake
curl -s -X POST $B/api/mcp -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'
# → {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},
#    "serverInfo":{"name":"bookmark-ai","version":"1.0.0"}}}

curl -s -X POST $B/api/mcp -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}' -o /dev/null -w '%{http_code}\n'
# → 202

# discovery
curl -s -X POST $B/api/mcp -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'

# search
curl -s -X POST $B/api/mcp -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_bookmarks",
       "arguments":{"query":"rust async","mode":"hybrid","limit":5}}}'

# save
curl -s -X POST $B/api/mcp -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"save_bookmark",
       "arguments":{"url":"https://example.com/","title":"Example"}}}'

# facets
curl -s -X POST $B/api/mcp -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_library_overview"}}'
```

## Files

| Path | Purpose |
| --- | --- |
| `apps/web/app/api/mcp/route.ts` | HTTP adapter: auth, DB routing, revocation, limits, dispatch; `405` on GET/DELETE |
| `apps/web/app/api/mcp/tokens/route.ts` | List + mint (Clerk session only) |
| `apps/web/app/api/mcp/tokens/[id]/route.ts` | Revoke |
| `apps/web/lib/server/mcp-token.ts` | `bkmcp_` mint/verify (modeled on `device-token.ts`) |
| `apps/web/lib/server/mcp/protocol.ts` | JSON-RPC validation + dispatcher (framework-free) |
| `apps/web/lib/server/mcp/tool-kit.ts` | Tool declaration types, arg validation, `McpToolInputError` |
| `apps/web/lib/server/mcp/tools.ts` | The four tools, thin over engine/db |
| `apps/web/lib/server/mcp/limits.ts` | Tier constants + window/bucket math |
| `apps/web/lib/server/mcp/subject.ts` | Clerk-user vs `"local"` self-host subject |
| `apps/web/components/library/mcp-settings.tsx` | Settings → MCP pane |
| `packages/db/src/queries/mcp.ts` | Token CRUD + atomic usage bump |
| `packages/types/src/mcp.ts` | Tool-name enum, token schemas, allowlist parser |

## Tests

`apps/web` has vitest now (`pnpm --filter @bookmark-ai/web test`) — 33 unit tests covering the
token round-trip/tamper/expiry/wrong-scope rejection, the rate-limit window math, and the JSON-RPC
dispatcher (negotiation, notifications, tool errors, batch rejection, limit refusals). The
dispatcher is tested through its framework-free entry points rather than the route handler, since
the handler needs a Next request scope for `after()`; the HTTP layer is covered by the live smoke
flow above instead.
