# @bookmark-ai/extension — the browser extension

One WXT + React codebase compiled to **Chrome (MV3)**, **Firefox (MV2)**, and **Safari**.
The fastest way to save: click the toolbar icon → the popup shows the current page
pre-filled → Save. It can also snapshot **every open tab as a session**, and restores
sessions into a new window or (Chrome) a tab group.

## Auth

There is **no sign-in UI in the popup**. The extension mirrors the web app's Clerk
session via `syncHost`: sign in at the web app once, and the background service worker
(`createClerkClient` from `@clerk/chrome-extension/background`) mints API tokens from
that shared session. This requires the extension's ID to be stable — the CRX id
`ffhbgpgebpmofjkehpjcemepbgcmoelp` is pinned via a public key in the manifest — and the
id + web origins to be listed in the Clerk instance's `allowed_origins`.

## Layout

| Path | What |
| --- | --- |
| `entrypoints/popup/` | React popup UI (components in `components/`) |
| `entrypoints/background.ts` | service worker: API calls with auth, session restore (new window / `tabs.group`), message hub |
| `lib/api.ts` | API client (token provider injected by the background) |
| `lib/messages.ts` | typed message contracts between popup ⇄ background ⇄ web app |
| `wxt.config.ts` | manifest: permissions (`tabs`, Chrome-only `tabGroups`), pinned key, `externally_connectable` |

The API contract comes from the `@bookmark-ai/types` workspace package — inside this
app's `node_modules` that's a **symlink** into `packages/types`, not a copy. Styling is
Tailwind (`assets/tailwind.css`) mirroring the tokens in `packages/ui/src/theme.css`.

## Build & load

```bash
pnpm --filter @bookmark-ai/extension dev              # live-reload Chrome dev build
pnpm --filter @bookmark-ai/extension build            # → .output/chrome-mv3
pnpm --filter @bookmark-ai/extension build:firefox    # → .output/firefox-mv2
pnpm --filter @bookmark-ai/extension build:safari     # → .output/safari-mv2
```

- **Chrome / Edge / Arc**: `chrome://extensions` → Developer mode → Load unpacked → `.output/chrome-mv3`
- **Firefox**: `about:debugging` → This Firefox → Load Temporary Add-on → `.output/firefox-mv2/manifest.json`
- **Safari**: `xcrun safari-web-extension-converter .output/safari-mv2 --app-name "Bookmark AI"` and run the Xcode project

Store-submission steps live in [`docs/PRODUCTION.md`](../../docs/PRODUCTION.md).
See `CLAUDE.md` in this folder for agent-facing details (messaging contracts, testing
recipe with Chrome for Testing).
