# Store assets

Listing graphics for the Chrome Web Store and Firefox Add-ons submissions (`STORE-LISTING.md`,
`AMO-LISTING.md`). Every screenshot is **1280×800 PNG, RGB, no alpha** (verify with
`sips -g pixelWidth -g pixelHeight -g hasAlpha <file>` → `1280 / 800 / no`), composed in the
shared style: dark gradient, brand mark + context pill, headline, grey subline, the real UI in a
macOS-style window. Real UI only — the production look (black/white icon plate, name
"Bookmark AI") of the current popup, and the signed-in web app on a curated demo library. No
personal data is in frame; the account is a throwaway "Demo User" on the dev Clerk instance and
the library was seeded with public docs/articles for the shoot.

| File | Size | Shows | Caption to enter in the store |
| --- | --- | --- | --- |
| `1-save.png` | 1280×800 | Popup on an MDN article: favicon, title, domain, **Save bookmark**, Save session / Save & close tiles, Live tabs (off), Open app → `www.bookmark-ai.cloud`, device footer | One click saves the page you're on. Toolbar click or Alt+Shift+S — title, icon and link captured; AI files and tags it for you. |
| `2-library.png` | 1280×800 | Web app `/app/library`, grid view: sidebar with categories/browsers counts, tag rail, "Today" group with categorized + tagged cards | Every save lands filed, tagged, and searchable. Auto-categorized on save; hybrid search finds pages by meaning, not just keywords. |
| `3-search.png` | 1280×800 | Web app search for "the classic transformer paper and how to use those models today", list view — "No exact matches — showing the closest results by meaning." with the two semantic hits | Search by meaning, not keywords. Describe what you remember — full-text and semantic search are blended, so the right page surfaces even when its words never appear in your query. |
| `4-live-optin.png` | 1280×800 | Popup Live tabs panel expanded: master switch on, per-window rows (this window shared, a second window not), device name "Chrome on Mac", compact action strip | Share a window as a live session. Strictly opt-in, per window. Private windows are never sent, and live data expires automatically after 7 days. |
| `5-live.png` | 1280×800 | Web app `/app/library?section=live`: device "Chrome on Mac" streaming, "Window 1 · 7 tabs" expanded with tab titles + favicons | Your open tabs, on every device, live. Close the laptop, open your phone, keep reading — tabs stream to your other devices in real time. |
| `promo-440x280.png` | 440×280 | CWS small promo tile — brand mark + one-liner, no screenshots | (no caption field) |

Display order in the store = file number order. CWS accepts 1–5 screenshots; all five are real
captures (none blocked). AMO reuses the same five.

## How they were made (repeatable)

- **Popup**: the LOCAL WXT build (`.output/chrome-mv3-dev`, pointed at `localhost:3000` with
  `DEV_OPEN_API=1`) copied out of the tree, with `icon-local/*.png` replaced by `icon/*.png` and
  the manifest `name` set to `Bookmark AI`, loaded into Chrome for Testing via puppeteer-core
  (`--load-extension`, `--disable-background-timer-throttling
  --disable-backgrounding-occluded-windows --disable-renderer-backgrounding`). The popup is
  opened as `chrome-extension://<id>/popup.html` in a BACKGROUND tab while the MDN article tab
  is active (so it detects the article), clicks are DOM `.click()` in `evaluate`, waits use
  `waitForFunction(…, {polling:"mutation"})`. Captured at 360 CSS px × 2, light colour scheme
  (`emulateMediaFeatures`). For shot 1 only, `chrome.storage.local.apiUrl` was set to
  `https://www.bookmark-ai.cloud` for the duration of the capture so the Open-app tile shows
  the production host instead of `localhost:3000` (removed right after).
- **Web app**: same CfT profile signed in through the real Clerk sign-in UI as a demo user,
  light theme, 1136×760 CSS viewport × 2, Next.js dev badge hidden via an injected
  `nextjs-portal{display:none}` style. Shot 5 is a real stream: the loaded extension's Live tabs
  switch was turned on, and the local live server (`localhost:8091`) fanned the window out to
  the web view.
- **Frames**: an HTML template rendered by the same browser at `deviceScaleFactor: 1`,
  viewport 1280×800, with the capture embedded as an `<img>` inside the window frame.

Regenerating: the scratch scripts (`launch-browser.mjs`, `popup-capture.mjs`,
`capture-web.mjs`, `compose.mjs` + `specs/*.json`) lived in the session scratchpad; the recipe
above plus `docs/TESTING.md` §3 is enough to rebuild them.
