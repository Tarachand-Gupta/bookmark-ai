---
name: test-mobile
description: "How to build, run, automate, and QA the Expo mobile app (apps/mobile, iOS + Android) on this Mac: simulators/AVD, dev client + Metro, Release-config builds against prod, JXA tap automation, screenshots, dark mode, test users, and failure→fix pairs. Use when testing or verifying any mobile feature or an Android/iOS-only bug report."
---

# Testing the mobile app (apps/mobile — Expo SDK 57)

Sources: `docs/TESTING.md`, `docs/mobile-store-readiness.md` §3/§5, memory notes
`ios-mobile-dev-setup.md` + `release-config-qa-gap.md`.

## 0. Ground rules

- Dev server on :3000 is the API the app talks to in local mode (`LOCAL_API_URL`; Android sees
  the host as `10.0.2.2`). Never point local dev at prod Turso.
- `apps/mobile/ios` and `apps/mobile/android` are GENERATED (expo prebuild, gitignored) — never
  edit them; edit `app.json`/plugins then prebuild.
- NEVER `killall BookmarkAI` (kills other agents' simulator apps); no `pkill`. Use
  `xcrun simctl terminate booted ai.bookmarkai`.
- `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8` is REQUIRED for `expo run:ios` (not cosmetic — pod
  install dies with Encoding::CompatibilityError without it).
- Fixtures: prefix `qa-mobile`, record created ids in `created-ids.json`, delete by id at the end.

## 1. iOS simulator — dev build + Metro

```bash
cd apps/mobile
LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 npx expo run:ios --no-bundler   # background; ~5 min first, ~2 min incremental
npx expo start --dev-client                                          # Metro (separate terminal/background)
```
- Xcode 26.5 + iOS 26.5 simulator platform installed; if xcodebuild sees ZERO destinations,
  `xcodebuild -downloadPlatform iOS`.
- Bundle id: `ai.bookmarkai`. Dev-only helpers: `EXPO_PUBLIC_SKIP_AUTH=1` skips the
  sign-in gate; `EXPO_PUBLIC_INITIAL_TAB=home|library|sessions|search|chat|settings` lands on a
  tab without tapping (headless screen selection — `simctl openurl` with the custom scheme pops
  an un-dismissible dialog, don't).
- Metro's watcher is dead without Watchman: stale code → restart Metro + relaunch the app.
- Theme override persists in AsyncStorage (`bookmark-ai:theme`) — if the app renders dark on a
  light sim, check `<container>/Library/Application Support/ai.bookmarkai/RCTAsyncLocalStorage_V1/manifest.json`
  before suspecting a bug.

## 2. iOS automation (the proven recipe)

- Screenshots: `xcrun simctl io booted screenshot nn-what.png`.
- Appearance: `xcrun simctl ui booted appearance dark` (set back to light after).
- Taps: plain System Events `click at` FAILS (-25204). Use JXA
  (`osascript -l JavaScript`) with `CGEventCreateMouseEvent`/`CGEventPost`, mapping the Simulator
  window origin + 28 pt title-bar offset to device points.
- Text: `keystroke` drops chars on long strings — send 5–7 char chunks; verify each tap by
  screenshotting before/after. If input doesn't land after one honest attempt, STOP and report —
  never fake a state you did not reach.
- Liveness/crash forensics: poll `xcrun simctl spawn booted launchctl list | grep
  ai.bookmarkai`; on a crash `xcrun simctl spawn booted log show --last 3m --predicate
  'process == "BookmarkAI" AND (eventMessage CONTAINS[c] "crash")'` (SIGTERM mid-stream →
  runningboardd lines). `idb` is NOT installed on this Mac — never plan around it.
- Files-app probes: write a `qa-mobile` beacon file, `xcrun simctl addmedia booted <file>`,
  then grep logs for `DocumentPicker|saveToFiles|openurl.*file`.
- Media: `xcrun simctl addmedia booted <png>` pushes into Photos.
- Rotating (iPad): `xcrun simctl` cannot rotate; use the Simulator menu via System Events
  ("Rotate Left" of menu "Device"), capture, rotate back.
- Physical iPhone (Tara's, UDID 00008120-00062D010C13C01E): after the 7-day free profile lapses,
  `expo run:ios` can't re-mint — use
  `cd apps/mobile/ios && xcodebuild -workspace BookmarkAI.xcworkspace -scheme BookmarkAI -configuration Release -destination 'id=<udid>' -allowProvisioningUpdates -derivedDataPath <dd> build`
  then `xcrun devicectl device install app --device <udid> <dd>/Build/Products/Release-iphoneos/BookmarkAI.app`
  (device UNLOCKED, USB, Apple ID in Xcode). Re-Trust in Settings after a re-mint.

## 3. Android emulator

```bash
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=$HOME/Library/Android/sdk
$ANDROID_HOME/emulator/emulator -avd bookmark_pixel &          # Pixel 8, API 36
cd apps/mobile && npx expo run:android --no-bundler            # or ./gradlew assembleDebug
```
- QA: `adb exec-out screencap -p > nn.png`; taps `adb shell input tap/text` (long strings get
  mangled — chunk with ~1.2 s gaps); relaunch `adb shell am start -n ai.bookmarkai/…`.
- Release-variant check: `npx expo run:android --variant release --no-bundler`.
- ⚠️ Gradle's `:app:createBundleReleaseJsAndAssets` does NOT take `EXPO_PUBLIC_*` env vars as task
  inputs — switching `EXPO_PUBLIC_SERVER_TARGET` between local release builds ships the PREVIOUS
  bundle (`UP-TO-DATE`). Force with `rm -rf android/app/build/generated/assets/createBundleReleaseJsAndAssets`
  (or `--rerun`) before trusting any local Android release build. EAS builds are clean; not affected.
- Shipped-APK verify (catches CI env regressions): download the GitHub-release APK;
  `aapt2 dump badging` + `unzip -o -q shipped.apk assets/index.android.bundle assets/app.config`
  + `grep -c pk_live_ assets/index.android.bundle` (>0 — mobile 1.0.0 shipped with ZERO and broke
  Clerk sign-in); install on BOTH an API 36 and an API 24 emulator; `adb logcat` FATAL count 0.

## 4. Release-config rule (the lesson that created this rule)

A dev-config simulator run CANNOT validate a shipped app. Auth + startup + environment
resolution must be verified in `EXPO_PUBLIC_SERVER_TARGET=production npx expo run:ios
--configuration Release --no-bundler` (embedded bundle, app scheme, prod Clerk) — dev runs
differ in exactly the ways that broke (SSO redirect URL missing in Release, splash waiting on a
Clerk round trip). State plainly what only a real device can prove (real Google sign-in round
trip, share-sheet placement, cellular cold start).

## 5. Test users / auth

- Dev Clerk instance (`darling-baboon-13.clerk.accounts.dev`): email verification can be
  disabled; `+clerk_test@example.com` addresses accept OTP `424242`. Dev-instance test account:
  `storeqa+clerk_test@example.com` (OTP-less, used for signed-in Release walkthroughs).
- Google SSO on simulators stops at the Google consent page (no test account) — capture the
  pre-consent state and mark the rest BLOCKED; real round-trip needs a physical device.
- Never sign in Tara's real account on a capture simulator; never tap Delete Account.

## 6. Signed-in walkthrough pattern (on a REAL signed-in Release build)

Read-only rules: no sign-out, no deletes, no settings changes that persist, no Ask AI sends (they
cost credits). Capture per device: initial screen, each bottom tab, one search (type only),
bookmark detail, dark mode (`simctl ui … dark` then back), iPad landscape (menu rotate).
Screenshots named `<device>-<nn>-<what>.png` into the qa dir. Report a table + defects with
screenshot names; anything unreached listed as such.

## 7. Failure→fix pairs

- Infinite spinner at launch (dev or prod) ⇒ Clerk Native API disabled on the instance — probe
  `curl "https://clerk.bookmark-ai.cloud/v1/environment?_is_native=1&__clerk_api_version=2025-04-10&_clerk_js_version=5"`.
- SSO completes in browser but app stays on sign-in (`needs_identifier`) ⇒ Clerk native redirect
  allowlist must contain `bookmarkai://` + `bookmarkai://sso-callback`.
- `Missing external verification redirect URL for SSO flow` in Release ⇒ `redirectUrl` missing
  from `startSSOFlow` (dev-client default doesn't exist in standalone builds).
- Splash held for seconds ⇒ `isLoaded` waiting on a Clerk network round trip; ceiling ~4 s.
- Red screen "Unable to resolve module swr" ⇒ pnpm peer isolation; `swr` must be a direct dep.
- Android blur renders flat fill ⇒ `blurMethod="dimezisBlurViewSdk31Plus"` + `BlurTargetView` ref
  (old `experimentalBlurMethod` deprecated; misconfig only WARNs).
- Headless iOS input ignored (CGEvent taps land empty) ⇒ don't force it; verify on Android
  Release or by hand and say what wasn't covered.
