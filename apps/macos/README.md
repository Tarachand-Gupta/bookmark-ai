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

# Test (115 tests: URL construction, error mapping, response decoding,
# chat stream assembly, attachment classification/downscaling, skills/MCP
# contracts, the SKILL.md import parser, history grouping, the empty-reply
# guard, the auth state machine + sign-out flush + stubbed-transport 401
# rules; the 8 RenderPreviewTests are skipped unless
# TEST_RUNNER_RENDER_PREVIEWS=1 — a plain env var is NOT forwarded to the
# test host)
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
| Sandbox | `app-sandbox` + `network.client` + `files.user-selected.read-write` | Outbound HTTP, plus read access to files the user explicitly picks, drops, or pastes as chat attachments (security-scoped, released after encoding). No server sockets. |
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

### Session states and the gate

`AuthController.Status` keeps two very different "no token" answers apart, and
`AppEnvironment.gate` (`AccessGate`) turns them into the ONE decision every
scene reads — the main window, the Settings window, and the menu bar can never
disagree about whether account data may be on screen:

| Target · auth status | `gate` | Main window | ⌘, Settings | Library menu |
| --- | --- | --- | --- | --- |
| Local · any | `.ready` | full app (no sign-in concept) | tabs | enabled |
| Cloud · `.signedIn` | `.ready` | full app | tabs | enabled |
| Cloud · `.unknown` / `.unreachable` | `.connecting` | `ConnectingView` — spinner, "Connecting to your account…"; after 60 s "Can't reach bookmark-ai.cloud" + Retry | `SettingsGatePanel` (same message) | disabled (Open Web App stays) |
| Cloud · `.signedOut` | `.signedOut` | `SignedOutView` — app mark, "Sign in to Bookmark AI", Sign In…, server picker footer. **No sidebar, no toolbar items.** | `SettingsGatePanel` — Sign In… + server picker, **no tabs** | disabled (Open Web App stays) |

- **`signedOut` is definitive** — Clerk loaded and reported no session (at
  launch, or from the 45 s refresh loop when the session expired under an idle
  app), the user chose Sign Out, or the server 401'd a *freshly minted* token
  (the one replay after a 401 still failed → `ApiClient.onUnauthorized`). Every
  one of these goes through ONE path, `setSignedOut()` → `onSignedOut` →
  `AppEnvironment.handleSignedOut()`, which resets **every** model: library
  rows + facets + search + selection, sessions, live, chat transcript + history
  + draft + attachments + history search, settings **and the plan card**
  (`SettingsModel.plan` is nil until `/api/account` answers for THIS session),
  skills, MCP tokens, health, the identity (`AuthController.account`), the
  requested Settings tab and the tour flag. `SignedOutResetTests` asserts each
  of those is empty afterwards.
- **`unreachable` is transient** — the token webview didn't load in time,
  `window.Clerk` isn't there yet, the renderer was recycled, or the machine is
  offline. It says nothing about the session, so it is NEVER rendered as "not
  signed in": at launch it is the connecting gate (no data, no sidebar), and the
  silent restore retries with backoff **1 → 2 → 4 → 8 → 15 → 30 s** (the last
  repeats). Once the stretch passes `AuthController.stallAfter` (60 s) the
  screen switches to "Can't reach bookmark-ai.cloud" with Retry; retries keep
  going underneath. A session confirmed by any attempt after the awaited one
  (a backoff tick, Retry, or an on-demand mint) fires `onSessionRestored`, which
  runs the data load the launch skipped.
- **Mid-session, a transient mint failure keeps the session.** The status stays
  `.signedIn`, the data stays on screen, and `AuthController.token` returns nil.
  `ApiClient.send` / `startChatTurn` then throw `ApiError.noToken` **before any
  network call** — a bare request would 401, replay bare, and turn a Clerk blip
  into a false sign-out. `onUnauthorized` can only fire for a token that was
  actually attached and rejected twice (`ApiClientAuthTests` pins the three
  cases against a stubbed `URLProtocol`).
- **Identity**: `GET /api/me` is loaded alongside the library on every
  confirmed session (`loadEverything`) and shown in the sidebar footer (initials
  avatar, name → else email, email → else the server host, a Local/Cloud glyph
  badge, ⋯ ▸ Account Settings… / Sign Out) and in Settings ▸ Account (Status,
  then the identity row, then Sign Out — the plan card above). A transient
  `/api/me` failure keeps the last identity of the same session; sign-out
  clears it.
- Breadcrumbs for every transition are in the unified log:
  `log show --last 2d --predicate 'subsystem == "ai.purecode.bookmarkai" AND category == "auth"'`.
- Tests drive the state machine without a webview through
  `AuthController.mintOverride` (DEBUG) and `refreshTick()` — the same code
  the 45 s loop runs (`AuthStateTests`).

Why this exists: an instance left running for days showed **"Not signed in ·
Cloud" while the sidebar still listed 73 bookmarks**, and even after an explicit
Sign Out the sidebar navigation, facets and the Account tab's plan card stayed.
Root causes: the 45 s refresh loop flipped the status on "no session" without
flushing any model; `restore()` collapsed "couldn't reach Clerk" into
signed-out; only the detail column was gated (the sidebar rendered regardless);
`ApiClient` sent bare requests when no token could be minted, so a blip
401-replayed into a false sign-out; and `SettingsModel.plan` defaulted to Free,
so it could never be empty. All five are fixed by the gate above.

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
│   │   ├── BookmarkAIApp.swift     @main, WindowGroup + Settings, menu commands (data items disabled while gated)
│   │   └── AppEnvironment.swift    composition root; wires api ↔ auth ↔ models; `gate`/`canUseData`; handleSignedOut() = THE flush
│   ├── Models/
│   │   ├── Bookmark.swift          Bookmark, OpenGraph, BookmarkSource, ISO8601
│   │   ├── ApiResponses.swift      List/Meta/Search/Health/Account/Settings (+ AiMode, ownKeyReady)
│   │   ├── Session.swift           Session + SessionTab (openable-URL rules)
│   │   ├── Live.swift              LiveDevice/Window/Tab + freshness helpers
│   │   ├── Chat.swift              JSONValue passthrough, ChatMessage, ChatToolCall/ChatFilePart projections, per-tool copy
│   │   ├── ChatHistoryGrouping.swift  Today/Yesterday/Earlier buckets + relative-time copy for the History popover
│   │   ├── Skills.swift            Skill, SkillDraft, SkillValidation, the 3 starter templates
│   │   ├── SkillMarkdown.swift     SKILL.md parse/serialize (frontmatter → heading/paragraph fallback) + file import gate
│   │   ├── McpToken.swift          McpToken list/create shapes + Claude Code / JSON config snippets
│   │   └── Plan.swift              PlanInfo (free), AccountResponse
│   ├── Chat/
│   │   ├── ChatModel.swift         stream assembly (text/reasoning/tool/file parts), attachments, reply notes, re-sync
│   │   ├── ChatView.swift          transcript, ⋯ menu (Skills…), History button, Thinking placeholder
│   │   ├── ChatHistoryPopover.swift  History popover: search, day groups, row ⋯/context menus, keyboard, confirmed delete
│   │   ├── ChatTurnFailureView.swift  "The AI returned no reply." + Retry under an empty turn
│   │   ├── ChatMessageView.swift   user bubble + attachments row, assistant parts in stream order
│   │   ├── ChatPartViews.swift     ReasoningDisclosure, ChatToolRow (4 states + soft `{error}`), thumbnails/pills, reply notes
│   │   ├── ChatComposer.swift      NSTextView composer (grows to 6 lines), pills, paperclip/drop/⌘V, drag tint
│   │   ├── ChatAttachments.swift   attachment rules + classifier, ImageIO downscale (1568 px), pasteboard payloads
│   │   ├── MarkdownBlocks.swift    block markdown parser (tables, code, lists…)
│   │   ├── SkillsModel.swift       /api/skills CRUD + enable toggles
│   │   └── SkillsSheet.swift       master/detail Skills sheet (templates, Import…/drop, editor, delete confirm)
│   ├── Sessions/                   SessionsModel + SessionsView
│   ├── Live/                       LiveModel (SSE + reconnect) + LiveTabsView
│   ├── Networking/
│   │   ├── ApiClient.swift         async URLSession, bearer injection (no token ⇒ `.noToken`, never a bare cloud request), 401 retry, skills/MCP/account calls
│   │   ├── ChatStream.swift        ChatStreamChunk (SSE parser), ChatTurnBody, reply-note headers, chat error copy
│   │   ├── ApiError.swift          typed errors + status→error mapping (+ `.noToken`)
│   │   └── ServerTarget.swift      local/cloud base URLs, hostLabel
│   ├── Auth/
│   │   ├── ClerkWebAuth.swift      the two webviews, JS token minting, sign-out
│   │   ├── AuthController.swift    @Observable auth state (unknown/signedOut/signedIn/unreachable), token cache + refresh, backoff restore + stall, the one sign-out path, identity
│   │   ├── AuthGate.swift          AuthGateScaffold (glass + centred column + server picker footer), AppMark, GateActionButton
│   │   ├── SignedOutView.swift     the whole window while signed out on Cloud
│   │   ├── ConnectingView.swift    the whole window while the session is unconfirmed (spinner → "Can't reach" + Retry)
│   │   └── SignInSheet.swift       sheet + NSViewRepresentable host
│   ├── Library/
│   │   ├── ContentView.swift       gate switch: NavigationSplitView / ConnectingView / SignedOutView; sign-in sheet at the root
│   │   ├── SidebarView.swift       facets with counts (hidden at 0) + account footer
│   │   ├── AccountFooter.swift     initials avatar, name/email lines, target badge, ⋯ ▸ Account Settings… / Sign Out
│   │   ├── LibraryBrowserView.swift grid/list host + empty/error states + banner
│   │   ├── BookmarkGridView.swift  adaptive card grid (default), hover, click-opens
│   │   ├── BookmarkListView.swift  card rows in a ScrollView: selection, arrows, ⏎, ⌫ via onKeyPress (NOT a List — its context-menu focus halo can't be disabled)
│   │   ├── BookmarkRow.swift       favicon tile, OG data, trailing thumbnail
│   │   ├── BookmarkChrome.swift    FaviconTile, CategoryBadge, shared context menu
│   │   ├── LibraryModel.swift      @Observable store: filter, search, delete
│   │   └── SidebarItem.swift       selection enum + PlannedFeature rows
│   ├── Settings/
│   │   ├── SettingsView.swift      ⌘, — tabs (General/AI/MCP/Sync/Live/Data/Account) behind the gate, else SettingsGatePanel
│   │   ├── SettingsGatePanel.swift  signed-out / connecting panel: message + Sign In… or Retry + server picker, no tabs
│   │   ├── SettingsModel.swift     GET/PUT /api/settings, aiMode switch, removeKey, plan (nil until loaded)
│   │   ├── AiSettingsTab.swift     Included ⇄ Own key, saved-key summary, provider/model, Remove key…
│   │   ├── McpSettingsTab.swift    endpoint + client setup snippets, tool toggles, token mint/reveal/revoke
│   │   ├── McpTokensModel.swift    /api/mcp/tokens list/create/revoke
│   │   └── AccountSettingsTab.swift  plan card, then Status → identity row (avatar, name, email) → Sign Out
│   └── Support/
│       ├── Preferences.swift       UserDefaults-backed server target + layout (injectable defaults)
│       ├── InitialsAvatar.swift    initials on a tinted disc, symbol fallback (footer 28pt, Account 36pt)
│       ├── Interaction.swift       pointingHandCursor, SurfaceCard, HoverHighlight
│       ├── AiCreditsCard.swift     the free-credits meter (chat + Settings ▸ AI)
│       ├── CopyButton.swift        "Copy" → "Copied" button, wrapping code block
│       ├── Shimmer.swift           shimmer modifier + ThinkingIndicator
│       ├── TermFilter.swift        shared search-term matching
│       ├── TourSheet.swift         first-run tour
│       ├── VisualEffectBackground.swift  behind-window vibrancy
│       └── RemoteImage.swift       NSCache image loader with request coalescing
└── Tests/
    ├── ApiClientTests.swift        13 tests — URLs, limits, error mapping
    ├── DecodingTests.swift         12 tests — real payload shapes
    ├── Phase2DecodingTests.swift   6 tests — chat SSE fixtures, tool projection
    ├── Phase3DecodingTests.swift   19 tests — reasoning/tool/file chunks, turn body, chat errors,
    │                               reply notes, aiMode, plan, MCP tokens, skills, soft tool errors
    ├── AttachmentTests.swift       12 tests — classifier, downscale/re-encode, caps, paste naming
    ├── SkillMarkdownTests.swift    8 tests — SKILL.md parser + round trip, import type gate, createSkill/installSkill copy
    ├── ChatHistoryTests.swift      4 tests — day buckets, relative-time copy, title filter, seed hook
    ├── TranscriptLayoutTests.swift 2 tests — empty-stream failure row + Retry, server `error` chunk on an empty turn (fixture streams via `turnStarter`)
    ├── SignedOutResetTests.swift   2 tests — handleSignedOut() empties every model (incl. plan, identity, window state); a post-retry 401 flushes through AuthController
    ├── AuthStateTests.swift        11 tests — refresh-tick no-session flushes; unavailable keeps session + data; restore → signedIn / signedOut / connecting; Retry notifies; backoff + stall constants; gate per target; initials; identity kept on /api/me failure
    ├── ApiClientAuthTests.swift    4 tests — stubbed URLProtocol: no token ⇒ no request + `.noToken`; expired token recovers on the replay; fresh token rejected ⇒ onUnauthorized once; Local sends no header
    ├── MarkdownBlockTests.swift    6 tests — block parser fixtures
    ├── FilteringTests.swift        5 tests — sessions/live search matching
    ├── StreamingLayoutTests.swift  1 test — streaming layout
    ├── PreferencesTests.swift      2 tests — layout default + persistence
    └── RenderPreviewTests.swift    8 previews — light+dark PNGs incl. the auth gate (signed-out window + Settings panel, connecting + stalled, footer name/email/local, Account tab) (TEST_RUNNER_RENDER_PREVIEWS=1)
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
  (rounded, bordered, focus tint, send button inside) around an `NSTextView`
  that grows to 6 lines (⏎ / ⌘⏎ send, ⇧⏎ newline), with attachment pills
  above the text. The empty state above it carries the title, three example
  prompts, and the `AiCreditsCard` ("N of 1,000 credits used this week ·
  resets Monday" — tokens÷1000, WEEKLY, never say monthly). Sessions get the full action set: Open All, Copy All Links,
  Rename… (alert), Summarize with AI, Delete — one `actionEntries` builder
  feeds both the hover ellipsis menu and the context menu.
- Context menu per card/row: **Open in Browser**, **Copy Link**, **Delete** —
  one shared `BookmarkContextMenu`, so the layouts can't drift apart.
  Double-click opens in the list; Delete key deletes the selection.
- Menu bar: **Library ▸ Refresh (⌘R)**, **Open Web App (⇧⌘O)**, `SidebarCommands()`
  for the View-menu sidebar toggle. File ▸ New Window is *removed* — Phase 1 is a
  single-window app, so shipping a window that mirrors state would be a bug.
- Standard **Settings** scene (⌘,) carrying the Local/Cloud switch and health readout —
  gated like the main window: signed out / connecting on Cloud shows only the
  `SettingsGatePanel` (the unit-test host shares the app's sandbox container, so
  tests never call `signOut()` — it would wipe the real `WKWebsiteDataStore` —
  and always build `AppEnvironment` on a throwaway `UserDefaults` suite).
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

**Phase 3 (shipped 2026-09)** — the product-wide chat upgrade, at parity with
the web app:
1. **Skills** — `⋯` toolbar menu ▸ *Skills…* opens `SkillsSheet` over
   `/api/skills`: list with enable toggles, add/edit/delete, three starter
   templates (Weekly reading digest, Research brief, Link triage), validation
   mirroring the server schema, 409 name conflicts inline. A server without
   the route gets "This server doesn't offer skills yet". **Import…**
   (`NSOpenPanel`, `.md`/`.txt`) or a SKILL.md dropped onto the list is parsed
   client-side (`SkillMarkdown`: YAML frontmatter `name:`/`description:`, else
   the first `# Heading` + first paragraph) and opens the editor PREFILLED for
   review — Create then posts as usual. Ask AI can do it too (the tip under
   the list says so): `createSkill` / `installSkill` tool rows read "Creating
   skill “x”" → "Created skill “x”" and "Installing skill from host" →
   "Installed skill “x”", the disclosure shows the skill's name + description,
   `{error}` outputs render red, and the Skills list reloads on success.
2. **Chat protocol** — the FIRST turn posts `{messages:[user], timezone}`; every
   later turn posts `{message, conversationId, timezone}` and the server loads
   its own transcript (`ChatTurnBody`). The reply's `x-conversation-id`,
   `x-ai-source` (`own-fallback` → "Free credits are used up this week…") and
   `x-ai-note` (`own-key-incomplete` → "Your key needs a model…") headers become
   one-line notes under that reply, keyed by the persisted message id.
3. **Reasoning + tool rows** — an instant shimmering *Thinking* placeholder,
   then `reasoning-*` chunks as a collapsible disclosure (auto-open while
   streaming, "Thought for N s" after; persisted thoughts reopen as
   "Thoughts"). Tool calls render as rows in stream order with the four AI SDK
   states (spinner / check / red) and per-tool copy ("Searching bookmarks for
   “q”" → "Found n bookmarks", …, "Loading skill “x”" → "Using skill “x”").
   NB: the server never emits `tool-output-error` — failures arrive as
   `tool-output-available` with `{error: "…"}`, which renders as the same red
   state (`ChatToolCall.isFailure`). Interactive rows carry `zIndex(1)` so a
   table/code sibling can never take their clicks (the chat-turn preview
   renders that mix; verified live by clicking). A turn that streams
   nothing renderable (a 200 with an empty stream) drops the hollow assistant
   message and shows a failure row under the prompt — the server's `error`
   chunk wording if it sent one, else "The AI returned no reply." — with
   Retry (`ChatModel.failedTurn`; Retry re-sends the same parts as a fresh
   message).
4. **Attachments** — paperclip (`NSOpenPanel` restricted to images / PDF /
   text-like documents), drag-and-drop onto the composer, ⌘V of an image or a
   file. Images are downscaled to ≤1568 px via ImageIO and re-encoded (JPEG
   0.85, PNG when translucent, GIF passthrough) and renamed to match what was
   encoded (a pasted PNG that became JPEG is "Pasted image.jpg"); 5 files /
   4 MB base64 per message. Sent as `file` parts with `data:` URLs, shown as pills in the
   composer and as QuickLook-able thumbnails / document pills in the
   transcript. Server rejections (400/413/415 vocabulary) map to readable
   banners. Paste/drop diagnostics: `log stream --level debug --predicate
   'subsystem == "ai.purecode.bookmarkai"'`.
5. **Settings ▸ AI** — segmented *Included free AI* ⇄ *Your own key* (PUTs
   `{aiMode}` alone), saved-key summary with a confirmed *Remove key…* (the ONLY
   sender of `apiKey: ""`), provider/model picker fed by "Verify Key & List
   Models". Google is complete without a model; OpenAI / Anthropic / custom
   need a chosen model before Save, and `ownKeyReady == false` shows the
   inline warning.
6. **Settings ▸ MCP** — endpoint + copyable Claude Code command / JSON config
   (seeded with a freshly minted token, else `<YOUR_TOKEN>`), tool toggles,
   token generation with one-time reveal, list rows (hint · created · last
   used · revoked) with inline revoke confirmation. Local mode without a
   session gets a clear 401/403 explanation.
7. **Settings ▸ Account** — the *Free plan* badge with the plan's feature lines
   (`GET /api/account`, default `free`).
8. **History** — the toolbar's clock button opens a 360×460 popover
   (`ChatHistoryPopover`), not a menu: a search field (title match on every
   term, debounced 150 ms into the STORED `visibleConversations`), then the
   conversations grouped Today / Yesterday / Earlier (`ChatHistoryGrouping`,
   unit-tested against a fixed clock + locale) with title + relative time
   ("2 min ago", "Yesterday 14:03", "24 Aug, 14:03"); the open conversation
   sits on a tint. Click opens and closes the popover; hover shows a ⋯ menu
   and right-click the same Open / Delete… items; ↑/↓ move, ↩ opens, ⌫ asks
   to delete, Esc closes. Delete ALWAYS confirms ("This conversation and its
   messages will be removed. This can't be undone.") and deleting the open
   conversation starts a fresh chat. Loading, empty ("No conversations yet")
   and no-match states; the list refreshes after every turn and deletion.

**Phase 4 candidates:**
1. **Saving from the Mac app** (`POST /api/bookmarks`) — a share extension and/or
   a global hotkey; `CreateBookmarkInput` with `device: "laptop"`.
2. **Search paging** — `offset`/`hasMore` are already in `SearchResponse`; the
   list just needs infinite scroll (cap `offset + limit` ≤ 200).
3. ~~Block markdown in chat~~ — SHIPPED: `MarkdownBlock.parse` (pure,
   fixture-tested) splits messages into tables/fenced code/headings/lists/
   quotes/rules; only inline spans go through `AttributedString`. Tables are a
   `Grid` that wraps cells (no sideways scroll); code blocks get a language tag
   + hover copy button. Visual review harness: `RenderPreviewTests`
   (`TEST_RUNNER_RENDER_PREVIEWS=1`, prints `PREVIEW-> <png>`; `ImageRenderer`
   can't draw ScrollView content, so it captures a real `NSHostingView`).
4. **Swift 6 language mode** and `@SceneStorage` for column visibility, once
   multi-window is wanted.
5. **ClerkKit swap** — only if the Native API toggle gets enabled; contained
   behind `AuthController`.
