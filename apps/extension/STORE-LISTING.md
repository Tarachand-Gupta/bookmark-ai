# Chrome Web Store — listing content & submission guide

Everything to paste into the CWS developer dashboard (https://chrome.google.com/webstore/devconsole)
for the first (manual) submission. After this one-time upload, CI publishes updates
automatically — see `RELEASING.md`.

The upload package is the zip produced by `pnpm --filter @bookmark-ai/extension zip`
(`.output/bookmark-aiextension-<version>-chrome.zip`).

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
> Every save is read, categorized and tagged automatically, using the AI provider you
> choose (bring your own key — free options work). Your library stays organized without
> you maintaining anything.
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
> opt-in. Full details: https://docs.bookmark-ai.cloud/privacy
>
> OPEN SOURCE
> The whole product is open source and self-hostable. Docs: https://docs.bookmark-ai.cloud

**Category**: Productivity · **Language**: English

**Additional fields**
- Official URL / homepage: `https://bookmark-ai.cloud`
- Support URL: `https://docs.bookmark-ai.cloud` (or the GitHub issues page if the repo goes public)

## 2 · Graphic assets

| Asset | Size | Required | Source |
| --- | --- | --- | --- |
| Store icon | 128×128 PNG | yes | already in the zip: `icon/128.png` (dashboard picks it up from the manifest; upload the same file if asked) |
| Screenshots (1–5) | **1280×800** (preferred) or 640×400, PNG/JPEG, no alpha | at least 1 | see shot list below |
| Small promo tile | 440×280 | no (recommended) | brand mark on dark background + one-liner |
| Marquee promo | 1400×560 | no | only if featured placement is ever pursued |

**Screenshot shot list** (in display order, with suggested captions):
1. The popup open over a real article, Save bookmark button visible — "One click saves the page you're on."
2. The library grid with categories/tags sidebar — "Every save lands filed, tagged, and searchable."
3. Search results for a vague query showing `meaning` matches — "Search by meaning, not keywords."
4. The popup's "Share window as live session" card expanded, toggle on — "Opt in to see your open tabs on any device."
5. The Live sessions view with a device streaming its tabs — "Your tabs, everywhere, live."

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
| Host permissions (`bookmark-ai.cloud`, `www.…`, `clerk.…`, `live.…`, `localhost`, dev alias) | All are the product's own first-party API/auth/live endpoints (localhost = self-hosted/dev instance). No third-party sites are accessed. |

**Data usage disclosures** — tick exactly these:
- **Personally identifiable information** — email/name from the user's own account (sign-in).
- **Authentication information** — the session token that keeps the user signed in.
- **Web history** — the URLs/titles the user explicitly saves; and, only when live sharing is opted into, the open tabs of that window (expires ≤7 days, private windows never sent).
- Everything else: **not collected**. No selling data, no unrelated purposes, no creditworthiness — tick the three certification checkboxes truthfully (we comply).

**Privacy policy URL** (required because data is collected):

> https://docs.bookmark-ai.cloud/privacy

## 4 · Distribution tab

- **Visibility**: Public (or Unlisted for a soft launch — link-only installs).
- **Regions**: all.
- **Pricing**: free.

## 5 · Submission walkthrough

1. https://chrome.google.com/webstore/devconsole → pay the one-time $5 developer fee if not yet done.
2. "New item" → upload `bookmark-aiextension-<version>-chrome.zip`.
3. Fill **Store listing** (section 1–2 above), **Privacy** (section 3), **Distribution** (section 4).
4. Account tab: verified contact email is required before submitting.
5. Submit for review. First review typically takes a few days; the `tabs`/`cookies`
   permissions may trigger a manual review — the justifications above are written for it.
6. Copy the item ID from the dashboard URL → set the `CWS_*` GitHub secrets
   (see `RELEASING.md`) so every future merge to main publishes automatically.
7. After approval: update `apps/web` install buttons/marketing with the real store URL,
   and add the store listing URL to the docs install page.

**Post-approval note**: the extension ID of the store build will differ from the local
dev ID. Add the new ID's origin to the Clerk instance `allowed_origins` and to
`AUTHORIZED_PARTIES` (`apps/web/lib/authorized-parties.ts`) BEFORE announcing, or
store-installed users can't authenticate. This is part of definition-of-done for the release.
