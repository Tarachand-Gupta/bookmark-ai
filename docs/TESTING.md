# Testing Playbook

Step-by-step verification of every surface. All of this passed on 2026-07-09; if something
fails, the regression is real. Commands assume repo root unless noted.

## 0. Static gates (fast, run first)

```bash
pnpm install
pnpm turbo build check-types        # 9 tasks; server "no output files" warning is cosmetic
cd apps/desktop && native check && native test   # markup+contract clean, 11/11 tests
```

## 1. Server + database

```bash
# Free the port first — a stale server serves OLD code silently:
lsof -i :4000 -P   # kill any PID found
pnpm --filter @bookmark-ai/server dev
```

Expected boot log: API on :4000, `database: file:./data/bookmarks.db`, `ai: gemini|disabled`.

```bash
curl -s http://localhost:4000/api/health
# {"ok":true,"ai":false}   (ai:true when GEMINI_API_KEY set)

# Save (exercises OG scrape + categorization; needs internet):
curl -s -X POST http://localhost:4000/api/bookmarks -H 'content-type: application/json' \
  -d '{"url":"https://github.com/vercel-labs/native","browser":"chrome","device":"laptop","os":"macOS"}'
# → 201; bookmark.og.image + og.favicon populated, category "Development" (heuristic) with tags

curl -s "http://localhost:4000/api/search?q=native+desktop&mode=text"   # ≥1 result
curl -s "http://localhost:4000/api/search?q=native&mode=ai"             # no key → mode:"text", fallback:true
curl -s http://localhost:4000/api/meta                                   # facet counts consistent
```

Vector layer without a Gemini key (synthetic embedding round-trip):

```bash
cd apps/server && pnpm tsx scripts/verify-vector.ts
# OK: vector store+search works (top score 1.0000, embedded=true)
```

With a key: save a bookmark, wait ≤30 s for `[embed] <id> <domain>` in the server log, then
`mode=ai` must return results WITHOUT `fallback` and score by meaning, not keywords.

Edge cases that must not 500: unreachable URL saves fine with empty OG; `q` with FTS
operators (`"a AND (b"`) is sanitized; re-saving a URL updates instead of duplicating.

## 2. Web app (browser/computer-use testing)

```bash
pnpm --filter @bookmark-ai/web dev   # :3000  (server must be up)
```

Checklist:
- Sidebar shows counts for Categories/Browsers/Devices/Recent days matching `/api/meta`.
- Cards render OG image (or domain-initial fallback), favicon, title, description, category
  badge, tags, browser/device icons, relative date. Card links open the bookmarked URL.
- Facet click filters grid + updates header title + URL query param (`?category=…`) —
  back button works; clicking the active facet clears it.
- A view with >100 bookmarks shows "Showing 100 of N" + a Load more button that appends
  the next page (server pages via `limit`/`offset`; search results are capped separately).
- Tag chip rail above the grid (top tags + counts from `/api/meta`): a chip click filters
  via `?tag=…` and retitles the header `#tag`; clicking the active chip clears it; the
  rail hides while searching.
- Search box: typing filters live full-text (250 ms debounce); the header title never
  changes — a "Results for …" heading renders above the grid.
- ✨ Ask AI opens the chat panel seeded with the query (URL gains `mode=ai`): the agent
  runs a searchFullText/searchSemantic tool (collapsible "Completed" block listing the
  matched bookmarks) and streams a cited answer; follow-ups submit with Enter; Close (or
  typing in the header box) returns to the grid. Needs `GEMINI_API_KEY` — without it
  `/api/chat` returns 503.
- "+ Add" dialog: paste URL (scheme auto-prepended) → saves → grid+sidebar refresh.
- Hover a card → trash icon → delete works.
- Mobile (375px): sidebar becomes sheet via trigger; header wraps; grid is 1-col.
- Server down → friendly error panel naming the dev command (not a crash).

## 3. Extension (WXT)

```bash
pnpm --filter @bookmark-ai/extension build           # .output/chrome-mv3
pnpm --filter @bookmark-ai/extension build:firefox   # .output/firefox-mv2
pnpm --filter @bookmark-ai/extension build:safari    # .output/safari-mv2
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
- Firefox: `about:debugging` → Load Temporary Add-on → `.output/firefox-mv2/manifest.json`.
- Safari: `xcrun safari-web-extension-converter apps/extension/.output/safari-mv2 --app-name "Bookmark AI"` → run Xcode project → enable in Safari (allow unsigned in Develop menu).

## 4. Desktop (native SDK — GUI session required)

Full detail in `apps/desktop/CLAUDE.md`. Fast path:

```bash
cd apps/desktop
native dev -Dautomation=true &      # window opens; boot-fetches from :4000
native automate wait                # ready=true + full widget snapshot
native automate screenshot main-canvas   # deterministic PNG in .zig-cache/native-sdk-automation/
```

Verify in the snapshot/screenshot: sidebar categories with counts; cards with site line,
title, description, category badge, #tags, `browser · device · day`; status bar
`N shown · M total · localhost:4000`.

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
# header → Search "fetch"; status bar → "N result(s) · localhost:4000"
native automate widget-action main-canvas <textbox-id> set_text ""   # restores the library
```

Server down → cards replaced by error panel + "Try again" button; status bar says Offline.
Card click / context-menu "Open in Browser" opens the URL in the default browser.

## 5. Cross-surface E2E (the money test)

1. Server + web running, extension loaded.
2. Save a page from the extension in Chrome.
3. Web app (:3000): bookmark appears with browser=chrome provenance.
4. Desktop: press the refresh button (top right) → same bookmark appears natively.
5. Search for it by a title word in both web (text mode) and `curl /api/search`.
