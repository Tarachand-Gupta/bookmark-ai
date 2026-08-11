# Store release — iOS TestFlight + Google Play (`apps/mobile`)

Status: CONFIGURED, NOT SUBMITTED. Written 2026-08-11. Everything in this repo that a store
release needs is in place and locally verified (§6); what remains is credential/dashboard work
that only the account owner can do (§7 is the checklist of exactly that).

Read `apps/mobile/AGENTS.md` first: the native `ios/` and `android/` directories are
**generated** by `expo prebuild` and gitignored — never edit them, edit `app.json` and re-run
prebuild.

---

## 1. What ships where

| Thing | Value |
| --- | --- |
| App name | Bookmark AI |
| iOS bundle id | `ai.purecode.bookmarkai` |
| iOS share-extension bundle id | `ai.purecode.bookmarkai.ShareExtension` |
| iOS App Group | `group.ai.purecode.bookmarkai` (both targets) |
| Android package | `ai.purecode.bookmarkai` |
| Marketing version | `app.json` → `expo.version` (`1.0.0`) |
| iOS build number | `app.json` → `expo.ios.buildNumber` (`"1"`) |
| Android versionCode | `app.json` → `expo.android.versionCode` (`1`) |
| Backend a release build talks to | `https://bookmark-ai.cloud` + prod Clerk (`pk_live_…`) — see §2 |

A **release** build (`__DEV__ === false`) resolves `SERVER_TARGET = "production"` in
`src/api.ts`, which in turn selects the prod Clerk publishable key in `src/lib/clerk.ts`. There
is no in-app server switch, and the Settings "Server" row is `__DEV__`-gated so it does not
exist in a store build. Nothing has to be flipped by hand before a release build.

---

## 2. Version + build-number strategy

`eas.json` sets `cli.appVersionSource = "local"` **on purpose**, even though EAS now recommends
`"remote"`. Reason: `expo-share-intent`'s config plugin reads `config.ios.buildNumber` at
**prebuild** time to write `CURRENT_PROJECT_VERSION` / `MARKETING_VERSION` onto the
`SavetoBookmarkAI` appex target. Apple rejects an upload whose app-extension
`CFBundleShortVersionString`/`CFBundleVersion` disagree with the containing app. With
`appVersionSource: "local"`, `autoIncrement` rewrites `app.json` *before* prebuild, so the app
and its extension always agree. With `"remote"`, EAS ignores `app.json`'s values (it warns
about exactly that) and the extension can drift.

Consequences of the `local` choice:

- `autoIncrement: true` in the `production` profile bumps `expo.ios.buildNumber` /
  `expo.android.versionCode` **in your working tree**. Commit that bump — otherwise the next
  build reuses the same number and App Store Connect rejects the duplicate.
- Bump `expo.version` by hand for each user-visible release (`1.0.0` → `1.0.1`).
- If you ever switch to `"remote"`, verify the appex version in the built `.ipa`
  (`unzip -p … Info.plist`) before trusting a submission.

---

## 3. `eas.json` profiles

`apps/mobile/eas.json`:

| Profile | Use | Output |
| --- | --- | --- |
| `development` | dev-client builds for a device, talks to the local dev server | APK / debug `.app` |
| `preview` | internal QA against **production** backend, sideloadable | APK / ad-hoc `.ipa` |
| `preview:simulator` | `extends: preview` + `ios.simulator: true` | simulator `.app` |
| `production` | store submission, `autoIncrement`, `distribution: "store"` | AAB / store `.ipa` |

Notes:

- **No `channel` keys.** `channel` is an EAS Update concept and `expo-updates` is not installed
  (`expo.modules.updates.ENABLED=false` in the generated manifest). Adding a channel without
  `expo-updates` only produces warnings. If OTA updates are wanted later, `npx expo install
  expo-updates` first, then add `channel` per profile.
- `env.EXPO_PUBLIC_SERVER_TARGET` is set explicitly per profile even though the `__DEV__`
  default already produces the same answer — it makes the target auditable in the build log.
- `apps/mobile/.env` is gitignored and therefore **not** uploaded to EAS. Do not rely on it for
  build-time values; use the `env` block or `eas env:create`.
- `submit.production.ios` has three `FILL_IN_…` placeholders (§7.2) and
  `submit.production.android.serviceAccountKeyPath` points at `apps/mobile/credentials/`, which
  is gitignored — drop the Play service-account JSON there.

---

## 4. Store-facing config already handled in `app.json`

| Item | State |
| --- | --- |
| App icon | `assets/icon.png`, 1024×1024, **no alpha channel** (PNG color type 2) — Apple's marketing-icon rule. Prebuild copies it to `AppIcon.appiconset`. |
| Android adaptive icon | foreground + background + monochrome (Android 13 themed icons) at 512×512. |
| Export compliance | `ios.infoPlist.ITSAppUsesNonExemptEncryption = false` — removes the export-compliance question on **every** TestFlight upload. Correct for this app: it uses only HTTPS/ATS platform crypto, which is exempt. |
| iOS privacy manifest | `ios.privacyManifests` declares `NSPrivacyTracking: false`, no collected-data types, and the three required-reason API categories React Native itself touches: `FileTimestamp` (`C617.1`), `UserDefaults` (`CA92.1`), `SystemBootTime` (`35F9.1`). Prebuild writes `ios/BookmarkAI/PrivacyInfo.xcprivacy`; the share extension gets its own. |
| Android permissions | Only `INTERNET` + `VIBRATE` (expo-haptics) survive. `android.blockedPermissions` strips `SYSTEM_ALERT_WINDOW` (React Native's dev overlay) and `READ_/WRITE_EXTERNAL_STORAGE`, all three merged in by transitive native modules and none of them used. Verify after any dependency change: `grep uses-permission android/app/src/main/AndroidManifest.xml`. |
| Account deletion | In-app, Settings → Delete Account (§5). Apple guideline 5.1.1(v). |

If Apple emails **ITMS-91053 (Missing API declaration)** after an upload, the near-certain
addition is `NSPrivacyAccessedAPICategoryDiskSpace` with reason `E174.1` — React Native's
Folly/boost layer can reach it. It is deliberately **not** declared up front: declaring a
category you do not use is its own violation (ITMS-91055).

### Known-optional gaps (not store blockers)

- ~~**Splash screen is the default blank one.**~~ **DONE 2026-08-11.** `expo-splash-screen` is
  installed and configured in `app.json` → `plugins`: the brand bookmark mark on `#ffffff`
  (`assets/splash-icon.png`) with a `dark` variant on `#0a0a0a`
  (`assets/splash-icon-dark.png`), `imageWidth: 128`, `resizeMode: "contain"`. Both marks are
  transparent-background glyph-only PNGs (Android 12+ masks the splash icon to a circle, so the
  artwork stays inside a centred circle of 66% of the canvas) drawn in the `src/theme.ts`
  neutral tokens. `App.tsx` calls `preventAutoHideAsync()` at module scope and hides the splash
  when the first real screen can paint, with a 4s module-scope ceiling so nothing that wedges
  startup can leave the splash up forever. Screenshot-verified on both simulators, light + dark.
  **The launcher icon (`assets/icon.png`) is still the default Expo template artwork** — the
  splash is on-brand, the app icon is not, so they do not match yet.
- **`userInterfaceStyle: "automatic"` has no effect on Android** — prebuild says so:
  *"Install expo-system-ui in your project to enable this feature."* The app reads
  `useColorScheme()` directly so dark mode works anyway; installing `expo-system-ui` would only
  fix the native window background during launch.
- **Release minification is off** (`enableMinifyInReleaseBuilds` defaults to `false`). Enabling
  it needs `expo-build-properties`; it shrinks the AAB but adds a Proguard-rules risk. Not
  required to publish.

---

## 5. Account deletion (Apple hard requirement)

Guideline 5.1.1(v): an app that lets users create an account must let them delete it **in the
app**. Wired up as of this pass:

- `apps/mobile/src/screens/SettingsScreen.tsx` — a destructive **Delete Account** row directly
  below **Sign Out**, plus a footnote stating the consequence. Shown only when there is a real
  Clerk user (hidden in the `EXPO_PUBLIC_SKIP_AUTH` dev session, which has none).
- Step 1: `Alert` — "Delete account? … cannot be undone" with Cancel / Continue(destructive).
- Step 2: `apps/mobile/src/components/DeleteAccountSheet.tsx` — a page sheet that requires the
  user to type `DELETE` (exact) **or** their own account email (case-insensitive) before the
  destructive button is armed.
- `apps/mobile/src/api.ts` → `deleteAccount()` → `DELETE /api/account` with the Clerk bearer
  token. Same contract as the web app (`apps/web/lib/api.ts`): **202** = deleted, **400** =
  local/open mode with no Clerk user ("Account deletion isn't available in local mode."),
  anything else surfaces the server's `error` string.
- On 202 only: the sheet closes, `signOut()` is called (a throw is expected and swallowed — the
  Clerk user no longer exists), and an "Account deleted" alert confirms it.
- On failure: the sheet **stays open with the session intact** and shows
  "Your account was NOT deleted: <reason>". It never pretends to have succeeded.

Server side (already existed): `apps/web/app/api/account/route.ts` deletes the Clerk user; the
`user.deleted` webhook is what tears down the tenant DB.

**App Review answer** for "how does a user delete their account": *Settings tab → Account →
Delete Account → type DELETE → Delete My Account.*

**Verified end-to-end 2026-08-11** on the iOS dev build against the dev Clerk instance: a
throwaway account (`qadel+clerk_test@example.com`) was created, the row → alert → sheet flow
run, the button confirmed **disabled** until `DELETE` was typed and **armed** after, and tapping
it produced a 202 → sheet closed → app returned to the sign-in screen → "Account deleted"
alert. `clerk users list` no longer contains the user. Screenshots in the session's
`qa-release/` (`ios-dev-02…06`).

---

## 6. Local release-build verification (done, reproducible)

Both were run on this machine on 2026-08-11 against the **production** target. Evidence:
`qa-release/` screenshots in the session scratchpad.

### Android

```bash
cd apps/mobile && npx expo prebuild -p android
cd android && JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home \
  ANDROID_HOME=$HOME/Library/Android/sdk ./gradlew assembleRelease
# → android/app/build/outputs/apk/release/app-release.apk  (74 MB)
adb install -r android/app/build/outputs/apk/release/app-release.apk
adb shell am start -n ai.purecode.bookmarkai/.MainActivity
```

`BUILD SUCCESSFUL in 4m 9s`. **No keystore needed**: the Expo bare template's `release` build
type is wired to `signingConfigs.debug` (the checked-in `debug.keystore`). That makes the APK
installable for QA and **unusable for Play** — Play rejects debug-signed uploads. Real
uploads must come from `eas build --profile production` (EAS holds the upload key) or a
locally configured release keystore.

Verified on `emulator-5554`: app boots to the sign-in screen, "Continue with Google" present,
tapping it opens `accounts.google.com` with *"to continue to bookmark-ai.cloud"* — i.e. the
release bundle really is on the prod Clerk instance and prod API. Stopped there (see §7.4).

### iOS (simulator, Release configuration)

```bash
cd apps/mobile && LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 \
  npx expo run:ios --configuration Release --no-bundler --device "iPhone 17"
```

`Build Succeeded — 0 error(s), 11 warning(s)`. **No signing wall**: `@expo/cli` skips code
signing for simulator builds unless the entitlements request associated-domains or
Sign-in-with-Apple; ours only request the App Group, so it builds unsigned. A **device or
archive** build is where signing starts, and that needs the Apple credentials in §7.

Verified on the booted iPhone 17 simulator: boots to sign-in, Google button present, tapping it
raises the `ASWebAuthenticationSession` consent sheet for `accounts.google.com`. Stopped there.

The `LANG=en_US.UTF-8` export is **not cosmetic** — without it CocoaPods dies with
`Encoding::CompatibilityError`.

### Repo fix this required

`apps/mobile/plugins/withAndroidShareLabel.js` used to `require("@expo/config-plugins")`. That
resolves during `expo prebuild` but **not** in the plain-node processes the release Gradle build
spawns (`:expo-constants:createExpoConfig`, `:app:createBundleReleaseJsAndAssets`), because
pnpm's strict isolation never links that transitive package into `apps/mobile`. The first
`assembleRelease` failed with `Cannot find module '@expo/config-plugins'`. Fixed by requiring
the `expo/config-plugins` re-export, which resolves through the direct `expo` dependency. Any
future local config plugin must do the same.

---

## 7. What only the owner can do

Everything below needs credentials or a dashboard click. Nothing in the repo blocks it.

### 7.1 EAS account

```bash
npm i -g eas-cli          # not installed on this machine
eas login                 # interactive
cd apps/mobile && eas init   # creates the EAS project, writes extra.eas.projectId into app.json
```

`eas init` also sets `expo.owner`. Commit the `app.json` change it makes. For CI later, mint an
`EXPO_TOKEN` robot token instead of `eas login`.

### 7.2 iOS credentials + App Store Connect

1. Apple Developer Program membership ($99/yr) on the account that owns `ai.purecode.bookmarkai`.
2. Register **two** App IDs (or let EAS do it): `ai.purecode.bookmarkai` and
   `ai.purecode.bookmarkai.ShareExtension`. Both must have the **App Groups** capability
   enabled and be members of `group.ai.purecode.bookmarkai` — the share extension passes the
   shared URL to the app through that group, so a missing group breaks sharing at runtime, not
   at build time.
3. Create the app record in App Store Connect (name, primary language, bundle id
   `ai.purecode.bookmarkai`, SKU). Note its numeric **Apple ID** → that is `ascAppId`.
4. Fill the three placeholders in `eas.json` → `submit.production.ios`: `appleId` (your Apple
   account email), `ascAppId`, `appleTeamId` (10-char team id).
5. Optional but recommended: add `"appleTeamId": "<TEAM_ID>"` to `app.json` → `ios`. Prebuild
   then writes `DEVELOPMENT_TEAM` into the Xcode project, which silences
   *"[expo-share-intent] No DEVELOPMENT_TEAM found in main app build settings"* and makes local
   archive builds work. EAS injects it during credential setup either way.
6. `eas build --platform ios --profile production` — first run prompts to create the
   Distribution Certificate and **two** provisioning profiles (app + appex) and stores them on
   EAS. Prefer an App Store Connect **API key** (`.p8`) over Apple-ID + 2FA; it is the only
   non-interactive option (`ascApiKeyPath` / `ascApiKeyIssuerId` / `ascApiKeyId`).
7. `eas submit --platform ios --profile production` (or `eas build … --auto-submit`).
   Processing takes ~10–15 min, then the build appears in TestFlight.
8. TestFlight: Internal Testing needs no review; External Testing needs a Beta App Review plus
   a beta description and feedback email.

### 7.3 Android / Play Console

1. Google Play Developer account (one-time $25).
2. Create the app in Play Console with package `ai.purecode.bookmarkai`. Leave **Play App
   Signing** on (the default): EAS holds the *upload* key, Google holds the app-signing key.
3. Create a Google Cloud service account with the *Service Account User* role, grant it
   Play Console access (Release manager), download its JSON key to
   `apps/mobile/credentials/play-service-account.json` (gitignored — the path `eas.json`
   already points at).
4. `eas build --platform android --profile production` → AAB. First run offers to generate the
   upload keystore; accept and let EAS store it.
5. `eas submit --platform android --profile production` → uploads to the **internal** track as
   a **draft** (that is what `eas.json` says). The app stays in draft until the store listing
   and the content questionnaires are complete.

### 7.4 The API allowlist decision — READ THIS

`requireUser()` (`apps/web/lib/server/require-user.ts`) enforces a `CLERK_ALLOWED_USER_IDS`
allowlist only **when the variable is non-empty**; an unset/empty value means *everyone who can
sign in gets in*.

**Verified 2026-08-11: `CLERK_ALLOWED_USER_IDS` is NOT set on Vercel production.**
`vercel env ls production` lists 15 variables and that is not one of them (it is declared in
`turbo.json` `build.env`, and documented in `CLAUDE.md`, but never added). So today:

- A TestFlight or Play tester who signs in with any Clerk account **is allowed** — no 403.
- Which also means the public prod API is open to anyone who completes prod Clerk sign-up,
  spending your Gemini quota and Turso storage. That is a **product decision to make before the
  first external tester**, not after.

Option A — lock it to yourself (what `CLAUDE.md` describes, and what a solo TestFlight run
wants):

```bash
# from the repo root
printf 'user_3GIhPt5Na3tYRP3XaPPU3PpI55e' | vercel env add CLERK_ALLOWED_USER_IDS production
vercel deploy --prod                       # env changes need a redeploy to take effect
```

Option B — add testers (comma-separated, no spaces). Get each tester's Clerk user id after they
sign up (`clerk users list`, or the Clerk dashboard), then:

```bash
vercel env rm CLERK_ALLOWED_USER_IDS production
printf 'user_OWNER,user_TESTER1,user_TESTER2' | vercel env add CLERK_ALLOWED_USER_IDS production
vercel deploy --prod
```

Option C — leave it unset (open signup). Only sane once per-user quotas exist.

Whatever you choose, mirror it on the **live server** (`apps/live-server`, its own
`CLERK_ALLOWED_USER_IDS` in the VM env) or Live Sessions will disagree with the main API.

~~Follow-up worth doing before external testers: mobile does **not** yet special-case the 403
`code: "forbidden"` response…~~ **DONE 2026-08-11.** `apps/mobile/src/api.ts` now classifies
responses exactly like `apps/web/lib/api.ts` (`ForbiddenError` on 403 `code: "forbidden"`,
`ProvisioningError` on 503 `code: "provisioning"`), and `useAccountStatus` turns those into
full-screen states above the tab shell: `src/screens/NoAccessScreen.tsx` ("This account doesn't
have access", names the signed-in email, Sign out + Check again) and
`src/screens/AccountSetupScreen.tsx` ("Setting up your account", 2s polling). So a
non-allowlisted tester now gets the same honest screen the web app shows, not a network error.
Verified on both simulators against a real server 403 (allowlist Option A set locally).

### 7.5 Store-listing assets and questionnaires

**Apple — App Store Connect**

- Screenshots: 6.9" iPhone (required) and, because `ios.supportsTablet: true`, **13" iPad
  screenshots are also required**. 3–10 per size. Grab them from the simulator:
  `xcrun simctl io booted screenshot`. `EXPO_PUBLIC_INITIAL_TAB=home|library|sessions|search|settings`
  makes each tab screenshot-able without navigating.
- Name (≤30 chars), subtitle (≤30), promotional text, description, keywords, support URL
  (`https://bookmark-ai.cloud`), marketing URL, **privacy policy URL — mandatory**.
- App Privacy questionnaire. For this app the truthful answers are:
  - *Contact Info → Email address*: collected, linked to identity, used for **App
    Functionality** (Clerk account). Not used for tracking.
  - *Identifiers → User ID*: collected, linked, App Functionality (the Clerk user id keys the
    tenant DB).
  - *Browsing History*: collected, linked, App Functionality — saved bookmark URLs, titles, and
    tab sessions are the product. Say so plainly; this is the answer reviewers check against
    the app's behavior.
  - *Usage Data / Diagnostics*: none (no analytics or crash SDK is installed).
  - **Tracking: No.** `NSPrivacyTracking` is `false` and there is no ATT prompt.
  - Account deletion: **Yes**, in-app (§5).
- Export compliance: already answered in the binary via `ITSAppUsesNonExemptEncryption=false`.
- Sign-in for review: App Review must be able to sign in. If you pick allowlist Option A above,
  **give them a demo account and add its Clerk user id to the allowlist**, or review will fail
  on a 403 they cannot explain. This is the single most likely rejection cause for this app.
- Third-party content note: bookmarks render Open Graph images fetched from arbitrary sites.
  Expect an age-rating question about unrestricted web access — answer honestly (17+ is the
  usual outcome for apps that open arbitrary URLs).

**Google — Play Console**

- Icon 512×512 PNG, feature graphic 1024×500, phone screenshots (≥2), 7" and 10" tablet
  screenshots (the app declares tablet support).
- Short description (≤80), full description (≤4000).
- **Data safety** form — same substance as Apple's: email + user id + "web browsing history"
  (bookmarks), collected and linked, for app functionality; encrypted in transit; **user can
  request deletion in-app**; no data shared with third parties; no ads.
- Content rating questionnaire (IARC).
- Target audience, ads declaration (none), news-app declaration (no).
- Privacy policy URL — mandatory, same one as Apple.
- App access: since sign-in is required, provide credentials under "All or some functionality
  is restricted" — with the same allowlist caveat as Apple.

---

## 8. Release checklist (per release)

1. `pnpm --filter @bookmark-ai/mobile check-types` clean.
2. Bump `expo.version` in `app.json` if it is user-visible.
3. `npx expo prebuild --clean` (SDK 57 clears the native dirs by default) and smoke-test dev
   builds on both platforms.
4. `eas build --platform all --profile production` → commit the `autoIncrement` bump.
5. `eas submit --platform ios --profile production` / `--platform android`.
6. Post-release smoke on the real build: sign in, save a bookmark, share a URL into the app,
   search, Settings → Delete Account renders. Not on the owner's live account for the last one.
