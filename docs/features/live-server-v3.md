# Live Server v3 — relay architecture decision

**Status: PROPOSAL. Nothing here is built.** Decision document for the owner, written
2026-08-11 against `main` (`apps/live-server` at commit `702c908`). Companions:
`live-sessions.md` (feature design + rejected alternatives), `live-sessions-vm.md` (the v2
backend that is deployed today), `live-sessions-status.md` (v1 build log).

The question this answers: *"the Redis-based SSE thing — should it be pub/sub or something,
like how other relay systems work?"*

**Short answer up front: it already IS Redis pub/sub** (`apps/live-server/src/live-store.ts:300-315`,
`src/redis.ts:19-62`). Pub/sub is not the problem and swapping it for Streams/NATS/Centrifugo
fixes nothing you currently feel. The two real defects are (1) **every update re-sends the
entire snapshot of every device** and (2) **a 60-second timer re-sends that same snapshot
forever just to advance a relative clock**. Both are payload-protocol problems inside a
transport that is fine. Recommendation is in §5.

---

## 1. Current state (v2), precisely

### 1.1 Topology

```
extension (MV3 worker, push-only)  ──HTTP POST /live──┐
                                                      │
web (fetch-event-source) ──GET /live/stream (SSE)──┐  │
mobile (react-native-sse) ─GET /live/stream (SSE)──┤  │
                                                   ▼  ▼
                              Caddy 443 (flush_interval -1)
                                  live.bookmark-ai.cloud
                                          │
                              Fastify :5100 (systemd, 1 process, 1 VM)
                                  │                    │
                          LiveFanout (in-proc)    LiveStore
                                  │                    │
                          ioredis SUB conn      ioredis CMD conn
                                  └────────┬───────────┘
                                     Redis (shared VM instance, logical DB 2, AOF)
```

One Fastify process (`src/server.ts:59-75`), one shared Oracle Cloud ARM64 VM, one shared
Redis on logical DB 2, fronted by the VM's shared Caddy with `flush_interval -1` so SSE is
not buffered (`deploy/Caddyfile.snippet:12,21`). Deploy is build → `pnpm --legacy deploy` →
`rsync` (excluding `.env`) → `systemctl restart bookmark-live`
(`.github/workflows/live-server-deploy.yml`).

### 1.2 Data model (Redis keys)

All keys are namespaced `live:{userId}:…` with the userId in Cluster hash-tag braces so a
future Cluster move keeps one user's keys on one slot (`src/keys.ts:1-9`):

| Key | Type | Contents | TTL |
| --- | --- | --- | --- |
| `live:{u}:dev:{deviceId}` | Hash | the device snapshot — `windowsJson` (the whole tab tree, serialized), `label`, `browser`, `device`, `os`, `tabCount`, `hiddenTabCount`, `capturedAt`, `lastSeenAt`, `createdAt` | `LIVE_TTL_DAYS` = 7d, reset on every push **and** heartbeat (`src/live-store.ts:139,172,182`) |
| `live:{u}:index` | ZSET | deviceId → last-seen ms; ordering + lazy GC of TTL'd-out members (`src/live-store.ts:237,269`) | none (members GC'd lazily) |
| `live:{u}:enabled` | String | `"1"`/`"0"`; **absent ⇒ OFF** (fail-safe) (`src/live-store.ts:86-92`) | none |
| `live:{u}:quota:{deviceId}:{day}` | String | INCR'd daily push counter | 26h (`src/live-store.ts:15`) |
| `live:{u}:winnames:{deviceId}` | Hash | windowId → viewer-set window name, overlaid on read | 7d, refreshed on write (`src/live-store.ts:226`) |
| `live:{u}:newwin:{deviceId}` | String | `"0"` = don't auto-share new windows; absent = share | **none, deliberately** (`src/keys.ts:39-47`) |
| `live:{u}:events` | pub/sub channel | the change envelope, below | n/a |

**Snapshots, not deltas — everywhere.** The device Hash holds one serialized `windowsJson`
blob; every push full-replaces it (`src/live-store.ts:177-183`). Schema caps are 12 windows
× 100 tabs (`packages/types/src/live.ts:27,52`), and the code's own estimate of a realistic
snapshot is **~42KB** (`src/live-store.ts:24,158`). Delta *pushes* were explicitly rejected in
the original design (`live-sessions.md` §6.4) — window identity is unstable across browser
restart, so `deviceId` is the only key (`live-sessions-status.md` invariant 1). That rejection
is about the **write** path and remains correct; it says nothing about the read path, which is
where the cost actually lands.

### 1.3 Write path

`POST /live` (`src/routes/push.ts:15-39`), in order:

1. `pushLiveStateSchema.safeParse` — `windows` **absent = heartbeat**, `windows: []` = "all
   windows closed" (a real wipe). The two must stay distinct.
2. `getEnabled` → `403 {ok:false, enabled:false}` when the account flag is off; the extension
   reads that and stops publishing (`apps/extension/lib/live-checkpoint.ts:168-176`).
3. `checkAndBumpQuota` — INCR of the per-device UTC-day counter, cap `LIVE_PUSH_QUOTA_PER_DAY`
   = 2000 (`src/config.ts:36`) → 429.
4. `writeSnapshot` (`src/live-store.ts:121-185`): one `GET` of the new-window policy, then for
   a full push an **`HMGET` of all seven `DISPLAY_FIELDS`** (dominated by the ~42KB
   `windowsJson`) compared byte-for-byte against the incoming serialization. Equal ⇒ *no-op
   push*: refresh `lastSeenAt`/`capturedAt`/ZSET/TTL in one MULTI and report `changed:false`.
   Unequal ⇒ full `HSET` + `HSETNX createdAt` + ZADD + EXPIRE in one MULTI, `changed:true`.
   A heartbeat against a missing snapshot is a no-op so it can never create a windowless ghost.
5. `if (changed) publish` — only a visible change fans out. Heartbeats never do
   (`src/routes/push.ts:32-35`).

Producer cadence lives in the extension (`apps/extension/lib/live-checkpoint.ts`): every
`tabs.on*`/`windows.on*` event only sets a `liveDirty` flag and re-arms a **5s trailing
debounce** (`:36,101-107`); the flush does one full `windows.getAll` scan (`:144-156`).
`windows.onRemoved` flushes immediately (`:390-395`). A `chrome.alarms` heartbeat every
**~2 min** re-stamps liveness and retries a debounce a killed worker dropped (`:38,205-215`).
Failures back off 1m→2m→5m→15m→30m (5m cap on Safari) (`:42-45`).

### 1.4 Read path — how one event reaches N subscribers

Pub/sub, with a per-user coalescing layer in front of the sockets:

1. `store.publish(userId, {type:"push"|"delete"|"reset", deviceId?})` → `PUBLISH live:{u}:events`
   with a tiny JSON envelope (`src/live-store.ts:300-302`, `src/types.ts:7-10`). The envelope
   deliberately carries no state — it only says "something changed".
2. **One** ioredis connection is in SUBSCRIBE mode for the whole process; `SubscriptionManager`
   ref-counts handlers per channel so N viewers of one user cost **zero** extra Redis
   connections and one `SUBSCRIBE` (`src/redis.ts:19-62`).
3. `LiveFanout` holds one group per user (`src/fanout.ts:57-95`). An event does **not** fan out
   immediately: it arms a trailing `LIVE_FANOUT_COALESCE_MS` = **500ms** timer (`src/config.ts:42`,
   `src/fanout.ts:126-136`). When it fires, `flush()` does **one** `listDevices` read + **one**
   `JSON.stringify` and writes that single pre-serialized frame to every socket in the group
   (`src/fanout.ts:147-168`, `src/sse.ts:30-32`). N viewers × M burst events ⇒ 1 read + 1
   serialize + N writes.
4. `listDevices` (`src/live-store.ts:235-271`): `ZREVRANGE` the index, then a pipeline of three
   reads per device (device Hash, winnames Hash, newwin String), drop index members whose Hash
   TTL'd out, parse `windowsJson`, overlay window names, and compute `lastSeenAgeSeconds`
   server-side (`:341-344`). Clients never subtract their own clock.
5. **Viewer-gated refresh**: while ≥1 viewer is connected, a `setInterval` re-emits a fresh
   coalesced frame every `LIVE_REFRESH_EMIT_MS` = **60s**, skipped if a frame already went out
   inside the window (`src/fanout.ts:80,139-144`, `src/config.ts:43`). Its only purpose is to
   keep `lastSeenAgeSeconds` current now that heartbeats no longer fan out.
6. `GET /live/stream` (`src/routes/stream.ts:27-79`): auth preHandler, per-user cap check,
   `reply.hijack()` + hand-written `text/event-stream` headers with `X-Accel-Buffering: no`
   (`src/sse.ts:12-25`), an **immediate full `state` frame for this connection** (never routed
   through the coalesce window), then `fanout.join`, then a `:keepalive` comment every **25s**
   (`:6,57-59`). Cleanup on `req.raw` `close`/`error` releases the slot, clears the heartbeat
   and leaves the group.

**So: fan-out-on-read, triggered by pub/sub, with full-state frames.** Reconnect is
self-healing by convergence — a viewer that missed events converges on the next frame. There
is no `id:`, no `Last-Event-ID`, no `retry:` (`src/sse.ts:30-32`), because full state makes
resume unnecessary.

### 1.5 Clients

- **Web** (`apps/web/hooks/use-live.ts`): `@microsoft/fetch-event-source` because native
  `EventSource` can't set an `Authorization` header. Primes with `GET /live` for instant paint
  (`:115`), then subscribes (`:137-175`). Capped reconnect backoff 1s→2s→5s→15s→30s (`:23`)
  overriding the library's flat 1s. **Visibility-gated**: hidden ⇒ `abort()`, visible ⇒ fresh
  prime + fresh subscribe (`:189-208`).
- **Mobile** (`apps/mobile/src/hooks/useLiveDevices.ts`): `react-native-sse` 1.2.1, held only
  while `active && segment==="ongoing" && AppState==="active"` (`:101,167`). Also primes with
  `GET /live` (`:112`). **No backoff override** — the library's default `pollingInterval`
  is a flat **5000ms** retry, uncapped (`react-native-sse/src/EventSource.js:37`).
- **Extension**: push-only, no SSE — an MV3 service worker can't hold a socket.
- Base URL resolution in all three prefers a per-user `settings.liveServerUrl` override over
  the build-time env default (`apps/web/lib/api.ts:257-261`, `apps/mobile/src/api.ts:117-135`,
  `apps/extension/lib/api.ts:35-96`).

### 1.6 Auth

`makeAuthPreHandler` (`src/auth.ts:20-98`), mirroring the web app's `require-user.ts`:
`Authorization: Bearer` only, three accepted credentials —

1. **`bkd_` device token** (`src/device-token.ts`): HS256 over `DEVICE_TOKEN_SECRET`, JWT
   compact form with `.`→`~` (a dotted bearer looks like a session JWT to Clerk middleware and
   crashes it), `scp` must be `"ext"`. Verified locally, no network. This is what all extension
   targets now use.
2. **Clerk session JWT**, verified offline with `@clerk/backend` `verifyToken` (JWKS cached, or
   pin `CLERK_JWT_KEY` + `CLERK_ISSUER` for an egress-free VM). `authorizedParties` is
   deliberately **not** passed to `verifyToken` — it rejects azp-less tokens — so the azp check
   is applied by hand with Express semantics: absent = pass, wrong = reject (`:77-85`).
3. **Open mode** — `DEV_OPEN_API=1` outside production, or no Clerk keys at all ⇒ the `"local"`
   namespace sentinel (`src/config.ts:122`).

Then the `CLERK_ALLOWED_USER_IDS` allowlist. `userId` becomes the Redis namespace — per-user
isolation is a **key-prefix invariant**, which the original design flagged as a new bug class
when it rejected Redis for the Turso path (`live-sessions.md` §6.2). Production fails closed on
missing Clerk config and on an empty CORS allowlist (`src/config.ts:84-98`).

### 1.7 Bounds that exist today

| Bound | Value | Where |
| --- | --- | --- |
| Snapshot TTL | 7 days, reset on push/heartbeat | `src/config.ts:35`, `live-store.ts:139,172,182` |
| Daily pushes per device | 2000 | `src/config.ts:36` |
| Concurrent SSE streams per user | 8, **in-memory per process** | `src/routes/stream.ts:15-16` |
| Body limit | 2MB | `src/server.ts:27` |
| Windows × tabs | 12 × 100 | `packages/types/src/live.ts:27,52` |
| Fan-out coalesce window | 500ms | `src/config.ts:42` |
| Refresh re-emit | 60s | `src/config.ts:43` |
| SSE keepalive | 25s | `src/routes/stream.ts:6` |
| Per-IP rate limit | **none** | — (contrast `apps/web/lib/server/rate-limit.ts`, 120/60s) |

---

## 2. Pain points

Ordered by how much they actually cost, not by how interesting they are.

### P1 — The 60s refresh tick re-sends the whole snapshot to advance a clock. (worst)

`src/fanout.ts:80,139-144` fires every 60s per user-with-a-viewer; `flush()` re-reads all
devices and re-serializes the full `state` frame (`:147-168`). The *only* field that differs
from the previous frame is the integer `lastSeenAgeSeconds` (`src/live-store.ts:343`).

At the code's own ~42KB estimate, one open Ongoing tab on an otherwise idle account costs
~42KB/min ≈ **60MB/day per viewer**, plus a `listDevices` pipeline (3 Redis reads per device)
and a `JSON.stringify` of the whole tab tree, forever, for **zero new information**. On mobile
that is metered data in the user's pocket. This is a pure protocol artifact: the age is derived
from `lastSeenAt`, which the client already has.

### P2 — Every change re-sends every device's entire tab list.

One tab title changing on the laptop ⇒ `changed:true` ⇒ publish ⇒ `flush()` serializes **all**
devices, **all** windows, **all** tabs to **all** viewers (`src/fanout.ts:147-168`). Payload
scales with total mirrored state, not with the size of the change. The pub/sub envelope already
carries `deviceId` "for a possible future delta path" (`src/types.ts:3-6`) — the seam was
anticipated and never used.

### P3 — Redis pub/sub is at-most-once, and the recovery mechanism is P1's timer.

`publish` is fire-and-forget (`src/live-store.ts:300-302`). Worse, `SubscriptionManager`
**swallows a failed `SUBSCRIBE` entirely** (`src/redis.ts:42-45`) — if that call fails, that
channel gets zero live updates for the life of the connection and nothing notices. ioredis
auto-resubscribes on reconnect, but any event published during the gap is gone. Today the
blast radius is bounded to ≤60s of staleness *because* the refresh tick exists. So the two
defects are load-bearing for each other: **you cannot fix P1 by simply deleting the tick**
without giving the propagation path a real delivery guarantee or a cheap resync signal.

### P4 — Reconnect churn costs two full snapshots per tab-focus.

Web aborts the stream when the tab is hidden and re-primes on return (`use-live.ts:189-208`):
that's one `GET /live` (full snapshot, `:115`) **plus** the connect-time `state` frame the
route always sends (`src/routes/stream.ts:44-50`) — the same ~42KB twice, plus two
`listDevices` reads, on every alt-tab. Mobile does the same on every foreground
(`useLiveDevices.ts:112,135`). And mobile's reconnect is a flat, uncapped 5s poll
(`react-native-sse/src/EventSource.js:37`), so a live server that is simply down means every
foregrounded phone on the Ongoing tab retries every 5 seconds indefinitely — the exact failure
the web hook's capped backoff was written to avoid (`use-live.ts:16-23`).

### P5 — No compression.

`deploy/Caddyfile.snippet` has `reverse_proxy … { flush_interval -1 }` and **no `encode`
directive**, so `text/event-stream` frames go out uncompressed. Tab lists are among the most
compressible payloads imaginable (repeated origins, repeated title suffixes, repeated favicon
hosts). This is the cheapest single win available and it is one line of Caddy config.

### P6 — Auth is checked once, at connect; a stream outlives its credential.

The preHandler runs once (`src/routes/stream.ts:28`). A Clerk session JWT is short-lived, but
the SSE connection can stay open for hours; nothing re-verifies, and revoking a session or a
device token does **not** drop existing streams. For a feature whose whole content is "the URLs
of every tab I have open", indefinite post-revocation delivery is the wrong default.

### P7 — Single-node ceilings that the docs describe as horizontal.

`live-sessions-vm.md` claims pub/sub gives "horizontal scale, no sticky sessions", and the
backplane genuinely does. But two things are per-process in-memory: the per-user stream cap
(`src/routes/stream.ts:15-16`, so the real cap becomes 8×N nodes) and the coalescing window
(`src/fanout.ts:58`, so N nodes do N independent `listDevices` reads and N serializations per
event instead of one). Neither breaks correctness; both quietly delete the optimizations. There
is also **no per-IP rate limit at all** on this server — only the per-device daily quota.

### P8 — No presence protocol.

"Online" is inferred client-side from `lastSeenAgeSeconds`, which is driven by the extension's
~2min heartbeat alarm (`live-checkpoint.ts:38`). A quit browser therefore reads as "last seen
2 minutes ago" for minutes. The original design is honest that a quit browser can't signal
departure (`live-sessions.md` §3.1) — but the *server* does know exactly which devices pushed
recently and exactly who is watching (`src/fanout.ts:58`), and exposes neither as a first-class
signal. This is also why P1's timer exists at all: presence is being emulated by re-sending
state.

### P9 — Quota is charged before suppression.

`checkAndBumpQuota` runs at `src/routes/push.ts:27`, **before** `writeSnapshot` decides the
push was a no-op (`:32`). So byte-identical pushes still consume the 2000/day budget. 2000/day
is one push every 43s on average against a 5s debounce, so a single auto-refreshing dashboard
whose title cycles can burn the day's budget and silently stop a device from reporting.

### P10 — Dev/prod parity: there is exactly one live server, and the dev extension writes to it.

`apps/extension/.env.dev-remote` sets `WXT_LIVE_API_URL=https://live.bookmark-ai.cloud` — the
**production** live server — while its `WXT_APP_URL` points at `bookmark-ai-dev.vercel.app`.
The green "(Dev)" build therefore pushes real tab snapshots into production Redis. That
contradicts `CLAUDE.md`'s strictly-separated-environments rule (and the "never point local dev
at prod data" lesson that already burned this project once). Local dev is a separate story
again: docker-compose on :8091 (`docker-compose.live.dev.yml`) vs systemd + rsync + shared
Redis DB 2 in prod, so the *deployment* shape is untested until it's in production.

### P11 — Two live implementations still coexist.

`apps/web/app/api/live/**` (the v1 Turso path) is still on `main`; retirement is deferred
(`live-sessions-vm.md` "Retirement"). Divergence risk on every contract change.

### P12 — The SSE surface has no tests.

`live-store.test.ts` (20 tests) and `auth.test.ts` (6) cover the store and the azp semantics
well; `fanout.test.ts` (4) covers coalescing and teardown. Nothing covers the route: hijack,
keepalive, the per-user cap, cleanup-on-error, or reconnect behavior.

### How big is a frame, actually?

The ~42KB in the code comments is an estimate. Measured (`JSON.stringify` of a
`listLiveResponseSchema` payload with realistic URL/title/favicon lengths and non-repetitive
content):

| Shape | Raw frame | gzip |
| --- | --- | --- |
| 1 device, 1 window, 15 tabs | 3.0 KB | 0.9 KB (3.3×) |
| 2 devices, 3 windows × 25 tabs each | 27.8 KB | 4.2 KB (6.7×) |
| Schema maximum (12 windows × 100 tabs) | 217.5 KB | 26.7 KB (8.1×) |

So the comments' estimate is about right for a real two-machine account, and the schema permits
frames 8× larger than that. **P1 therefore costs ~28 KB/min ≈ 40 MB/day per open viewer today,
and up to ~300 MB/day for a heavy user** — every byte of it redundant.

---

## 3. The landscape (2026), and what it says about the question asked

### 3.1 "Should it be pub/sub or something?" — the propagation primitives

| Primitive | Delivery | Replay / late join | Fit here |
| --- | --- | --- | --- |
| **Redis Pub/Sub** (what we use) | **At-most-once.** "a message will be delivered once if at all… If the subscriber is unable to handle the message (for example, due to an error or a network disconnect) the message is forever lost." Ordering is preserved. ([redis.io/docs/latest/develop/pubsub](https://redis.io/docs/latest/develop/pubsub/)) | None | Adequate **only** because every frame is full state. The docs themselves point at Streams "If your application requires stronger delivery guarantees". |
| **Redis Streams** | At-least-once with consumer groups + `XACK`; or plain `XREAD` where each reader keeps its own cursor. Fan-out is native: "It is important to understand that this command *fans out* to all the clients that are waiting for the same range of IDs, so every consumer will get a copy of the data" ([XREAD](https://redis.io/docs/latest/commands/xread/)) | Yes — a durable, capped log (`XADD … MAXLEN ~ N`) with resumable ids | The right upgrade **if** we ever send deltas, because a delta protocol needs gap detection. Cost: "when XREADGROUP blocks, XADD will pay the O(N) time in order to serve the N clients blocked on the stream" — irrelevant with one in-process reader. Note there is no time-based retention: "There is currently no option to tell the stream to just retain items that are not older than a given period", and `EXPIRE` on a stream key is **not** refreshed by `XADD` ([EXPIRE](https://redis.io/docs/latest/commands/expire/)). |
| **Redis keyspace notifications** | Same at-most-once loss, payload is the *key name only*, and `expired` events are late: "there can be a significant delay between the time the key time to live drops to zero, and the time the `expired` event is generated" ([docs](https://redis.io/docs/latest/develop/pubsub/keyspace-notifications/)) | None | **No.** Off by default, value-less, node-local in Cluster. |
| **Postgres LISTEN/NOTIFY** | At-most-once, transactional, and the payload cap is hard: "**In the default configuration it must be shorter than 8000 bytes**" ([PG 18 NOTIFY](https://www.postgresql.org/docs/18/sql-notify.html)) | None | **No.** We run libSQL — this means *adding* Postgres. A tab snapshot blows 8000 bytes at a few dozen tabs, so it degenerates into "write row, notify the id, subscriber SELECTs". Also pooler-hostile (PgBouncer transaction pooling: `LISTEN` = "Never", [pgbouncer.org/features](https://www.pgbouncer.org/features.html)). |
| **In-process EventEmitter** | Exact, synchronous | n/a | **Honest observation:** today the publisher (`POST /live`) and every subscriber (`GET /live/stream`) are handled by the *same single Fastify process*, so the Redis round-trip in `live-store.ts:300-315` buys nothing except the option of a second node. It is cheap enough to keep, but it should not be mistaken for a feature. |

**Verdict on the literal question: pub/sub is not the problem, and Streams would not fix any
symptom you currently feel.** Streams become *necessary* the moment frames stop being
self-contained full state — which is exactly the change worth making, so the two are coupled.

### 3.2 Fan-out-on-write vs fan-out-on-read

The literature on this ([Silberstein et al., *Feeding Frenzy*, SIGMOD 2010](https://jeffterrace.com/docs/feeding-frenzy-sigmod10-web.pdf);
Twitter's timeline architecture, [InfoQ](https://www.infoq.com/presentations/Twitter-Timeline-Scalability))
is entirely about the producer:consumer *ratio* — Twitter's problem is one post fanning out to
80M followers. **Ours is 1 producer → 1–3 consumers, all owned by the same user, at ~2–4
messages/minute.** There is no celebrity problem and no materialization to optimize. The
current design (fan-out-on-read: publish a "something changed" flag, then re-read) is already
fine; the defect is *how much* it re-reads, not *when*.

### 3.3 The pattern we are actually missing: a retained last-value + deltas

Every mature messaging system converges on the same shape — keep exactly one retained value per
key, deliver it on subscribe, stream deltas after, and express removal as a tombstone:

- **MQTT retained messages.** "If the RETAIN flag is set to 1… the Server MUST store the
  Application Message… so that it can be delivered to future subscribers whose subscriptions
  match its topic name" `[MQTT-3.3.1-12]`; and the tombstone: "If a PUBLISH packet is received
  which contains a zero length payload and the RETAIN flag is set to 1… the Server MUST NOT
  store the message as a retained message but MUST clear any retained message for that topic"
  `[MQTT-3.3.1-13]` ([OASIS MQTT 5.0](https://docs.oasis-open.org/mqtt/mqtt/v5.0/os/mqtt-v5.0-os.html)).
- **Kafka log compaction.** "Any consumer progressing from the start of the log will see at
  least the final state of all records in the order they were written"; deletes are null-payload
  tombstones ([Confluent](https://docs.confluent.io/kafka/design/log_compaction.html)).
- **NATS JetStream KV.** A watcher will "Receive a snapshot of every key, then live changes as
  they happen" ([docs.nats.io](https://docs.nats.io/nats-concepts/jetstream/key-value-store)).
- **Centrifugo `cache` recovery mode** exists for precisely this: "designed to quickly deliver
  the most recent (latest) publication as the first event to the subscriber right after
  subscription request" ([centrifugal.dev](https://centrifugal.dev/docs/server/cache_recovery)).
- **Pusher cache channels** store "only the single last event, for max 30 minutes or until a new
  event arrives" ([pusher.com](https://pusher.com/docs/channels/using_channels/cache-channels/)).

We already have the retained half — the device Hash *is* the last-value cache, and
`routes/stream.ts:44-50` already delivers it on subscribe. **What we lack is the "deltas after"
half**, which is what P1 and P2 are.

For the delta encoding itself: **RFC 7396 JSON Merge Patch** (which
[obsoletes RFC 7386](https://www.rfc-editor.org/rfc/rfc7396)) is the pragmatic choice, *but only
over an id-keyed object* — the RFC is explicit that "It is not possible to patch part of a target
that is not an object, such as to replace just some of the values in an array." RFC 6902 JSON
Patch works on arrays but its paths are positional (`/tabs/3/title`), so any tab reorder shifts
every subsequent index — a bad fit for tab lists, which reorder constantly. rsync-style rolling
checksums ([tech report](https://rsync.samba.org/tech_report/)) are the wrong tool entirely:
they exist for opaque byte streams with no shared schema.

### 3.4 SSE vs WebSocket for *this* workload

The two classic objections to SSE are both already neutralised in our exact stack:

- **The 6-connection limit is an HTTP/1.1-only problem.** MDN: "When **not used over HTTP/2**,
  SSE suffers from a limitation to the maximum number of open connections… set to a very low
  number (6)… When using HTTP/2, the maximum number of simultaneous HTTP streams is negotiated
  between the server and the client (defaults to 100)"
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events)).
  Caddy's default protocol set is `h1 h2 h3` ([caddyserver.com](https://caddyserver.com/docs/caddyfile/options)),
  so production is already h2.
- **Proxy buffering.** Caddy special-cases us: `flush_interval` "is ignored and responses are
  flushed immediately to the client if one of the following applies from the response:
  `Content-Type: text/event-stream`" ([reverse_proxy docs](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy)).
  Our explicit `flush_interval -1` is belt-and-braces. (nginx, by contrast, defaults to
  `proxy_buffering on` — which is why `X-Accel-Buffering: no` is in `sse.ts:19`.)

And SSE gives us two things free that a WebSocket would make us hand-write: auto-reconnect, and
resumption via `Last-Event-ID` — "The `Last-Event-ID` HTTP request header reports an
`EventSource` object's last event ID string to the server when the user agent is to reestablish
the connection", set from any `id:` field ([WHATWG HTML](https://html.spec.whatwg.org/multipage/server-sent-events.html)).
**We emit no `id:`, so we are paying for SSE and not collecting.**

Where SSE genuinely loses is **auth**, on a spec-level fact: the `EventSource` constructor takes
only `(url, {withCredentials})` — there is no header surface at all
([WHATWG IDL](https://html.spec.whatwg.org/multipage/server-sent-events.html#the-eventsource-interface)) —
so native `EventSource` can only carry a cookie or a query-string token, and RFC 6750 §2.3 says
the URI method "SHOULD NOT be used unless it is impossible to transport the access token in the
'Authorization' request header field" ([RFC 6750](https://www.rfc-editor.org/rfc/rfc6750#section-2.3)).
We already dodged this: web uses `@microsoft/fetch-event-source` and mobile uses
`react-native-sse`, both of which set real headers (`use-live.ts:138`,
`useLiveDevices.ts:135-137`). The WebSocket answer to the same problem is smuggling the token in
`Sec-WebSocket-Protocol` — legitimate, with Kubernetes as precedent
([k8s PR #47740](https://github.com/kubernetes/kubernetes/pull/47740)) — but it is strictly more
work than what we already have.

**The extension is not a factor.** It only publishes, over plain HTTP. And subscribing from an
MV3 worker is off the table regardless: Chrome documents WebSocket activity as resetting the 30s
idle timer ([Chrome 116 notes](https://developer.chrome.com/blog/chrome-116-beta-whats-new-for-extensions))
but lists no such behaviour for SSE or streaming `fetch`
([SW lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)) —
and keeping the worker alive is the *opposite* of what a battery-conscious push loop wants.

### 3.5 Presence, honestly

Nobody solves this with departure events, because ungraceful disconnect is the normal case:

- **Centrifugo** uses TTL presence (`presence_ttl` default `60s`,
  [engines](https://centrifugal.dev/docs/server/engines)) and warns that join/leave are
  "delivered with at most once guarantee" ([presence](https://centrifugal.dev/docs/server/presence)).
- **Phoenix.Tracker** needs a CRDT and a heartbeat to do it across a cluster, with a `:down_period`
  before peers notice a crash ([hexdocs](https://phoenix-pubsub.hexdocs.pm/Phoenix.Tracker.html)) —
  and it models "multiple tabs = one identity" explicitly as a `metas` list per key
  ([Phoenix.Presence](https://phoenix.hexdocs.pm/Phoenix.Presence.html)).

**Our heartbeat + TTL model is already the industry answer.** The only thing worth borrowing is
the ref-counted-metas idea (report a device online iff ≥1 live connection/heartbeat), and even
that is optional for a feature whose producer can't signal departure at all
(`live-sessions.md` §3.1). P8 is therefore a *low* priority — a design smell, not a bug.

### 3.6 Off-the-shelf relays — the honest scorecard

| Option | What it would actually replace | Verdict |
| --- | --- | --- |
| **Centrifugo v6.9.1** (Apache-2.0, single static binary, [releases](https://github.com/centrifugal/centrifugo/releases)) | The **fan-out third** of the server. `cache` recovery = last-value-on-subscribe; the `#` channel boundary means "Only the user with ID `42` can subscribe" ([channels](https://centrifugal.dev/docs/server/channels)) — server-enforced isolation instead of our key-prefix invariant; the **subscribe proxy** ([proxy](https://centrifugal.dev/docs/server/proxy)) would reuse our existing auth verbatim; the memory engine "Supports all engine features" ([engines](https://centrifugal.dev/docs/server/engines)) | **Best of the off-the-shelf options, and still no.** It is *additive*: we keep Fastify for push/list/forget/rename/settings + Redis for snapshots (Centrifugo's own docs say history "can be empty, truncated, or lost at any moment — so your application database stays the source of truth"), so we'd run **two** processes to fix a payload bug. Also: uni-SSE needs the token in the query string, caps the URL at 2048 chars, and does not support `Last-Event-Id` ([uni_sse](https://centrifugal.dev/docs/transports/uni_sse)); and whether `cache` recovery fires for unidirectional SSE is **unverified**. |
| **NATS + JetStream KV** (Apache-2.0, "less than 20MB of RAM", [nats.io/about](https://nats.io/about/)) | In theory both the store *and* the fan-out (KV watch = snapshot-then-deltas) | **Disqualified on auth.** `kv.watch()` "creates a consumer under the covers, which then matches the stream by looking at the subject, thus the call to list the streams" — and `$JS.API.STREAM.NAMES` is account-wide, so a per-user credential can't be scoped to its own keys ([nats.js discussion #389](https://github.com/nats-io/nats.js/discussions/389)). The maintainer's workaround (stream `RePublish` → plain core-NATS subjects) splits store from fan-out again, which was the whole appeal. |
| **Soketi** | Pusher-protocol fan-out | **Dead.** Last release **1.6.1, 2024-03-25**; ["Is Soketi maintained?" (#1305)](https://github.com/soketi/soketi/issues/1305), opened 2026-02-12, still has no maintainer reply. |
| **Laravel Reverb** / **Sockudo** | same | Reverb requires a PHP/Laravel runtime to *be* the server ([docs](https://laravel.com/docs/13.x/reverb)). Sockudo (MIT, Rust) is actively developed but has shipped 4 majors in ~20 months with ~83% of commits from one person — the exact failure mode that killed Soketi. |
| **Supabase Realtime** | Fan-out, with Clerk as a [first-party third-party auth provider](https://supabase.com/docs/guides/auth/third-party/clerk) | WebSocket-only ([protocol](https://supabase.com/docs/guides/realtime/protocol)); billing counts "one message sent plus one message per subscribed client that receives it" ([usage docs](https://supabase.com/docs/guides/platform/manage-your-usage/realtime-messages)); **`bkd_` device tokens can't work** (it needs a verifiable JWT to push claims into Postgres); and free projects "are paused after 1 week of inactivity". ~$25/mo minimum. |
| **Cloudflare Durable Objects + Hibernatable WebSockets** | **Everything** — Fastify, Redis, the VM, Caddy, systemd, TLS renewal | The strongest *architectural* option; see Option C in §4. |
| **Ably / Pusher / PubNub** | Fan-out | Free at ~50 users, then a cliff: Ably ≈$159/mo and Pusher $99/mo at 500 users, because all of them bill 1 publish + 1 per subscriber, and Ably bills in 5 KiB chunks / PubNub in 2048-byte units ([Ably](https://ably.com/docs/platform/pricing/message-counting), [Pusher](https://pusher.com/channels/pricing/), [PubNub](https://www.pubnub.com/pricing/transaction-classification/)). Our payloads are exactly the wrong shape for per-message billing. |
| **Mercure** | SSE-native fan-out; the hub is literally "a custom build of the Caddy web server" ([install](https://mercure.rocks/docs/hub/install)), with `Last-Event-ID` replay and JWKS auth | Genuinely elegant fit, but **AGPL-3.0** ([repo](https://github.com/dunglas/mercure)) — a deliberate decision for a hosted product, and still additive (it relays; it doesn't hold our state). |

Two cross-cutting findings worth stating plainly:

1. **Nothing here is cheaper than the VM.** The win from adopting a relay would be *deleting our
   own code*, not money or latency.
2. **Only the self-hosted options preserve `bkd_` device tokens**, because only they let the
   relay delegate verification to our existing code (Centrifugo's subscribe proxy, the Pusher
   HMAC auth endpoint). Every managed option requires a real verifiable JWT per client.

---

## 4. Three candidate architectures

### Option A — Keep Fastify + SSE; fix the payload protocol

Change nothing about the transport or the backplane. Fix P1/P2/P4/P5 where they live.

1. **Delete the 60s full-frame refresh.** Send `serverNow` once per frame; clients render
   "last seen" from `lastSeenAt` + their own monotonic delta since the frame arrived, instead of
   trusting a server-computed integer that decays. If a nudge is still wanted, ride the existing
   25s keepalive with a ~30-byte `event: now` frame. Removes ~40 MB/day/viewer and a
   `listDevices` pipeline every minute per active user.
2. **Emit `id:` and honour `Last-Event-ID`.** Free per the SSE spec; it is the prerequisite for
   anything below.
3. **Deltas as RFC 7396 merge patches over an id-keyed device map.** New frame type
   `event: patch`, `data: {devices: {"<deviceId>": {...} | null}}` — `null` = forgotten device,
   exactly MQTT's zero-length retained clear. Keep `event: state` as the connect frame and as a
   keyframe every Nth patch so any client can always resync without server-side history. Because
   `patch` is additive, **old clients that only handle `state` keep working**, which is what
   makes this shippable without a lockstep client release.
4. **Compress.** Add `encode zstd gzip` to the two Caddy sites (3–8× measured on real payloads).
   Verify with a live stream — Caddy's SSE flush special-case is documented as
   `Content-Type`-triggered, but `encode` + SSE has known sharp edges
   ([caddy#6293](https://github.com/caddyserver/caddy/issues/6293)).
5. **Drop the redundant prime.** Web's `GET /live` before subscribing (`use-live.ts:115`)
   duplicates the connect frame. Delete it; keep `GET /live` for the chat tool and the error path.
6. **Cheap correctness/hygiene fixes**: content-hash field instead of a 42KB `HMGET` compare
   (P8); quota charged *after* suppression (P9); log-and-fail instead of swallowing a failed
   `SUBSCRIBE` (P3); copy `apps/web/lib/server/rate-limit.ts` in (P7); close a stream when its
   token's `exp` passes, with a `retry:` hint (P6); mobile backoff parity (P4).
7. **Optionally** swap `PUBLISH` → `XADD` on one capped global bus stream + a single
   `XREAD BLOCK 0` loop, so propagation stops being at-most-once and the process resumes from
   its last id after a Redis blip. Only worth it once deltas exist (gap detection), and only if
   the in-process-EventEmitter shortcut in §3.1 is rejected.

**Honest trade-offs.** Fixes every symptom that is actually felt, in the codebase we already
have, with no new dependency, no new process, no new deploy target, and no client-platform risk.
Does **not** fix P7 (single-node ceilings), P10 (one live server for two environments — that's a
separate systemd unit + Caddy site, ~30 min), or P11 (retirement). Keeps us owning reconnect,
presence, and state delivery. Adds a second frame type to the wire contract, which is real
complexity — item 3 is the only part that needs care, and it is the only part that is optional.

### Option B — Put an off-the-shelf relay behind the same auth (Centrifugo)

Fastify keeps `POST /live`, `GET /live`, forget/rename/settings, and Redis keeps the snapshots.
Centrifugo (single static binary, memory engine, Apache-2.0) takes over fan-out: channel
`tabs:<userId>#<userId>` for server-enforced owner-only access, `force_recovery_mode: "cache"` +
`history_size: 1` for last-value-on-subscribe, the subscribe proxy pointed at our existing auth,
and built-in presence. Fastify publishes via `POST /api/publish` with `X-API-Key`.

**Honest trade-offs.** Deletes our fan-out, coalescing, connect-frame, and presence code, and
converts per-user isolation from a key-prefix invariant into a server-enforced boundary — which
is a genuine answer to the objection that killed Redis for the Turso path
(`live-sessions.md` §6.2). But: **two processes instead of one**, a second config surface and
upgrade cadence, Redis still required for our own state, uni-SSE's token-in-query-string
regression versus the header auth we have today, and one load-bearing unverified assumption
(cache recovery over uni-SSE). It fixes P2 only if we send deltas *anyway* — Centrifugo relays
whatever we publish. **It does not fix the actual problem; it re-homes it.**

### Option C — One Durable Object per user on Cloudflare

Delete the VM, Caddy, Redis, systemd, rsync, and TLS renewal. `idFromName(clerkUserId)` gives
one single-threaded object per user — "Each Durable Object has a globally-unique name, which
allows you to send requests to a specific object from anywhere in the world"
([what-are-durable-objects](https://developers.cloudflare.com/durable-objects/what-are-durable-objects/)).
State (snapshots, window names, the enabled flag, the quota counter) lives in that object's
SQLite; `setAlarm` replaces the 7-day TTL with "Guaranteed at-least-once execution"
([alarms](https://developers.cloudflare.com/durable-objects/api/alarms/)). Readers connect over
**Hibernatable WebSockets**: `state.acceptWebSocket(ws)`, and while hibernating "WebSocket
clients remain connected to the Cloudflare network" while in-memory state resets
([best-practices/websockets](https://developers.cloudflare.com/durable-objects/best-practices/websockets/)).

**Cost.** Requests 1M/mo included then $0.15/M; duration 400,000 GB-s/mo included then
$12.50/M GB-s on a 128 MB basis; and critically "Durable Objects that are idle and **eligible
for** hibernation are not billed for duration"
([pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)). At 50 users ×
2 connections × 8h/day × a 20s cadence that is ~121,500 requests and ~2,765 GB-s/mo — inside the
free allowances, i.e. **$5/mo, all of it the Workers Paid floor**, and outgoing WebSocket
messages are not billed at all, so fan-out is free.

**The trap, stated loudly.** Hibernation "is only supported when a Durable Object acts as a
WebSocket server". An open SSE stream is an in-flight request, so the object is "idle in memory
but unable to hibernate" — billed for the entire connection. The same 50-user scenario over SSE
is ~5.5M GB-s ≈ **$69/mo, a ~14× swing that scales linearly with users**. So Option C is a
**mandatory WebSocket migration** for both readers: hand-rolled reconnect with backoff
(`partysocket`, MIT, is the sane shortcut), and token-in-subprotocol auth because browsers
cannot set headers on a WebSocket handshake.

**Honest trade-offs.** Strictly the best end state on three axes: per-user isolation becomes
*structural* (a DO is the boundary; there is no key prefix to get wrong), ops goes to near-zero,
and dev parity is solved for free — `wrangler dev` runs "the exact same open-source C++ runtime
that Cloudflare uses to run Workers in production"
([local-data](https://developers.cloudflare.com/workers/development-testing/local-data/)), which
kills P10 outright. Against it: rewriting both readers to WebSocket, a third deploy pipeline
alongside Vercel and the VM, Clerk JWKS verification inside a Worker under a 6-outgoing-
connections-per-request limit (cache the JWKS), and moving live state to a store with no `turso`-
style CLI to poke at. It also does nothing for P1/P2 by itself — a hibernating DO that re-sends
28 KB to advance a clock is still wasteful, just billed differently. **Option C is a hosting
decision; the payload protocol still has to be fixed either way.**

(PartyKit is not the on-ramp: the original `partykit` package has published nothing since
**2025-05-21**, and its successor `partyserver` — "inspired by PartyKit" — still says "*Much
like life, this is a Work in Progress*". Neither is deprecated; neither is the thing to build on.
Raw Durable Objects are ~100 lines here.)

---

## 5. Recommendation

**Do Option A now. Keep Option C as the named end state, gated on a real trigger. Reject
Option B.**

The reasoning, in one line each:

- Every symptom the owner can actually observe — bandwidth, mobile data, reconnect churn — is a
  **payload-protocol** defect (P1, P2, P4, P5). None of them is caused by pub/sub, and none of
  them is fixed by changing the backplane or the vendor.
- Option B adds a second process, a second config surface, and a token-in-URL regression to fix
  a payload bug it doesn't even address. For a solo maintainer that is a strictly worse trade.
- Option C is the better *architecture* and the better *ops story*, and it is the only option
  where per-user isolation stops being an invariant we have to keep getting right. But it costs a
  WebSocket rewrite of two clients plus a third deploy pipeline, and it must be earned by a
  reason — wanting the VM gone, wanting multi-region, or a load the single node can't hold — not
  by tab-list bandwidth.

### 5.1 Migration path for Option A, realistically sized

**Phase A0 — hygiene, ~half a day, zero client changes, independently shippable.**

| Change | File | Fixes |
| --- | --- | --- |
| `encode zstd gzip` on both sites; re-verify streaming | `apps/live-server/deploy/Caddyfile.snippet` (+ the two VM files) | P5 |
| Move `checkAndBumpQuota` after `writeSnapshot`; only charge when `changed` | `src/routes/push.ts:27,32` | P9 |
| Store a `hash` field; compare that instead of `HMGET`-ing `windowsJson` | `src/live-store.ts:45-53,159` | P8 |
| Log + surface a failed `SUBSCRIBE` (end the stream so the client reconnects) | `src/redis.ts:42-45` | P3 |
| Port the sliding-window rate limiter | new `src/rate-limit.ts`, wired in `src/auth.ts` | P7 |
| Second systemd unit + Caddy site + Redis logical DB 3 → `live-dev.bookmark-ai.cloud`; repoint `WXT_LIVE_API_URL` | VM + `apps/extension/.env.dev-remote` | P10 |
| Mobile: pass `pollingInterval` and recreate the source on a capped backoff ladder matching web | `apps/mobile/src/hooks/useLiveDevices.ts:135` | P4 |
| Route-level tests (hijack, keepalive, cap, cleanup) | new `src/routes/stream.test.ts` | P12 |

**Phase A1 — the actual fix, ~1 day server + ~half a day per client.**

1. `packages/types/src/live.ts`: add `liveStreamFrameSchema` — a discriminated union of
   `{type:"state", devices, enabled, ttlHours, serverNow, seq}` and
   `{type:"patch", devices: Record<string, LiveDevicePatch|null>, serverNow, seq}`.
   **Do not bump `SCHEMA_VERSION` in `packages/types/src/export.ts`** — this is wire protocol,
   not user data, so CLAUDE.md migration rule 6 does not fire. No DB migration at all: the Redis
   model is unchanged.
2. `src/sse.ts`: emit `id: <seq>` on every frame; add a `retry:` hint.
3. `src/fanout.ts`: keep the 500ms coalesce; have `flush()` diff the previous serialized device
   map per group and emit a `patch` when a previous frame exists, a `state` keyframe otherwise
   or every Nth frame. **Delete the `refreshTimer`** (`:80,139-144`) and the `refreshEmitMs`
   config; carry `serverNow` on every frame instead.
4. `src/routes/stream.ts`: keep the immediate connect `state` frame (it *is* the retained
   last-value delivery); close the stream when the credential's `exp` passes.
5. Web `use-live.ts`: apply patches onto held state; delete the `getLive` prime (`:115`);
   compute displayed age from `lastSeenAt` + `serverNow` + local elapsed. Mobile
   `useLiveDevices.ts`: same, keeping the `GET /live` prime only for the `ProvisioningError`
   path it genuinely needs (`:117`).
6. **Untouched by design:** the extension (push-only — `live-checkpoint.ts` needs zero changes),
   the Vercel chat agent's `listLiveTabs` tool (it reads `GET /live`,
   `apps/web/app/api/chat/route.ts:169-192`), every Redis key, and the auth model.

**One stated invariant is amended, deliberately.** `live-sessions-status.md` invariant 3 and
`live-sessions.md` §4.4 say *"freshness is server-owned; clients render the integer
`lastSeenAgeSeconds` and never subtract their own clock."* Phase A1 keeps the **server-owned**
half (the server still stamps `lastSeenAt` and still ships `serverNow`, so no client clock is
trusted for an absolute time) but moves the **ticking** half to the client, which subtracts only
its own *monotonic elapsed since this frame arrived* — never `Date.now()` against a server
timestamp. That is what lets the 60s full-snapshot re-emit die. The original invariant's actual
purpose (no clock skew in displayed freshness) is preserved; its literal wording is not. Update
both docs in the same commit.

**Phase A2 — only if a second node is ever needed.** Move the per-user stream cap and the
coalescing group to shared state, and swap `PUBLISH` → `XADD` on one capped bus stream with a
single `XREAD BLOCK 0` reader. Until then, note in the code that the current pub/sub hop is a
same-process round trip that an `EventEmitter` would serve identically.

### 5.2 The trigger for Option C

Revisit Cloudflare Durable Objects when **any** of these becomes true, and not before:

- the shared OCI VM becomes a liability (co-tenant contention, an OS upgrade, or wanting the box
  gone);
- live sessions needs a second region, or the single node's stream count becomes a real ceiling;
- a second product surface wants the same per-user-object shape (making the DO pattern earn its
  learning cost more than once);
- the key-prefix isolation invariant produces an actual near-miss in review.

At that point the work is: a Worker + one DO class (~a day), WebSocket migration of web and
mobile with `partysocket` and subprotocol auth (~a day each), and a `wrangler` deploy pipeline.
Phase A1's protocol work is **not** wasted — the same frame types go over a WebSocket unchanged.

---

## 6. Non-goals

Explicitly out of scope, so they are not re-litigated:

1. **Delta *pushes* from the extension.** `live-sessions.md` §6.4 stands: window identity is
   unstable across browser restart, `deviceId` is the only key, and every push must remain a
   full-state overwrite. Phase A1 adds deltas on the **read** path only.
2. **A managed relay vendor** (Ably / Pusher / PubNub / Supabase). Two-sided message counting
   and size multipliers make our payload shape the worst case, and the free tiers break somewhere
   between 50 and 500 users.
3. **WebSocket for the extension.** It only publishes; and keeping an MV3 worker alive is the
   opposite of what a background push loop should do.
4. **A presence protocol with join/leave events.** Heartbeat + TTL is what Centrifugo and
   Phoenix do underneath, both admit join/leave is lossy, and our producer cannot signal
   departure at all. At most, ref-count connections per device later.
5. **Postgres LISTEN/NOTIFY**, Redis keyspace notifications, and Redis Cluster.
6. **Horizontal scale.** One node, honestly documented as one node (fix the docs' "horizontal
   scale" claim rather than the code).
7. **Retiring `apps/web/app/api/live/**`** (P11) — real work, but sequenced separately per
   `live-sessions-vm.md`.
8. **Encryption at rest / E2E for live tab data** — a privacy decision (`live-sessions.md` §5.9),
   not a relay decision.
9. **The two-key / anti-stalkerware question** (`live-sessions.md` §5.2) remains open and is
   untouched by any option here.
10. **Valkey vs Redis.** Both serve the portable stream/pub-sub subset identically; Redis 8's
    tri-license (RSALv2 / SSPLv1 / **AGPLv3**, [LICENSE](https://github.com/redis/redis/blob/unstable/LICENSE.txt))
    attaches obligations to *modified* Redis served over a network, which we don't do. Not a
    decision this document needs to force.
