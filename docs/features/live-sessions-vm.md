# Live Sessions v2 — VM server (Fastify + Redis + SSE)

**Status: BUILT on branch `live-sessions`, not deployed.** Companion to
`live-sessions.md` (feature design) and `live-sessions-status.md` (v1 build). This
documents the v2 backend that moves the feature off Vercel/Turso.

## Why

v1 served Live Sessions from the Vercel `/api/live` routes over per-user Turso DBs.
The **reads** don't scale economically: web polls 4s/15s and mobile 4s/30s while an
Ongoing view is open — each poll is a Vercel invocation **and** a Turso read, per
viewer, for purely ephemeral data. v2 moves it to a small always-on server.

## Shape

**Split by durability.** Durable data (bookmarks, saved sessions, search, chat, the
`Save-a-window` action) stays on Vercel + Turso. All **ephemeral live tab state +
the enabled consent flag** move to `apps/live-server` (Fastify) backed by **Redis**.

- **Reads = SSE** (`GET /live/stream`), not polling → idle = zero traffic, instant
  updates, and Redis pub/sub as the fan-out backplane (horizontal scale, no sticky
  sessions). Producer (extension) stays HTTP POST — an MV3 service worker can't hold
  a socket. See `apps/live-server/README.md` for the endpoint table + Redis model.
- **Retention = Redis TTL** (7-day key expiry, reset on push/heartbeat) — no reaper.
  Heartbeat (`windows` omitted) refreshes TTL without touching windows; `windows:[]`
  writes the wipe. Freshness computed server-side.
- **Auth = Clerk JWT verified offline** via `@clerk/backend` `verifyToken` (JWKS
  cached, networkless; or pin `CLERK_JWT_KEY`+`CLERK_ISSUER`). Mirrors the web app's
  `require-user.ts`: azp absent = pass (native mobile), wrong = reject; `CLERK_ALLOWED_USER_IDS`
  allowlist. The same `Bearer` tokens all three clients already send.
- **Consent flag lives in Redis** (AOF-persisted). If ever lost → absent ⇒ OFF, the
  fail-safe/privacy-default direction. This is the one datum less durable than Turso.

The live server is the **sole authority** for the feature, so it needs only Clerk
JWKS + Redis — no Turso, no `@bookmark-ai/db`, no tenant routing. The wire contract
is `@bookmark-ai/types` (`packages/types/src/live.ts`), reused verbatim and bundled in.

## Resilience

Self-healing by convergence — every reconnect re-syncs full state (not deltas). The
extension push loop is already outage-proof (never-throws, backoff, ~2min heartbeat);
SSE auto-reconnects and the server sends a full `state` frame on every connect; both
containers `restart: unless-stopped`; Redis AOF survives restarts. Total VM/disk loss
self-heals: flags default OFF and online extensions re-push within ~2min.

## Deploy

Containerized, portable, in-repo: `apps/live-server/Dockerfile` + `docker-compose.live.yml`
(prod) / `docker-compose.live.dev.yml` (dev), run as separate `-p live-prod` / `-p live-dev`
stacks. Fronted by **Caddy** on `live.bookmark-ai.cloud` (auto-TLS; SSE needs
`flush_interval -1` — see `deploy/Caddyfile.snippet`). CI builds → GHCR → SSH deploy
(`.github/workflows/live-server-deploy.yml`).

## Client seams (return shapes unchanged → no view-component edits)

- **Extension** — new `local:liveApiUrl` (default `https://live.bookmark-ai.cloud`);
  `lib/live-api.ts` push/settings/delete repointed; `host_permissions` gains the live
  origin. Push-only, no SSE.
- **Web** — `NEXT_PUBLIC_LIVE_API_URL`; `hooks/use-live.ts` swaps polling for a
  `@microsoft/fetch-event-source` SSE subscriber (browser EventSource can't send the
  Bearer header) keeping the `LiveState` shape + visibility gating; `getLive` stays as
  first-paint/fallback.
- **Mobile** — `getLiveUrl()` on the local/prod switch; `hooks/useLiveDevices.ts` swaps
  polling for a `react-native-sse` subscriber keeping the `LiveDevicesState` shape +
  AppState/segment gating.

## Retirement (deferred — sequencing)

After the clients ship pointing at the live server AND it's deployed, remove the old
Vercel path: `apps/web/app/api/live/*`, `packages/engine/src/live-sessions.ts` (device
logic), `packages/db/src/queries/live.ts` device queries + `rows.ts` bits. **Keep** the
v3 Turso tables as additive dead schema (no destructive migration), and keep the live
tables in `sql-tool.ts` `BLOCKED_IDENTIFIERS`. Until then both paths coexist.

## Not done

Real-device end-to-end (needs Clerk sign-in / simulator), the actual deploy + DNS +
Caddy + Clerk `allowed_origins` for `live.bookmark-ai.cloud`, and the retirement step.
No committed tests for the server yet (verified via live smoke: 12 contract/invariant
checks + a containerized-image run).
