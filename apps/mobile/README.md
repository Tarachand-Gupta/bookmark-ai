# @bookmark-ai/mobile — the iOS/iPad (and Android) app

Expo (React Native) app designed to feel **native iOS**, not a web page: bottom
floating tab bar (real Liquid Glass on iOS 26, frosted blur on iOS 18/Android), large
titles and the iOS type scale, SF Symbols, native bottom-sheet filters, day-grouped
lists, long-press action sheets, and haptics.

## Production builds and sign-in

Supabase owns mobile authentication. The original native screen supports email/password,
verified email codes, signup and password recovery. Google and Apple are available on
both iOS and Android through the canonical hosted provider screen and a state-checked
PKCE handoff. The approved Apple button remains on iOS. MFA admission blocks private
screens and requests until verification completes. Sessions live in SecureStore under
`bookmark-ai:supabase-production`, separate from preserved QA and former Clerk storage.

Production uses **Bookmark AI**, package/bundle ID `ai.bookmarkai`, callback
`bookmarkai://sso-callback`, API `https://www.bookmark-ai.cloud` and Live
`https://live.bookmark-ai.cloud`. Version **1.0.2**, iOS build **102**, Android code **102**.

Current simulator screens are exposed through Xcode **Device Hub** (`com.apple.dt.Devices`).
Select the matching simulator row there; the historical `Simulator.app` entry is absent
on this installation. See [the production QA report](../../docs/testing/reports/2026-10-09-mobile.md)
for exact package, runtime, and evidence limits.
A new or unconfirmed account sees full-screen setup feedback; a failed setup offers
Retry and never opens an empty library as evidence of readiness.

From the repository root, create embedded Release packages without a local server:

```sh
node apps/mobile/scripts/production-release.mjs ios-simulator
node apps/mobile/scripts/production-release.mjs ios-device --from-run=/absolute/ios/run
node apps/mobile/scripts/production-release.mjs android
```

Run iOS targets sequentially: Expo shares a temporary native build directory inside the snapshot. The iPhone command may reuse the simulator’s printed frozen source run. Each new run
uses an isolated native dependency overlay, generated native projects and explicit
Supabase production guards. iOS simulator, provisioned-device IPA, Android APK and AAB
are saved in `dist/production`; `mobile-manifest.json` records identity, configuration,
source provenance, production URLs and artifact hashes. The wrapper reads the private
`.env.supabase.production.local`; Android signing reads only the four approved fields
from `.keys/android-release.env`. Missing production signing fails the release build.
The device IPA uses Apple Development provisioning and is installable only on devices
covered by its profile; it is not an App Store submission artifact.

Run the private artifact audit after building. It compares backend values against
embedded JS/public configuration without printing them, and checks the APK/AAB signing
certificates against the owner-held release keystore:

```sh
node apps/mobile/scripts/audit-production.mjs ios /absolute/BookmarkAI.app /absolute/audit.json
node apps/mobile/scripts/audit-production.mjs android /absolute/app.apk /absolute/audit.json /absolute/app.aab
```

Install only after verifying the actual package identity, signer and manifest. Preserve
existing apps and user data; a signer mismatch is not a reason to uninstall. Simulator
source/build proof does not prove physical provider callbacks or OS share-sheet placement.
The independent `qa:supabase` workflow retains its named QA IDs/callback and isolated
storage. Unqualified Expo generation is intentionally rejected rather than silently
building a different authentication provider.

## Settings

Settings is a short native menu. Account & Security keeps profile, email, password,
recovery, local sign-out and account deletion. Devices separates Apps & Web from
Browser Extensions using registered client types; rows open details with Rename and
confirmed sign-out. Equal names never combine separate sessions. Appearance, AI & Plan,
and Help & About keep the existing controls and legal/support links. Back returns to
Settings and Done closes it.

## "Save to Bookmark AI" (system share sheet)

Any app that can share a link can save to Bookmark AI — Chrome/Safari, chat apps,
anything that emits `ACTION_SEND text/*` (Android) or a web URL/page (iOS).

Native plumbing: the `expo-share-intent` plugin block in `app.json` (iOS share-extension
target `ai.bookmarkai.ShareExtension`, Android `ACTION_SEND` filters on
MainActivity) plus `plugins/withAndroidShareLabel.js`, which puts
`android:label="Save to Bookmark AI"` on the SEND intent filter — Android resolves a share
target's name from the filter first, so this names the action **without** renaming the
launcher icon. On iOS the extension's `CFBundleDisplayName` is `Save to Bookmark AI`; iOS
26's share sheet labels the row with the containing app's name (`Bookmark AI`) regardless.

JS side is `src/lib/share-intent.ts`: extract the first URL from the shared text (it is
prose as often as a bare link), auto-save it via `createBookmark`, confirm in
`ShareSavedBanner` (the scraped title replaces the raw link when the refetch lands). A
failed save opens the Add Bookmark sheet prefilled instead of losing the link; a share that
arrives while signed out is retained in the encrypted pending-share workflow and
completes after the correct authenticated account is ready.

Both native folders are generated. Edit app/config/plugin source, then use the production
release runner to regenerate and rebuild both apps in frozen snapshots.

## Update banner

On launch (and again on foreground / every 6 h) Home fetches the public
`GET /api/app/releases` and compares this build's `expo-application`
`nativeApplicationVersion` + `nativeBuildVersion` (`app.json` `version` / `ios.buildNumber` /
`android.versionCode`; SDK 57's expo-constants no longer exposes them) with the `ios` /
`android` record. A newer record shows
"Bookmark AI {version} is available" under the Home header with **Update** (opens the
store URL) and **Later** (24 h snooze per release, persisted in AsyncStorage per server
target); a record whose `minSupportedVersion` is above this build shows the blocking,
non-dismissible variant. No record, a failed request (5 s timeout) or an equal/older
record ⇒ no banner. Logic is pure and tested in `src/lib/appUpdate.ts`; I/O lives in
`src/hooks/useAppUpdate.ts`; the card is `src/components/UpdateBanner.tsx`.

To see it against the local server (the dev user is the default admin):

```bash
curl -X PUT localhost:3000/api/admin/releases/ios -H 'content-type: application/json' \
  -d '{"version":"9.9.9","build":"99","downloadUrl":"https://apps.apple.com/app/id123","releaseNotes":"Faster search"}'
# add "minSupportedVersion":"9.0.0" for the blocking variant; relaunch the app
curl -X DELETE localhost:3000/api/admin/releases/ios   # clean up
```

## Layout

| Path | What |
| --- | --- |
| `App.tsx` | providers (share-intent → Clerk → preferences → safe-area), auth gate, tab shell, deep links (`bookmarkai://tab/...`), share-sheet save + confirmation banner |
| `plugins/withAndroidShareLabel.js` | local config plugin: names the Android share-sheet action "Save to Bookmark AI" |
| `src/api.ts` | API client — same contract as the web app; build-time server target (`SERVER_TARGET`: dev run → local, release → prod); bearer-token injection |
| `src/theme.ts` | design tokens — hex ports of `packages/ui/src/theme.css` (sync manually on retheme) |
| `src/navigation/TabBar.tsx` | floating glass tab bar + `useTabBarClearance()` (content scrolls under it) |
| `src/screens/` | Library (list/cards, quick filters), Search (keyword \| AI), Settings (account, theme; read-only server), SignIn (Apple on iOS, Google, email+password, email code, forgot-password) |
| `src/components/` | FilterSheet (native pageSheet), BookmarkRow/Card, SegmentedControl, Symbol (SF Symbol w/ Android fallback) |
| `src/hooks/` | `useLibrary` (filters + pagination + meta), `useSearch` (debounced) |
| `src/context/PreferencesContext.tsx` | theme/view persisted in AsyncStorage (server target is a read-only build constant) |
| `src/lib/` | Clerk keys + token cache, Sign in with Apple decisions (`appleSignIn.ts`, tested), day grouping, long-press actions, share-intent capture/URL parsing/auto-save |

The `ios/` and `android/` directories are **generated** (`expo prebuild`, gitignored) —
never edit them; change `app.json` instead.

## Run it

```bash
# iOS (needs Xcode + its iOS platform download)
npx expo run:ios          # build + install on the simulator
npx expo start            # Metro bundler (separate terminal)

# Android (needs JDK 21 + Android SDK; emulator or device)
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=$HOME/Library/Android/sdk
npx expo run:android
```

### Release builds (Android APK download)

`.github/workflows/android-release.yml` builds the sideload APK: tag `android-v<expo.version>` (or
dispatch), `expo prebuild` → `gradlew assembleRelease` signed with the release keystore
(`plugins/withReleaseSigning.js` reads `ANDROID_KEYSTORE_*` from env / GitHub secrets, debug
keystore when unset) → `bookmark-ai-<version>-android.apk` + sha256 on the GitHub Release. A
release bundle targets production by itself (`__DEV__` false). Bump `expo.version` **and**
`android.versionCode` first. Keystore custody, secrets and the local recipe:
`docs/features/releases.md` → "Building and publishing downloads". Store builds stay `eas build`.

The iOS simulator reaches the local API (the web dev server) at `localhost:3000`; the
Android emulator sees the host machine as `10.0.2.2` (handled in `src/api.ts`).

Other bundle-time env flags (see "Server target" above for `EXPO_PUBLIC_SERVER_TARGET` /
`EXPO_PUBLIC_API_URL`):

- `EXPO_PUBLIC_INITIAL_TAB=sessions|search|chat|filters|settings` — open on a specific screen (headless screenshots); `settings` opens Home with the Settings presentation over it, since Settings is no longer a tab
- `EXPO_PUBLIC_SKIP_AUTH=1` — skip the sign-in gate against the open local server (QA agents); `__DEV__`-only, ignored in release builds

See `AGENTS.md` here before writing code: Expo APIs change fast — check the versioned
docs for **SDK 57** specifically.
