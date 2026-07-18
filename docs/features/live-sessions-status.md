# Live Sessions — implementation status & handoff

**As of 2026-07-18. Branch `live-sessions` (off `main`). Nothing deployed, nothing pushed.**

This is the build-status companion to the design spec. **`docs/features/live-sessions.md` is
authoritative for the *why* and the design rationale** (read its `REWORK 2026-07-17 batch 2`
banners in §4.1/§4.4/§4.8 and §9.1.1 first — they supersede the older 3-min-alarm text). This
file is the *what's built, where, verified, and what's left* so a fresh chat can continue
without the original conversation.

The feature: **"tabs from other devices"** — Chrome/iCloud/Firefox-style tab sync, but not
locked to one browser ecosystem. Any browser with the extension installed and signed into the
account contributes its open tabs; anywhere you're logged in you see them grouped **device →
window → tab**. Sync semantics, not capture: close a tab and it leaves the list; nothing is
durable until you **Save** one window into a real saved session.

---

## Status at a glance

| Piece | State | Verified |
| --- | --- | --- |
| Backend (types, migration v3, engine, `/api/live`) | **Built** | Adversarial review clean · live HTTP smoke ×2 · in-memory integration smoke (26 assertions) |
| Extension (event-driven debounced push + toggle) | **Built** | `check-types` · 48 unit tests · `wxt build` chrome-mv3 OK |
| Mobile (Saved/Ongoing reader) | **Built** | `check-types` (no simulator run) |
| Web (Saved/Ongoing reader + Settings→Devices) | **Built** | `check-types` · DELETE purge route live-verified |
| Whole repo | integrated on `live-sessions` | **`pnpm check-types` 7/7**, extension **48/48 tests** |

Not done: adversarial review of the three surfaces, deploy, and the two ship-gate blockers
(extension publish, Clerk Native API). See "Remaining" below.

---

## Branch & commits

`live-sessions` (base `main` = `987d059`). HEAD = `d14c09f`. Linear-ish history:

```
b11326f  docs: rework live-sessions to event-driven 5s-debounce sync + full web Current view
2373ca0  feat(extension): show the signed-in identity in the popup header   (separate small feature)
c590c33  feat: Live Sessions backend — types, migration v3, engine, /api/live
c204380  feat(mobile): Saved/Ongoing sessions with live device→window→tab view
41c0ad2  feat(web): Saved/Ongoing sessions view + Settings→Devices management
d7d8e1e  merge: web …
273696b  feat(extension): event-driven debounced live-tabs push + popup toggle
d14c09f  merge: extension …   (HEAD)
```

**Uncommitted and deliberately untouched:** `apps/mobile/src/screens/SignInScreen.tsx` — a
pre-existing, unrelated sign-up change from before this work. Do not stage it with this feature.

---

## What was built, by surface

### Backend (`c590c33`)
- **`packages/types/src/live.ts`** — the contract: `liveTabSchema`, `liveWindowSchema`,
  `pushLiveStateSchema` (POST body; `capturedAt` display-only; `windows` **absent = heartbeat**
  vs `[] = all windows closed`), `liveDeviceSchema` + `listLiveResponseSchema` (GET: `devices[]`
  each with a server-computed integer `lastSeenAgeSeconds`, top-level `enabled`, `ttlHours`),
  `updateLiveSettingsSchema`. Re-exported from `packages/types/src/index.ts`.
- **Migration v3 `live-sessions`** in `packages/db/src/migrations.ts` — appended after v2
  (`user-settings`); v1/v2 untouched. Three statements, all bare strings (NOT `tolerant`), all
  `CREATE … IF NOT EXISTS` (idempotent — `runMigrations` has no transaction): `live_devices`,
  `idx_live_devices_last_seen`, `live_settings`. **No `user_id` on `live_devices`** (per-DB
  tenancy is the boundary). Keyed by `device_id`; `windows_json` blob; `push_day`/`push_count`
  in-row quota; `captured_at` (display) vs `last_seen_at` (server-stamped).
- **`packages/db/src/queries/live.ts`** — `upsertDeviceSnapshot` (one-hop `ON CONFLICT`,
  server-passed `last_seen_at`, `push_count` CASE, heartbeat variant omits
  `windows_json`/`tab_count`/`hidden_tab_count`, **no `captured_at` ordering guard** — it's a
  self-DoS on clock skew), `listDevices` (TTL `WHERE`), `getDevice`, `deleteDevice`,
  `deleteAllDevices`, `reapExpiredDevices`, `getLiveSettings`, `setLiveSettings`. Row mapper in
  `rows.ts` (`LiveDeviceRow`, `LIVE_DEVICE_COLUMNS`, `rowToLiveDevice`).
- **`packages/engine/src/live-sessions.ts`** — `applyDeviceSnapshot` (reads `enabled`→refuse if
  off; in-row daily quota; server-stamps `last_seen_at`; single upsert; reaps peers),
  `listLiveDevices` (flag-gated, TTL-filtered, server-computes `lastSeenAgeSeconds` clamped ≥0),
  `deleteLiveDevice`, `getLiveEnabled`, `setLiveEnabled` (off **purges** all devices).
  `LIVE_TTL_DAYS = 7`. All freshness/quota/TTL math is server-side.
- **`packages/engine/src/sql-tool.ts`** — `BLOCKED_IDENTIFIERS` now includes `live_devices` +
  `live_settings`, so the `/api/chat` agent can never read the open-tab tables (§5.5). Shipped in
  the **same commit** as the migration, on purpose.
- **Routes** (`apps/web/app/api/live/…`): `POST /api/live` (push; `403 {enabled:false}` when off,
  `429` on quota, else `{ok:true, enabled:true}`), `GET /api/live` (`{devices, enabled,
  ttlHours}`), `DELETE /api/live` (purge-all → 204, does **not** flip the flag),
  `DELETE /api/live/[id]` (forget one → 204), `POST /api/live/settings` (`{enabled}` toggle;
  POST not PUT because CORS methods are hardcoded to GET/POST/DELETE/OPTIONS). All go through
  `getRequestApiContext()`.
- **Export untouched:** `SCHEMA_VERSION` stays 1 — live tables are excluded from export by
  construction (§4.2.2). Do not bump it.

### Extension (`273696b`)
- `lib/device-id.ts` — durable per-install UUID (row key, minted once via `storage.defineItem`) +
  seeded renamable label (e.g. "Chrome on Mac").
- `lib/live-checkpoint.ts` — the loop. Listeners registered **synchronously** in
  `defineBackground`; each `tabs.on*`/`windows.on*` event only sets `liveDirty` + (re)arms a **5s
  trailing debounce** → one full-scan `windows.getAll` push after the last change. `chrome.alarms`
  (~2 min) is the heartbeat/backstop (resends if still dirty = a worker died mid-debounce; else
  sends a heartbeat with `windows` **omitted**). `windows.onRemoved` flushes immediately. Dirty
  flag cleared only on 2xx. Silent exponential backoff. Toolbar badge = publishing indicator.
- `lib/live-sanitize.ts` (+ 17 tests) — pure capture-time sanitizer: incognito/devtools filtered
  out (via existing `lib/session-filter.ts`), non-http(s) dropped and counted into
  `hiddenTabCount`, auth-flow paths (`/reset`, `/login/…`, `/oauth/callback`) reduced to origin
  with `redacted:true`, credential/tracking params + `utm_*` stripped, `favIconUrl` kept only if
  http(s). Titles pass through (deliberate, §5.4).
- `lib/live-storage.ts`, `lib/live-api.ts` (never-throw push/settings/delete),
  `entrypoints/popup/components/LiveTabsToggle.tsx` (opt-in switch, default OFF, rename, muted
  status line — uses doc-compliant copy, NOT the banned "sync/live/now"). Modified:
  `wxt.config.ts` (+`alarms`), `background.ts`, `lib/messages.ts` (`LIVE_SET_ENABLED`), `lib/api.ts`
  (export `authHeaders`), `popup/App.tsx`.
- **Also here (`2373ca0`, separate feature):** the popup now shows the signed-in identity under
  the wordmark — full name if both names set, else masked email (`tar**@purecode.ai`). Logic in
  `lib/identity.ts` (+ 7 tests), `components/HeaderIdentity.tsx`.

### Mobile (`c204380`) — all under `apps/mobile`
- `src/hooks/useLiveDevices.ts` — copies `useSessions` shape; the app's first `AppState`
  listener; adaptive polling gated on `active && AppState==="active" && segment==="ongoing"`;
  **4s while a window is expanded, 30s otherwise**, auto-pause after 5 min idle.
- `src/components/LiveWindowCard.tsx` (window card, expand, ~8-tab cap + fold, per-window Save,
  http vs redacted classification), `LiveDeviceSection.tsx` (device header, freshness dot),
  `LiveEmptyState.tsx` (A off / B no-device / D provisioning), `src/lib/live.ts` (§4.4 helpers).
- Modified: `src/screens/SessionsScreen.tsx` (Saved/Ongoing `SegmentedControl`, per-window Save
  with stale-confirm), `App.tsx` (threads `active`/`onOpenSettings`), `src/api.ts`
  (`createSession`, `listLiveDevices`, `ProvisioningError`), `src/components/Symbol.tsx` (glyphs).

### Web (`41c0ad2`) — all under `apps/web`
- `components/library/ongoing-view.tsx` (device→window→tab, empty states, per-window Save),
  `sessions-panel.tsx` (Saved/Ongoing switch), `devices-settings.tsx` (Settings→Devices: toggle +
  Forget + "Forget is not Stop" copy), `hooks/use-live.ts` (**4s expanded / 15s idle**, paused
  when `document.visibilityState !== "visible"`), `components/ui/segmented-control.tsx`
  (hand-rolled — no shadcn Tabs installed), `lib/live-format.ts`.
- Modified: `lib/api.ts` (`getLive`, `setLiveEnabled`, `forgetLiveDevice`,
  `forgetAllLiveDevices`, `saveSession`), `app/api/live/route.ts` (**added the DELETE purge
  handler**), `settings-dialog.tsx` (Devices section), `app-sidebar.tsx`, `library-page.tsx`,
  `sessions-empty.tsx`.

---

## Invariants — do NOT break these when continuing

1. **`device_id` is the only key; `windowId` is never a key.** Every push full-replaces
   `windows_json`, so a browser restart (which changes `windowId`) can't orphan a window (§4.2.2).
   Do not move to per-window/per-tab rows or delta pushes without solving window identity first.
2. **Storage is the tenant DB**, per-DB isolation, no `user_id` column. Not Redis (§6.2).
3. **Freshness is server-owned.** `last_seen_at` server-stamped; clients render the integer
   `lastSeenAgeSeconds` and never subtract their own clock.
4. **Heartbeat (`windows` omitted) ≠ wipe (`windows: []`).** A heartbeat that sends `[]` wipes the
   mirror; a last-window-close that omits `windows` leaves a ghost. Keep them distinct.
5. **Default OFF, opt-in.** The settings toggle is the consent; no runtime prompt. **Retention 7
   days** (governs a device that stops reporting, never a window). Server-side 403 gate on push.
6. **Save = one window only** (not all windows, not cross-browser) → existing `POST /api/sessions`.
7. **The chat SQL-tool blocklist must always include the live tables.** Any new live table is
   agent-readable the moment it exists (the tool is a denylist).
8. **Cadence = event-driven + 5s debounce**, `chrome.alarms` is only the heartbeat/backstop.

---

## Deferred / known gaps (v1-acceptable, but track them)

- **Mobile can't enable the feature** — no toggle in mobile Settings. Turn it on from the
  extension popup or web Settings→Devices. Arguably the safer default (no remote-arming a laptop
  from a phone); ties into the open two-key question (§5.2).
- **Web device rename is read-only** — the label is set at the machine (extension popup, §4.5).
  Backend has no rename path that survives the next push. To add: `PATCH /api/live/[id]` +
  `setDeviceLabel` (must NOT touch `last_seen_at`) + push-side "don't clobber a user-set label".
- **No test infra in `packages/db` / `packages/engine`** — the privacy-sensitive invariants
  (default-off, TTL reap, quota, blocklist) have no committed regression tests. The backend build
  used a throwaway in-memory smoke. Adding vitest to those two packages is recommended.
- Mobile per-tab long-press action sheet deferred (tap-to-open only). Web renders all tabs on
  expand (no ~8 cap — fine, it scrolls). Extension rename propagates on next checkpoint (≤2 min),
  and `tabs.onActivated`/`windows.onFocusChanged` are intentionally excluded from dirty triggers
  (focus churn; the tab-*set* changes that "10→9" needs are all covered).
- Two surface agents ran `pnpm install --frozen-lockfile` in their worktrees (needed `tsc`;
  worktrees have no `node_modules`) — verified neither changed `pnpm-lock.yaml` nor committed it.

## Still-open design decisions (from spec §9.2)

- **Two-key / anti-stalkerware model (§5.2).** Because the extension is already signed in and
  holds `tabs`, an account-level toggle means someone with the password can enable sync remotely
  with no signal on the laptop — a hole Chrome Sync / iCloud Tabs don't have (they require sign-in
  *at the device*). Undecided. Decide before real-world exposure.
- **Measure the phone-readable fraction** of mirrored tabs before believing the feature's value.
- **Ship Stage 0 ("Save session, keep open") and wait?** It's already shipped; if it satisfies,
  Stages 1–3 may be unnecessary.

---

## Remaining before real-world use

1. **(Recommended) adversarial review of the three surfaces** — the backend got one; the surfaces
   got only typecheck + the extension's unit tests. Prioritize the extension push loop + sanitizer.
2. **Deploy** — applies additive migration v3 to prod tenant DBs on first touch. Safe (additive,
   reviewed, proven to apply cleanly) but it *is* the real production migration — deliberate step.
3. **Ship gates (pre-existing tasks):**
   - Publish the extension (Chrome Web Store / AMO) — users install from a store; §10.1.
   - Enable Clerk Native API on prod so mobile can sign in — §10.2.
   - Firefox needs the honest `data_collection_permissions` change before AMO (§5.1.1) = spec
     Stage 3.

---

## How to test locally (continuation recipe)

- **Backend / API (works today, tokenless):**
  `DEV_OPEN_API=1 pnpm --filter @bookmark-ai/web dev` then curl `http://localhost:3000/api/live`.
  It's default-OFF, so `POST /api/live/settings {"enabled":true}` first, then
  `POST /api/live` a `pushLiveStateSchema` body, then `GET /api/live`. (`browser` enum:
  chrome/firefox/safari/edge/arc/other; `device`: desktop/laptop/mobile/tablet/other.) The full
  push→read→save→purge flow was verified this way. **This applies migration v3 to whatever
  `DATABASE_URL` points at** — locally that's the shared dev DB (additive, safe).
- **Web UI:** the app is Clerk-gated. A sandboxed/preview browser can't complete the Clerk
  dev-instance sign-in handshake (it 307s to accounts.dev) — sign in in a real browser at
  `localhost:3000`, then Sessions → **Ongoing**. Seed data via the curl push above.
- **Extension:** `pnpm --filter @bookmark-ai/extension dev` (WXT) in Chrome-for-Testing or
  Firefox — branded Chrome ≥137 blocks unpacked loads. See memory `extension-live-test-recipe`.
- **Mobile:** simulator build per memory `ios-mobile-dev-setup`
  (`cd apps/mobile && LANG=en_US.UTF-8 npx expo run:ios`, Metro separately). Default server target
  is `local` = the web dev server on :3000.
- **Full end-to-end on real devices:** a Vercel **preview deploy** of this branch (your real
  account signs in) — but that applies migration v3 to **prod** tenant DBs. Your call.
