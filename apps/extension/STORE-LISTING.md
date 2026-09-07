# Chrome Web Store — listing content & submission guide

Everything to paste into the CWS developer dashboard (https://chrome.google.com/webstore/devconsole)
for the first (manual) submission. After this one-time upload, CI publishes updates
automatically — see `RELEASING.md`.

The FIRST upload package is `.output/bookmark-aiextension-<version>-chrome-store.zip` from
`pnpm --filter @bookmark-ai/extension release:zip` — the Chrome zip with the manifest `key`
removed and the private key bundled as `key.pem`, which keeps the pinned extension id
`ffhbgpgebpmofjkehpjcemepbgcmoelp` (see `RELEASING.md`). Every later update uploads the plain
`*-chrome.zip`.

---

## 1 · Store listing tab

**Name** (45 chars max)

Bookmark AI

**Summary / short description** (132 chars max)

Save any page in one click — AI files and tags it, find it again by meaning, and see your open tabs on every device, live.

**Detailed description**

Bookmark AI turns "I'll save this for later" into something that actually works later.

ONE-CLICK SAVE
Click the toolbar icon (or press Alt+Shift+S) and the page is saved — title, icon and
link included. No folders to file into, no copy-pasting URLs.

AI DOES THE FILING
Every save is read, categorized and tagged automatically. 1,000 free AI credits are
included, or bring your own API key. Your library stays organized without you
maintaining anything.

SEARCH BY MEANING
Hybrid search blends full-text with semantic vectors, so a vague memory like "that
article about focus" finds the page even when those words never appear on it.

SAVE WHOLE SESSIONS
Snapshot an entire window of tabs as one session, then restore the whole set later as
a tab group. Park your research and pick it back up.

LIVE TABS, ON EVERY DEVICE (OPT-IN)
Turn on "Share window as live session" and the tabs you have open appear on your other
devices in real time. Close the laptop, open your phone, keep reading. Off by default,
private windows are never sent, credential-looking URLs are reduced to their origin,
and live data expires automatically after 7 days.

PRIVATE BY DESIGN
You sign in once on the website — the extension mirrors that session. Nothing is
collected beyond what makes your own library work, and live sharing is strictly
opt-in. Full details: https://www.bookmark-ai.cloud/privacy

OPEN SOURCE
The whole product is open source and self-hostable. Docs: https://docs.bookmark-ai.cloud

**Category**: Productivity · **Language**: English

**Additional fields**
- Official URL / homepage: `https://www.bookmark-ai.cloud`
- Support URL: `https://docs.bookmark-ai.cloud` (or the GitHub issues page if the repo goes public)
- Support email: `tara@purecode.ai`

## 2 · Graphic assets

| Asset | Size | Required | Source |
| --- | --- | --- | --- |
| Store icon | 128×128 PNG | yes | already in the zip: `icon/128.png` (dashboard picks it up from the manifest; upload the same file if asked) |
| Screenshots (1–5) | **1280×800** (preferred) or 640×400, PNG/JPEG, no alpha | at least 1 | `store-assets/1-save.png … 5-everywhere.png` — captions + provenance in `store-assets/README.md` (`6-search.png` is the AMO-only sixth frame; CWS caps at 5) |
| Small promo tile | 440×280 | no (recommended) | `store-assets/promo-440x280.png` — brand mark on dark background + one-liner |
| Marquee promo | 1400×560 | no | only if featured placement is ever pursued |

**Screenshot shot list** (in display order; captions are ≤132 characters, the CWS cap — the same text is in `store-assets/README.md`):
1. `1-save.png` — popup on a real article with the native-apps and Ask AI callouts — "One click saves the page you're on — title, icon and link captured, AI files and tags it. Also on Mac, iPhone, iPad and Android."
2. `2-library.png` — library grid + search-by-meaning inset — "Filed, tagged, and searchable by meaning — auto-categorized on save, with full-text and semantic search blended."
3. `3-ask-ai.png` — Ask AI dock beside the library, one completed exchange — "Ask AI about everything you've saved — a chat agent over your library, sessions and open tabs that cites the bookmarks it used."
4. `4-live.png` — Live sessions view + the popup's Live tabs panel — "Your open tabs, on every device, live — opt in per window; private windows never leave the browser and live data expires in 7 days."
5. `5-everywhere.png` — native Mac app with iPhone, iPad and Android — "One library on every screen — native Mac, iPhone, iPad and Android apps plus the web app. Works with Chrome, Firefox and Safari."

Rules of thumb: exact pixel size (1280×800), real UI only (no mockups that misrepresent),
readable text, no personal data in frame — use a demo account with curated bookmarks,
not a personal library. (Claude can capture these: popup shots via a 1280×800 browser
window on the demo pages, app shots from a demo-seeded session — ask.)

## 3 · Privacy tab (the part rejections come from)

**Single purpose description**

Bookmark AI saves pages the user chooses to bookmark, organizes them with AI, and
(opt-in) mirrors the user's open tabs across their own signed-in devices.

**Permission justifications** — paste per row:

| Permission | Justification |
| --- | --- |
| `activeTab` | Read the title and URL of the page the user is actively saving when they click Save. |
| `tabs` | List the tabs of the current window so the user can save a whole window as a session, and (only when the user opts in to live sharing) mirror their open tabs to their own devices. |
| `storage` | Store the user's extension settings (API URL, device name, live-sharing preference) locally. |
| `alarms` | Periodic heartbeat so an opted-in device's live-tab mirror stays fresh and expires server-side when the device goes quiet. |
| `cookies` | Read the session cookie of our own auth domain (clerk.bookmark-ai.cloud) so the extension reuses the website sign-in instead of asking for credentials in the popup. |
| `bookmarks` | Mirror bookmarks the user adds/removes in the browser into their library — on by default, toggle in Settings → Sync. Only add/remove events are observed (no bulk reads; imports and restores are skipped). |
| `readingList` | Mirror Reading List additions the same way (saved with the `reading` tag). |
| `tabGroups` | Restore a saved session as one titled tab group instead of loose tabs. |
| Host permissions — exactly four: `https://bookmark-ai.cloud/*`, `https://www.bookmark-ai.cloud/*`, `https://clerk.bookmark-ai.cloud/*`, `https://live.bookmark-ai.cloud/*` | All are the product's own first-party endpoints: the web app + its API (apex redirects to www), our authentication domain, and our live-sessions server. No third-party sites are accessed; dev/localhost origins exist only in non-store builds. |

**Data usage disclosures** — tick exactly these:
- **Personally identifiable information** — email/name from the user's own account (sign-in).
- **Authentication information** — the session token that keeps the user signed in.
- **Web history** — the URLs/titles the user explicitly saves; and, only when live sharing is opted into, the open tabs of that window (expires ≤7 days, private windows never sent).
- Everything else: **not collected**. No selling data, no unrelated purposes, no creditworthiness — tick the three certification checkboxes truthfully (we comply).

**Privacy policy URL** (required because data is collected):

https://www.bookmark-ai.cloud/privacy

**Notes to reviewer** (the dashboard has no dedicated field until a review is opened — paste
this into the reply to the first review email, or into the "additional notes" box if the
Privacy tab shows one; the AMO listing carries the same text in `AMO-LISTING.md`):

The extension has no sign-in UI of its own. Sign in on https://www.bookmark-ai.cloud first
(same Chrome profile); the extension mirrors that session through the `cookies` permission
on our own auth domain (clerk.bookmark-ai.cloud) and then shows the save UI. Until then the
popup shows a single "Sign in" button that opens the website.

TEST ACCOUNT: <email> / <password> (Tara fills in)

Built with WXT (Vite); `pnpm --filter @bookmark-ai/extension build` reproduces the uploaded
`chrome-mv3` bundle (Node 22, pnpm 10.34.1). No remote code is loaded or executed.

## Privacy practices tab (paste-ready)

Everything below is written to be pasted verbatim into the CWS **Privacy practices** tab
(paste each block as-is). Every justification describes code that
actually ships in the production build — nothing here is aspirational, and each claim is
traceable to `wxt.config.ts`, `lib/app-origins.ts`, `lib/native-sync.ts`, `lib/live-*.ts` and
`entrypoints/background.ts`.

### Single purpose description

Bookmark AI saves the page you are on — or a whole window of tabs — into your own Bookmark
AI library, where each save is automatically categorized, tagged and made searchable by
meaning. The popup mirrors that library back to you and, only if you switch it on, shares a
window's open tabs with your other signed-in devices. Every permission it requests serves
that single purpose: getting the pages you choose into your library and keeping them
reachable on any device you sign in on.

(485 characters.)

### Permission justifications

**activeTab**

When the user clicks Save in the popup, the extension reads the title and URL of the tab they
are actively looking at and posts exactly that to their own library. Nothing is read until the
user opens the popup and acts, and no page content or script is injected to do it. This is the
extension's primary action and it works on whatever page the user chose to save.

**alarms**

Two periodic alarms, both maintenance-only. A ~2-minute heartbeat runs only while the user has
opted a window into live tabs; it re-stamps liveness and retries a failed publish so a device
that goes quiet expires server-side instead of showing stale tabs. A 6-hour alarm renews the
extension's own auth token, re-checks it, and refreshes the user's sync preferences. Neither
alarm reads page content.

**bookmarks**

Chrome and Firefox only. With "Sync browser bookmarks" on (a toggle in the user's account
settings), the extension listens for the browser's own bookmark add and remove events and
mirrors just those into the same library, so a Ctrl/Cmd+D bookmark is filed like a popup save.
It never enumerates or bulk-reads the user's bookmark tree, and bookmark imports, restores and
Firefox Sync backfill are detected and skipped. Removals only propagate if the user separately
turns on full sync (off by default).

**cookies**

Used solely on the extension's own authentication domain, clerk.bookmark-ai.cloud, and on the
product's own origin. The extension has no sign-in UI: the user signs in on
www.bookmark-ai.cloud and the background script reads that session cookie to reuse the sign-in,
mint a device token for API calls, and sign out cleanly. No other site's cookies are read, and
cookie values are never logged or transmitted anywhere except to our own API as the request's
authorization.

**Host permissions** (exactly four in the published build)

All four are first-party endpoints of this product; no third-party or wildcard site access is
requested. `https://bookmark-ai.cloud/*` and `https://www.bookmark-ai.cloud/*` are the web app
and its API — where saves are posted and where the user's session is mirrored from (the apex
redirects to www, so both are needed). `https://clerk.bookmark-ai.cloud/*` is our
authentication provider's domain for this instance, where the sign-in session lives.
`https://live.bookmark-ai.cloud/*` is our live-sessions relay, contacted only when the user
opts a window into live tabs. Development-only origins (localhost, dev deployment) exist only
in non-store builds and are absent from every uploaded package.

**readingList**

Chrome only, and only while bookmark sync is on. The extension listens for entries the user
adds to Chrome's Reading List and mirrors them into the same library, tagged "reading" and
"article" so they are findable later. It observes add/remove events only — the existing
Reading List is never enumerated or bulk-read — and it is switched off with the same single
Sync toggle as bookmark mirroring.

**Remote code**

No remote code is loaded or executed. All JavaScript, HTML and CSS that runs is bundled into
the uploaded package at build time (WXT/Vite); there is no `eval`, no `new Function` on fetched
text, no remotely hosted script tag, and no dynamically injected external script. The extension
does make network calls to our own API endpoints listed above, but those requests only send and
receive JSON data — bookmark records, session data and auth tokens — which is parsed as data
and never executed as code.

**storage**

Local settings and small caches only: the API base URL, the device name shown next to a save,
the live-sharing preference and per-window sharing choices, the extension's device token, a
capped map of URLs the extension itself mirrored (so a removal can be undone server-side), and
a queue of failed saves to retry. All of it stays in the browser's extension storage; none of
it is browsing history, and nothing extra is uploaded because of it.

**tabGroups**

Chrome only, and only on restore. When the user reopens a saved session, the extension opens
that session's tabs and groups them into one tab group titled with the session's name, instead
of dumping loose tabs into the window. The permission is used to set that group's title and
color and nothing else — no existing groups are read or modified.

**tabs**

Two user-initiated features need the tab list of a window rather than one active tab: "Save
session", which snapshots every tab in the current window as one restorable set, and live tabs,
which — only for windows the user has explicitly opted in — sends the title, URL and favicon of
the open tabs so they appear on the user's other signed-in devices. Private/incognito windows
are filtered out in code and never sent, and credential-looking URLs are reduced to their origin
before anything leaves the browser.

### Data usage disclosure

Tick these four rows; leave every other row unticked:

| Category | Tick? | Why |
| --- | --- | --- |
| **Personally identifiable information** | ✅ | The name and email address of the account the user signed in with are read from the mirrored session and shown in the popup. |
| **Authentication information** | ✅ | The extension reuses the website's session cookie and stores a device token that authorizes its API calls. |
| **Website content** | ✅ | Titles, URLs and favicons of pages the user chooses to save (or shares as live tabs) are sent to their own library. |
| **Web history** | ✅ | Same data seen through the store's other lens: saved pages and opted-in live tabs are a record of pages the user visited. Tick it rather than argue the distinction. |
| Health information | ❌ | Never collected. |
| Financial and payment information | ❌ | The extension handles no payments and reads no payment data. |
| Personal communications | ❌ | No email, messages or chat content is read. |
| Location | ❌ | No geolocation, IP-geolocation or address data is requested or derived. |
| User activity | ❌ | No analytics, clickstream, keystroke or interaction telemetry of any kind — the extension ships no analytics SDK. |

(Note: "Website content" and "Web history" are two separate rows in the dashboard and both
apply here — the extension transmits page titles/URLs/favicons the user selected. Do not tick
"User activity": nothing is logged about how the user uses pages, only what they explicitly
chose to save or share.)

**The three certification checkboxes** — tick all three; each is truthful:

1. *"I do not sell or transfer user data to third parties, outside of the approved use cases."*
   Confirmed. Data goes only to the user's own Bookmark AI account on our own first-party
   endpoints (or their self-hosted instance). There is no data broker, ad network or analytics
   vendor in the extension.
2. *"I do not use or transfer user data for purposes that are unrelated to my item's single
   purpose."* Confirmed. Every transmission is a save, a session, a live-tab checkpoint or an
   auth call — all in service of the user's own library.
3. *"I do not use or transfer user data to determine creditworthiness or for lending purposes."*
   Confirmed. No credit, lending or scoring use exists anywhere in the codebase.

**Privacy policy URL** (required, and it must be reachable): `https://www.bookmark-ai.cloud/privacy`

### Before submitting

⚠️ **The publisher contact email must be set AND verified on the dashboard's Account/Settings
page before Chrome will accept the submission** — the Privacy practices tab stays blocked until
it is. Tara does this once at
https://chrome.google.com/webstore/devconsole → Account → Contact email (`tara@purecode.ai`),
then clicks the verification link Google emails.

## 4 · Distribution tab

- **Visibility**: Public (or Unlisted for a soft launch — link-only installs).
- **Regions**: all.
- **Pricing**: free.

## 5 · Submission walkthrough

1. https://chrome.google.com/webstore/devconsole → pay the one-time $5 developer fee if not yet done.
2. "New item" → upload `bookmark-aiextension-<version>-chrome-store.zip` (the `key.pem` one — first upload only).
3. Fill **Store listing** (section 1–2 above), **Privacy** (section 3), **Distribution** (section 4).
4. Account tab: verified contact email is required before submitting.
5. Submit for review. First review typically takes a few days; the `tabs`/`cookies`
   permissions may trigger a manual review — the justifications above are written for it.
6. Copy the item ID from the dashboard URL → set the `CWS_*` GitHub secrets
   (see `RELEASING.md`) so every future merge to main publishes automatically.
7. After approval: update `apps/web` install buttons/marketing with the real store URL,
   and add the store listing URL to the docs install page.

**Post-upload check**: because the first upload carries `key.pem`, the store item id should be
the pinned `ffhbgpgebpmofjkehpjcemepbgcmoelp` — the id already registered in the Clerk
instance `allowed_origins` and in `AUTHORIZED_PARTIES` (`apps/web/lib/authorized-parties.ts`).
VERIFY it in the dashboard URL right after the upload. If it differs, register the new id in
both places BEFORE announcing, or store-installed users can't authenticate.
