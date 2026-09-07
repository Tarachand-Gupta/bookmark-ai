# Store assets

Listing graphics for the Chrome Web Store and Firefox Add-ons submissions (`STORE-LISTING.md`,
`AMO-LISTING.md`). Every screenshot is **1280×800 PNG, RGB, no alpha** (verify with
`sips -g pixelWidth -g pixelHeight -g hasAlpha <file>` → `1280 / 800 / no`), composed in the
shared style: dark gradient, brand mark + context pill, headline, grey subline, real UI in a
macOS-style window (plus, where a frame calls for it, callout cards, a floating inset window and
plain CSS phone/tablet bezels). **Real UI only** — every pixel of product UI is a capture of a
running build on ONE demo library: the production look (black/white icon plate, name
"Bookmark AI") of the current popup, the signed-in web app, the native Mac app, and the iPhone /
iPad / Android apps. No mockups, no edited DOM, no personal data in frame; the account is a
throwaway "Demo User" on the dev Clerk instance and the library was seeded with public
docs/articles for the shoot.

| File | Size | Shows | Caption to enter in the store (≤132 chars, the CWS cap) |
| --- | --- | --- | --- |
| `1-save.png` | 1280×800 | Popup on an MDN article (favicon, title, domain, **Save bookmark**, Save session / Save & close tiles, Live tabs off, Open app → `www.bookmark-ai.cloud`, device footer) flanked by two callout cards: the iPhone app's Library in a phone bezel ("Also on Mac, iPhone, iPad and Android") and a crop of a real Ask AI answer ("Ask AI about anything you've saved") | One click saves the page you're on — title, icon and link captured, AI files and tags it. Also on Mac, iPhone, iPad and Android. |
| `2-library.png` | 1280×800 | Web app `/app/library`, grid view: sidebar with category/browser counts, tag rail, "Today" group of categorized + tagged cards; floating inset window (lower right) with the real search-by-meaning view — the query in the search box, "No exact matches — showing the closest results by meaning." and the top semantic hits | Filed, tagged, and searchable by meaning — auto-categorized on save, with full-text and semantic search blended. |
| `3-ask-ai.png` | 1280×800 | Web app with the Ask AI dock docked beside the library (sidebar collapsed to its icon rail): one real completed exchange — the question, "Thought for 1 s", the "Found 1 bookmark" tool row with the bookmark card it searched (category/tags), and the one-sentence answer linking that bookmark | Ask AI about everything you've saved — a chat agent over your library, sessions and open tabs that cites the bookmarks it used. |
| `4-live.png` | 1280×800 | Web app `/app/library?section=live`: device "Chrome on Mac" streaming, its window expanded with tab titles + favicons; inset (right) of the popup's Live tabs panel expanded — master switch on, per-window rows (this window shared, a second window not), "Shown as Chrome on Mac" | Your open tabs, on every device, live — opt in per window; private windows never leave the browser and live data expires in 7 days. |
| `5-everywhere.png` | 1280×800 | Native Mac app (SwiftUI, light, library grid + sidebar) large in the back, iPhone Library front-left, iPad Library behind-right, Android Library front-right — all real captures in plain CSS bezels | One library on every screen — native Mac, iPhone, iPad and Android apps plus the web app. Works with Chrome, Firefox and Safari. |
| `6-search.png` | 1280×800 | (AMO only — CWS caps at 5) Web app search for "the classic transformer paper and how to use those models today", list view — "No exact matches — showing the closest results by meaning." with the semantic hits | Search by meaning, not keywords — describe what you remember and the right page surfaces even when its words never appear. |
| `promo-440x280.png` | 440×280 | CWS small promo tile — brand mark + one-liner, no screenshots | (no caption field) |

Display order in the store = file number order. **CWS takes 1–5**, **AMO takes 1–6**. Every
frame is a real capture (none blocked, none mocked): the Android capture is the dev build on the
`bookmark_pixel` emulator; the iPhone/iPad captures are dev builds on throwaway simulators; the
Mac capture is a re-signed copy of the Debug build on the local server target.

## How they were made (repeatable)

Demo data: `seed-demo.mjs` + `seed-extra.mjs` POST 24 public pages to the local dev server
(`DEV_OPEN_API=1`, file-based dev DB) with realistic browser/device/savedAt metadata and record
the ids in `seeded-ids.json` for cleanup; wait for enrichment (titles, categories, tags,
embeddings — poll `GET /api/bookmarks` + `/api/meta`) before shooting. `savedAt` stamps must be
in the PAST relative to the shoot (the native apps show relative times — "in 4 hours" is not a
state to ship). Every client below points at the same local dev server, so all frames show ONE
library.

- **Popup**: the LOCAL WXT build (`pnpm --filter @bookmark-ai/extension build:local` →
  `.output/chrome-mv3-dev`, pointed at `localhost:3000`) copied out of the tree, with
  `icon-local/*.png` replaced by `icon/*.png` and the manifest `name` set to `Bookmark AI`, loaded
  into Chrome for Testing via puppeteer-core (`--load-extension`,
  `--disable-background-timer-throttling --disable-backgrounding-occluded-windows
  --disable-renderer-backgrounding`, its own profile, own remote-debugging port). The popup is
  opened as `chrome-extension://<id>/popup.html` in a BACKGROUND tab of the demo window while the
  MDN article tab is active (so it detects the article), clicks are DOM `.click()` in `evaluate`,
  waits use `waitForFunction(…, {polling:"mutation"})`. Captured at 360 CSS px × 2, light colour
  scheme (`emulateMediaFeatures`). For frame 1 only, `chrome.storage.local.apiUrl` was set to
  `https://www.bookmark-ai.cloud` for the duration of the capture so the Open-app tile shows the
  production host (removed right after). The Live panel inset (frame 4) is the same popup with
  the master switch turned on, the web app moved to its own window and that window's row
  toggled off — a real stream to the local live server (`localhost:8091`).
- **Web app**: same profile signed in through the real Clerk sign-in UI as the demo user (email +
  password, then the instance's email-code step), light theme, 1136×760 CSS viewport × 2 — the
  library grid for frame 2 at 1300×760 so three columns show, the live view for frame 4 at
  820×620 so the window ends before the inset — Next.js dev badge hidden via an injected
  `nextjs-portal{display:none}` style. Search views load `/app/library?q=…` and switch layout with
  the real "List view" toggle; the search inset in frame 2 is a 480 px-wide viewport capture of
  the same view. Ask AI opens with `/app/library?ai=1`; the dock width is the persisted
  drag-resize fraction (`bookmark-ai:chat-fraction`, 0.4 for frame 3); ONE real question is typed
  and the capture waits for the agent to finish (the send control leaves its "Stop generating"
  state), then the thread is scrolled back to the top so the whole exchange is in view. The frame 1 chat card is a crop of a
  second run of the same question with the dock at its narrowest docked width (0.3), scrolled
  back to the top so it starts at the question.
- **Mac app**: an isolated copy of the Debug `BookmarkAI.app` (`CFBundleIdentifier` changed to
  `ai.purecode.bookmarkai.macos.shoot`, entitlements extracted with `codesign -d --entitlements
  :-` and re-signed ad hoc with `codesign --force --deep --sign -`), so it has its own sandbox
  container/UserDefaults and never touches a real install. Prefs written into that container
  (`serverTarget=local`, `appearanceMode=light`, `libraryLayout=grid`), window sized to 1200×760
  points, grid scrolled to the top, captured with `screencapture -x -o -l <windowId>` (window id
  from `CGWindowListCopyWindowInfo` filtered by the copy's PID). Quit by bundle id afterwards.
- **iPhone / iPad**: throwaway simulators (`xcrun simctl create "Shoot iPhone 17" …iOS-26-5`,
  `"Shoot iPad Pro 13" …iOS-26-0`) with a dev build (`cd apps/mobile && npx expo run:ios
  --no-bundler --device <udid>`, Metro on :8081; dev builds resolve `SERVER_TARGET=local` and the
  dev Clerk instance), signed in as the demo user through the real sign-in screen (input driven
  with `idb ui tap` / `idb ui text`, element frames from `idb ui describe-all`), status bar
  overridden (`xcrun simctl status_bar … --time 9:41 --wifiBars 3 --cellularBars 4 --batteryLevel
  100`), light appearance, captured with `xcrun simctl io <udid> screenshot`. Deleted afterwards.
- **Android**: the `bookmark_pixel` AVD with a fresh dev build (`npx expo run:android
  --no-bundler`, JDK 21 + `ANDROID_HOME` per the mobile setup notes), signed in as the demo user
  via `adb shell input tap/text` (short chunks), status bar cleaned with SystemUI demo mode,
  captured with `adb exec-out screencap -p`.
- **Frames**: an HTML template rendered by the same Chrome for Testing at `deviceScaleFactor: 1`,
  viewport 1280×800. Layers: macOS-style window (CSS title bar + the 2× capture), floating inset
  window (optionally a cropped/scaled region of a capture), callout card (rgba-white surface,
  1 px border, 14 px radius, phone bezel or UI crop + label + sub-line), CSS phone/tablet bezels
  (rounded rect, thin dark frame) around real screenshots, and the native Mac capture with
  corners + shadow only (its title bar is real). The template asserts the headline fits on one
  line and the subline stays inside 760 px.

Regenerating: the scratch scripts (`launch-browser.mjs`, `seed-demo.mjs`, `popup-capture.mjs`,
`capture-web.mjs`, `capture-chat.mjs`, `move-app-window.mjs`, `compose-v2.mjs` + `specs/*.json`,
`live-off.mjs`, `cleanup-seeds.mjs`) lived in the session scratchpad; the recipe above plus
`docs/TESTING.md` §3 is enough to rebuild them.
