# Firefox Add-ons (AMO) — listing content & submission guide

Everything to paste into the AMO Developer Hub (https://addons.mozilla.org/developers/) for
the first submission of the Firefox build. The CWS equivalent lives in `STORE-LISTING.md`;
the marketing copy is shared, the privacy/permissions wording below is adapted to AMO's
fields and to the `data_collection_permissions` declaration in the manifest.

Upload package: `pnpm --filter @bookmark-ai/extension zip:firefox` →
`.output/bookmark-aiextension-<version>-firefox.zip`. AMO also requires the **source code
zip** for review because the add-on is bundled/minified:
`pnpm --filter @bookmark-ai/extension zip:store` (`scripts/store-zip.mjs`) writes
`.output/bookmark-aiextension-<version>-sources.zip` with everything needed to rebuild
`firefox-mv2` plus a generated `BUILD.md` — see "Notes to Reviewer" below.

---

## 1 · "Describe Add-on" step

**Name**

> Bookmark AI

**Add-on URL** (slug)

> bookmark-ai

**Summary** (≤ 250 chars, plain text — shown in search results and at the top of the listing)

> Save any page in one click and let AI file and tag it. Find it again by meaning, not keywords. Save whole windows as sessions, and opt in to see your open tabs on every device, live.

(197 characters.)

**Description** (AMO allows a small HTML subset: `<b> <i> <a> <ul> <ol> <li> <blockquote> <abbr> <acronym> <code>`
plus line breaks. Paste as-is.)

> Bookmark AI turns "I'll save this for later" into something that actually works later.
>
> <b>One-click save</b>
> Click the toolbar icon (or press Alt+Shift+S) and the page is saved — title, icon and link included. No folders to file into, no copy-pasting URLs.
>
> <b>AI does the filing</b>
> Every save is read, categorized and tagged automatically, using the AI provider you choose (bring your own key — free options work). Your library stays organized without you maintaining anything.
>
> <b>Search by meaning</b>
> Hybrid search blends full-text with semantic vectors, so a vague memory like "that article about focus" finds the page even when those words never appear on it.
>
> <b>Save whole sessions</b>
> Snapshot an entire window of tabs as one session and pick your research back up later.
>
> <b>Mirror your Firefox bookmarks</b>
> Bookmarks you add in Firefox itself (Ctrl/Cmd+D) land in your library too, categorized like everything else. On by default — switch it off in Settings → Sync on the website.
>
> <b>Live tabs, on every device (opt-in)</b>
> Turn on "Live tabs" and the tabs you have open appear on your other devices in real time. Close the laptop, open your phone, keep reading. Off by default, private windows are never sent, credential-looking URLs are reduced to their origin, and live data expires automatically after 7 days.
>
> <b>Private by design</b>
> You sign in once on the website — the extension mirrors that session. Nothing is collected beyond what makes your own library work, and live sharing is strictly opt-in. Full policy: <a href="https://www.bookmark-ai.cloud/privacy">https://www.bookmark-ai.cloud/privacy</a>
>
> <b>Open source</b>
> The whole product is open source (MIT) and self-hostable. Docs: <a href="https://docs.bookmark-ai.cloud">https://docs.bookmark-ai.cloud</a>
>
> <i>Requires a free Bookmark AI account — sign in at https://www.bookmark-ai.cloud first; the add-on picks the session up automatically.</i>

**Categories** (Firefox — pick up to two)

- Bookmarks
- Tabs

**Support email**

> tara@purecode.ai

**Support website**

> https://docs.bookmark-ai.cloud

**Homepage**

> https://www.bookmark-ai.cloud

**License**

> MIT License (the repository's `LICENSE`, © 2026 Tarachand Gupta). Pick "MIT/X11 License" in
> the dropdown.

**Privacy policy** (AMO requires the text INLINE when the add-on collects data — paste this
verbatim; it matches the manifest's `data_collection_permissions` declaration and the
Chrome data-usage disclosures.)

> Bookmark AI collects only what is needed to run your own bookmark library, and only for
> the account you sign in with.
>
> Authentication information: the add-on mirrors your existing sign-in on
> www.bookmark-ai.cloud (a session token and the name/email of your account) so it can save
> to your library without asking for credentials in the popup.
>
> Bookmarks: the address, title and icon of pages you explicitly save, plus bookmarks you
> add or remove in Firefox itself while bookmark mirroring is on (on by default; switch it
> off in Settings → Sync on the website).
>
> Browsing activity: the tabs of a window when you choose "Save session", and — only if you
> turn on "Live tabs" — the title, address and icon of your open tabs so they can appear on
> your other signed-in devices. Live tabs is off by default, private windows are never sent,
> URLs that look like they carry credentials are reduced to their origin, and live data
> expires automatically after 7 days.
>
> Technical data: the browser, device type and operating system name attached to each save
> so your library can be filtered by device.
>
> Nothing is sold, shared with third parties, or used for advertising or profiling. Data is
> processed by the Bookmark AI service you signed in to (or your own self-hosted instance).
> You can export or delete everything from Settings → Account on the website. Full policy:
> https://www.bookmark-ai.cloud/privacy

## 2 · Technical details / version notes

**Release notes** (first version)

> First public release. One-click save with AI categorization and tagging, search by meaning,
> window sessions, Firefox bookmark mirroring, and opt-in live tabs across devices.

**"This add-on requires payment, non-free services or software, or additional hardware"**:
No (the hosted service has a free plan; self-hosting is free).

**Whiteboard / Notes to Reviewer** — paste into the "Notes to Reviewer" box:

> ACCOUNT REQUIREMENT
> The add-on has no sign-in UI of its own. Sign in on https://www.bookmark-ai.cloud first
> (any browser session in the same Firefox profile); the add-on's background script mirrors
> that session through the `cookies` permission on our own auth domain
> (clerk.bookmark-ai.cloud) and shows the save UI. Until then the popup shows a single
> "Sign in" button that opens the website.
>
> TEST ACCOUNT: <email> / <password> (Tara fills in)
>
> BUILD
> Built with WXT (Vite) from the attached sources zip. `BUILD.md` in the zip has the exact
> steps; in short: Node 22, pnpm 10.34.1,
> `pnpm --filter @bookmark-ai/extension... install --frozen-lockfile`, then
> `pnpm --filter @bookmark-ai/extension build:firefox` → `.output/firefox-mv2`, which is
> byte-identical to the uploaded package.
>
> LINTER WARNINGS
> The `innerHTML`/`unsafe-assignment` warnings come from bundled third-party dependencies
> (React DOM and the Clerk client SDK), not from our code. Our own source contains no
> innerHTML assignments. No remote code is loaded or executed.
>
> PERMISSIONS
> `activeTab`/`tabs`: read the page being saved and list the window's tabs for "Save
> session" and (opt-in) live tabs. `bookmarks`: mirror bookmarks the user adds/removes in
> Firefox into their library (toggle in Settings → Sync). `storage`/`alarms`: local
> settings and the periodic heartbeat that expires an opted-in device's live tabs.
> `cookies` + host permissions: our own domains only (bookmark-ai.cloud, www., clerk., live.).
> No third-party sites are ever accessed.

## 3 · Listing images

Reuse the CWS assets in `store-assets/` (AMO accepts PNG/JPG; screenshots are displayed at
their native size and scaled down, 1280×800 works). AMO has no five-image cap, so upload all six
in file order — `1-save.png`, `2-library.png`, `3-ask-ai.png`, `4-live.png`, `5-everywhere.png`,
`6-search.png` (the standalone search-by-meaning frame is the AMO-only sixth). Upload the icon
`public/icon/128.png` (AMO also asks for a 64×64 — `public/icon/96.png` is accepted and scaled,
or export 64 from `scripts/generate-icons.mjs`). Captions per image (≤132 chars each; AMO's own
caption field is longer but the same text is used) are in `store-assets/README.md`.

## 4 · Submission walkthrough

1. https://addons.mozilla.org/developers/ → sign in with the Mozilla account → "Submit a New Add-on".
2. "On this site" distribution → upload `bookmark-aiextension-<version>-firefox.zip`.
3. The validator will flag "innerHTML" warnings from bundled deps — proceed; the note above
   explains them.
4. "Do you need to submit source code?" → **Yes** → upload
   `bookmark-aiextension-<version>-sources.zip` (contains `BUILD.md`).
5. Describe Add-on (section 1), then Technical details / Notes to Reviewer (section 2), then
   images (section 3).
6. Submit. First review of an add-on with `tabs` + `cookies` + `bookmarks` is manual and can
   take several days; the test account is what unblocks it.
7. After approval: `WEB_EXT_API_KEY`/`WEB_EXT_API_SECRET` (from the AMO API keys page) go
   into the GitHub secrets so `RELEASING.md`'s Firefox step can sign future versions, and the
   listing URL goes onto the website's install buttons and the docs install page.

The gecko id is fixed in the manifest (`bookmark-ai@purecode.ai`,
`browser_specific_settings.gecko.id`), so the reviewed id is the same one the local
`firefox-mv2` build already uses — no allowed-origins change is needed for Firefox (page →
extension messaging isn't used there; see `CLAUDE.md`).
