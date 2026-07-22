# Extension — Agent Guide (WXT)

One codebase → three browsers at build time. WXT 0.20 + React 19 + Tailwind v4.

```bash
pnpm --filter @bookmark-ai/extension dev            # chrome dev w/ HMR
pnpm --filter @bookmark-ai/extension build          # .output/chrome-mv3  (turbo's `build`)
pnpm --filter @bookmark-ai/extension build:preview  # chrome, Vercel preview target
pnpm --filter @bookmark-ai/extension build:firefox  # .output/firefox-mv2
pnpm --filter @bookmark-ai/extension build:safari   # .output/safari-mv2
pnpm --filter @bookmark-ai/extension check-types
```

## Build targets (which server the extension talks to)

The app origin, Live server, and Clerk key/syncHost are chosen at BUILD time by
WXT's env mode — one committed `.env.<mode>` file per target (all values PUBLIC:
publishable keys + URLs). `lib/api.ts` / `lib/clerk.ts` read `import.meta.env.WXT_*`
with production fallbacks. A developer can still override the API base at RUNTIME
in the popup settings row; the env only sets the DEFAULT.

| Command | Mode / env file | App origin (API + web) | Clerk |
| --- | --- | --- | --- |
| `pnpm dev` | development / `.env.development` | `http://localhost:3000` | dev instance |
| `pnpm build` | production / `.env.production` | `https://bookmark-ai.cloud` | prod (`pk_live`) |
| `pnpm build:preview` | preview / `.env.preview` | `https://bookmark-ai-wine.vercel.app` | dev instance |

`wxt.config.ts` `host_permissions` is a static SUPERSET of all three origins +
`https://live.bookmark-ai.cloud/*` + both Clerk frontend APIs, so one manifest
covers every target. A plain `.env` (gitignored) overrides any mode's defaults.

Layout (keep multi-file — the user explicitly banned monolith files):

- `wxt.config.ts` — manifest fn (MV2/MV3-aware), permissions (`cookies` is for Clerk),
  `host_permissions`: `http://localhost/*` (ports are ignored in match patterns — covers the
  web dev server at localhost:3000, both Clerk syncHost and the local /api base) +
  `bookmark-ai.cloud` apex/www (prod API + prod Clerk syncHost, the default) +
  `bookmark-ai-wine.vercel.app` (preview target) + `live.bookmark-ai.cloud` (Live server) +
  Clerk frontend APIs (prod `clerk.bookmark-ai.cloud` + dev instance) — a static superset so one
  manifest serves all three build targets, the
  pinned CRX `key`, and `externally_connectable.matches` (localhost, vercel aliases,
  bookmark-ai.cloud apex/www — origins that may message the extension; a missing origin
  silently breaks "Open all in tab group" on that domain, Chrome won't even inject
  `chrome.runtime.sendMessage` there)
- `entrypoints/background.ts` — receives `SAVE_BOOKMARK`/`SAVE_SESSION`/`LIVE_SET_ENABLED`/
  `GET_USER`, POSTs to the API / reads the Clerk session, replies result/error. `GET_USER`
  resolves `{signedIn, name, email}` from the mirrored web session (createClerkClient + syncHost)
  — this is what the popup gate polls.
- `entrypoints/popup/` — `App.tsx` (auth gate: loading → `SignInGate` → full UI) + `components/`
  (SignInGate, SignOutButton, SaveCard, SavedResult, ErrorNote, LiveTabsToggle, SettingsRow, Spinner)
- `lib/messages.ts` — typed popup↔background contract (incl. `GET_USER`/`UserInfo`/`requestUser`)
  · `lib/api.ts` — fetch helper (API base from `local:apiUrl` storage; default is the build-target
  origin via `WXT_APP_URL`. Web/sign-in links share the API origin — `getWebBaseUrl` === API base,
  no separate web-URL setting) · `lib/detect.ts` — browser via `import.meta.env.BROWSER` build
  constant (+ UA brands for Edge/Arc), device/os heuristics
- `assets/tailwind.css` — mirrors `packages/ui/src/theme.css` tokens (sync manually on retheme)
- `scripts/generate-icons.mjs` — dependency-free PNG icon generator (`pnpm icons`)

Auth (Clerk, syncHost pattern):
- The popup does NOT host sign-in UI (OAuth is unsupported in extension popups). Instead
  `ClerkProvider` in `entrypoints/popup/main.tsx` gets `syncHost` → the extension mirrors the
  session the user creates on the **web app** (the build-target origin; see Build targets).
- **Signed-out gate**: `App.tsx` shows ONLY `SignInGate` (a sign-in prompt whose button opens
  `<appOrigin>/sign-in`) when no session — no save/session UI at all. The gate's auth source is
  the background `GET_USER` message (createClerkClient reads the mirrored session), NOT the popup
  hooks — so it's independent and pollable. App re-checks on popup open, on `visibilitychange`,
  and (only while the gate is up) on a 2s interval, so returning from the sign-in tab promotes the
  popup without a reinstall/reopen. Signed in → the user's name (from `UserInfo`, email fallback)
  shows on the LEFT of the header, with `SignOutButton` (`useClerk().signOut()`) on the right.
- `lib/clerk.ts` — publishable key + sync host (public values), env-driven per build target with
  **production** fallbacks (`clerk.bookmark-ai.cloud` + `https://bookmark-ai.cloud` syncHost; both
  Clerk frontend APIs are `host_permissions` entries). Per-target values live in `.env.<mode>`; a
  `.env` (from `.env.example`) overrides them locally.
- **Stable extension id** `ffhbgpgebpmofjkehpjcemepbgcmoelp` comes from the `key` in
  wxt.config.ts (private key: `.keys/crx-key.pem`, gitignored). That id is registered in the
  Clerk instance's `allowed_origins` (PATCH /v1/instance) together with localhost:3000 /
  127.0.0.1:3000 / bookmark-ai-theta.vercel.app — if the key ever changes, re-register or
  extension auth silently breaks. Don't remove the web origins: allowed_origins is a
  RESTRICTION list once set (null = allow all).

Gotchas:
- Types come from `@bookmark-ai/types` (workspace). tsconfig extends `.wxt/tsconfig.json`
  (generated by `wxt prepare` on postinstall — run `pnpm install` if it's missing).
- Changing the API URL to a non-localhost origin needs a matching `host_permissions` entry.
- Keyboard shortcut Alt+Shift+S opens the popup (`_execute_action` / `_execute_browser_action`).
- Loading instructions per browser: see `docs/TESTING.md` §3 (Safari needs
  `xcrun safari-web-extension-converter`).
