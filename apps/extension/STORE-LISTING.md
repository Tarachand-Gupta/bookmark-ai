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

> Bookmark AI

**Summary / short description** (132 chars max)

> Save any page in one click — AI files and tags it, find it again by meaning, and see your open tabs on every device, live.

**Detailed description**

> Bookmark AI turns "I'll save this for later" into something that actually works later.
>
> ONE-CLICK SAVE
> Click the toolbar icon (or press Alt+Shift+S) and the page is saved — title, icon and
> link included. No folders to file into, no copy-pasting URLs.
>
> AI DOES THE FILING
> Every save is read, categorized and tagged automatically. 1,000 free AI credits are
> included, or bring your own API key. Your library stays organized without you
> maintaining anything.
>
> SEARCH BY MEANING
> Hybrid search blends full-text with semantic vectors, so a vague memory like "that
> article about focus" finds the page even when those words never appear on it.
>
> SAVE WHOLE SESSIONS
> Snapshot an entire window of tabs as one session, then restore the whole set later as
> a tab group. Park your research and pick it back up.
>
> LIVE TABS, ON EVERY DEVICE (OPT-IN)
> Turn on "Share window as live session" and the tabs you have open appear on your other
> devices in real time. Close the laptop, open your phone, keep reading. Off by default,
> private windows are never sent, credential-looking URLs are reduced to their origin,
> and live data expires automatically after 7 days.
>
> PRIVATE BY DESIGN
> You sign in once on the website — the extension mirrors that session. Nothing is
> collected beyond what makes your own library work, and live sharing is strictly
> opt-in. Full details: https://www.bookmark-ai.cloud/privacy
>
> OPEN SOURCE
> The whole product is open source and self-hostable. Docs: https://docs.bookmark-ai.cloud

**Category**: Productivity · **Language**: English

**Additional fields**
- Official URL / homepage: `https://www.bookmark-ai.cloud`
- Support URL: `https://docs.bookmark-ai.cloud` (or the GitHub issues page if the repo goes public)
- Support email: `tara@purecode.ai`

## 2 · Graphic assets

| Asset | Size | Required | Source |
| --- | --- | --- | --- |
| Store icon | 128×128 PNG | yes | already in the zip: `icon/128.png` (dashboard picks it up from the manifest; upload the same file if asked) |
| Screenshots (1–5) | **1280×800** (preferred) or 640×400, PNG/JPEG, no alpha | at least 1 | `store-assets/1-save.png … 5-live.png` — captions + provenance in `store-assets/README.md` |
| Small promo tile | 440×280 | no (recommended) | `store-assets/promo-440x280.png` — brand mark on dark background + one-liner |
| Marquee promo | 1400×560 | no | only if featured placement is ever pursued |

**Screenshot shot list** (in display order, with suggested captions):
1. `1-save.png` — the popup on a real article, Save bookmark button visible — "One click saves the page you're on."
2. `2-library.png` — the library grid with categories/tags sidebar — "Every save lands filed, tagged, and searchable."
3. `3-search.png` — results for a vague query, "closest results by meaning" — "Search by meaning, not keywords."
4. `4-live-optin.png` — the popup's Live tabs panel expanded, sharing on for one window — "Share a window as a live session."
5. `5-live.png` — the Live sessions view with a device streaming its tabs — "Your open tabs, on every device, live."

Rules of thumb: exact pixel size (1280×800), real UI only (no mockups that misrepresent),
readable text, no personal data in frame — use a demo account with curated bookmarks,
not a personal library. (Claude can capture these: popup shots via a 1280×800 browser
window on the demo pages, app shots from a demo-seeded session — ask.)

## 3 · Privacy tab (the part rejections come from)

**Single purpose description**

> Bookmark AI saves pages the user chooses to bookmark, organizes them with AI, and
> (opt-in) mirrors the user's open tabs across their own signed-in devices.

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

> https://www.bookmark-ai.cloud/privacy

**Notes to reviewer** (the dashboard has no dedicated field until a review is opened — paste
this into the reply to the first review email, or into the "additional notes" box if the
Privacy tab shows one; the AMO listing carries the same text in `AMO-LISTING.md`):

> The extension has no sign-in UI of its own. Sign in on https://www.bookmark-ai.cloud first
> (same Chrome profile); the extension mirrors that session through the `cookies` permission
> on our own auth domain (clerk.bookmark-ai.cloud) and then shows the save UI. Until then the
> popup shows a single "Sign in" button that opens the website.
>
> TEST ACCOUNT: <email> / <password> (Tara fills in)
>
> Built with WXT (Vite); `pnpm --filter @bookmark-ai/extension build` reproduces the uploaded
> `chrome-mv3` bundle (Node 22, pnpm 10.34.1). No remote code is loaded or executed.

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
