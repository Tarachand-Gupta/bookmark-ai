# @bookmark-ai/live-server

Dedicated always-on server for **Live Sessions** ("tabs from other devices"). It
offloads the high-frequency, ephemeral live-tab traffic off Vercel/Turso: reads are
**Server-Sent Events** (idle = zero traffic) and state lives in **Redis** (native TTL
= retention, no reaper). Auth is the **same Clerk tokens** the clients already send,
verified offline. See `docs/features/live-sessions.md` for the feature design and
`docs/features/live-sessions-vm.md` for this server's architecture.

It is the **sole authority** for the feature — push, read, forget, and the enabled
consent toggle — so it needs only **Clerk JWKS + Redis**. Turso is untouched.

## Endpoints (no `/api` prefix)

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Liveness (no auth); pings Redis |
| `POST` | `/live` | Push a device checkpoint (`pushLiveStateSchema`). 403 `{ok,enabled:false}` when off, 429 over quota |
| `GET` | `/live` | Full device list (non-SSE fallback / first paint) |
| `GET` | `/live/stream` | **SSE** — `event: state` frame on connect + on every change |
| `DELETE` | `/live/:deviceId` | Forget one device (204) |
| `DELETE` | `/live` | Forget all — pure purge, does not flip the flag (204) |
| `POST` | `/live/settings` | Toggle the enabled flag; OFF purges all devices |

The wire contract is `@bookmark-ai/types` (`packages/types/src/live.ts`), bundled in.

## Redis model

- `live:{userId}:dev:{deviceId}` — Hash snapshot, 7-day TTL reset on every push/heartbeat.
- `live:{userId}:index` — ZSET (score = last-seen ms) for ordering + lazy GC.
- `live:{userId}:enabled` — String `"1"`/`"0"`, absent ⇒ OFF (fail-safe). AOF-persisted.
- `live:{userId}:quota:{deviceId}:{day}` — daily push counter (self-expires).
- `live:{userId}:events` — pub/sub channel; SSE streams subscribe, publishers fan out.

## Local development

```bash
# 1. a Redis to talk to
docker run -d --name live-redis -p 6379:6379 redis:7-alpine --appendonly yes

# 2. the server in open mode (tokenless — uses the "local" namespace)
cd apps/live-server
cp .env.example .env   # then edit; or just export inline:
DEV_OPEN_API=1 NODE_ENV=development REDIS_URL=redis://127.0.0.1:6379 pnpm dev

# smoke:
curl localhost:8080/health
curl localhost:8080/live/settings -X POST -H 'content-type: application/json' -d '{"enabled":true}'
curl -N localhost:8080/live/stream     # watch the SSE stream
```

Or the whole dev stack in containers (server + its own Redis, hot-reload, port 8081):

```bash
docker compose -p live-dev \
  -f apps/live-server/docker-compose.live.yml \
  -f apps/live-server/docker-compose.live.dev.yml up
```

Point the clients at it: web `NEXT_PUBLIC_LIVE_API_URL=http://localhost:8081`,
extension popup `local:liveApiUrl=http://localhost:8081`, mobile `serverTarget=local`.

## Production

CI (`.github/workflows/live-server-deploy.yml`) builds the image, pushes it to GHCR,
and deploys to the VM over SSH. On the VM:

```bash
docker compose -p live-prod -f apps/live-server/docker-compose.live.yml pull
docker compose -p live-prod -f apps/live-server/docker-compose.live.yml up -d --no-build
```

Fronted by Caddy on `live.bookmark-ai.cloud` (auto-TLS) — see `deploy/Caddyfile.snippet`
(SSE needs `flush_interval -1`). Requires `.env` on the VM (see `.env.example`), a DNS
A record `live` → the VM, and `live.bookmark-ai.cloud` in the extension `host_permissions`
+ the Clerk instance `allowed_origins`.

## Environment

See `.env.example`. Key ones: `REDIS_URL`; `CLERK_SECRET_KEY` (or `CLERK_JWT_KEY` +
`CLERK_ISSUER` for egress-free verification); `CLERK_ALLOWED_USER_IDS`,
`CLERK_AUTHORIZED_PARTIES`, `LIVE_ALLOWED_ORIGINS` (mirror the web app);
`LIVE_TTL_DAYS` (7), `LIVE_PUSH_QUOTA_PER_DAY` (2000).
