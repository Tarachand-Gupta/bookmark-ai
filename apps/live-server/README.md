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

Or the whole dev stack in containers (server + its own Redis, hot-reload, port 8091).
This compose file is self-contained — Docker is a **local-dev-only** convenience now
(production is systemd/rsync, below):

```bash
docker compose -p live-dev -f apps/live-server/docker-compose.live.dev.yml up
```

Point the clients at it: web `NEXT_PUBLIC_LIVE_API_URL=http://localhost:8091`,
extension popup `local:liveApiUrl=http://localhost:8091`, mobile `serverTarget=local`.

## Production — systemd + rsync on the OCI ARM VM (no Docker)

Production runs on a shared Oracle Cloud **ARM64** VM (Ubuntu 24.04) alongside other
backends. There is **no Docker** there — the server is pure-JS (Fastify + ioredis +
`@clerk/backend`, no native bindings), so a CI-built `node_modules` runs as-is on ARM64.
It runs under **systemd** and is fronted by the VM's shared **Caddy** on 443; Redis is
the VM's shared instance on **logical DB 2** (`redis://127.0.0.1:6379/2`).

| | |
| --- | --- |
| systemd unit | `bookmark-live.service` (`User=ubuntu`, `ExecStart=/usr/bin/node dist/server.js`, `EnvironmentFile=/home/ubuntu/bookmark-live/.env`) |
| App dir | `/home/ubuntu/bookmark-live` |
| Port (loopback) | `127.0.0.1:5100` (bound `0.0.0.0` by the app; host iptables blocks it externally) |
| Redis | shared server, logical DB `2` |
| Caddy sites | `/etc/caddy/sites/bookmark-live.caddy` → `live.129.146.3.172.sslip.io`; `/etc/caddy/sites/bookmark-live-domain.caddy` → `live.bookmark-ai.cloud` (both `reverse_proxy … { flush_interval -1 }` for SSE) |

**Deploy** is automated by `.github/workflows/live-server-deploy.yml` on pushes to
`main`/`live-sessions` touching `apps/live-server/**` or `packages/types/**`: it builds,
runs `pnpm --filter=@bookmark-ai/live-server --legacy deploy --prod out` (copying the
gitignored `dist/` in), `rsync`s `out/` to the VM (**excluding `.env`** so the VM secret is
never clobbered), `sudo systemctl restart bookmark-live`, and health-checks the sslip host.
It never touches Caddy or the co-tenant services. Secrets: `VM_HOST`, `VM_USER`,
`VM_SSH_KEY` (a dedicated deploy key), `VM_APP_DIR`.

**First-time / manual deploy** mirrors the workflow: build → `pnpm … --legacy deploy --prod
out` → `cp -R apps/live-server/dist out/dist` → `rsync -az --exclude=.env out/ VM:/home/ubuntu/bookmark-live/`
→ write `/home/ubuntu/bookmark-live/.env` (chmod 600, values per `.env.example`) → install
the systemd unit + the two Caddy site files → `systemctl enable --now bookmark-live` +
`sudo systemctl reload caddy` (**reload, never restart**). `live.bookmark-ai.cloud` also needs
its DNS CNAME/A record, plus entry in the extension `host_permissions` and the Clerk instance
`allowed_origins`; until the DNS exists, only the `sslip.io` host serves.

## Environment

See `.env.example`. Key ones: `REDIS_URL`; `CLERK_SECRET_KEY` (or `CLERK_JWT_KEY` +
`CLERK_ISSUER` for egress-free verification); `CLERK_ALLOWED_USER_IDS`,
`CLERK_AUTHORIZED_PARTIES`, `LIVE_ALLOWED_ORIGINS` (mirror the web app);
`DEVICE_TOKEN_SECRET` (Safari `bkd_…` device tokens, 64-char hex, shared with the
web app); `LIVE_TTL_DAYS` (7), `LIVE_PUSH_QUOTA_PER_DAY` (2000).

### `LIVE_ENCRYPTION_SECRET` — at-rest encryption of live tabs

The VM's Redis is loopback-bound but has **no password** and RDB persistence is on, so
`windowsJson` (real tab URLs, titles, favicons) is encrypted at the application layer
before it is written: AES-256-GCM, `enc:v1:<iv-b64>:<ct+tag-b64>`, key = base64 of 32
raw bytes (`openssl rand -base64 32`), no KDF. See `src/crypto.ts`. Each envelope is
bound to its owner with GCM **AAD** = `userId:deviceId`, so a ciphertext copied into a
different device's or user's hash fails the auth tag and renders as zero windows
instead of leaking the original owner's tabs.

| Value | Behaviour |
| --- | --- |
| unset / empty | `windowsJson` stored **plaintext**, one-time warn. Fine for local dev. |
| set, valid (32 decoded bytes) | Encrypted at rest. |
| **set, invalid** | The server **refuses to boot** with a clear error (never echoing the value). A configured key silently degrading to plaintext is the worst outcome, so this is loud. `openssl rand -hex 32` is the classic mistake — 48 decoded bytes, fails boot. |

Only `windowsJson` is encrypted; `label`/`os`/timestamps/counters and the separate
window-names hash stay plaintext. Reads never throw — a value that cannot be decrypted
(rotated key, wrong owner, corruption) degrades to zero windows for that device, logged
at most once per 60s with a cumulative failure count.

**Rotation and migration** are both self-healing within one push cycle (~2 min): a
device whose tabs changed rewrites the field on its next push, and a device whose tabs
did *not* change still gets its legacy-plaintext value rewritten as ciphertext by the
no-op push path (which does **not** publish — nothing a viewer renders moved). CI
upserts the value into the VM `.env` from the `LIVE_ENCRYPTION_SECRET` GitHub secret on
every deploy.
