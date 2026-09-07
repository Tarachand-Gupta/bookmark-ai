# Safari store readiness — Mac App Store (`apps/extension/safari-app`)

Audit date **2026-09-07**, against the Safari build of the extension at version **0.1.2**
(`CFBundleVersion` **10200**), toolchain macOS 26.6.2 · Safari 26.6.2 · Xcode 26.5 (17F42) ·
xcodegen 2.46.0. Requirements were checked against the current App Store Review Guidelines and
App Store Connect rules (September 2026). Statuses:

- **PASS** — verified in code / in the built artifact (evidence given as a file path or command).
- **FIXED** — was failing or missing, built in this pass (the commit that adds this file).
- **FAIL** — still failing; needs code, a deploy or a decision. Listed separately in §1.3.
- **NEEDS-TARA** — a developer-account / App Store Connect / payment / secret action only the
  account owner can do. Ordered list in §6.
- **RISK** — passes the rule as written but has a realistic chance of a store-side objection.

Companion docs: `apps/extension/RELEASING.md` §5 (release commands), `docs/TESTING.md` §3
(local install + headless checks), `apps/extension/CLAUDE.md` → `safari-app/` (file map),
`STORE-LISTING.md` / `AMO-LISTING.md` (the Chrome/Firefox declarations this listing mirrors).

**Short answer to "is it ready?"** The Safari build is store-shaped and proven: one command turns
`pnpm build:safari` into a committed-spec Xcode project whose Release archive compiles universal
(arm64 + x86_64), both bundles sandboxed with nothing else, versions synced from `package.json`
onto both targets, privacy manifests, category, export-compliance flag, 1024 icon, and a real
container app — and the Debug build is installed at `/Applications/Bookmark AI.app`, ENABLED in
Safari 26.6.2, with the popup rendering the signed-in UI (§3). Everything left is work only the
paid team can do (App IDs, App Store Connect record, distribution certificate, upload, metadata,
the reviewer password) plus **one web deploy** so the Support URL stops 404-ing (§1.3 #1).

---

## 1. Guideline audit

### 1.1 App Store Review Guidelines (Mac, Safari web extension)

| # | Guideline | Status | Evidence / notes |
| --- | --- | --- | --- |
| S1 | **2.4.5(i) App Sandbox** — Mac App Store apps must be sandboxed | PASS | `safari-app/App/BookmarkAI.entitlements` and `Extension/BookmarkAIExtension.entitlements` contain exactly `com.apple.security.app-sandbox=true` + `com.apple.security.application-groups=[L3PP7DQZWS.ai.bookmark.safari]` (least privilege — the converter's `files.user-selected.read-only` was dropped; the appex needs no network entitlement because Safari performs the extension's requests; the team-id-prefixed App Group is the macOS form and needs no portal registration — it is the sandbox-compatible channel of S31). `project.yml` also sets `ENABLE_APP_SANDBOX: YES` + `ENABLE_HARDENED_RUNTIME: YES`. Built Debug bundle: `codesign -d --entitlements -` on app and appex → `app-sandbox` + the group (+ `get-task-allow`, Debug only). Pinned by `safari-app/safari-app.test.ts` (both targets, same id, mirrored in `Shared/AuthStateStore.swift` and `project.yml`). |
| S2 | **2.4.5 — no auto-launch / login items without consent** | **FIXED** | The old wrapper showed a modal "Run Bookmark AI in the background? → Start at Login" alert on first launch. Now "Start at login" is an explicit toggle in the setup window and a check item in the status menu (`SetupView.swift` `loginRow`, `AppDelegate.swift` `toggleLoginItem`), `SMAppService.mainApp` register/unregister only on user action. Nothing runs at login unless enabled. |
| S3 | **2.1(a) Completeness — the container app must do something** | **FIXED** | The store rejects an empty/placeholder window. `SetupView.swift`: live status card ("Bookmark AI is on/off in Safari", polled every 2 s while visible via `SFSafariExtensionManager.getStateOfSafariExtension`), "Turn On in Safari…" deep link (`SFSafariApplication.showPreferencesForExtension` → Safari ▸ Settings ▸ Extensions with Bookmark AI selected), three numbered steps, Open Bookmark AI / Sign In, Start-at-login toggle, Privacy/Support links, version. Menu-bar item mirrors the actions. Verified on screen (§3 screenshot 1) and by accessibility (`menu bar 2` items). |
| S4 | **2.1(a) Demo account for review** | NEEDS-TARA | The extension has no sign-in UI; the reviewer signs in on the website inside Safari. Reviewer account on production: `test@bookmark-ai.cloud` (library seeded 2026-09-07). Put the password ONLY in App Store Connect → App Review Information (never in this repo). Confirm `CLERK_ALLOWED_USER_IDS` on Vercel prod is unset or contains that user (store-release.md §7.4: unset as of 2026-08-11 — re-check with `vercel env ls production`). |
| S5 | **2.3 / 2.3.1 Accurate metadata; 2.3.7 unique name; 2.3.10 no other-platform references** | NEEDS-TARA | Paste-ready copy in §4 — written for Safari (no Chrome/Firefox/Android mentions, no bookmark-mirroring or tab-group claims, which Safari cannot do). Store name **"Bookmark AI for Safari"** (22 chars) = on-device `CFBundleDisplayName` (`App/Info.plist`), distinct from the desktop app "Bookmark AI" (apps/macos). "X for Safari" is established practice on the Mac App Store (AdGuard for Safari, Dark Reader for Safari, Grammarly for Safari). |
| S6 | **2.3.3 Screenshots show the app in use** | NEEDS-TARA / **RISK** | The existing `apps/extension/store-assets/*.png` are 1280×800 (an accepted Mac size) but shots 1, 4 and 5 show a **Chrome** popup / "Chrome on Mac" device — not reusable for the Mac App Store; 2 and 3 (web app in a generic window frame) are borderline. Recapture in Safari per §5 (recipe produces exact 2880×1800 PNG/JPG without compositing). |
| S7 | **2.5.2 No downloaded/remote executable code** | PASS | The popup, background service worker and content scripts are bundled from `.output/safari-mv3` into the appex `Contents/Resources` (`manifest.json` `background.service_worker: background.js`); the web app opens in Safari tabs, never in an embedded web view. `lib/diag.ts` dev POST sink is compiled out of production (`diag.test.ts`). |
| S8 | **2.5.4 / 4.2 Minimum functionality — Safari web extension container** | PASS | Apple's own template is a one-window onboarding app; ours adds the live state, deep link, login-item toggle and menu-bar access (S3). Safari extension apps are explicitly permitted (Guideline 4.2.4 exempts extensions from the "must be a full app" rule when they extend Safari). |
| S9 | **4.8 Login Services (Sign in with Apple)** | **RISK** | The Mac app and the extension present NO login of their own: the popup's only sign-in affordance opens `https://www.bookmark-ai.cloud/sign-in` in a Safari tab (`entrypoints/popup/components/SignInGate.tsx`). 4.8 targets apps that use a third-party login "to set up or authenticate the user's primary account" — a website flow in the user's browser has not historically been treated as the app's login. If a reviewer disagrees (the website offers "Continue with Google"), the fix is on the WEB: enable Apple as a Clerk SSO connection (Services ID + Team ID + Key ID + `.p8` — the same setup as mobile-store-readiness.md §1.4 Option B); no Mac code change. |
| S10 | **5.1.1(i) Privacy policy link in the app + content** | PASS / **RISK** | Setup window footer → `https://www.bookmark-ai.cloud/privacy` (`CompanionModel.privacyURL`) — 200 in prod. Content: `apps/web/app/privacy/page.tsx` was extended in `52a797b` (Langfuse, attachments, device data, deletion anchor) but that commit is **not deployed** (see #1 in §1.3) — the live page is the previous text until the next `vercel deploy --prod`. |
| S11 | **5.1.1(ii)/(iii) Purpose strings / data minimization** | PASS (N/A) | No camera, contacts, location, photos, microphone, Bluetooth, local-network or automation entitlements; no TCC-gated API is called. The Info.plist has no `NS*UsageDescription` because none is needed. |
| S12 | **5.1.1(v) Account deletion** | PASS (N/A) | The Mac app/extension neither create accounts nor sign users in; accounts are created and deleted on the website (Settings → Account → Delete, `DELETE /api/account` → 202; the webhook tears down the tenant). Mention in the review notes (§4.4). |
| S13 | **5.1.2 Data use and sharing** | PASS | The production manifest's `host_permissions` are exactly the four first-party origins (`lib/app-origins.ts` `PROD_HOST_PERMISSIONS`; `scripts/safari-xcode.sh` step 2 refuses to embed anything else); no third-party SDK in the native binary (AppKit/SwiftUI/SafariServices/ServiceManagement only); the appex is WebKit + our JS. Server-side processors are named in the privacy policy (Clerk, Turso, Gemini, Langfuse, Vercel). |
| S14 | **Privacy manifest (`PrivacyInfo.xcprivacy`)** | **FIXED** | Both bundles ship one (`App/PrivacyInfo.xcprivacy`, `Extension/PrivacyInfo.xcprivacy`, present in the built `Contents/Resources`). `NSPrivacyTracking=false`, no tracking domains, collected types Email / Name / User ID / Browsing History / Other User Content — all linked, not tracking, App Functionality — i.e. the CWS "PII + authentication info + web history" and the Firefox `authenticationInfo/bookmarksInfo/browsingActivity` declarations in Apple's taxonomy. Required-reason APIs: the app declares `UserDefaults` `CA92.1` (the has-launched flag + the state mirror); the appex declares none. Pinned by `safari-app.test.ts`. |
| S15 | **App Privacy "nutrition label"** | NEEDS-TARA | Answers in §4.3 — must match S14 and the policy. |
| S16 | **Third-party SDKs on Apple's privacy-manifest list** | PASS | None. `otool -L` of the app/appex binaries shows only system frameworks; no CocoaPods/SPM dependencies exist in `project.yml`. |
| S17 | **Export compliance** | **FIXED** | `ITSAppUsesNonExemptEncryption=false` in `App/Info.plist` (no network calls in the app; HTTPS only through WebKit in the extension) — App Store Connect skips the questionnaire per upload. |
| S18 | **Version / build numbers (app == appex, monotonic)** | **FIXED** | `safari-app/Version.xcconfig` is GENERATED from `apps/extension/package.json` by `scripts/safari-version.mjs` and feeds BOTH targets (`configFiles` in `project.yml`): `MARKETING_VERSION 0.1.2`, `CURRENT_PROJECT_VERSION 10200` (= major·1 000 000 + minor·10 000 + patch·100 + `SAFARI_BUILD_SUFFIX`). Built plists: app and appex both `0.1.2 / 10200` (§3). The converter output had `1.0 / 1` on both — App Store Connect rejects an appex whose versions differ from its host; this can no longer drift. Tests: `scripts/safari-version.test.ts`. |
| S19 | **Bundle identifiers** | NEEDS-TARA (decision, then register) | `ai.bookmark.safari` (app) / `ai.bookmark.safari.Extension` (appex) — what the repo, the local install and Safari's registration have used since July, in `project.yml` ONLY (mirrored in `CompanionModel.swift`, pinned by tests). **They become permanent when the App Store Connect record is created** → §6 #1. |
| S20 | **Minimum macOS** | PASS / INFO | `MACOSX_DEPLOYMENT_TARGET 14.0` (built `LSMinimumSystemVersion` 14.0 on both bundles). Sonoma/Safari 17 is the floor for the MV3 service-worker background this build uses and for `@Observable`/`SFExtensionProfileKey` in the native code. The converter had pinned the APP to 26.5 (its host SDK) — that would have excluded every Mac not on the newest OS. Runtime-verified only on 26.6.2. |
| S21 | **App icon — 1024×1024 + macOS 26 Liquid Glass** | **FIXED** | `App/Assets.xcassets/AppIcon.appiconset` (16→1024 PNG, `pnpm icons:safari-app` draws the toolbar mark on Apple's 824/1024 icon grid — same brand mark as the extension/web/desktop) + `App/AppIcon.icon` (Icon Composer document copied from apps/macos, so Tahoe renders the glass look instead of stamping a rim on a flat PNG). Built product: `Assets.car` contains the `.icon` layers, `AppIcon.icns` the fallback. App Store Connect takes the 1024 from the binary — nothing to upload separately. `icon_1024.png` is 1024×1024 (`sips`). |
| S22 | **Universal binary** | PASS | Release archive `Architectures = [x86_64, arm64]` (§3). |
| S23 | **`LSApplicationCategoryType`** (required for the Mac App Store) | **FIXED** | `public.app-category.productivity` in `App/Info.plist`; present in the built plist. Matches the primary category in §4.1. |
| S24 | **Code signing / distribution** | NEEDS-TARA | `project.yml` → `CODE_SIGN_STYLE: Automatic`, `DEVELOPMENT_TEAM: L3PP7DQZWS` (the ONE line to change if the paid enrolment lands on another team). Local builds are signed with the "Apple Development" identity already in the keychain (`BB7CP2R7GG`). The Mac App Store distribution certificate + profiles are issued by Xcode on first Archive → Distribute (or `xcodebuild -exportArchive … -allowProvisioningUpdates` with `safari-app/ExportOptions.plist`, method `app-store-connect`). **Notarization is NOT needed** — Apple signs App Store builds; notarization applies only to Developer ID builds distributed outside the store. |
| S25 | **Menu-bar (LSUIElement) app behaviour under review** | PASS / INFO | Reviewers launch the app: first launch shows the setup window; re-launching from Finder/Launchpad (`applicationShouldHandleReopen`) shows it again; the status item is always present with Quit (⌘Q works via a hidden key-equivalent menu). Documented in the review notes (§4.4) so "nothing happened on second launch" is not read as broken. |
| S26 | **Safari's permission model in the review flow** | INFO | Safari asks per site the first time the extension touches `bookmark-ai.cloud` (content-script bridge — the sign-in hand-off) and again for the current tab / all websites when saving sessions. The setup window's step 2 and the review notes (§4.4) tell the reviewer to Allow. Safari's Extensions pane shows the standard banner "can read and alter webpages … on all websites" once "Always Allow on Every Website" is chosen (§3 screenshot 3). |
| S27 | **Extension manifest permissions are justified** | PASS | `activeTab`/`tabs` (save the current page, list a window's tabs for sessions / opt-in live tabs), `storage`, `alarms` (device-token renewal + live heartbeat), `cookies` (Clerk session mirror — no-op on Safari, which partitions cookies; auth goes through the bridge-minted `bkd_` device token), `scripting` (Safari-only: re-inject the bridge into app tabs that predate the install), `nativeMessaging` (Safari-only: tell the companion app who is signed in — identity, never a token; S31). Justifications in §4.4. |
| S28 | **Accessibility / appearance** | PASS | Semantic colors and materials only (verified in dark mode, §3 screenshot 1), system fonts, `accessibilityLabel`s on the steps and status card, keyboard: ⌘W closes the window, ⌘Q quits, Escape closes the status menu. English only (INFO). |
| S29 | **Age rating questionnaire (2026 format)** | NEEDS-TARA | Answers in §4.3. The app has no embedded web view — links open in Safari — so "Unrestricted Web Access: No". Expected **4+**. |
| S30 | **Support URL** | **FAIL → NEEDS-TARA (deploy)** | App Store Connect validates that the Support URL loads. `https://www.bookmark-ai.cloud/support` returns **404** in production today; the page exists in the repo (`apps/web/app/support/page.tsx`, public route in `middleware.ts`, commit `52a797b`) and only needs `vercel deploy --prod` from the repo root (not run in this pass — deploys were out of scope). |
| S31 | **2.1(a) Completeness — the companion must reflect the extension's REAL sign-in state** (the window said "Sign in once on the web" beside a signed-in popup) | **FIXED** | New channel, App Store sandbox-compatible: the background (Safari target only) sends `{type:"authState", signedIn, email?, name?, at}` over `browser.runtime.sendNativeMessage` on every resolved user, device-token mint, sign-out and 6h tick (`lib/native-auth-report.ts`: deduped on state+email, forced on the tick, 5 s bound, never a token, no-op on Chrome/Firefox); `Extension/SafariWebExtensionHandler.swift` writes it to the App Group suite `L3PP7DQZWS.ai.bookmark.safari` (`Shared/AuthStateStore.swift`); `CompanionModel.refresh()` reads it. Window: step 1 and 2 show green checks when done, step 2 reads "Signed in as ‹email›" (middle-truncated), the Sign In button disappears, the status card names the account; menu: first line "Signed in as ‹email›" / "Not signed in" / "Sign-in state unknown" (no report yet). Verified live (§3). Privacy: the same e-mail/name the popup already shows, written only into the app's own group suite on this Mac — covered by the Email/Name types in S14. |

### 1.2 Build pipeline invariants (what a compiler will not check — now tested)

| # | Invariant | Status | Where it is enforced |
| --- | --- | --- | --- |
| P1 | Reproducible path `build:safari` → Xcode project → archive, no manual steps | **FIXED** | `apps/extension/scripts/safari-xcode.sh` (`pnpm safari:xcode -- [--build] [--archive [--unsigned]] [--install]`), spec `safari-app/project.yml` (XcodeGen), no converter, no `sed` on generated files. |
| P2 | The embedded bundle is the PRODUCTION target | **FIXED** | Script step 2 fails unless `manifest.name == "Bookmark AI"`, `version == package.json` and `host_permissions` are exactly the four prod origins (`--allow-dev-bundle` to override deliberately). |
| P3 | Appex resources equal the WXT output | PASS | Step 4 `rsync --delete` (excluding the other targets' `icon-dev/`/`icon-local/` plates); the file list inside the built appex was diffed against `.output/safari-mv3` → identical. |
| P4 | A new WXT top-level output entry cannot be silently dropped | **FIXED** | Step 5 drift guard fails the run until `project.yml` lists it; `safari-app.test.ts` pins today's list. |
| P5 | Versions cannot drift between package.json, app and appex | **FIXED** | S18 + `scripts/safari-version.test.ts` (the committed `Version.xcconfig` must equal the derived values; `pnpm safari:version` is the CI-able check). |
| P6 | Stale appex resources after a rebuild (the 2026-09-03 gotcha) | **FIXED** | The script always runs `clean build`; `Extension/Resources` is re-synced every run. |
| P7 | Only ONE registered copy of the appex | **FIXED** | Install step unregisters + deletes the DerivedData product, `ditto`s to `/Applications`, re-registers; verified `pluginkit -mAvvv -p com.apple.Safari.web-extension` → one row. |
| P8 | Post-install proof that Safari still has the extension enabled | **FIXED** | `CompanionModel.refresh()` mirrors Safari's answer into UserDefaults; the script reads `defaults read ai.bookmark.safari ai.bookmark.safari.lastExtensionState` → `enabled` (2026-09-07). |
| P9 | Chrome/Firefox outputs: manifests + behaviour unchanged; bundles differ only by the new (inert) module | PASS (documented) | Manifests: `chrome-mv3` and `firefox-mv2` are byte-identical to the frozen 0.1.2 store zips — no `nativeMessaging` there (Safari-only spread in `wxt.config.ts`). Popup CSS/JS: byte-identical (`assets/popup-C3j3pSDT.css`, `chunks/popup-B60519-I.js`) — a trap was closed on the way: Tailwind v4 scans every non-ignored file under `apps/extension` for class-like tokens, so comments in the new Swift/YAML/scripts (and, later, in `lib/native-auth-report.ts` + `background.ts`) saying "container" added a dead `.container` rule and moved every popup chunk hash; `assets/tailwind.css` now `@source not`s `safari-app/` and the five new script files, and the two scanned source comments were reworded (only that — `scripts/generate-icons.mjs` already feeds a dead `.rounded` to the shipped CSS and must stay). `background.js`: DIFFERENT from the frozen zips (+1.4 KB) because `entrypoints/background.ts` now imports `lib/native-auth-report.ts`; on Chrome/Firefox the inlined `"chrome"/"firefox" !== "safari"` makes `reportAuthState` return `"unsupported"` before touching anything — no behaviour change (the shipped zips are frozen, so this is acceptable). A second, pre-existing one-identifier delta (`xP()`→`Xue()` in Clerk's `safe-buffer`) reproduces from the untouched HEAD tree — environment drift since the zip, not this work. Toolbar PNGs sha256-identical after the icon-generator refactor. |
| P10 | `pnpm --filter @bookmark-ai/extension test` stays green | PASS | 19 files / 162 tests (was 17 / 140): + `scripts/safari-version.test.ts` (version encoding, xcconfig sync) + `safari-app/safari-app.test.ts` (bundle ids app↔Swift, sandbox-only entitlements, privacy manifests, Info.plist keys, resource layout). `pnpm check-types` clean. |

### 1.3 FAIL list (what still blocks or needs a decision)

1. **Support URL 404 in production (S30) + privacy-policy content not yet live (S10).** Both are the
   same undeployed commit `52a797b`. `vercel deploy --prod` from the repo root, then
   `curl -I https://www.bookmark-ai.cloud/support` → 200. Do this BEFORE creating the App Store
   Connect version (the URL is validated on save).
2. **Bundle-id decision (S19/§6 #1)** — permanent once the record exists.
3. **Screenshots in Safari (S6)** — the Chrome-based store assets cannot be reused as-is.
4. **Reviewer password (S4)** — into App Store Connect only.

### 1.4 Counts

PASS 15 · FIXED 13 · FAIL 1 (support URL, needs a deploy) · NEEDS-TARA 9 · RISK 3 (4.8, screenshots, policy text until deployed) · INFO 4.

---

## 2. What was built (the reproducible path)

```
apps/extension/
  scripts/safari-xcode.sh          the pipeline (pnpm safari:xcode -- …)
  scripts/safari-version.mjs       MARKETING_VERSION / CURRENT_PROJECT_VERSION from package.json (+ .d.mts, .test.ts)
  scripts/generate-safari-app-icon.mjs   16→1024 appiconset from the shared mark (pnpm icons:safari-app)
  safari-app/
    project.yml                    XcodeGen spec — COMMITTED source of truth (ids, team, sandbox, targets, scheme)
    Version.xcconfig               GENERATED (committed so Xcode works from a clean checkout; tests keep it honest)
    ExportOptions.plist            method app-store-connect, team L3PP7DQZWS, automatic signing
    App/                           menu-bar companion: AppDelegate.swift (explicit main(), NSStatusItem, window),
                                   CompanionModel.swift (@Observable state + actions), SetupView.swift (SwiftUI),
                                   Info.plist, BookmarkAI.entitlements, PrivacyInfo.xcprivacy,
                                   Assets.xcassets/AppIcon.appiconset, AppIcon.icon
    Extension/                     appex: SafariWebExtensionHandler.swift, Info.plist, BookmarkAIExtension.entitlements,
                                   PrivacyInfo.xcprivacy, Resources/ (gitignored rsync of .output/safari-mv3)
    BookmarkAISafari.xcodeproj/    gitignored — `xcodegen generate` output
    DerivedData/, build/           gitignored — xcodebuild intermediates, .xcarchive, export
```

Commands (from the repo root):

```bash
pnpm --filter @bookmark-ai/extension safari:xcode                         # build:safari → checks → xcconfig → rsync → xcodegen
pnpm --filter @bookmark-ai/extension safari:xcode -- --install            # + signed Debug build → /Applications/Bookmark AI.app
pnpm --filter @bookmark-ai/extension safari:xcode -- --archive            # + Release .xcarchive (needs the distribution cert to sign)
pnpm --filter @bookmark-ai/extension safari:xcode -- --archive --unsigned # Release compile proof, no team needed
pnpm --filter @bookmark-ai/extension safari:xcode -- --open               # open the generated project in Xcode
```

Retired: `xcrun safari-web-extension-converter`, `apps/extension/safari-xcode/` (its output),
`apps/extension/safari-native/` + `scripts/sync-safari-native.sh` (the sed-patch flow). Two
converter defaults were wrong for the store and are gone with it: app deployment target pinned to
the host SDK (26.5) and `1.0 / 1` versions on both bundles.

Two things worth knowing when touching the native code:

- `@main` on an `NSApplicationDelegate` does **not** instantiate the delegate without a storyboard
  — AppKit's default `main()` only calls `NSApplicationMain`. The first build ran with no status
  item and no window; `AppDelegate.main()` now creates, retains and installs the delegate itself.
- `SFSafariExtensionManager.getStateOfSafariExtension` only works from the containing app, so the
  app mirrors every answer into its defaults (`ai.bookmark.safari.lastExtensionState`) for scripts.

---

## 3. Verification log (2026-09-07)

Everything below ran on this Mac against the production extension target (`.env.production`,
`bookmark-ai.cloud`, prod Clerk).

| Check | Result |
| --- | --- |
| `pnpm --filter @bookmark-ai/extension build:safari` | `safari-mv3` 0.1.2, MV3, `host_permissions` = the four prod origins (bundle check step 2 passed) |
| `xcodegen generate` | `BookmarkAISafari.xcodeproj`; `-showBuildSettings`: `MARKETING_VERSION 0.1.2`, `CURRENT_PROJECT_VERSION 10200`, `MACOSX_DEPLOYMENT_TARGET 14.0`, `PRODUCT_BUNDLE_IDENTIFIER ai.bookmark.safari` |
| `xcodebuild … Debug clean build` (manual signing, Apple Development BB7CP2R7GG) | BUILD SUCCEEDED; `codesign -dv`: `Identifier=ai.bookmark.safari`, `TeamIdentifier=L3PP7DQZWS`, `--verify --deep --strict` valid; entitlements app + appex = `app-sandbox` (+ `get-task-allow`) |
| Built plists | app: `CFBundleShortVersionString 0.1.2`, `CFBundleVersion 10200`, `CFBundleDisplayName "Bookmark AI for Safari"`, `LSUIElement`, `LSApplicationCategoryType productivity`, `LSMinimumSystemVersion 14.0`, `CFBundleIconName AppIcon`; appex: `0.1.2 / 10200`, `NSExtensionPointIdentifier com.apple.Safari.web-extension`, principal class `Bookmark_AI_Extension.SafariWebExtensionHandler` |
| Appex `Contents/Resources` vs `.output/safari-mv3` | identical file list (minus `icon-dev/`, `icon-local/`); `PrivacyInfo.xcprivacy` present in app and appex; `Assets.car` holds the Icon Composer layers, `AppIcon.icns` the fallback |
| `xcodebuild archive` Release, `CODE_SIGNING_ALLOWED=NO` | `safari-app/build/BookmarkAISafari.xcarchive`: `0.1.2 (10200)`, `Architectures [x86_64, arm64]`, appex embedded under `PlugIns/` — Release compiles; signing/export await the distribution certificate |
| Install (`--install`) | running app quit via AppleScript, `/Applications/Bookmark AI.app` replaced in place, DerivedData copy unregistered + deleted, relaunched; `pluginkit -mAvvv -p com.apple.Safari.web-extension` → ONE row `ai.bookmark.safari.Extension(0.1.2)` at `/Applications/Bookmark AI.app/Contents/PlugIns/Bookmark AI Extension.appex` |
| Safari still has the extension enabled after the reinstall | `defaults read ai.bookmark.safari ai.bookmark.safari.lastExtensionState` → `enabled`; Safari ▸ Settings ▸ Extensions shows "Bookmark AI 0.1.2 from Bookmark AI" ticked with the ⌥⇧S shortcut (screenshot 3) |
| Container app | accessibility: 2 menu bars (main + status item), status menu = "Safari extension: on · Open Safari Extensions Settings… · Open Bookmark AI · Show Setup Window · Start at Login ✓ · Quit Bookmark AI"; `open` re-shows the setup window (screenshot 1, dark mode, status card green "Bookmark AI is on in Safari"); the "Open Safari Extensions Settings…" item opened Safari's pane with Bookmark AI selected (screenshot 3) |
| Popup in Safari (toolbar button clicked via accessibility) | renders the signed-in UI — account chip, Save bookmark, Save session (2 tabs), Save & close, Live tabs, Open app `www.bookmark-ai.cloud`, footer "Safari on Mac" (screenshot 2). **Nothing was saved** (Tara's account; saves against production were out of bounds), popup dismissed with Escape |
| Sign-in channel (S31) — extension → appex → companion | Popup open → background `authState` report → `~/Library/Group Containers/L3PP7DQZWS.ai.bookmark.safari/Library/Preferences/L3PP7DQZWS.ai.bookmark.safari.plist` created within seconds: `signedIn = 1`, `email = tarachandragupta2784@gmail.com`, `name = Tarachand Gupta`, `updatedAt`. (`defaults read` by SUITE NAME answers "Domain … does not exist" for group suites — read the plist path.) Setup window: green checks on steps 1+2, "Signed in as tarachandragupta2784@gmail.com", no Sign In button, status card names the account (screenshot 4); status menu first line "Signed in as tarachandragupta2784@gmail.com" (screenshot 5). Signed-out rendering verified WITHOUT signing Tara out: `defaults write ‹plist› signedIn -bool false` → within one 2 s poll the window showed step 2's instructions, the "2" badge and the Sign In button again, status detail "Not signed in yet — sign in on bookmark-ai.cloud (step 2)…", menu "Not signed in" (screenshot 6); then `defaults write ‹plist› signedIn -bool true` restored the extension's last real report (verified by re-reading the plist and the menu). |
| Unit-level | `pnpm --filter @bookmark-ai/extension test` → 19 files, 162 tests passed; `pnpm --filter @bookmark-ai/extension check-types` clean |
| Chrome / Firefox outputs | `pnpm build` + `pnpm build:firefox` re-run; `chrome-mv3/manifest.json`, `firefox-mv2/manifest.json` and both file lists unchanged; toolbar PNGs sha256-identical after the icon-generator refactor |

Screenshots (QA evidence — contain Tara's live library/e-mail, so they stay OUT of git):
`apps/extension/safari-app/build/qa-2026-09-07/` (gitignored) — `1-companion-setup-window.png`
(504×717, pre-channel build), `2-safari-popup.png` (3456×1640), `3-safari-settings-extensions.png`
(1704×1280), `4-companion-signed-in.png` (1008×1404), `5-companion-menu-signed-in.png` (916×502),
`6-companion-signed-out-override.png` (1008×1434); the same files are in this session's scratchpad.
They are evidence, not store assets (§5 has the recipe).

**Not verified here, and why:**

- A save against production from the signed-in popup — Tara's account was the only signed-in
  session and saving with it was not allowed; the reviewer account's password is not available to
  agents. → Tara: open any article in Safari, click the toolbar button, Save bookmark, confirm it
  lands in the library with `browser: safari`.
- The fresh-install, signed-out popup (`SignInGate`) in Safari — Tara's Safari is signed in and
  must not be signed out. The gate itself is the same React tree verified in Chrome/Firefox
  (`docs/TESTING.md` §3); the Safari-specific part (bridge-minted `bkd_` token after web sign-in)
  is what the current signed-in state proves.
- macOS 14/15 runtime (built for 14.0, run only on 26.6.2).
- Distribution signing, `-exportArchive`, upload — need the paid team (§6).

---

## 4. App Store Connect — paste sheet (macOS app)

### 4.1 App information

| Field | Value |
| --- | --- |
| Platform | macOS |
| Name (30) | `Bookmark AI for Safari` |
| Subtitle (30) | `Save any page. AI files it.` |
| Primary language | English (U.S.) |
| Bundle ID | `ai.bookmark.safari` (register first — §6 #1) |
| SKU | `bookmark-ai-safari` |
| Primary category | Productivity |
| Secondary category | Utilities |
| Content rights | Does not contain, show, or access third-party content |
| Age rating | see §4.3 → 4+ |
| Pricing | Free · all territories |
| Copyright | `2026 Tarachand Gupta` |

### 4.2 Version 0.1.2

**Promotional text** (170)

> Save the page you're on with one click. AI categorizes and tags it; find it again by meaning. Save whole windows as sessions, and opt in to live tabs across your devices.

**Description** (4000)

> Bookmark AI turns "I'll save this for later" into something that actually works later — right from Safari's toolbar.
>
> ONE-CLICK SAVE
> Click the Bookmark AI button in Safari's toolbar (or press ⌥⇧S) and the page is saved — title, icon and link included. No folders to file into, no copy-pasting URLs.
>
> AI DOES THE FILING
> Every save is read, categorized and tagged automatically. 1,000 free AI credits are included, or bring your own API key. Your library stays organized without you maintaining anything.
>
> SEARCH BY MEANING
> Hybrid search blends full-text with semantic vectors, so a vague memory like "that article about focus" finds the page even when those words never appear on it.
>
> SAVE WHOLE SESSIONS
> Snapshot every tab in a Safari window as one session and reopen the whole set later in a new window. Park your research and pick it back up.
>
> LIVE TABS, ON EVERY DEVICE (OPT-IN)
> Turn on "Live tabs" and the tabs you have open appear on your other signed-in devices in real time. Close the Mac, open your phone, keep reading. Off by default, private windows are never sent, credential-looking URLs are reduced to their origin, and live data expires automatically after 7 days.
>
> PRIVATE BY DESIGN
> You sign in once on bookmark-ai.cloud and the extension picks that session up — it never asks for a password itself. Nothing is collected beyond what makes your own library work, and live sharing is strictly opt-in. Full details: https://www.bookmark-ai.cloud/privacy
>
> OPEN SOURCE
> The whole product is open source and self-hostable. Docs: https://docs.bookmark-ai.cloud
>
> Requires a free Bookmark AI account. After installing, turn the extension on in Safari ▸ Settings ▸ Extensions — the app shows you how.

**Keywords** (100, comma-separated)

> bookmarks,bookmark manager,read later,save tabs,tab session,AI search,semantic search,tabs,sync

**URLs**

| Field | Value |
| --- | --- |
| Support URL | `https://www.bookmark-ai.cloud/support` (**404 until `52a797b` is deployed** — §1.3 #1) |
| Marketing URL | `https://www.bookmark-ai.cloud` |
| Privacy Policy URL | `https://www.bookmark-ai.cloud/privacy` |

**What's New** (first version)

> First release for Safari. One-click save with AI categorization and tagging, search by meaning, window sessions, and opt-in live tabs across your devices.

### 4.3 App Privacy label + age rating answers

**App Privacy** ("Do you or your third-party partners collect data from this app?" → **Yes**). Every
type below: *Linked to the user* — **Yes**, *Used for tracking* — **No**, purpose **App Functionality**
only. Matches both `PrivacyInfo.xcprivacy` files (S14) and the CWS/AMO declarations.

| Category | Data type | Why |
| --- | --- | --- |
| Contact Info | Email Address | the signed-in account, shown in the popup's account chip |
| Contact Info | Name | same |
| Identifiers | User ID | Clerk user id / the scoped `bkd_` device token that authenticates saves |
| Browsing History | Browsing History | URL, title, icon of pages the user saves; a window's tabs when saving a session; opt-in live tabs (≤ 7 days, private windows never sent) |
| User Content | Other User Content | user-typed session names and the device label ("Safari on Mac") attached to saves |

Everything else (Location, Contacts, Financial, Health, Purchases, Search History, Diagnostics,
Usage Data, Sensitive Info, Photos, Audio, …): **Not collected**. Tracking: **No** — no ATT, no
ads/analytics SDK, `NSPrivacyTracking=false`.

**Age rating (2026 questionnaire)**: Violence / Sexual content / Profanity / Horror / Alcohol-
tobacco-drugs / Gambling / Contests / Medical: **None**. Unrestricted Web Access: **No** (no
embedded browser — links open in Safari). Parental controls / kids category: **No**. Result: **4+**.

### 4.4 App Review Information

Contact: Tarachand Gupta · `tara@purecode.ai` · phone (Tara). Sign-in required: **Yes** →
*Username* `test@bookmark-ai.cloud` · *Password* **(Tara pastes it here — never in the repo)**.

**Notes** (paste):

> Bookmark AI for Safari is a Safari web extension with a small menu-bar companion app. The companion app's only jobs are to explain setup, deep-link into Safari ▸ Settings ▸ Extensions, show whether the extension is on, and (optionally, off by default) start at login.
>
> HOW TO TEST
> 1. Launch the app → the setup window opens. Click "Turn On in Safari…" (opens Safari ▸ Settings ▸ Extensions) and tick Bookmark AI. Closing the window leaves the app in the menu bar (bookmark icon); opening the app again re-shows the window.
> 2. In Safari, go to https://www.bookmark-ai.cloud/sign-in and sign in with the reviewer account above. When Safari asks whether Bookmark AI may access bookmark-ai.cloud, choose Allow — that is how the extension picks up the session; it has no password prompt of its own.
> 3. Open any article, click the Bookmark AI button in Safari's toolbar (or press Option-Shift-S) → Save bookmark. The page appears at https://www.bookmark-ai.cloud/app within seconds, categorized and tagged. "Save session" lists the window's tabs — when Safari asks, allow the extension on the current site or on every website.
>
> PERMISSIONS
> activeTab/tabs: read the page being saved and list a window's tabs for sessions and (opt-in) live tabs. storage/alarms: local settings and the periodic token renewal / live-tabs heartbeat. cookies: reserved for the website session hand-off (unused on Safari). scripting: re-attach the sign-in bridge to bookmark-ai.cloud tabs opened before installation. nativeMessaging: tells the companion app whether the extension is signed in (account e-mail/name only, never a credential) so its setup window can show the real state. Host permissions are exactly our own domains: bookmark-ai.cloud, www.bookmark-ai.cloud, clerk.bookmark-ai.cloud, live.bookmark-ai.cloud.
>
> DATA
> No third-party SDKs, no analytics, no remote code. Live tabs is off by default. Accounts are created, exported and deleted on the website (Settings → Account). Privacy policy: https://www.bookmark-ai.cloud/privacy

### 4.5 Distribution

Availability: all territories · Pricing: Free · Pre-order: no · Automatic release after review.
Mac App Store only — no Developer ID build is planned, so no notarization step exists.

---

## 5. Screenshots — sizes and capture recipe

**Accepted Mac sizes** (16:10, PNG or JPEG, no alpha, 1–10 images; one size is enough, all uploads
of a locale must share it): **1280×800, 1440×900, 2560×1600, 2880×1800**. Use **2880×1800** — it is
exactly what a 1440×900-point region captures on this Retina Mac, so no compositing is needed.

**Set-up (keeps Tara's session untouched):** Safari ▸ File ▸ New Profile → "Store shots"
(extensions are per profile: enable Bookmark AI for it under Settings ▸ Extensions), sign in there
as `test@bookmark-ai.cloud` (curated seeded library — no personal data in frame), light appearance,
hide bookmarks bar and tab bar clutter, Safari window sized to exactly 1440×900 points:

```bash
osascript -e 'tell application "Safari" to set bounds of window 1 to {0, 25, 1440, 925}'
```

**Capture a shot** (Accessibility is granted to `osascript` on this Mac):

```bash
# open the popup (a synthetic ⌥⇧S does NOT — click the toolbar button instead)
osascript <<'AS'
tell application "Safari" to activate
tell application "System Events" to tell process "Safari"
  repeat with b in (buttons of toolbar 1 of window 1)
    try
      if (description of b) contains "Bookmark AI" then click b
    end try
  end repeat
end tell
AS
sleep 2
screencapture -x -t jpg -R 0,25,1440,900 shot-1-popup.jpg     # → 2880×1800, no alpha
sips -g pixelWidth -g pixelHeight -g hasAlpha shot-1-popup.jpg # expect 2880 / 1800 / no
osascript -e 'tell application "System Events" to key code 53'  # Escape closes the popup
```

**Shot list** (store order; captions go in the description, the store has no caption field):

1. `1-popup.jpg` — the popup on an article in Safari, "Save bookmark" visible ("Safari on Mac" in the footer). *One click saves the page you're on.*
2. `2-library.jpg` — `https://www.bookmark-ai.cloud/app/library` in Safari, grid view with categories. *Every save lands filed, tagged and searchable.*
3. `3-search.jpg` — a vague query showing "closest results by meaning". *Search by meaning, not keywords.*
4. `4-live.jpg` — popup with the Live tabs panel on for this window, device "Safari on Mac". *Share a window as a live session — strictly opt-in.*
5. `5-companion.jpg` — the companion's setup window (`open "/Applications/Bookmark AI.app"`, then `tell process "Bookmark AI" to set position of window 1 to {480, 250}`) over a plain desktop, status card green. *Turn it on in Safari — the app shows you how.*

Rules from `store-assets/README.md` still apply: real UI only, readable text, nothing personal in
frame. Do not reuse the Chrome-based `store-assets/1-save.png`, `4-live-optin.png`, `5-live.png`
for the Mac App Store (they show a Chrome popup / "Chrome on Mac").

---

## 6. What only Tara can do — in order

| # | Action | Where | Notes |
| --- | --- | --- | --- |
| 1 | **Decide the bundle ids, then register two explicit App IDs** — default `ai.bookmark.safari` (app) + `ai.bookmark.safari.Extension` (appex), no capabilities. Alternative for consistency with iOS/macOS (`ai.purecode.bookmarkai.*`): `ai.purecode.bookmarkai.safari` + `ai.purecode.bookmarkai.safari.extension` — change the two `PRODUCT_BUNDLE_IDENTIFIER` lines in `safari-app/project.yml`, `extensionBundleIdentifier` in `App/CompanionModel.swift`, the ids in `safari-app.test.ts`/`safari-xcode.sh`, re-run `safari:xcode -- --install` and re-tick the extension in Safari once (it appears as a new extension; the stored device token is lost until an app tab re-mints it). **Permanent once step 3 exists.** | developer.apple.com → Certificates, Identifiers & Profiles → Identifiers | Team `L3PP7DQZWS` is pre-filled in `project.yml`; if the paid enrolment created a different team (Organization enrolments do), edit that one line. |
| 2 | **Xcode ▸ Settings ▸ Accounts** — sign in with the enrolled Apple ID so automatic signing can issue the "Apple Distribution" / Mac App Store certificate and the two provisioning profiles on first archive. | Xcode | No manual profiles; nothing to download. |
| 3 | **Create the App Store Connect record** — macOS app, name `Bookmark AI for Safari`, bundle id from #1, SKU `bookmark-ai-safari`, English (U.S.). | appstoreconnect.apple.com → My Apps → + | Names are unique store-wide; if taken, `Bookmark AI: Save & Search` (26). |
| 4 | **Deploy the web app** (`vercel deploy --prod` from the repo root) so `/support` is live and the updated privacy policy text (`52a797b`) is what reviewers read. Verify `curl -I https://www.bookmark-ai.cloud/support` → 200. | terminal | Blocks saving the version's URLs (S30). |
| 5 | **Archive + upload**: `pnpm --filter @bookmark-ai/extension safari:xcode -- --archive`, then either Xcode ▸ Window ▸ Organizer ▸ Distribute App → App Store Connect → Upload, or `xcodebuild -exportArchive -archivePath apps/extension/safari-app/build/BookmarkAISafari.xcarchive -exportOptionsPlist apps/extension/safari-app/ExportOptions.plist -exportPath apps/extension/safari-app/build/export -allowProvisioningUpdates` + Transporter on the `.pkg`. Processing ≈ 10–15 min; the build then shows under the app's version. | Xcode / terminal | Mac App Store distribution — NOT Developer ID, NO notarization (Apple signs store builds). A re-upload of the same 0.1.2 needs `SAFARI_BUILD_SUFFIX=1` (→ 10201) before archiving. |
| 6 | **Paste the metadata** (§4.1, §4.2), the **App Privacy** answers and the **age rating** (§4.3). | App Store Connect → version page / App Privacy | Description avoids other browsers/platforms on purpose (2.3.10). |
| 7 | **App Review Information** — contact, "Sign-in required", `test@bookmark-ai.cloud` + its password, the notes from §4.4. Confirm the account signs in on prod and, if `CLERK_ALLOWED_USER_IDS` is set on Vercel, that its id is in it. | App Store Connect → App Review Information | The password never goes in the repo or the docs. |
| 8 | **Screenshots** per §5 (at least one 2880×1800; five recommended). | Safari "Store shots" profile + `screencapture` | The reviewer account's seeded library is the data in frame. |
| 9 | **Submit for review.** First Safari-extension reviews with `tabs`/host permissions are manual; the notes and the test account are what unblock them. If 4.8 is raised (S9), enable Apple as a Clerk SSO connection on the website (Services ID + `.p8`) — no Mac code change. | App Store Connect | After approval: the Mac App Store link goes on the website's install buttons and the docs install page; bump `version` in `package.json` for every later release (RELEASING.md §5). |

Not needed: a Developer ID certificate, notarization, a D-U-N-S number (Individual enrolment;
seller name = Tara's), TestFlight (optional for Mac — internal testing works without review if you
want a dry run of the signed build first).

---

## 7. Known limits and open risks

- **4.8 Sign in with Apple** (S9) — the website's "Continue with Google" is outside the app, but a
  reviewer might not see it that way. Mitigation is entirely web-side (Clerk Apple SSO).
- **Support URL / privacy text** are one deploy away (S10, S30).
- **macOS 14/15** are within the deployment target but only 26.6.2 was exercised; the Swift code uses
  nothing newer than macOS 14 APIs (`@Observable`, `SMAppService`, `SFExtensionProfileKey`,
  `NSApplication.activate()`).
- **Safari's per-site prompts** are the most likely source of "it doesn't work" review notes; the
  setup window and §4.4 pre-empt them, but a reviewer who denies access on bookmark-ai.cloud cannot
  sign the extension in — the popup then keeps showing the sign-in gate by design.
- **Login item** — `SMAppService.mainApp.register()` posts the system "Bookmark AI added as login
  item" banner and lists the app under System Settings ▸ General ▸ Login Items; if the app is ever
  moved out of `/Applications` the registration goes stale (the toggle then shows an error inline).
- **Sign-in channel latency/dedupe** — the companion learns about a sign-in on the extension's
  next resolve (a popup open, a mint, the 6h tick), not instantly at web sign-in; reports are
  deduped per worker boot, so a manually edited group suite is only corrected on the next state
  CHANGE or the 6h tick (which re-sends unconditionally). Changing the team id means changing the
  group id in four places (`project.yml`, both entitlements, `Shared/AuthStateStore.swift`) —
  `safari-app.test.ts` fails until they agree.
