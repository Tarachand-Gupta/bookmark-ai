# Encryption posture — Bookmark AI

> Status: internal security audit, 2026-08-24. Untracked by default — commit if you want it
> in the repo. Contains infra detail (VM IP, secret names, plaintext-at-rest findings); do
> **not** publish it anywhere public as-is.

Answers two questions: **what encryption standard are we using**, and **how do we make sure all
server data — especially live tabs — is encrypted.** Every claim is cited to `file:line` (repo
facts) or an official-doc URL (platform facts). Items that couldn't be checked from the repo are
marked **UNVERIFIED (VM state)** — they need a look at the running Oracle VM.

---

## 1. What we use today (the standards)

### In transit — TLS everywhere, verified
- Client → Vercel: HTTPS forced (HTTP → 308), **TLS 1.2/1.3 only**, forward-secrecy ciphers, HSTS
  ([vercel.com/docs/cdn-security/encryption](https://vercel.com/docs/cdn-security/encryption)).
- Vercel/clients → Turso: `libsql://` **is TLS by default** (maps to `https`/`wss` unless `?tls=0`) —
  verified in `@libsql/core` config; zero non-localhost `http://` URLs in production code (`facts`).
- Client → live-server: TLS terminated by Caddy at `live.bookmark-ai.cloud`; the Caddy→app hop is
  loopback plaintext (never leaves the box). **UNVERIFIED (VM state)** for the real Caddy config.
- Clerk: HTTPS (SOC 2 Type 2 + HIPAA).

### At rest — AES-256 at the provider volume layer, verified
- **Turso Cloud**: volume-level encryption on every DB as part of SOC 2
  ([docs.turso.tech/cloud/encryption](https://docs.turso.tech/cloud/encryption)). Cipher not named
  by Turso — don't claim "AES-256 for Turso" specifically unless BYOK is on.
- **Oracle Cloud (OCI) block/boot volumes**: **AES-256, always on, no opt-out**
  ([OCI Block Volume Encryption](https://docs.oracle.com/en-us/iaas/Content/Block/Concepts/blockvolumeencryption.htm)).
  Covers the Always-Free ARM VM's disk. This is what sits under Redis.
- **Vercel**: AES-256 platform-wide; env vars encrypted at rest
  ([vercel.com/docs/security/compliance](https://vercel.com/docs/security/compliance)).

### Application-level encryption we do ourselves — exactly one thing
- **User BYOK AI-provider keys**: **AES-256-GCM**, 12-byte random IV, 16-byte auth tag, a raw 32-byte
  key (base64 `AI_KEY_ENCRYPTION_SECRET`; no KDF needed — it's already 256-bit random). Envelope
  `enc:v1:<iv>:<ct+tag>` in `user_settings.ai_api_key`
  (`packages/engine/src/ai-key-crypto.ts:19-20,48-53`). This is the model to copy if we ever want to
  app-encrypt anything else.
- Everything else user-data-wise (bookmarks, sessions, chat, live tabs) is **provider-volume-encrypted
  plaintext** — no second app-level layer.

### Tokens — signed, not encrypted (they're bearer credentials, not stored data)
- `bkd_` device + `bkmcp_` MCP tokens: **HS256** HMAC over `DEVICE_TOKEN_SECRET`, timing-safe verify,
  alg-pinned (`apps/web/lib/server/device-token.ts`, `mcp-token.ts`).
- Live tokens: **Clerk RS256** session JWTs, 600s TTL (`live-token.ts:18,32`).
- Randomness is CSPRNG throughout (`randomBytes`, `randomUUID`); no `Math.random` in security paths.

**Bottom line:** we already meet the accepted small-SaaS bar — **TLS 1.2+/1.3 in transit + AES-256
provider-volume encryption at rest on every store.** Honest public wording:
*"All data is encrypted in transit (TLS 1.2+/1.3) and at rest (AES-256 at the storage layer via our
providers — Turso, Oracle Cloud, Vercel; auth by Clerk, SOC 2 Type 2 & HIPAA)."* Avoid
"end-to-end encrypted" — we hold the keys.

---

## 2. Live tabs specifically (what you asked about)

**Where it rests:** Redis on the OCI VM, as **plaintext JSON hashes** — key `live:{userId}:dev:{deviceId}`
(`apps/live-server/src/live-store.ts`, `keys.ts:11`). `windowsJson` holds the real (sanitized) **tab
URLs, page titles (≤300 chars), favicon URLs**, plus device label, OS, and user-set window names
(`packages/types/src/live.ts:10-35`). ~42KB/device, **7-day rolling TTL**. No app-level encryption
anywhere in the live-server.

**Two nuances that matter (VM state now VERIFIED 2026-08-24 via `redis-cli` on the box):**
- Redis is `redis://` (**not** `rediss://`) on loopback, logical DB 2 (`config.ts:18`, README).
  **VERIFIED:** `bind 127.0.0.1 -::1` (loopback only — 6379 is NOT externally reachable),
  `protected-mode yes`. **BUT no auth:** `requirepass` is empty and `ACL LIST` = `user default on
  **nopass** ~* &* +@all`. So the only control on the tab data is the loopback bind + VM host
  integrity — any local process / SSRF / RCE foothold on the box has full read/write. The instance is
  **shared** across logical DBs with other password-less co-tenant backends, so a global `requirepass`
  can't be added without breaking them all, and a scoped ACL user is defeated while `default` stays
  `nopass`. ⇒ closing the no-auth gap cleanly needs either a dedicated live Redis or coordinating every
  app on the instance; **the pragmatic protection is the app-level `windowsJson` encryption below.**
- **Persistence: AOF is OFF, RDB snapshots are ON** (`appendonly no`; `save 3600 1 300 100 60 10000`;
  `dir /var/lib/redis`). (The earlier "AOF on" note was wrong.) So tab URLs/titles DO land on the VM
  **disk** via `dump.rdb`. That disk is an OCI block volume = **mandatory AES-256 at rest**, so the
  file is provider-encrypted; app-level encryption of `windowsJson` (below) makes the *contents*
  ciphertext too, which is what makes the RDB artifact safe against a local reader.
- **Also verified:** the live-server node app binds **`0.0.0.0:5100`** (all interfaces) — external
  reachability of the app port depends entirely on host iptables / the OCI security list (UNVERIFIED —
  needs sudo/console). Cleanest fix: bind the app to `127.0.0.1` (Caddy already proxies from loopback).

**Capture-time mitigation (extension side, `apps/extension/lib/live-sanitize.ts`):** credential-looking
query params stripped, auth-flow URLs reduced to origin (`redacted:true`), suspicious fragments and
`data:` favicons dropped, **incognito never sent**. The file itself says it's "a mitigation, not a
guarantee" — stored URLs are sanitized but real.

**Honest status of live tabs:** encrypted at rest at the **provider-disk layer** (OCI AES-256) and in
transit to viewers (Caddy TLS), but **not** application-level encrypted and **not** protected by Redis
auth/TLS on the box. The security rests on the loopback bind + VM host integrity — a root user on the
VM, or anything else on the shared box that can reach DB 2, sees plaintext.

---

## 3. How to make sure all server data is encrypted — prioritized

### Live tabs / Redis — do these
1. **Verify the VM's Redis is loopback-bound, firewalled, and has `requirepass`/ACL.** This is the
   real risk, not the cipher. **UNVERIFIED today** — check first. (Needs `! ssh` to the VM.)
2. **Disable Redis persistence for the live-tab keys** (`save ""` / `appendonly no`, or move them to a
   no-persist logical DB). Live-tab state is ephemeral presence data — with persistence off those URLs
   **never touch disk at all**, removing the at-rest artifact entirely. Tradeoff: state lost on Redis
   restart (fine for presence; devices re-push within ~2 min).
3. **If tab URLs are classified sensitive, app-encrypt `windowsJson` in Fastify before `SET`**
   (AES-256-GCM or XChaCha20-Poly1305, key in the live-server env). Redis then holds only ciphertext —
   protects against RDB/AOF leakage, backups, and a read-only Redis compromise. Reuse the exact pattern
   from `ai-key-crypto.ts`. This is the strongest option and the one that makes "even our own VM can't
   read your tabs" true.
4. **`rediss://` TLS** only matters if Redis ever moves **off-box** from Fastify. On loopback it buys
   nothing.

### All data at rest, generally
- We already clear the bar (§1). The **one real upgrade** is **Turso BYOK** — per-tenant AEAD keys
  (AES-256-GCM / ChaCha20-Poly1305 / AEGIS), DB files **and WAL** encrypted on disk and on S3, keys
  never stored by Turso ([docs.turso.tech/cloud/encryption](https://docs.turso.tech/cloud/encryption)).
  It fits our per-user-DB model and makes Turso provider-blind. **Caveats:** creation-time only (can't
  flip existing DBs), no rekeying, needs Pro plan, and demands a key-custody design. Path: create new
  tenants as BYOK going forward; migrate existing tenants via provision-new + copy. Only worth it if we
  want to claim "we cannot read your data."
- **OCI volume in-transit encryption** (instance↔volume) is a cheap toggle to check/enable on the VM's
  attachment.

---

## 4. Things that leak plaintext *despite* the encryption (fix these — they matter more than ciphers)

| # | Finding | Location | Fix |
|---|---------|----------|-----|
| 1 | **Fail-open AI-key encryption** — if `AI_KEY_ENCRYPTION_SECRET` is missing/throws, the user's provider key is stored **plaintext** with only a `console.warn` | `apps/web/lib/server/ai-key-crypto.ts:26-35` | Make it fail-closed: refuse to save the key rather than store plaintext |
| 2 | **Master DB stores every tenant's full-access Turso `db_auth_token` in plaintext** — a master-DB leak = all tenant data | `packages/db/src/master.ts:30-37` | Encrypt those tokens at rest (KMS or an app key), or scope them down |
| 3 | **Real bookmark URLs in Vercel logs** — full URL logged on every enrich failure; search/`?url=` query strings land in runtime logs (1–30-day retention, project-wide visibility) | `apps/web/app/api/bookmarks/route.ts:49`; Vercel runtime logs | Log the bookmark `id`, not the `url` |
| 4 | **Gemini free-tier trains on submitted content** — bookmark metadata + full chat go to Google under one key; on the unpaid tier Google uses it to improve products and may human-review | `packages/engine/src/{categorize,embeddings}.ts`, `/api/chat` | Confirm the key is on a **billed** project; state Google's role + retention in the privacy policy |
| 5 | **Export bundle is unencrypted JSON** incl. full chat history | `packages/engine/src/export-import.ts` | Fine for a user-initiated download; note it, consider opt-in encryption |
| 6 | **`CRON_SECRET` compare is non-timing-safe** (`!==`) | `apps/web/app/api/cron/embed/route.ts:33-35` | Use `timingSafeEqual` |
| 7 | **Mobile bookmark cache not user-scoped, survives sign-out** — shared-device leak between accounts | `apps/mobile/src/hooks/useDashboard.ts:12` | Key cache by Clerk user id; clear on sign-out |
| 8 | **Client-side bearer tokens at rest in plaintext** — `bkd_` in `chrome.storage.local`, `bkmcp_` in `~/.claude.json` | extension + local Claude config | Document as secret-bearing; rely on the existing revoke paths; consider shorter MCP TTL |
| 9 | **Public-repo transition** — `CLAUDE.md` + `live-server-deploy.yml` hardcode the VM IP `129.146.3.172`, Clerk user id, Turso host; combined with unverified Redis auth this is a recon map | repo files | Scrub to GH Actions vars before flipping public; verify Redis auth/bind first |
| 10 | **13 unencrypted tenant DBs on the laptop** (`data/tenants-dev/`, one 7 MB) | local disk | Rely on FileVault — verify `fdesetup status`; purge stale dev DBs |

---

## 5. What to check on the VM
**Redis checks — DONE 2026-08-24** (`redis-check.sh` piped over ssh):
- `bind` = `127.0.0.1 -::1` ✅ loopback only · `protected-mode` = `yes` ✅
- `requirepass` = empty, `ACL LIST` = `default on nopass +@all` ⚠️ **no auth** (see §2)
- `appendonly no`, `save 3600 1 300 100 60 10000`, `dir /var/lib/redis` ⚠️ RDB on → disk
- listeners: `127.0.0.1:6379` (redis) ✅ but `0.0.0.0:5100` (node app) ⚠️ (see §2)
- app `.env` `REDIS_URL` carries no password (consistent with `nopass`)

**Still UNVERIFIED — check when convenient:**
- `sudo iptables -L -n | grep -E '6379|5100'` (or the OCI VCN security list) — confirm 5100 is not
  externally reachable (6379 is already loopback-bound, so it's safe regardless).
- `fdesetup status` (laptop) — confirm FileVault for the local tenant DBs.
- OCI console → the VM's block-volume attachment → in-transit encryption toggle.
