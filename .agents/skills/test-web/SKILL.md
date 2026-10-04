---
name: test-web
description: "How to build, run, and QA the web app + API (apps/web, Next.js dev server on :3000) on this Mac: curl contract checks, signed-out vs signed-in QA, headless Chrome screenshot recipes, and failure→fix pairs. Use when testing or verifying any web/UI/API feature or a web bug report."
---

# Testing the web app + API (apps/web on :3000)

Sources: `docs/TESTING.md` §1/§2, past QA handoffs. One Next dev server serves BOTH the UI
and the API — there is no separate server.

## 0. Boot + boot gates

```bash
# ONE dev server serves everyone (UI + API):
lsof -i :3000 -P    # a stale `next-server` serves OLD code silently — kill the PID first
DEV_OPEN_API=1 pnpm --filter @bookmark-ai/web dev
```
- `DEV_OPEN_API=1` maps unauthenticated requests to the dev user (UI renders signed-in). WITHOUT
  it (and with Clerk keys set) every route 401s — that's the auth gate working, not a bug.
- NEVER run `pnpm turbo build`/`next build` while the dev server is up (clobbers `.next`, serves
  500s); NEVER bare-`vercel deploy --prod` in a subagent (prod deploys are the main session's job).
- The prod API IS this same dev server deployed — route behavior changes land in `packages/engine`
  (routes are thin adapters).

## 1. Contract checks (curl, signed-out with DEV_OPEN_API=1)

```bash
curl -s http://localhost:3000/api/health      # {"ok":true,"ai":<key set>}
curl -s -X POST http://localhost:3000/api/bookmarks -H 'content-type: application/json' \
  -d '{"url":"https://…"}'                    # 201 {bookmark}; OG scraped; AI category
curl -s "http://localhost:3000/api/search?q=…&mode=text"   # ≥1 result
curl -s "http://localhost:3000/api/search?q=…&mode=hybrid" # RRF blend; limit 40
curl -s http://localhost:3000/api/meta        # facet counts consistent
curl -s http://localhost:3000/api/account     # {"plan":"free"}
curl -s -i -X POST http://localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"messages":[{"id":"u1","role":"user","parts":[{"type":"text","text":"What am I working on?"}]}]}'
# → X-Conversation-Id + X-Ai-Source headers; SSE stream: reasoning-*, tool-*, text-*, finish
curl -s -X PUT http://localhost:3000/api/settings -H 'content-type: application/json' \
  -d '{"aiMode":"own"}'     # 400 while no key stored; {"apiKey":"sk…"} stores + sets own; {"apiKey":""} clears → included
curl -s http://localhost:3000/api/skills    # CRUD: 409 duplicate name (case-insensitive), 400 name>60, PUT enabled:false
```

- Paging: `offset` in → `{offset, hasMore}` out; page with `offset += limit` while `hasMore`
  (`offset + limit` ≤ 200). Omitting `offset` = the pre-paging response byte-for-byte.
- LIST tools (chat): `{limit≤50, offset}` in → one page + `{total, hasMore, nextOffset}` out.
- Upserts: re-saving a URL updates instead of duplicating.
- Edge cases that must NOT 500: unreachable URL saves with empty OG; FTS operators sanitized;
  attachments validated BEFORE any model call (415/413/400).
- Cleanup: every created row (bookmark/skill/conversation/user) recorded at creation and
  DELETEd → 204, re-query → 0 rows; settings diff vs baseline NONE.
- Chat later turns: `{message, conversationId}` (server loads stored history); GET the
  conversation transcript to verify. Probe chat timing: `curl -w '%{time_starttransfer} %{http_code}'`.

## 2. Signed-in web QA (headless)

- Headless recipe: the session scratch scratchpad `scratchpad/` contains `cdp.mjs` (dependency-free
  Chrome DevTools Protocol driver) — use headless Chrome or `chrome-headless-shell` (`~/.cache/puppeteer/chrome-headless-shell/…`)
  for authed pages; clone a signed-in CfT profile for auth.
- Checklist: sidebar facet counts match `/api/meta`; every section header is a collapsible
  trigger; cards render OG image/favicon/category badge/#tags/browser·device·relative date; view
  toggle grid/list/compact persists (localStorage); facet click filters + URL query param (back
  works); tag rail chips filter; search filters live (250 ms debounce, header title unchanged);
  Ask AI panel streams reasoning + tool rows; Add dialog saves; hover a card → trash → delete;
  mobile 375 px: sidebar becomes a sheet, grid 1-col; API failure → friendly error, not a crash.
- Test accounts (create/remove via the Clerk REST API — key from `apps/web/.env.local`, never printed):
  ```bash
  SK=$(grep '^CLERK_SECRET_KEY=' apps/web/.env.local | cut -d= -f2-)
  curl -s -X POST https://api.clerk.com/v1/users -H "Authorization: Bearer $SK" \
    -H 'content-type: application/json' \
    -d "{\"email_address\":[\"qa-$RANDOM+clerk_test@example.com\"],\"skip_password_checks\":true,\"password\":\"…\"}"
  # record {email,userId} → cleanup = DELETE /v1/users/:id; dev-instance OTP is 424242
  ```
  Headless sign-in (puppeteer-core@24 + CfT): `waitForSelector('input[name="identifier"]')` →
  triple-click (`clickCount:3`) + `type` (delay ~15) → Enter → password → 60 s loop for the OTP
  field, type `424242`, settle screenshots. Mobile-shaped page: MOBILE UA + viewport 390×844 +
  isMobile+touch; instrument() captures console/pageerror/requestfailed + `/api/` responses.
- Screenshots: `screencapture -x -R x,y,w,h nn-what.png` per screen; every claim points at one.

## 3. Cross-surface E2E (the money test)

1. Web dev server up (open), extension loaded, mobile/macOS on local target.
2. Save a page from the extension in Chrome (popup API URL at localhost:3000).
3. Web: bookmark appears with browser=chrome provenance.
4. macOS: refresh → same bookmark natively. Mobile: same on the emulator.
5. Search for a title word in web text mode, `curl /api/search`, and in the apps.
6. Ask AI in web → follow-up keeps context (server-side history).

## 4. Failure→fix pairs

- EADDRINUSE with OLD code serving ⇒ `lsof -i :3000 -P`, kill the PID, restart.
- 401s everywhere with the UI looking signed-in ⇒ `DEV_OPEN_API=1` missing from the dev command.
- `next build` while dev server up ⇒ `rm -rf apps/web/.next`, restart the server.
- Chromium CLI loads silently ignored ⇒ Chrome for Testing (§ extension skill).
- Streaming shows nothing (200, empty stream) ⇒ engine/chat route issue — check the
  engine route + logs, not the client.
