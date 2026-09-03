# Bookmark AI — macOS (SwiftUI)

A real, native SwiftUI Mac app for the Bookmark AI library. Translucent
`NavigationSplitView` sidebar, unified toolbar, SF Symbols, system typography,
automatic light/dark, App Sandbox on from day one.

This is a **separate app from `apps/desktop`** (the zero-native Zig experiment).
It shares nothing with it but knowledge of the API.

---

## Build & run

XcodeGen owns the project. `BookmarkAI.xcodeproj` is **generated and gitignored** —
`project.yml` is the committed source of truth, so a checkout reproduces the
project exactly rather than fighting merge conflicts in a `pbxproj`.

```bash
brew install xcodegen            # once
cd apps/macos
xcodegen generate                # writes BookmarkAI.xcodeproj

# Build
xcodebuild -project BookmarkAI.xcodeproj -scheme BookmarkAI \
           -configuration Debug -derivedDataPath build build

# Test (25 unit tests: URL construction, error mapping, response decoding)
xcodebuild -project BookmarkAI.xcodeproj -scheme BookmarkAI \
           -configuration Debug -derivedDataPath build test

# Run
open build/Build/Products/Debug/BookmarkAI.app
```

Or just `xed .` after generating, and hit ⌘R in Xcode.

### Code signing

Default is **automatic** signing with team `L3PP7DQZWS`. If no provisioning
profile can be issued, signing must never block a local build — fall back to
ad-hoc ("Sign to Run Locally"), which still applies the sandbox entitlements:

```bash
xcodebuild -project BookmarkAI.xcodeproj -scheme BookmarkAI \
  -configuration Debug -derivedDataPath build \
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- \
  PROVISIONING_PROFILE_SPECIFIER= DEVELOPMENT_TEAM= build
```

Both paths are verified working.

---

## Platform choices

| Choice | Value | Why |
| --- | --- | --- |
| Deployment target | **macOS 14.0** | The floor that gives `@Observable`, `ContentUnavailableView`, and `.alternatingRowBackgrounds()` without gating. Everything newer (`.toolbar(removing:)`, `SearchToolbarBehavior`, `Tab`-based `TabView`) is deliberately avoided so the app runs on Sonoma, not just this machine's macOS 26. |
| Swift language mode | 5 (`SWIFT_STRICT_CONCURRENCY: minimal`) | All model/UI types are `@MainActor`-isolated by design; Swift 6 mode is a clean follow-up, not a Phase 1 prerequisite. |
| Bundle id | `ai.purecode.bookmarkai.macos` | |
| Sandbox | `app-sandbox` + `network.client` only | The entire capability surface is outbound HTTP. No file access, no server sockets. |
| Accent colour | **none defined** | With no `AccentColor` asset the app adopts the *user's system accent*, which is what a Mac-native app should do. Every other colour is semantic (`.secondary`, `.tint`, `.quaternary`, `.bar`), so light/dark is automatic with zero hardcoded values. |
| App icon | generated from `apps/desktop/assets/icon.png` (1024²) | Same brand mark as the other clients, resampled into a proper 10-slot macOS `AppIcon.appiconset`. |

`NSAppTransportSecurity` allows insecure loads for `localhost`/`127.0.0.1` only
(local dev server); cloud is https-only.

---

## Auth architecture

### Why WKWebView and not Clerk's native Apple SDK

`clerk-ios` (ClerkKit) **does** support macOS — its `Package.swift` declares
`.macOS(.v14)`, so the native route was genuinely on the table. It was rejected
for one hard reason and one soft one:

1. **It needs Clerk *dashboard* configuration this task is not permitted to make.**
   ClerkKit talks to the Clerk Native API, which requires the instance's
   **Native API toggle** to be ON, plus a native application / redirect-scheme
   registration for OAuth. Writing Clerk config was explicitly out of scope.
2. It would add four SPM dependencies (Nuke, PhoneNumberKit, Mocker,
   swift-concurrency-extras) to an otherwise dependency-free app.

The webview route needs **zero** dashboard changes: it renders the web app's own
`/sign-in` page, so it works against the dev and prod Clerk instances
interchangeably, and inherits every auth method the website already supports
(including Google SSO) for free.

**Tradeoff:** sign-in is a web page in a sheet rather than native Clerk UI, and
token minting depends on `window.Clerk` being present on the app origin. If Tara
later enables the Native API toggle and registers a native app, swapping in
ClerkKit is a contained change behind `AuthController`.

### How it works

Two `WKWebView`s share `WKWebsiteDataStore.default()`, so cookies set by one are
instantly visible to the other **and persist across launches** (silent re-auth):

1. **Sign-in webview** — presented in a sheet at `https://www.bookmark-ai.cloud/sign-in`.
   Polled every 1.2s; the first non-nil token means sign-in finished. Completion
   is detected by *polling for a token*, not by watching for a navigation to
   `/app`, because Clerk finishes some flows entirely client-side.
2. **Token webview** — parked in a transparent, click-through, off-screen window
   for the app's lifetime. Unlike the Zig desktop SDK, WKWebView **can** evaluate
   JavaScript, so `window.Clerk.session.getToken()` is reachable directly and
   **no web-app change was needed**.

Minting runs `callAsyncJavaScript` (macOS 11+) in the `.page` content world —
`window.Clerk` is page JavaScript and is invisible from an isolated world.

Token lifecycle:
- Clerk session JWTs live ~60s. Cached for **40s**, re-minted by a background
  loop every **45s** while signed in.
- Single-flighted: a burst of parallel requests costs one mint.
- **401 → force re-mint → replay the request exactly once** (`allowRetry` is the
  recursion guard), so a token that expires in flight recovers silently.
- Sign-out calls `window.Clerk.signOut()`, then wipes the whole website data
  store and tears the token webview down.

**Nothing durable is stored by this app**, which is why there is no Keychain
entry: session JWTs are memory-only, and the Clerk cookies live in the
WKWebsiteDataStore inside the sandbox container, managed by the OS.

### Base URLs (parity with `apps/mobile/src/api.ts`)

| Mode | Base | Auth |
| --- | --- | --- |
| **Local** (default) | `http://localhost:3000` | **none** — expects `DEV_OPEN_API=1` |
| **Cloud** | `https://www.bookmark-ai.cloud` | `Authorization: Bearer <Clerk session JWT>` |

The cloud base **must** be the `www` host. The apex 308-redirects `/api/*` to
`www`, and URLSession — like every HTTP stack — strips `Authorization` across an
origin hop, so the retried request arrives bare and 401s while the app looks
signed in. There is a unit test pinning this.

Local deliberately sends no token: a prod-instance JWT is meaningless to a
dev-instance server, and `DEV_OPEN_API=1` short-circuits before Clerk anyway.

---

## File tree

```
apps/macos/
├── project.yml                     XcodeGen manifest (source of truth)
├── README.md
├── .gitignore                      BookmarkAI.xcodeproj/, build*/
├── Resources/
│   ├── Info.plist                  ATS localhost exception, LSMinimumSystemVersion
│   ├── BookmarkAI.entitlements     app-sandbox + network.client
│   └── Assets.xcassets/AppIcon.appiconset/
├── Sources/
│   ├── App/
│   │   ├── BookmarkAIApp.swift     @main, WindowGroup + Settings, menu commands
│   │   └── AppEnvironment.swift    composition root; wires api ↔ auth ↔ library
│   ├── Models/
│   │   ├── Bookmark.swift          Bookmark, OpenGraph, BookmarkSource, ISO8601
│   │   ├── ApiResponses.swift      List/Meta/Search/Health/Account/Settings
│   │   ├── Session.swift           Session + SessionTab (openable-URL rules)
│   │   ├── Live.swift              LiveDevice/Window/Tab + freshness helpers
│   │   └── Chat.swift              JSONValue passthrough, ChatMessage, part views
│   ├── Chat/                       ChatModel (stream assembly), ChatView, bubbles
│   ├── Sessions/                   SessionsModel + SessionsView
│   ├── Live/                       LiveModel (SSE + reconnect) + LiveTabsView
│   ├── Networking/
│   │   ├── ApiClient.swift         async URLSession, bearer injection, 401 retry
│   │   ├── ApiError.swift          typed errors + status→error mapping
│   │   └── ServerTarget.swift      local/cloud base URLs
│   ├── Auth/
│   │   ├── ClerkWebAuth.swift      the two webviews, JS token minting, sign-out
│   │   ├── AuthController.swift    @Observable auth state, token cache + refresh
│   │   └── SignInSheet.swift       sheet + NSViewRepresentable host
│   ├── Library/
│   │   ├── ContentView.swift       NavigationSplitView, .searchable, toolbar
│   │   ├── SidebarView.swift       facets with counts + account footer
│   │   ├── AccountFooter.swift
│   │   ├── LibraryBrowserView.swift grid/list host + empty/error states + banner
│   │   ├── BookmarkGridView.swift  adaptive card grid (default), hover, click-opens
│   │   ├── BookmarkListView.swift  card rows in a ScrollView: selection, arrows, ⏎, ⌫ via onKeyPress (NOT a List — its context-menu focus halo can't be disabled)
│   │   ├── BookmarkRow.swift       favicon tile, OG data, trailing thumbnail
│   │   ├── BookmarkChrome.swift    FaviconTile, CategoryBadge, shared context menu
│   │   ├── LibraryModel.swift      @Observable store: filter, search, delete
│   │   └── SidebarItem.swift       selection enum + PlannedFeature rows
│   ├── Settings/
│   │   ├── SettingsView.swift      ⌘, — General/AI/Live/Data/Account (web parity)
│   │   └── SettingsModel.swift     GET/PUT /api/settings + status
│   └── Support/
│       ├── Preferences.swift       UserDefaults-backed server target + layout
│       ├── Interaction.swift       pointingHandCursor, SurfaceCard, HoverHighlight
│       ├── AiCreditsCard.swift     the free-credits meter (chat + Settings ▸ AI)
│       ├── VisualEffectBackground.swift  behind-window vibrancy
│       └── RemoteImage.swift       NSCache image loader with request coalescing
└── Tests/
    ├── ApiClientTests.swift        13 tests — URLs, limits, error mapping
    ├── DecodingTests.swift         12 tests — real payload shapes
    └── PreferencesTests.swift      2 tests — layout default + persistence
```

---

## Mac-native behaviours implemented

- `NavigationSplitView` with `.listStyle(.sidebar)` → system translucent material,
  resizable dividers; `.windowToolbarStyle(.unified)` so it meets the title bar.
- `.searchable(placement: .toolbar)` → native toolbar search field, debounced
  280 ms, hitting `/api/search?mode=hybrid&limit=40`.
- **Two layouts, one toolbar toggle** (segmented, à la App Store/CaskHub), persisted
  across launches: a favicon-tile **card grid** (default; pointer-first — click opens,
  right-click for the rest) and a spacious **list** (keyboard-first — selection,
  arrow keys, Delete). Also in the menu bar: **Library ▸ View as Grid (⌘1) / as
  List (⌘2)** with check-marked state.
- **Interaction polish is a hard requirement, not a nice-to-have** (Tara,
  2026-08-29): every clickable card/row shows the pointing-hand cursor
  (`pointingHandCursor()` — SwiftUI has no cursor API before macOS 15) and a
  hover state. Cards/rows sit on their own surface (`SurfaceCard`: slightly
  lighter fill, hairline border, very slight shadow, hover elevation, selection
  tint); sub-rows inside a card use `HoverHighlight`. List rows clear the system
  row background (`.listRowBackground(Color.clear)`) so the two treatments
  never stack.
- **Chat composer docks to the BOTTOM, always** — a real input container
  (rounded, bordered, focus tint, send button inside). The empty state above it
  carries the title, three example prompts, and the `AiCreditsCard` ("N of
  1,000 credits used this week · resets Monday" — tokens÷1000, WEEKLY, never
  say monthly). Sessions get the full action set: Open All, Copy All Links,
  Rename… (alert), Summarize with AI, Delete — one `actionEntries` builder
  feeds both the hover ellipsis menu and the context menu.
- Context menu per card/row: **Open in Browser**, **Copy Link**, **Delete** —
  one shared `BookmarkContextMenu`, so the layouts can't drift apart.
  Double-click opens in the list; Delete key deletes the selection.
- Menu bar: **Library ▸ Refresh (⌘R)**, **Open Web App (⇧⌘O)**, `SidebarCommands()`
  for the View-menu sidebar toggle. File ▸ New Window is *removed* — Phase 1 is a
  single-window app, so shipping a window that mirrors state would be a bug.
- Standard **Settings** scene (⌘,) carrying the Local/Cloud switch and health readout.
- `ContentUnavailableView` for empty / no-search-results / error states, overlaid
  on the list so the toolbar and search field stay put.
- `navigationTitle` + `navigationSubtitle` → window title reads
  *"All Bookmarks – 11 bookmarks"*.

---

## Phase roadmap

**Phase 1** — library, facets, hybrid search, sign-in, Local/Cloud switch, the
grid/list browse layouts, behind-window vibrancy.

**Phase 2 (shipped)** — the three feature views, each with its own toolbar:
1. **Ask AI** (`POST /api/chat`) — streaming UI-message SSE parsed by
   `ChatStreamChunk` (fixtures captured from the live endpoint pin the wire
   format in tests); tool-activity chips; conversation history (list/open/
   delete); after every turn the transcript re-syncs from
   `GET /api/chat/conversations/:id` so the next turn re-sends the server's
   EXACT persisted parts — including Gemini's `thoughtSignature` provider
   metadata, which multi-turn tool use needs. Parts are held as lossless
   `JSONValue`, never re-typed.
2. **Sessions** (`GET/DELETE /api/sessions`) — disclosure rows with the AI
   summary; Open All (http/https only — browser-internal URLs render as text).
   Search is debounced through `commitSearch()` into a STORED `visibleSessions`
   (a computed property re-filtering per keystroke made typing lag), and while
   a query is active each card surfaces its MATCHING tabs + "Show all N tabs"
   — same rule as Live Tabs.
3. **Live Tabs** — the dedicated live server over SSE (`/live` snapshot +
   `/live/stream` `state` frames), `settings.liveServerUrl` override honoured,
   auto-reconnect with last-known-data-kept error policy. NB: `AsyncLineSequence`
   drops empty lines, so the SSE parser dispatches per data-line, never on
   blank-line boundaries. Local dev needs `redis-server` +
   `cd apps/live-server && PORT=8091 pnpm dev` (open mode without Clerk keys).
4. Menu bar navigation: **Ask AI ⇧⌘A · Sessions ⇧⌘S · Live Tabs ⇧⌘L**.

**Known List gotcha (fixed twice here, don't reintroduce):** nested `ForEach`
rows are FLATTENED into their `List` section, so row ids must be unique across
sibling groups — a bare `enumerated().offset` id makes window 2 render window
1's rows. Use composite ids (`device:window:offset`, `session:offset`).

**Phase 3 candidates:**
1. **Saving from the Mac app** (`POST /api/bookmarks`) — a share extension and/or
   a global hotkey; `CreateBookmarkInput` with `device: "laptop"`.
2. **Search paging** — `offset`/`hasMore` are already in `SearchResponse`; the
   list just needs infinite scroll (cap `offset + limit` ≤ 200).
3. **Chat attachments + paste pills** — coordinate with the product-wide chat
   upgrade (skills, MCP, CSV/JSON/MD/PDF/image attachments).
4. ~~Block markdown in chat~~ — SHIPPED: `MarkdownBlock.parse` (pure,
   fixture-tested) splits messages into tables/fenced code/headings/lists/
   quotes/rules; only inline spans go through `AttributedString`. Tables are a
   `Grid` that wraps cells (no sideways scroll); code blocks get a language tag
   + hover copy button. Visual review harness: `RenderPreviewTests`
   (`RENDER_PREVIEWS=1`, prints `PREVIEW-> <png>`; `ImageRenderer` can't draw
   ScrollView content, so it captures a real `NSHostingView`).
5. **Swift 6 language mode** and `@SceneStorage` for column visibility, once
   multi-window is wanted.
6. **ClerkKit swap** — only if the Native API toggle gets enabled; contained
   behind `AuthController`.
