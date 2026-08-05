# Testing Playbook

Step-by-step verification of every surface. All of this passed on 2026-07-09; if something
fails, the regression is real. Commands assume repo root unless noted.

## 0. Static gates (fast, run first)

```bash
pnpm install
pnpm turbo build check-types        # builds + typechecks every package
cd apps/desktop && native check && native test   # markup+contract clean, 11/11 tests
```

## 1. API + database

The API is the web dev server (`apps/web` on :3000) — there is no separate server. Run it
OPEN (`DEV_OPEN_API=1`) so tokenless curl works without a Clerk session:

```bash
# Free the port first — a stale dev server serves OLD code silently:
lsof -i :3000 -P   # kill any PID found (process is `next-server`, not tsx)
DEV_OPEN_API=1 pnpm --filter @bookmark-ai/web dev
```

Boots Next on :3000; with `DATABASE_URL` unset it falls back to the repo-root
`file:../../data/bookmarks.db`. Without `DEV_OPEN_API=1` (and with Clerk keys configured)
these curls return `401` — that's the auth gate working; use a Clerk JWT or run open.

```bash
curl -s http://localhost:3000/api/health
# {"ok":true,"ai":false}   (ai:true when GEMINI_API_KEY set)

# Save (exercises OG scrape + categorization; needs internet):
curl -s -X POST http://localhost:3000/api/bookmarks -H 'content-type: application/json' \
  -d '{"url":"https://github.com/vercel-labs/native","browser":"chrome","device":"laptop","os":"macOS"}'
# → 201; bookmark.og.image + og.favicon populated, category "Development" (heuristic) with tags

curl -s "http://localhost:3000/api/search?q=native+desktop&mode=text"   # ≥1 result
curl -s "http://localhost:3000/api/search?q=native&mode=ai"             # no key → mode:"text", fallback:true
curl -s http://localhost:3000/api/meta                                   # facet counts consistent
```

Deployed API (no local server needed — hits the live Vercel deployment):

```bash
curl -s https://bookmark-ai.cloud/api/health
# {"ok":true,"ai":true}   — public, the one route that skips auth

curl -s https://bookmark-ai.cloud/api/bookmarks
# {"error":"Missing or invalid bearer token"}   — 401, needs a Clerk session JWT
```

With a Gemini key: save a bookmark, then the Next `after()` embeds it in the background
(watch the dev-server log for the `[embed] <id> <domain>` line) within a second or two;
`mode=ai` must then return results WITHOUT `fallback` and score by meaning, not keywords.

Edge cases that must not 500: unreachable URL saves fine with empty OG; `q` with FTS
operators (`"a AND (b"`) is sanitized; re-saving a URL updates instead of duplicating.

## 2. Web app (browser/computer-use testing)

```bash
pnpm --filter @bookmark-ai/web dev   # :3000  (this same process serves the API)
```

Checklist:
- Sidebar shows counts for Categories/Browsers/Devices/Recent days matching `/api/meta`;
  every section header is a collapsible trigger (chevron flips, list folds); Categories
  caps at 6 rows with "View all (N)" ↔ "Show less" expanding in place.
- Cards render OG image (or domain-initial fallback), favicon, title, description, category
  badge (folder icon) vs tag badges (hash icon), browser/device icons, relative date.
  Card links open the bookmarked URL.
- View toggle right of the tag rail switches grid / list (side-thumbnail rows) / compact
  (dense single lines); the choice persists across reloads (localStorage) and applies to
  search results too. No layout may scroll the page horizontally.
- Facet click filters grid + updates header title + URL query param (`?category=…`) —
  back button works; clicking the active facet clears it.
- A view with >100 bookmarks shows "Showing 100 of N" + a Load more button that appends
  the next page (server pages via `limit`/`offset`; search results are capped separately).
- Tag rail above the grid (top tags + counts from `/api/meta`): "Tags" label, chips on a
  single line with internal horizontal scroll, and an expand chevron at the end that
  unfolds the full wrapped list. A chip click filters via `?tag=…` and shows a
  `#tag · N bookmarks` heading in the content area — the header title stays on the
  selected view; clicking the active chip clears it; the rail hides while searching.
- Search box: typing filters live full-text (250 ms debounce); the header title never
  changes — a "Results for …" heading renders above the grid.
- ✨ Ask AI opens the chat panel seeded with the query (URL gains `mode=ai`): each tool
  call renders a status strip ("Full-text search / Semantic search · "query" · N matches")
  over always-visible bookmark cards — favicon, title, domain — description, % match
  (semantic only), clickable category/tag chips that jump back to the filtered library,
  and Copy-link + Open buttons; the streamed answer cites picks as markdown links.
  Follow-ups submit with Enter. Close (or typing in the header box) returns to the grid
  AND clears the search text — the header box must be empty and the URL free of `q`/`mode`.
  Needs `GEMINI_API_KEY` — without it `/api/chat` returns 503.
- "+ Add" dialog: paste URL (scheme auto-prepended) → saves → grid+sidebar refresh.
- Hover a card → trash icon → delete works.
- Mobile (375px): sidebar becomes sheet via trigger; header wraps; grid is 1-col.
- API failure (e.g. DB unreachable) → friendly error panel, not a crash.

## 3. Extension (WXT)

```bash
pnpm --filter @bookmark-ai/extension build           # .output/chrome-mv3
pnpm --filter @bookmark-ai/extension build:firefox   # .output/firefox-mv2
pnpm --filter @bookmark-ai/extension build:safari    # .output/safari-mv3
```

All three must succeed. Live test (needs a real browser via computer use / chrome MCP):
1. Chrome → `chrome://extensions` → Developer mode → Load unpacked → `apps/extension/.output/chrome-mv3`.
2. Open any article page → click the Bookmark AI toolbar icon → popup shows tab favicon/title/url.
3. "Save bookmark" → success card shows the AI category + tags returned by the server;
   popup auto-closes ~1.2 s later. Verify the bookmark appears in the web app with
   `browser:"chrome"` and correct device/os.
4. Error path: stop the server, save → "Is the Bookmark AI server running?" message.
5. Settings row persists a custom API URL (storage.local). Note: non-localhost origins may
   need extra `host_permissions` in `wxt.config.ts`.
6. Native-sync (Chrome/Firefox popup reload not needed — listeners live in the background):
   - Web app → Settings → "Sync" shows the two toggles (master ON, full sync OFF by default).
   - With sync on: press Ctrl/Cmd+D in Chrome and save the bookmark → it appears in the web
     app within moments (categorized/enriched shortly after), `browser:"chrome"`.
   - Chrome Reading List: side panel → "+ Add current tab" → saved with the `reading` and
     `article` tags (searchable via the tag rail).
   - Full sync off: remove that native bookmark → the Bookmark AI copy stays. Full sync on:
     native remove → the copy deletes (mirrored by url→id map; requires the add to have been
     mirrored by that same install).
   - Turning the master toggle off in Settings → Sync stops new mirrors within ≤6h (the
     extension's settings refresh runs at boot + on the 6h auth alarm).
- Firefox: `about:debugging` → Load Temporary Add-on → `.output/firefox-mv2/manifest.json`
  (native-sync bookmark mirror works there too; Firefox has no reading list).
- Safari (verified recipe — needs full Xcode; note: native-sync is a compile-time no-op in
  Safari — Apple exposes no bookmarks/Reading List API to extensions):
  1. `cd apps/extension && xcrun safari-web-extension-converter .output/safari-mv3 --app-name "Bookmark AI" --bundle-identifier ai.bookmark.safari --project-location safari-xcode --macos-only --no-open --no-prompt --force`
     Note: running the converter WITHOUT `--project-location` dumps a duplicate project with
     placeholder `com.yourCompany.*` bundle ids into `apps/extension/Bookmark AI/` — delete it and
     use the command above. JS/manifest-only changes need NO reconversion — the Xcode project
     references `.output/safari-mv3` directly — BUT an incremental `xcodebuild build` will
     silently keep the previously-copied resources (verified: it reported BUILD SUCCEEDED while
     embedding a week-old bundle). After any `pnpm build:safari`, rebuild with `clean build`
     (step 3) so the fresh resources are re-copied into the appex.
  2. `apps/extension/scripts/sync-safari-native.sh` — patches the just-generated (gitignored)
     project with our COMMITTED native sources in `apps/extension/safari-native/`: it turns the
     wrapper into a **menu-bar background app** (AppDelegate/ViewController overwrite → NSStatusItem,
     survives window-close, "Start at Login" via SMAppService), fixes the app target's bundle id
     (`ai.bookmark.Bookmark-AI` → `ai.bookmark.safari`, else the build fails at ValidateEmbeddedBinary),
     and sets `LSUIElement=true` in the app Info.plist (no Dock icon). Idempotent — re-run after every
     reconversion, before xcodebuild. Fails loudly (quoting the converter command) if `safari-xcode/`
     is missing.
  3. `cd "safari-xcode/Bookmark AI" && xcodebuild -project "Bookmark AI.xcodeproj" -scheme "Bookmark AI" -configuration Debug clean build CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY="Apple Development: tarachandragupta2784@gmail.com (BB7CP2R7GG)" DEVELOPMENT_TEAM=L3PP7DQZWS PROVISIONING_PROFILE_SPECIFIER=""`
     (`clean` matters — see step 1 note. The signing flags use the Apple Development
     cert already in this Mac's keychain: a REAL signature makes Safari keep the
     extension across restarts with NO "Allow Unsigned Extensions" re-arm. Dropping
     them falls back to ad-hoc signing, which Safari treats as unsigned and forgets
     on every restart. Do NOT pass CODE_SIGNING_REQUIRED=NO.)
  4. Install to a STABLE path and keep it the ONLY copy — multiple registered copies of the
     app (DerivedData + /Applications + ~/Applications) make Safari's extension list appear
     empty or doubled, and each rebuild re-registers the DerivedData copy:
     `ditto "$DD_APP" "/Applications/Bookmark AI.app" && pluginkit -r "$DD_APP/Contents/PlugIns/Bookmark AI Extension.appex"; rm -rf "$DD_APP"; open "/Applications/Bookmark AI.app"`
     (where `DD_APP=~/Library/Developer/Xcode/DerivedData/Bookmark_AI-*/Build/Products/Debug/"Bookmark AI.app"`).
     Running the app once registers the extension; verify a single registration with
     `pluginkit -mAvvv | grep -A1 ai.bookmark`.
  5. In Safari: Settings → Advanced → "Show features for web developers", then Develop →
     "Allow Unsigned Extensions" (re-arm after each Safari restart), then Settings →
     Extensions → enable Bookmark AI. `safari-xcode/` is gitignored (generated).

## 4. Desktop (native SDK — GUI session required)

Full detail in `apps/desktop/CLAUDE.md`. The desktop app talks to the local web dev server,
so start it OPEN first: `DEV_OPEN_API=1 pnpm --filter @bookmark-ai/web dev`. Fast path:

```bash
cd apps/desktop
native dev -Dautomation=true &      # window opens; boot-fetches from :3000
native automate wait                # ready=true + full widget snapshot
native automate screenshot main-canvas   # deterministic PNG in .zig-cache/native-sdk-automation/
```

Verify in the snapshot/screenshot: sidebar categories with counts; cards with site line,
title, description, category badge, #tags, `browser · device · day`; status bar
`N shown · M total · localhost:3000`.

Interaction: get a category row's widget id from `native automate snapshot`
(**the id right after `#` on the SAME line as `role=listitem`** — the trailing `parent=#…` id
is a different widget!), then:

```bash
native automate widget-click main-canvas <id>
# status bar → "1 shown · M total", header → category name
```

Search (header field): get the textbox id from the snapshot (`role=textbox`), then

```bash
native automate widget-action main-canvas <textbox-id> set_text fetch
native automate widget-key main-canvas enter
# header → Search "fetch"; status bar → "N result(s) · localhost:3000"
native automate widget-action main-canvas <textbox-id> set_text ""   # restores the library
```

Server down → cards replaced by error panel + "Try again" button; status bar says Offline.
Card click / context-menu "Open in Browser" opens the URL in the default browser.

## 5. Cross-surface E2E (the money test)

1. Web dev server running (open, on :3000 — it serves both the UI and the API), extension loaded.
2. Save a page from the extension in Chrome (point its popup API URL at `http://localhost:3000`).
3. Web app (:3000): bookmark appears with browser=chrome provenance.
4. Desktop: press the refresh button (top right) → same bookmark appears natively.
5. Search for it by a title word in both web (text mode) and `curl /api/search`.
