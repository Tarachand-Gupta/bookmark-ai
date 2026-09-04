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

Settings AI mode, skills, account plan (all against the open dev server):

```bash
curl -s http://localhost:3000/api/account                                   # {"plan":"free"}
curl -s http://localhost:3000/api/settings | jq '.settings|{aiMode,ownKeyReady}'   # "included" / false (no key)
curl -s -X PUT http://localhost:3000/api/settings -H 'content-type: application/json' -d '{"aiMode":"own"}'
# → 400 {"error":"Add an API key before switching to your own key"}   (no key stored)
curl -s -X PUT http://localhost:3000/api/settings -H 'content-type: application/json' -d '{"apiKey":"sk-test-1234"}' | jq '.settings|{aiMode,apiKeySet,apiKeyLast4}'
# → own / true / "1234"; then {"aiMode":"included"} keeps the key, {"provider":"openai"} keeps key+model,
#   {"apiKey":""} clears the key AND sets included. (Needs AI_KEY_ENCRYPTION_SECRET in root .env.)

curl -s -X POST http://localhost:3000/api/skills -H 'content-type: application/json' \
  -d '{"name":"Link triage","description":"Sort new links into keep / skim / drop","instructions":"…"}'
# → 201 {skill}; repeating with "LINK TRIAGE" → 409; "bad/name" → 400
curl -s http://localhost:3000/api/skills                                    # {"skills":[…]} newest first
curl -s -X PUT http://localhost:3000/api/skills/<id> -H 'content-type: application/json' -d '{"enabled":false}'
curl -s -i -X DELETE http://localhost:3000/api/skills/<id>                  # 204; again → 404
```

Chat protocol + attachments (needs `GEMINI_API_KEY`). The stream is SSE `data:` lines of UI chunks:

```bash
# First turn: full messages array → X-Conversation-Id + X-Ai-Source headers, reasoning-* + tool-* chunks
curl -s -i -X POST http://localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"messages":[{"id":"u1","role":"user","parts":[{"type":"text","text":"What am I working on?"}]}],"timezone":"Asia/Kolkata"}' \
  | grep -iE '^x-(conversation-id|ai-source)|"type":"(reasoning-start|tool-input-available)"' | head
# Follow-up: ONLY the new message + conversationId — the server supplies the history
curl -s -X POST http://localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"message":{"id":"u2","role":"user","parts":[{"type":"text","text":"Summarise that in one sentence."}]},"conversationId":"<id>"}'
# Attachment rules are re-enforced server-side BEFORE the model call:
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"messages":[{"id":"u1","role":"user","parts":[{"type":"file","filename":"app.ts","mediaType":"text/plain","url":"data:text/plain;base64,eA=="}]}]}'   # 415
# A PNG/JPEG/WebP/GIF ≤2 MB, .md/.txt/.csv/.json/.html ≤1 MB or .pdf ≤3 MB file part is accepted (≤5 files, ≤4 MB total → else 413).
curl -s http://localhost:3000/api/chat/conversations/<id>   # persisted transcript: user parts keep the file part; assistant parts include reasoning + tool-* parts
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
# PROD target (bookmark-ai.cloud + prod Clerk) — what users get:
pnpm --filter @bookmark-ai/extension build           # .output/chrome-mv3
pnpm --filter @bookmark-ai/extension build:firefox   # .output/firefox-mv2
pnpm --filter @bookmark-ai/extension build:safari    # .output/safari-mv3   (the dir the Xcode wrapper embeds)
# LOCAL target (localhost:3000 + dev Clerk, red "(Local)" icon) — what you load to test against the dev server:
pnpm --filter @bookmark-ai/extension build:local          # .output/chrome-mv3-dev
pnpm --filter @bookmark-ai/extension build:firefox:local  # .output/firefox-mv2-dev
pnpm --filter @bookmark-ai/extension build:safari:local   # .output/safari-mv3-dev
```

A PROD build only ever signs in against `bookmark-ai.cloud`; load the `-dev` output whenever the
test plan says "localhost:3000" — a `firefox-mv2` popup pointed at the local dev server can never
reach the signed-in state. The Safari wrapper project references `.output/safari-mv3` by path, so
to try the LOCAL target in Safari: `rm -rf .output/safari-mv3 && ditto .output/safari-mv3-dev
.output/safari-mv3`, run steps 2–4 below, then `pnpm build:safari` again to put the prod bundle
back before the next wrapper build (not exercised as of 2026-09-03 — only the prod bundle has
been embedded and registered).

All three must succeed. Also compare the three `.output/*/manifest.json` side by side — every
difference must be one of the intentional ones: MV2 vs MV3 shape (`browser_action`/`background.scripts`
vs `action`/`background.service_worker`, `_execute_browser_action` vs `_execute_action`, MV2 host
patterns folded into `permissions`), Chrome-only `key` + `externally_connectable` + `tabGroups`/
`readingList`, Chrome/Firefox-only `bookmarks`, Safari-only `scripting` + `bridge.js`, Firefox-only
`browser_specific_settings`, and the `marker.js` content script on Firefox + Safari only.

Live test — scripted (Chrome for Testing + puppeteer-core; branded Chrome ≥137 can't load unpacked
extensions from the command line): launch the CfT binary from `~/.cache/puppeteer` with
`--load-extension=.output/chrome-mv3-dev` (the LOCAL target, `pnpm build:local`), open
`chrome-extension://joillpelifndeefomeimoomlgoimbkei/popup.html` in a BACKGROUND tab while an article
tab is active, and drive it with DOM `.click()` + `waitForFunction(…, {polling:"mutation"})`. With the
dev server in `DEV_OPEN_API=1` mode, seeding `chrome.storage.local.set({deviceToken:{token:"bkd_…",
exp:Date.now()+80*864e5}})` from the popup page promotes the gate to the signed-in UI (open mode
accepts any bearer; `/api/me` answers `{signedIn:true}`) so save/session flows run against the real
API. Expect `perf: api post {path:"/api/bookmarks",status:201}` / `/api/sessions` 201 in
`.dev-extension-log.ndjson`; delete what you created by id afterwards.

Live test — by hand (needs a real browser via computer use / chrome MCP):
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
   - Importing bookmarks (Chrome/Firefox Library → Import, Firefox's migration wizard, a
     bookmarks.html restore) must NOT mirror them: Chrome is bracketed by onImportBegan/Ended,
     and every browser skips nodes whose `dateAdded` is >60s old at notification time — expect
     `nativeSync: add skipped (backfilled node)` lines in `.dev-extension-log.ndjson`, no saves.
- Firefox (verified 2026-09-03 with Firefox 151 + `web-ext` 10.6): two ways to load the MV2 build.
  Use `firefox-mv2-dev` (`build:firefox:local`) for anything involving localhost:3000; `firefox-mv2`
  is the prod target.
  1. By hand: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick
     `apps/extension/.output/firefox-mv2-dev/manifest.json` (or `firefox-mv2/` for prod). The add-on lives until Firefox quits —
     **temporary add-ons never survive a restart**; only an AMO-signed XPI does (`web-ext sign`
     needs `WEB_EXT_API_KEY`/`WEB_EXT_API_SECRET`, which are NOT in this repo or its env — until
     an AMO account exists, reload the temporary add-on each session). Firefox Developer Edition /
     Nightly can also install an UNSIGNED XPI persistently with
     `xpinstall.signatures.required=false` in `about:config` (release Firefox ignores that pref).
  2. Scripted (throwaway profile, add-on preloaded, no clicking):
     ```bash
     UUID=5f3a9d2e-7c1b-4e6f-9a8d-0b1c2d3e4f50   # any UUID — pins the moz-extension:// origin
     pnpm dlx web-ext run --source-dir apps/extension/.output/firefox-mv2-dev \
       --pref "extensions.webextensions.uuids={\"bookmark-ai@purecode.ai\":\"$UUID\"}" \
       --start-url http://localhost:3000/app --no-reload --no-input
     ```
     The `uuids` pref makes the popup reachable as a normal tab at
     `moz-extension://$UUID/popup.html` (open it AFTER web-ext logs "Installed … as a temporary
     add-on" — a start-url tab loads before the install and stays blank); Alt+Shift+S opens the
     real toolbar popup. Diag breadcrumbs from the Firefox background/popup land in
     `.dev-extension-log.ndjson` like every other target (`"browser":"firefox"`).
  - Expect the same popup as Chrome: sign-in gate when signed out, `bg: clerk manifest shim
    {outcome:"patched"}` in the diag log, and NO `sdk failed … Missing host_permissions` line
    (that was the 2026-09-03 Firefox regression — see `apps/extension/CLAUDE.md` → Auth).
  - Native-sync bookmark mirror works there too; Firefox has no reading list.
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
     `pluginkit -mAvvv -p com.apple.Safari.web-extension | grep -A4 ai.bookmark` (expect ONE
     `ai.bookmark.safari.Extension` row whose Path is under `/Applications/Bookmark AI.app`).
     First launch shows the setup window plus a one-time "Run Bookmark AI in the background?"
     prompt (`Start at Login` = SMAppService login item); later launches are menu-bar only.
     The JS/manifest inside the installed appex is whatever `.output/safari-mv3` held at
     xcodebuild time — after any `pnpm build:safari`, repeat steps 3–4 (quit the running app
     first: `osascript -e 'quit app "Bookmark AI"'`).
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
