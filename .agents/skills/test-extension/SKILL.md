---
name: test-extension
description: "How to build, load, automate, and QA the cross-browser extension (apps/extension, WXT — Chrome MV3, Firefox MV2, Safari) on this Mac: Chrome for Testing + puppeteer recipes, Firefox web-ext temporary add-ons, the Safari Xcode wrapper pipeline, store-release builds, and failure→fix pairs. Use when testing or verifying any extension feature or a browser-specific bug report."
---

# Testing the extension (apps/extension — WXT, 3 targets)

Sources: `docs/TESTING.md` §3, `apps/extension/CLAUDE.md`, memory notes
`extension-live-test-recipe.md` + `deployment-state.md`.

## 0. Ground rules

- Dev server on :3000 (`DEV_OPEN_API=1 …`) is the LOCAL target; `https://bookmark-ai.cloud` is
  PROD. A PROD build only ever signs in against prod — load `-dev` outputs for localhost tests.
- Branded Chrome ≥137 CANNOT load unpacked extensions from the CLI — never chase that path.
- NEVER `pkill` (kills wrong processes); `wxt` one-shot commands hang — always go through
  `apps/extension/scripts/wxt-run.mjs` (never call bare `wxt` in scripts/CI).
- `.dev-extension-log.ndjson` is the diag breadcrumb log for every target (`"browser"` field).
- Report honestly; mark BLOCKED rather than fake (e.g. Incognito behaviour is NOT live-testable —
  the grant path is user-only; prove via unit tests and say so).

## 1. Build all targets

```bash
corepack pnpm --filter @bookmark-ai/extension build              # .output/chrome-mv3 (PROD)
corepack pnpm --filter @bookmark-ai/extension build:firefox      # .output/firefox-mv2 (PROD)
corepack pnpm --filter @bookmark-ai/extension build:safari       # .output/safari-mv3 (PROD)
corepack pnpm --filter @bookmark-ai/extension build:local        # .output/chrome-mv3-dev (LOCAL)
corepack pnpm --filter @bookmark-ai/extension build:firefox:local
corepack pnpm --filter @bookmark-ai/extension build:safari:local
corepack pnpm --filter @bookmark-ai/extension test               # vitest (currently ~162 tests)
```

- Manifest diff across the three `manifest.json`s must show ONLY the intentional differences
  (MV2 vs MV3 shape, Chrome-only key/externally_connectable/tabGroups/readingList, Safari-only
  scripting + bridge.js + nativeMessaging, Firefox-only browser_specific_settings + marker.js).

## 2. Chrome — scripted (the proven recipe)

Chrome for Testing + puppeteer-core (binary under `~/.cache/puppeteer`):
`npx @puppeteer/browsers install chrome@stable`. Launch with
`--load-extension=.output/chrome-mv3-dev --disable-background-timer-throttling
--disable-backgrounding-occluded-windows --disable-renderer-backgrounding`.

- Open `chrome-extension://<id>/popup.html` in a BACKGROUND tab with the article tab active —
  popup's `tabs.query` must resolve to the article. `browser.newPage()` steals focus → popup
  misdetects itself as the active tab; re-focus the ordinary page (`bringToFront()`) right after.
- Clicks: DOM `.click()` via evaluate (element-handle clicks stall in unfocused tabs);
  `waitForFunction(…, {polling:"mutation"})` (RAF never fires in unfocused tabs).
- Signed-in gate without real Clerk (dev): seed
  `chrome.storage.local.set({deviceToken:{token:"bkd_…", exp:Date.now()+80*864e5}})` from the
  popup page — open mode accepts any bearer; `/api/me` answers `{signedIn:true}`.
- Success path races `window.close()` (auto ~1.2 s) — treat "target closed" as save-succeeded;
  verify via `GET /api/bookmarks`.
- MV3 service worker idles out in ~30 s; re-acquire the worker target before `openPopup()`.
- `chrome.storage` is NOT reachable on the service_worker target — set `apiUrl` from the popup
  page context (WXT `local:apiUrl` item) instead of driving the Settings UI.
- Expect `perf: api post {path:"/api/bookmarks",status:201}` lines in `.dev-extension-log.ndjson`.
- Scope diag breadcrumbs to ONE action: `wc -l < .dev-extension-log.ndjson` before, then
  `tail -n +<N+1>` after — only that action's lines.
- Timeout/failure injection: a "blackhole" TCP server (accepts, never responds) on e.g. :8199;
  point the sync host at `localhost:8199` (apiUrl from the popup page) — mid-flight popup must
  show `Saving…` + the host label, no hang, and the save completes after swapping back.
- Verify saves server-side, never from the popup alone: `curl -s "localhost:3000/api/bookmarks?limit=3"`.
- Locked display: headed Chrome + screencapture hang; use `chrome-headless-shell` from
  `~/.cache/puppeteer/chrome-headless-shell/…` over CDP (can't load extensions though —
  extension states need an unlocked display).

## 3. Firefox — temporary add-on (two ways)

1. By hand: `about:debugging#/runtime/this-firefox` → Load Temporary Add-on →
   `.output/firefox-mv2-dev/manifest.json` (or `-mv2` for prod). Temporary add-ons never survive
   a restart; only AMO-signed XPIs do.
2. Scripted (throwaway profile, popup reachable as a normal tab):
   ```bash
   UUID=5f3a9d2e-7c1b-4e6f-9a8d-0b1c2d3e4f50   # any UUID pins the moz-extension:// origin
   corepack pnpm dlx web-ext run --source-dir apps/extension/.output/firefox-mv2-dev \
     --pref "extensions.webextensions.uuids={\"bookmark-ai@bookmark-ai.cloud\":\"$UUID\"}" \
     --start-url http://localhost:3000/app --no-reload --no-input
   ```
   Open `moz-extension://$UUID/popup.html` only AFTER web-ext logs "Installed … as a temporary
   add-on" (a start-url tab loads before the install and stays blank). Alt+Shift+S opens the real
   toolbar popup. Expect the same popup as Chrome; NO `sdk failed … Missing host_permissions`
   line (that was the 2026-09-03 regression, fixed by the Clerk manifest shim).

## 4. Safari — the Xcode wrapper pipeline

```bash
corepack pnpm --filter @bookmark-ai/extension safari:xcode -- --install
```
ONE command: `build:safari` → bundle check (manifest version == package.json, exactly the four
prod host_permissions, MV3 SW; `--allow-dev-bundle` overrides) → `scripts/safari-version.mjs
--write` → rsync into `safari-app/Extension/Resources` → drift guard → `xcodegen generate` →
`xcodebuild … clean build` (clean is NOT optional — incremental builds keep stale appex
resources), signed with the real "Apple Development" identity → quits the running menu-bar app
via AppleScript (never kill) → replaces `/Applications/Bookmark AI.app` → unregisters + deletes
the DerivedData copy → relaunches → prints Safari's verdict:
`defaults read ai.bookmark.safari ai.bookmark.safari.lastExtensionState` → `enabled`.

Verify: `pluginkit -mAvvv -p com.apple.Safari.web-extension | grep -A4 ai.bookmark` → ONE row
under `/Applications/Bookmark AI.app`; menu-bar glyph with the status menu; in Safari Settings →
Extensions "Bookmark AI <version>" ticked; toolbar button opens the popup.

Headless checks (accessibility is on):
- Menu: `tell application "System Events" to tell process "Bookmark AI" to tell menu bar item 1
  of menu bar 2 to click` then click menu items.
- Toolbar button: click the button whose description contains "Bookmark AI" in
  `buttons of toolbar 1 of window 1` (a synthetic ⌥⇧S keystroke does NOT open the popup).
- Capture: `get {position, size} of window 1` + `screencapture -x -R x,y,w,h`; after a popup
  click Safari stays frontmost but macOS 14+ refuses `NSApp.activate()` — use
  `perform action "AXRaise" of window 1` + `set frontmost to true` first.
- Sign-in channel (Safari only): the popup → background → `nativeMessaging` → App Group suite.
  Check via `defaults read ~/Library/Group\ Containers/L3PP7DQZWS.ai.bookmark.safari/Library/Preferences/L3PP7DQZWS.ai.bookmark.safari.plist`
  (by full plist PATH — by suite name says "does not exist"). To see signed-out rendering WITHOUT
  signing anyone out: `defaults write <path> signedIn -bool false`, look, then back to true.

To test the LOCAL bundle in Safari deliberately (wrapper normally refuses non-prod):
`rm -rf .output/safari-mv3 && ditto .output/safari-mv3-dev .output/safari-mv3 && pnpm
--filter @bookmark-ai/extension safari:xcode -- --skip-web-build --allow-dev-bundle --install`;
restore prod with a plain `safari:xcode -- --install` afterwards.

## 5. Native sync (Chrome/Firefox)

Web app → Settings → Sync toggles; Ctrl/Cmd+D save mirrors within moments; Reading List "+ Add
current tab" gets `reading`+`article` tags; full sync off: native remove keeps the copy; on:
mirrored delete. Imports must NOT mirror (Chrome bracketed by onImportBegan/Ended; >60 s-old
`dateAdded` skipped — expect `nativeSync: add skipped (backfilled node)` lines). Firefox has no
reading list. Turning the master toggle off stops mirrors within ≤6 h (boot + 6 h auth alarm).

## 6. Store/release builds + shipping

- Store zips: see `apps/extension/RELEASING.md`; the CWS/AMO workflows NEVER auto-published
  (CWS_* secrets unset) — shipping = build + Tara reloads at chrome://extensions (unpacked prod
  build, pinned CRX key gives the stable id) or a store upload by her.
- AMO listing icon: needs `action.default_icon` in the manifest (shipped in 0.1.3 —
  Bugzilla 1842447; check `wxt.config.ts` if the AMO icon breaks again).
- Firefox Clerk mint 400 on prod (fixed 2026-09-08): extension background fetch carries
  `Origin: moz-extension://<uuid>`; Clerk's `allowed_origins` is an explicit RESTRICTION list —
  the fix strips Origin on the extension's OWN FAPI requests only (never the page's own Clerk
  requests — the first fix leaked scope and broke web Clerk.js in Firefox; the regression test
  pins the scope).

## 7. Failure→fix pairs

- `--load-extension` silently ignored on branded Chrome ≥137 ⇒ Chrome for Testing only.
- Popup shows chrome-extension:// URL as the saved page ⇒ popup tab stole focus; bringToFront.
- "Missing host_permissions" from Clerk in Firefox ⇒ the background must patch the manifest shim
  (`bg: clerk manifest shim {outcome:"patched"}` in the diag log).
- Live-tabs toggle flips off in <1 s on Firefox prod (2026-09-08) ⇒ device-token mint 400 from
  Clerk FAPI (Origin restriction) — see §6.
- Live tabs take 5–10 s + retry after that fix (page's own Clerk.js slowed by the first Origin
  fix) ⇒ scope the Origin-strip to extension-originated requests only.
- web-ext start-url tab blank ⇒ install the add-on first, then open the moz-extension URL.
- Incognito "Allow" cannot be automated ⇒ unit-test the filter; mark the live check BLOCKED.
