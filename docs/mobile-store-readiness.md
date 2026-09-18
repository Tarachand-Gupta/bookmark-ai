# Mobile store readiness — App Store + Google Play (`apps/mobile`)

Audit date **2026-09-07**, against `apps/mobile` at commit `2241ddb` (Expo SDK 57, RN 0.86.2,
iOS deployment target 16.4, Android target/compile SDK 36). Requirements were re-checked against
the CURRENT store rules (September 2026) — sources are linked inline. Statuses:

- **PASS** — verified in code / in the built Release artifact (evidence given as `file:line`).
- **FIXED** — was failing, fixed in this pass (commit hash given). Four commits, none pushed.
- **FAIL** — still failing; needs code or a decision. Listed separately in §1.4.
- **NEEDS-TARA** — a dashboard / account / payment / legal action only the account owner can do.
- **RISK** — passes the rule as written but has a realistic chance of a store-side rejection;
  verify at first upload.

> **2026-09-19 continuity update (not a fresh store audit):** the current local tree now contains
> the public `/support` route, the expanded privacy policy and deletion anchor described below,
> and `admin@bookmark-ai.cloud` as the public support mailbox. Recovered deployment history reports
> `/support` and `/privacy` returning 200 after a production deploy, but that live state was not
> reverified during recovery. The 2026-09-07 404 observations and screenshots below remain historical
> evidence; use the current mailbox and URLs in every new store/dashboard field.

Companion doc: `docs/features/store-release.md` (EAS profiles, credentials flow, allowlist
decision). This file supersedes its §7.5 "store-listing assets and questionnaires".

**Short answer to "should I pay?"** Yes — the binaries are store-shaped and both Release
builds boot cleanly against production (§3). But two things gate the *iOS* submission and
must be planned before the $99 is useful: (1) **Guideline 4.8** — with "Continue with Google"
on the sign-in screen, Apple requires Sign in with Apple (or an equivalent), which needs the
paid account to exist first, or the Google button has to be hidden on iOS for v1 (§1.4 #1);
(2) a **reviewer account** on the prod Clerk instance (§2). On Play, the **12-testers /
14-days closed test** for a new personal account sets the calendar: production access is
~3 weeks after the $25 at the earliest (§2).

---

## 1. Guideline audit

### 1.1 Apple — App Store Review Guidelines

| # | Guideline | Status | Evidence / notes |
| --- | --- | --- | --- |
| A1 | **2.1(a) Completeness — no placeholder/dev UI in the shipped build** | PASS | The Local/Production server switch no longer exists; the target is a build-time constant (`src/api.ts:100-106`). The read-only "Server" row is `__DEV__`-gated (`src/screens/SettingsScreen.tsx` `{__DEV__ ? (<GroupRow … label="Server"`) and the sign-in bypass is `__DEV__ && EXPO_PUBLIC_SKIP_AUTH` (`App.tsx:122`). Verified absent in the Release Settings screen (§3, `android-local-05-settings-bottom.png`: About shows only "Open web app" + "Version"). Release bundle strings contain `www.bookmark-ai.cloud` + `pk_live_…` (§3). |
| A2 | **2.1(a) Demo account for review** | NEEDS-TARA | App Review must sign in. Create a reviewer account on the **prod** Clerk instance (email + password — do NOT give them a Google account) and, if `CLERK_ALLOWED_USER_IDS` is set on Vercel, add its user id (store-release.md §7.4 — as of 2026-08-11 the variable was NOT set on prod, i.e. open sign-up; re-check with `vercel env ls production`, not run here). Put the credentials in App Store Connect → App Review Information. |
| A3 | **2.3 / 2.3.1 Accurate metadata** | NEEDS-TARA | Paste-ready copy in §4. Screenshots must show the real app (§5). Nothing hidden/dormant: the `bookmarkai://` deep links (`App.tsx:275-295`) and `EXPO_PUBLIC_INITIAL_TAB` are documented dev/screenshot affordances, not features. |
| A4 | **4.8 Login Services** | **FIXED (code) → NEEDS-TARA (Apple portal + prod Clerk)** | "Continue with Google" sets up the primary account → Apple requires an equivalent login ([4.8 text](https://developer.apple.com/app-store/review/guidelines/#login-services)). **Option A shipped 2026-09-07** (`docs/mobile-store-readiness.md` §1.4 #1): native Sign in with Apple via `@clerk/expo` 4.6.5 `useSignInWithApple` + `expo-apple-authentication` 57.0.1, iOS only, rendered above Google with the system `AppleAuthenticationButton` (`src/screens/SignInScreen.tsx` `appleAvailable`), entitlement `com.apple.developer.applesignin` from `app.json` `ios.usesAppleSignIn` + the plugin. Verified on a fresh iPhone 17 simulator against the dev Clerk instance (button rendered light/dark; the Apple flow itself is Tara's prod test). Works end-to-end only once Tara finishes the Apple-portal + prod-Clerk steps in §1.4 #1. |
| A5 | **5.1.1(i) Privacy policy link inside the app** | **FIXED** `10549f2` | Settings → Legal & Support → Privacy Policy / Terms of Service open `https://www.bookmark-ai.cloud/privacy` / `/terms` in the in-app browser (`src/lib/links.ts`, `src/screens/SettingsScreen.tsx` "Legal & Support" group). Both URLs return 200 today (curl, §3). Also linked from the sign-in consent line (`c4ecfe1`). |
| A6 | **5.1.1(i) Privacy policy CONTENT** | NEEDS-TARA | `apps/web/app/privacy/page.tsx` names Clerk, Turso, Gemini and describes in-app deletion — good — but is missing, against 5.1.1(i)'s "identify what data … all uses … every third party": **Langfuse** (AI chat prompts/completions are traced to Langfuse US cloud since commit `8559813` — a third party that sees user content), **Vercel** (hosting), the **mobile apps** (device type/name/OS sent with every save: `src/api.ts:38-48`), **photo/file attachments** sent to the chat model and stored with the conversation (`packages/db/src/migrations.ts:252-256` `chat_messages.parts_json`), a **retention** statement, and a **contact email**. Proposed replacement copy in §4.5. Web change ⇒ needs a deploy (not run here). |
| A7 | **5.1.1(ii) Purpose strings** | **FIXED** `e01a015` | `NSPhotoLibraryUsageDescription` was already specific ("Bookmark AI lets you attach photos from your library to Ask AI questions.", `app.json` expo-image-picker plugin). `NSFaceIDUsageDescription` was expo-secure-store's template ("Allow $(PRODUCT_NAME) to access your Face ID biometric data.") → now "Bookmark AI can use Face ID to protect the sign-in saved on this device." (`app.json` expo-secure-store plugin `faceIDPermission`; verified in the built `Info.plist`). No camera/microphone strings — both disabled in the plugin, so the keys don't exist. |
| A8 | **5.1.1(iii) Data minimization — pickers over full access** | PASS | Photos come through `expo-image-picker`'s out-of-process picker (`src/lib/attachmentPickers.ts:62-68`), files through the document picker (`:112-125`). No Contacts/Location/Camera. |
| A9 | **5.1.1(v) In-app account deletion** | PASS | Settings → Account → Delete Account (`src/screens/SettingsScreen.tsx` `label="Delete Account"`), two-step: Alert → typed-confirmation sheet (`src/components/DeleteAccountSheet.tsx`) → `DELETE /api/account` 202 → sign-out (`src/api.ts:279-290`). Server deletes the Clerk user; the webhook tears down the tenant DB (`apps/web/app/api/account/route.ts`). Confirmation steps are explicitly allowed ([Apple's account-deletion page](https://developer.apple.com/support/offering-account-deletion-in-your-app/)). Verified rendering in Release (§3, `android-local-06-settings-account.png`). **Sign in with Apple token revocation (checked 2026-09-07):** Clerk does NOT revoke on user deletion — its own docs: "Deleting the user from Clerk does not reset this on Apple's side" ([Clerk iOS SIWA guide](https://clerk.com/docs/ios/guides/configure/auth-strategies/sign-in-with-apple)). Nor can our `DELETE /api/account` do it: Apple's `/auth/revoke` needs a refresh or access token, and Clerk's native flow (`oauth_token_apple`) only ever verifies the identity token — the hook discards `authorizationCode` (`@clerk/expo/dist/hooks/useSignInWithApple.ios.js`), so no refresh token exists anywhere. Apple's [TN3194](https://developer.apple.com/documentation/technotes/tn3194-handling-account-deletions-and-revoking-tokens-for-sign-in-with-apple) covers exactly this case: "If you don't have the user's refresh token, access token, or authorization code, you must still fulfill the user's account deletion request … Delete the user's account data from your systems. Direct the user to [manually revoke] for your client." → `DeleteAccountSheet` now shows Apple-signed-in users (an `apple` external account) the Settings › your name › Sign-In & Security › Sign in with Apple › Bookmark AI › Stop Using path. What a real revocation would need: server-held Apple key (Team ID, Key ID, `.p8` as a Vercel secret), a client change to capture `authorizationCode` at sign-in and POST it to a new API route that exchanges it at `/auth/token` within 5 minutes and stores the refresh token per user (new tenant column ⇒ migration + export-format bump), then `POST /auth/revoke` from `DELETE /api/account`. Not small, not done. |
| A10 | **5.1.1(v) "Let people use it without a login"** | PASS (N/A) | Every feature is the user's own synced library (bookmarks, sessions, live tabs, AI over that library) — "significant account-based features". No login-free surface is owed. |
| A11 | **5.1.2(i) Data use & sharing — disclose sharing incl. third-party AI, get permission** | **FIXED** `c4ecfe1` + NEEDS-TARA | Sign-in screen now carries "By continuing you agree to the Terms of Service and Privacy Policy." with tappable links (`SignInScreen.tsx` `styles.consent`) — the explicit-permission moment. The disclosure itself lives in the privacy policy → see A6 (add Langfuse + attachments). No ATT prompt needed: no tracking (`NSPrivacyTracking: false`, no ad/analytics SDK — see A16). |
| A12 | **App Privacy "nutrition label"** | NEEDS-TARA | Answers in §4.3. Must match A13 and the policy. |
| A13 | **Privacy manifest (`PrivacyInfo.xcprivacy`)** | **FIXED** `e01a015` + PASS | Expo writes `ios/BookmarkAI/PrivacyInfo.xcprivacy` from `app.json` → `ios.privacyManifests`. Required-reason APIs: FileTimestamp `C617.1`, UserDefaults `CA92.1`, SystemBootTime `35F9.1` (the RN set — `React-Core_privacy.bundle` in the built app declares the same). DiskSpace is declared by `expo-file-system`'s own manifest (`node_modules/expo-file-system/ios/PrivacyInfo.xcprivacy`: `E174.1`, `85F4.1`, shipped as the `ExpoFileSystem_privacy` resource bundle) — so it is deliberately NOT duplicated in ours. `NSPrivacyCollectedDataTypes` was `[]` while the app collects email/name/user id/browsing history/user content/photos → now lists those six (linked, not tracking, App Functionality). |
| A14 | **Third-party SDKs on Apple's privacy-manifest list** | **RISK** | Apple's [list](https://developer.apple.com/support/third-party-SDK-requirements/) includes **SDWebImage** and **hermes**. The built app embeds `Frameworks/SDWebImage.framework` + `SDWebImageWebPCoder.framework` — pulled in as PREBUILT xcframeworks by `expo-image-manipulator` 57.0.15 (`node_modules/expo-image-manipulator/ios/ExpoImageManipulator.podspec:22,30-32`; artifacts in `ios/Pods/ExpoImageManipulator/SDWebImage.xcframework`) — and that xcframework contains **no `PrivacyInfo.xcprivacy`** (verified: framework has only `Headers Info.plist Modules SDWebImage`). New-app uploads with a listed SDK lacking a manifest are refused with **ITMS-91061**. Hermes ships as `hermesvm.framework` (renamed in RN 0.8x), also without a manifest; Apple's matcher keys on "hermes", so this one is uncertain. **Mitigation if ITMS-91061 fires:** build the Expo modules from source so SDWebImage comes from CocoaPods (which ships its manifest): set `EXPO_USE_PRECOMPILED_MODULES=0` for `pod install` (`ios/Podfile:21` honours `Podfile.properties.json` `EXPO_USE_PRECOMPILED_MODULES: "false"`; on EAS put the env var in the `production` profile's `env`). Do this reactively: the TestFlight upload email is the authoritative test and costs nothing. |
| A15 | **Export compliance** | PASS | `ITSAppUsesNonExemptEncryption: false` (`app.json` `ios.infoPlist`), present in the built `Info.plist`. HTTPS-only platform crypto ⇒ exempt. |
| A16 | **Third-party SDK disclosure (what is in the binary)** | PASS (list) | Clerk (`@clerk/expo` 4.6.5 — auth; JS only: its native module — Clerk's SwiftUI/Compose components + the clerk-ios/clerk-android SDKs — is excluded from autolinking in `apps/mobile/package.json`, verified absent from `ios/Podfile.lock`; brings `@clerk/clerk-js` → `@solana/wallet-adapter-react` → **Solana Mobile Wallet Adapter native lib on Android**, unused), `expo-apple-authentication` 57.0.1 (Sign in with Apple), Expo modules, React Native + Hermes, SDWebImage (via expo-image-manipulator), Ionicons/SF Symbols, AsyncStorage, react-native-sse. **No analytics, crash reporting, or ads SDK.** Server-side processors (not in the binary): Clerk, Turso, Google Gemini, Langfuse, Vercel. |
| A17 | **Background modes / entitlements** | PASS | Only `com.apple.security.application-groups` (`group.ai.bookmarkai`) for the share extension (`ios/BookmarkAI/BookmarkAI.entitlements`, `ios/SavetoBookmarkAI/ShareExtension.entitlements`). No background modes, push, location. |
| A18 | **URL scheme / universal links** | PASS | `bookmarkai` + `ai.bookmarkai` schemes (`Info.plist` `CFBundleURLTypes`, from `app.json` `scheme`); `bookmarkai://sso-callback` is registered on both Clerk instances (`src/lib/clerk.ts:41-68`). No universal links (none needed). |
| A19 | **iPad support claim vs layouts** | **FIXED** `2241ddb` + PASS | `supportsTablet: true` → `TARGETED_DEVICE_FAMILY = 1,2`, all orientations, `UIRequiresFullScreen=false` (multitasking must work — RN flex layouts do). The prod Release build was installed on the iPad Pro 13" (M4) simulator: it boots to sign-in (`ipad-01-signin-portrait.png`), but the form stretched edge-to-edge → capped at 440 pt (`SignInScreen.tsx` `styles.column`), verified on the final build (`ipad-final-01-signin-portrait.png`). Other screens use list layouts that scale; a landscape/Split View pass on a real iPad is still owed (§6). |
| A20 | **App icon 1024×1024, no alpha** | PASS | `assets/icon.png` 1024×1024 PNG, `hasAlpha: no` (sips). Android adaptive layers 1024×1024. |
| A21 | **Launch screen** | PASS | `expo-splash-screen` storyboard, light+dark marks (`app.json` plugin). Cold start: native splash → LaunchScreen twin → sign-in in <2 s on the simulator (§3). Hard ceiling 1.5 s (`App.tsx:64-65`). |
| A22 | **Version / build numbers** | PASS | `1.0.0` / build `1` (`app.json`, built `Info.plist`); appex matches (store-release.md §2 explains the `appVersionSource: local` choice). |
| A23 | **Minimum iOS** | PASS | 16.4 (`IPHONEOS_DEPLOYMENT_TARGET`, Expo SDK 57 default; `MinimumOSVersion` 16.4 in the built plist). |
| A24 | **Age rating questionnaire (new 2025/26 format)** | NEEDS-TARA | Answers in §4.3. Bookmarks open in the SYSTEM browser (`src/lib/bookmarkActions.ts:6-8`, `Linking.openURL`), not an in-app web view → "Unrestricted Web Access: No". Expected rating **4+**. Apple requires the new questionnaire for all new submissions since September 2026. |
| A25 | **UIScene lifecycle** | INFO | The Release run logs Apple's runtime issue "`UIScene` lifecycle will soon be required" (RN 0.86 still uses the AppDelegate lifecycle). Not a submission blocker today; tracked by RN/Expo for the iOS 27 SDK. |

### 1.2 Google Play

| # | Policy | Status | Evidence / notes |
| --- | --- | --- | --- |
| G1 | **Target API level** — new apps must target **Android 16 / API 36** from 31 Aug 2026 ([policy](https://support.google.com/googleplay/android-developer/answer/11926878)) | PASS | Built release APK: `targetSdkVersion:'36'`, `compileSdkVersion='36'`, `minSdkVersion 24` (`aapt2 dump badging`, §3). Expo SDK 57 defaults — nothing to configure. |
| G2 | **Closed-testing requirement for NEW personal accounts** — 12 testers opted in continuously for 14 days before you can apply for production access ([policy](https://support.google.com/googleplay/android-developer/answer/14151465)) | NEEDS-TARA | Applies to every personal Play account created after 13 Nov 2023 — i.e. Tara's. Organization accounts are exempt (needs a D-U-N-S number). Timeline in §2. |
| G3 | **Data safety form** | NEEDS-TARA | Answers in §4.4. |
| G4 | **Privacy policy URL** | PASS (URL) / NEEDS-TARA (enter it) | `https://www.bookmark-ai.cloud/privacy` — 200. Must also be linked in-app (done, A5). Content gaps: A6. |
| G5 | **Account deletion — in-app AND a web URL** ([policy](https://support.google.com/googleplay/android-developer/answer/13327111)) | PASS (in-app) / **NEEDS-TARA (web URL)** | In-app: A9. Web: the only web deletion path today is inside the signed-in app (`apps/web/components/library/settings-dialog.tsx` → `deleteAccount`); `/account/delete`, `/delete-account` and `/support` all 404. Google accepts a privacy-policy anchor if the deletion section is "highlighted and reasonably prominent" and names the app. **Enter `https://www.bookmark-ai.cloud/privacy#delete-account`** after adding `id="delete-account"` + the mobile steps + the email fallback to the "Your control" section (`apps/web/app/privacy/page.tsx:71-79`; copy in §4.5). Needs a deploy. |
| G6 | **Permissions** | PASS | Main manifest declares only `INTERNET` + `VIBRATE`; `READ/WRITE_EXTERNAL_STORAGE`, `CAMERA`, `RECORD_AUDIO`, `SYSTEM_ALERT_WINDOW` are stripped (`android/app/src/main/AndroidManifest.xml` `tools:node="remove"`, from `app.json` `blockedPermissions` + image-picker plugin). The MERGED release manifest adds normal-protection permissions from libraries — `USE_BIOMETRIC`/`USE_FINGERPRINT` (androidx.biometric via expo-secure-store), `ACCESS_NETWORK_STATE` + Play Install Referrer (`com.solanamobile:mobile-wallet-adapter-clientlib`, Clerk's transitive Solana dependency) — none are runtime/dangerous, none need a Play declaration. No `READ_MEDIA_IMAGES`: photos use the system Photo Picker. |
| G7 | **Cleartext traffic off in release** | PASS | The merged release manifest has NO `usesCleartextTraffic` attribute → default `false` on target 36; only `android/app/src/debug/AndroidManifest.xml` sets it `true` for `http://10.0.2.2:3000`. Proven in §3: a Release build pointed at the local target failed with "CLEARTEXT communication to 10.0.2.2 not permitted by network security policy". |
| G8 | **App signing** | NEEDS-TARA | Local release builds are signed with the checked-in `debug.keystore` (`android/app/build.gradle:112-115`) — installable, NOT uploadable. Turn on Play App Signing (default), let EAS generate/hold the upload key (`eas build -p android --profile production`). |
| G9 | **Adaptive icon** | PASS | foreground / background / monochrome (`app.json` `android.adaptiveIcon`), 1024×1024. Play Console needs a separate 512×512 32-bit PNG icon (export from `assets/icon.png`). |
| G10 | **Content rating (IARC)** | NEEDS-TARA | Answers in §4.4 → expected **Everyone**. |
| G11 | **Target audience / age** | NEEDS-TARA | 18+ only (or 13+); NOT "designed for children". Avoid the Families policy entirely. |
| G12 | **News / Financial / Health / Government declarations** | NEEDS-TARA | All **No**. |
| G13 | **Ads declaration** | NEEDS-TARA | **No ads.** No ad SDK in the binary (A16). |
| G14 | **App access (reviewer credentials)** | NEEDS-TARA | "All or some functionality is restricted" → provide the same reviewer email+password as A2 (must be reusable, not behind 2FA/OTP — email+password on Clerk is fine; email-code sign-in would fail their rule). |
| G15 | **64-bit** | PASS | `native-code: arm64-v8a armeabi-v7a x86 x86_64` (badging). |
| G16 | **16 KB page size** (required for new apps targeting 15+ since Nov 2025) | PASS | `zipalign -c -P 16 -v 4 app-release.apk` → all `.so` aligned (§3). RN 0.86 + AGP defaults. |
| G17 | **App bundle (.aab)** | PASS (config) | `eas.json` `production.android.buildType: "app-bundle"`. Local `assembleRelease` makes an APK for QA only. |
| G18 | **Photo & Video Permissions policy** | PASS | No `READ_MEDIA_*`; system picker (G6). |
| G19 | **Edge-to-edge (Android 16 enforces)** | PASS | `edgeToEdgeEnabled=true` (`android/gradle.properties`); tab bar and sheets already inset (§3 screenshots). |

### 1.3 Both stores

| # | Item | Status | Evidence / notes |
| --- | --- | --- | --- |
| B1 | Privacy + Terms pages exist | PASS | `https://www.bookmark-ai.cloud/privacy` and `/terms` → 200 `text/html` (apex too). Public routes in `apps/web/middleware.ts:13-19`. |
| B2 | Linked from inside the app | **FIXED** | `10549f2` (Settings) + `c4ecfe1` (sign-in consent line). |
| B3 | **Support URL / email** | **NEEDS-TARA** | At audit time, the now-superseded mailbox was in the app and `/support` returned 404. The 2026-09-19 continuity note above records the later local implementation and recovered deployment history. Use `admin@bookmark-ai.cloud` and `https://www.bookmark-ai.cloud/support` for every new listing; live reachability still needs a current check before submission. |
| B4 | Update banner vs prod's current 404 on `/api/app/releases` | PASS | Prod returns a **404 HTML page** until the next deploy (curl, §3). `src/api.ts:324-333` throws on `!res.ok` before touching the body (a JSON parse of HTML never happens), `src/hooks/useAppUpdate.ts:86-97` swallows every failure ("silent by contract"). Observed: both Release builds ran ≥ 90 s against prod with no banner, no red screen, no `ReactNativeJS` errors (§3). |
| B5 | Marketing URL | NEEDS-TARA | `https://www.bookmark-ai.cloud` (public, 200). |

### 1.4 FAIL list (what still blocks or needs a decision)

1. **Apple 4.8 — Sign in with Apple. DECIDED (Tara, 2026-09-07): Option A, keep Google + email/password. CODE DONE — see the commit `feat(mobile): native Sign in with Apple on iOS via @clerk/expo`.** What shipped, what was verified, and what is still on Tara:

   **Shipped in `apps/mobile` (one commit, not pushed):**
   - `@clerk/clerk-expo` 2.19.31 → **`@clerk/expo` 4.6.5** (Clerk renamed the package with Core 3; `@clerk/clerk-expo` is deprecated, LTS until Jan 2027 — [migration article](https://clerk.com/articles/migrating-from-clerk-clerk-expo-to-clerk-expo-breaking-changes-native-components)). Peer range `expo >=54 <58` covers SDK 57. The screens keep the Core 2 resource API through **`@clerk/expo/legacy`** (`useSignIn`/`useSignUp`: `signIn.create` / `attemptFirstFactor` / `setActive`) — the main entry's `useSignIn` is the redesigned Core 3 object (`signIn.password()`, `finalize()`), a rewrite of every QA'd flow for no user-visible gain; Clerk's own stable `useSSO` and `useSignInWithApple` are built on the legacy hooks too. `useSSO` in 4.6.5 is the same sequence as 2.19.31 (`signIn.create({strategy, redirectUrl})` → `openAuthSessionAsync` → `signIn.reload({rotatingTokenNonce})`, no auto-activation — verified in `dist/hooks/useSSO.js`), so the Google flow and `useFinishPendingSession` are unchanged; `useAuth`/`useClerk`/`useUser`/`ClerkProvider`/`TokenCache` moved to the `@clerk/expo` import. `publishableKey` is now a required prop (we always passed it).
   - **`@clerk/expo`'s native module is excluded from autolinking** (`apps/mobile/package.json` → `expo.autolinking.exclude`). 4.x ships `ClerkExpo` (SwiftUI/Compose `AuthView`/`UserButton`, biometrics) whose podspec requires **iOS 17.0** and pulls `clerk-ios` 1.5.2 via SPM, and on Android `clerk-android-ui` 1.1.5 + Compose with a Kotlin metadata-version hack. Nothing here uses it; excluding it keeps the iOS 16.4 floor and both binaries as they were. `requireOptionalNativeModule` makes the JS side no-op without it (checked `dist/utils/native-module.js`, `dist/provider/nativeClientSync.js`). Verified: `npx expo-modules-autolinking resolve --platform apple|android` lists no Clerk module; `ios/Podfile.lock` has no `ClerkExpo`; `IPHONEOS_DEPLOYMENT_TARGET` still 16.4. Do NOT add the `@clerk/expo` config plugin unless you also remove the exclusion and accept iOS 17.
   - **`expo-apple-authentication` 57.0.1** (+ `expo-crypto` 57.0.1, already present) with the `"expo-apple-authentication"` plugin and `ios.usesAppleSignIn: true` in `app.json` → `com.apple.developer.applesignin = [Default]` in `ios/BookmarkAI/BookmarkAI.entitlements` (verified after `expo prebuild --clean --platform ios`; the plugin also sets `CFBundleAllowMixedLocalizations` so the button localises). Android untouched: no Apple button (`offersAppleSignIn(Platform.OS)`), no manifest/gradle change.
   - **Sign-in screen** (`src/screens/SignInScreen.tsx`): Apple's `AppleAuthenticationButton` (`ASAuthorizationAppleIDButton` — Apple-approved title/logo/colours), `CONTINUE` type, `BLACK` on light / `WHITE` on dark, `cornerRadius = radius.lg` (10), height 50 — every full-width button on the screen now shares `AUTH_BUTTON_HEIGHT = 50`, so Apple and Google are the same size, Apple ABOVE Google. Wired to `useSignInWithApple().startAppleAuthenticationFlow()` (Apple sheet → identity token → Clerk `signUp.create({strategy: "oauth_token_apple", token})`, transfer handled inside the hook). Post-flow: same activation as Google, first-sign-up completion (`missing_requirements` with nothing missing → `signUp.update({})`), SILENT cancel (the hook swallows `ERR_REQUEST_CANCELED`), everything else a message. Pure decisions in **`src/lib/appleSignIn.ts`** (`resolveAppleFlow`, `describeAppleSignInError`, `appleButtonStyle`, `offersAppleSignIn`, `hasAppleAccount`) with **13 tests** (`appleSignIn.test.ts`; suite 89 → **102**, `pnpm --filter @bookmark-ai/mobile test`; `check-types` clean). Email/password, email code, forgot-password and the consent line are unchanged.
   - **Account deletion** (A9): revocation is not possible from our side; `DeleteAccountSheet` gets a `signedInWithApple` footnote with the manual Settings path (TN3194 fallback). Details in A9.
   - `apps/mobile/README.md` "Signing in" documents all of the above.

   **Verified (2026-09-07, screenshots in `/private/tmp/claude-501/-Users-tara-Developer-bookmark-ai/0945f608-b009-4084-9c9c-c0d3261adc8c/scratchpad/mobile-apple/`):** Debug build on a NEW simulator "BookmarkAI QA iPhone 17" (iOS 26.5, created for this — Tara's two signed-in simulators untouched) against the local dev server + dev Clerk instance: `01-signin-light.png` / `02-signin-dark.png` (Apple button present, black on light / white on dark, same height and radius as Google, above it; the rest of the screen unchanged). Release configuration with the production target (`EXPO_PUBLIC_SERVER_TARGET=production npx expo run:ios --configuration Release`) compiles (`run-ios-release-prod.log`). **The Apple sheet / token exchange was deliberately NOT exercised** — Tara decided (2026-09-07) to test Sign in with Apple on PRODUCTION herself now that the Developer Program subscription is bought. The dev Clerk instance does have the Apple connection (shared dev credentials) AND the iOS app under *Native applications* (App ID prefix `L3PP7DQZWS`, bundle `ai.bookmarkai`, added 2026-09-07), so a local-target build can be used for that test too.

   **Still on Tara (both needed before the feature works for a real user):**
   - **Apple Developer portal** (after enrolment lands): Certificates, Identifiers & Profiles → Identifiers → App ID `ai.bookmarkai` → enable the **Sign in with Apple** capability (leave the appex App ID `ai.bookmarkai.ShareExtension` without it). A device build with the `applesignin` entitlement needs a provisioning profile from the PAID team — free personal teams cannot carry the capability, which is why no device build was attempted here; the first EAS/Xcode device build will mint it. (The Xcode *simulator* build did not need any of this.) Optional, only for Apple login on the WEB: a Services ID + Sign in with Apple key (`.p8`) — the native app flow does not use them.
   - **Clerk Dashboard, PRODUCTION instance** (`clerk.bookmark-ai.cloud`): (1) Configure → SSO connections → **Apple** → enable for sign-up and sign-in; production instances require CUSTOM credentials on the connection — Apple Services ID, Team ID (`L3PP7DQZWS`), Key ID and the `.p8` private key — even though the native token flow itself only checks the identity token (Clerk will not let the connection exist without them). Also set the **Email Source** domain Apple's Private Email Relay needs (Clerk shows the `bounces+…@clkmail.…` value; register it in the Apple portal under Services → Sign in with Apple for Email Communication) or "Hide My Email" users cannot receive Clerk's emails. (2) Configure → **Native applications** → add iOS app: App ID Prefix `L3PP7DQZWS`, Bundle ID `ai.bookmarkai` (Clerk auto-adds `ai.bookmarkai://callback` to the mobile redirect allowlist — harmless). Native API must be enabled (it already is on prod). Until (2) is done the prod app will show the button and Clerk will reject the token.
   - **Clerk Dashboard, DEV instance**: done 2026-09-07 (Apple connection with shared credentials + Native applications entry).
   - **Real-device test** once the profile exists: tap Continue with Apple with a real Apple ID (first time = name/email consent, "Hide My Email" variant too), confirm the account lands in the dev instance and the app signs in; then the same on a prod-target build after the prod steps. Also re-check A9's footnote appears in Delete Account for that user.
   - **App Review notes**: state "Sign in with Apple is offered natively on iOS alongside Google and email" (§4.1 placeholder).

   Options B (web OAuth Apple) and C (hide Google on iOS) are superseded by the decision above and kept only for the record: B = `startSSOFlow({ strategy: "oauth_apple" })`, browser sheet, needs the same prod credentials; C = `OAUTH_ENABLED = Platform.OS !== "ios"`, 15 minutes, loses Google on iOS.
2. **Privacy policy content** (A6) and **Play deletion anchor** (G5) — web copy edits + one deploy. Drafts in §4.5.
3. **Public support page** (B3) — one page + deploy, or the GitHub Issues URL once public.
4. **Reviewer account** (A2/G14) and the **allowlist decision** (store-release.md §7.4).
5. **RISK: SDWebImage without a privacy manifest** (A14) — nothing to do until the first upload; the fix is a one-line build property if ITMS-91061 fires.

### 1.5 Counts

PASS 33 · FIXED 7 (5 commits; 4.8 code landed 2026-09-07) · FAIL 0 (4.8's remaining pieces are portal/dashboard work → NEEDS-TARA) · NEEDS-TARA 18 · RISK 1 · INFO 1.

---

## 2. What only Tara can do — in order

| # | Action | Cost | Lead time | Notes |
| --- | --- | --- | --- | --- |
| 1 | ~~Decide the 4.8 path~~ **Decided 2026-09-07: Option A (native Sign in with Apple, keep Google + email). Code shipped — see §1.4 #1.** | — | — | iOS now waits only on enrolment for the entitlement-carrying device build. |
| 2 | **Enroll in the Apple Developer Program** (Individual; no D-U-N-S needed) at developer.apple.com/programs/enroll or via the Apple Developer app. | **$99/yr** | Apple says 24–48 h; individuals in 2026 report 2–7+ weeks when identity verification stalls — start now. | Organization accounts need a D-U-N-S number (free, ~5 business days) — only worth it if you want "PureCode" as the seller name instead of your personal name. |
| 3 | **App Store Connect**: create the app record — bundle id `ai.bookmarkai`, name "Bookmark AI", SKU `bookmark-ai-ios`, primary language English (U.S.). Register the appex App ID `ai.bookmarkai.ShareExtension`; both App IDs need *App Groups* → `group.ai.bookmarkai`. Note the numeric Apple ID → `eas.json` `submit.production.ios.ascAppId`; fill `appleId` + `appleTeamId` (`L3PP7DQZWS`). Create an App Store Connect **API key** (`.p8`) for non-interactive `eas submit`. | — | minutes | store-release.md §7.2. |
| 4 | **Sign in with Apple setup — the code is DONE (§1.4 #1); left: Apple portal capability on the App ID, prod Clerk Apple connection (custom credentials) + Native applications entry, a real-device test.** | — | 1–2 h portal/dashboard + a device build | Revocation on deletion (A9): not possible with Clerk's token-only flow — the app shows the manual Settings path per TN3194; a full implementation is scoped in A9 if a reviewer ever insists. |
| 5 | **EAS**: `npm i -g eas-cli && eas login && cd apps/mobile && eas init` (commit the `app.json` change). First `eas build -p ios --profile production` mints the distribution cert + two profiles. | free tier OK | 20–40 min per build | store-release.md §7.1. |
| 6 | **Reviewer account**: create `review@…` (or an alias you own) on the prod Clerk instance with email + password; seed it with ~10 bookmarks and one saved session so the reviewer sees a real library. Add its user id to `CLERK_ALLOWED_USER_IDS` if you lock the allowlist. Paste credentials into App Store Connect → App Review Information and Play Console → App access. | — | 15 min | Google requires credentials that bypass OTP — use password, not the email code. |
| 7 | **Web copy + deploy** (§4.5): privacy policy additions with `id="delete-account"`, `/support` page. `vercel deploy --prod` from the repo root. | — | 30 min | Also fixes the `/api/app/releases` 404 (the route is already in `main`). |
| 8 | **App Privacy label + age rating + metadata** in App Store Connect (§4.1, §4.3), screenshots (§5). Submit to TestFlight first (internal testing needs no review) and install on your iPhone 14 Pro Max — the real-device checks in §6. | — | Upload processing 10–15 min; App Review 1.5 days avg, new apps 2–5 days in 2026. | |
| 9 | **Google Play Console**: register (personal account), identity verification. | **$25 one-time** | Verification hours–2 business days. | |
| 10 | **Play app record** + store listing (§4.2), Data safety (§4.4), content rating, target audience, App access, declarations. Create the service account JSON → `apps/mobile/credentials/play-service-account.json` (gitignored). `eas build -p android --profile production` (AAB, EAS upload key) → `eas submit` to the **internal** track first. | — | 1 h | store-release.md §7.3. |
| 11 | **Closed testing**: create a closed track, add ≥ 12 testers (an email list or a Google Group), get them all opted in, keep them opted in for **14 consecutive days**, then *Apply for production access* on the dashboard and answer the questionnaire. | — | **≥ 14 days + Google's review of the application (days)** | The 14-day clock restarts if you drop below 12 opted-in testers. Hint: the same testers can double as TestFlight external testers. |
| 12 | **Production release** on Play → first review of a new developer's app: 7–14 days is normal in 2026. | — | 1–2 weeks | |

**Realistic calendar:** Apple — enrolment (days–weeks) → TestFlight the same day the account is live → App Review 2–5 days. Google — $25 + verification (≤ 2 days) → internal test same day → closed test ≥ 14 days → production application → review 1–2 weeks: **~4–5 weeks to public on Play**, starting the day you pay.

---

## 3. Release-configuration test (what dev runs cannot show)

Both builds were made with `EXPO_PUBLIC_SERVER_TARGET=production` (also the `__DEV__ === false` default) — embedded bundle, app scheme, **prod Clerk instance + prod API** — on this Mac, 2026-09-07. Artifacts and screenshots: `/private/tmp/claude-501/-Users-tara-Developer-bookmark-ai/0945f608-b009-4084-9c9c-c0d3261adc8c/scratchpad/mobile-store-audit/` (`BookmarkAI-prod-release.app`, `app-release-prod.apk`, `*.png`, `*-build.log`).

### iOS — `expo run:ios --configuration Release --no-bundler`, iPhone 17 simulator (iOS 26.5)

- Build: **Build Succeeded, 0 errors, 11 warnings** (`ios-release-build.log`). Installed and opened.
- Built artifact checks: `CFBundleShortVersionString 1.0.0`, `CFBundleVersion 1`, `MinimumOSVersion 16.4`, `ITSAppUsesNonExemptEncryption false`, `NSFaceIDUsageDescription` = new specific string; `main.jsbundle` is Hermes bytecode (magic `c61fbc03`) and contains `www.bookmark-ai.cloud` and the `pk_live_…` key; privacy manifests present for the app, appex, React-Core, React-cxxreact, React-timing, ExpoConstants, ExpoApplication, RNCAsyncStorage, folly/glog/boost. **Missing for `SDWebImage.framework` and `hermesvm.framework`** (A14).
- Cold launch (`simctl terminate` → `launch`): **0.6 s** native splash with the bookmark mark (`ios-01-cold-launch-0.6s.png`), **2 s** sign-in screen fully rendered (`ios-02-after-2s.png`), **6 s** unchanged and stable (`ios-03-after-6s.png`) — splash released promptly, no hang. The app rendered DARK while the simulator was light: that is the persisted theme preference (`bookmark-ai:theme: "dark"` in the shared AsyncStorage container left by earlier dev sessions), not a bug — a fresh install follows the system.
- Sign-in screen: "Continue with Google", email + password, "Forgot password?", "Email me a code instead" — all present; **no Server row, no dev banner, no "Developer session" footnote**. The final build adds the consent line with Terms/Privacy links (`ios-local-00-state.png` shows it on the local-target Release build; final prod-target screenshot `ios-final-*.png`).
- Update banner: prod `/api/app/releases` → 404 HTML at test time. No banner, no error. Process still alive after 100 s (`ps`), unified log for the PID shows no faults/exceptions (only Apple's `UIScene` runtime notice, A25).
- **Signed-in Settings on iOS Release: NOT exercised.** Signing in on prod needs a real prod account (none was created, per instructions); a Release build against the LOCAL target (dev Clerk, embedded bundle) was built and launched to do it, but headless input into the iOS Simulator did not land (synthesized CGEvent taps/keystrokes were ignored — `ios-local-02-filled.png` shows empty fields), so the Settings screen was verified in Release configuration on **Android only** (below). The Settings code is platform-shared JS; the iOS Symbol names used (`info.circle`, `hand.raised`, `envelope`) are valid SF Symbols on iOS 16+. A 2-minute manual check on the iPhone (Settings → Legal & Support) is owed before submission — listed in §6.
- iPad Pro 13" (M4) simulator: the same prod Release `.app` installed and launched (`ipad-01-signin-portrait.png`, 2064×2752). Sign-in rendered; the edge-to-edge form was capped at 440 pt in `2241ddb` (re-verify on the final build: `ipad-final-*.png`).

### Android — `expo run:android --variant release --no-bundler`, AVD `bookmark_pixel` (Pixel 8, API 36)

- Build: **BUILD SUCCESSFUL in 4m 18s**, 404 tasks (`android-release-build.log`). Installed and opened. 75.7 MB APK, debug-keystore signed (QA only, G8).
- Built artifact checks (`aapt2 dump badging`): `versionCode 1`, `versionName 1.0.0`, `targetSdkVersion 36`, `compileSdkVersion 36`, permissions as in G6, 4 ABIs, `application-debuggable` absent; merged release manifest has no `usesCleartextTraffic`; `zipalign -P 16` PASS (G16).
- Cold launch (`am force-stop` → `am start -W`): **TotalTime 788 ms** to first frame; **0.3 s** splash twin with spinner (`android-01-cold-launch.png`), **2 s / 6 s** sign-in screen, light theme, stable (`android-02-after-2s.png`, `android-03-after-6s.png`). `logcat`: `ReactNativeJS: Running "main"` and nothing else — no `AndroidRuntime`/`FATAL`/JS errors. Update banner: none, silent, as on iOS.
- **Settings verified in Release configuration** (Release variant, embedded bundle, pointed at the LOCAL target so a dev-instance test account could sign in — `storeqa+clerk_test@example.com`, OTP-less test email; created on the DEV Clerk instance only): Settings → **About: Open web app, Version 1.0.0 (1) — no Server row** (`android-local-05-settings-bottom.png`); **Legal & Support: Privacy Policy, Terms of Service, Contact Support showed the now-superseded mailbox** (`android-local-10-settings-icons.png`, icons rendering after `2241ddb`; the current source uses `admin@bookmark-ai.cloud`); **Account: Sign Out, Delete Account + footnote** (`android-local-06-settings-account.png`). Tapping Privacy Policy opened a Chrome Custom Tab on `bookmark-ai.cloud/privacy` (`android-local-07-privacy-customtab.png`; `topResumedActivity = CustomTabActivity`), Back returned to Settings (`android-local-08-back-in-settings.png`).
- Side observation from that run: the Ask AI group showed "fetch failed: CLEARTEXT communication to 10.0.2.2 not permitted by network security policy" — the expected proof that release builds refuse http (G7); a shipped build never targets 10.0.2.2.

### Final artifacts (all four commits, production target)

- **iOS** (`ios-release-final-build.log`: Build Succeeded, 0 errors, 1 warning; `BookmarkAI-final-release.app` in the scratch dir). Cold launch on iPhone 17: splash 0.6 s → sign-in at 2 s with the consent line → unchanged at 7 s (`ios-final-01…03.png`); process alive; per-PID log shows only CoreUI theme-store noise, no faults. **iPad Pro 13" (M4)**: `ipad-final-01-signin-portrait.png` — the form is now a centred 440 pt column. That screenshot also shows the system "BookmarkAI Wants to Use google.com to Sign In" sheet: the Google button had been activated on the iPad (most likely a stray synthesized tap from the failed iOS automation attempt — not reproduced, not investigated further). It does show the SSO path reaching `ASWebAuthenticationSession` on iPad with the prod Clerk instance; it was not continued (no account).
- **Android** (`android-release-final-build2.log`: BUILD SUCCESSFUL in 28 s after a forced re-bundle; `app-release-final.apk`). Cold launch on Pixel 8: `TotalTime 1516 ms`, splash → sign-in with consent line, light theme, stable at 7 s (`android-final-01…03.png`); `logcat`: only `ReactNativeJS: Running "main"`, no exceptions from the app.
- **Gotcha found while doing this — write it down:** Gradle's `:app:createBundleReleaseJsAndAssets` does NOT take `EXPO_PUBLIC_*` environment variables as task inputs. Switching `EXPO_PUBLIC_SERVER_TARGET` (or `EXPO_PUBLIC_INITIAL_TAB`) between two local release builds without a source change leaves the task `UP-TO-DATE` and **ships the previous bundle** (`android-release-final-build.log` shows exactly that). Force it with `rm -rf android/app/build/generated/assets/createBundleReleaseJsAndAssets` (or `./gradlew :app:createBundleReleaseJsAndAssets --rerun`) before trusting a local Android release build. iOS re-runs its bundle phase every build, so it is not affected. EAS builds are clean builds, so the store artifact is not affected either.

---

## 4. Store metadata pack (paste-ready)

### 4.1 App Store Connect

| Field | Value |
| --- | --- |
| Name (≤30) | `Bookmark AI` |
| Subtitle (≤30) | `Save links. Ask your library.` |
| Primary category | Productivity |
| Secondary category | Utilities |
| Bundle ID | `ai.bookmarkai` |
| SKU | `bookmark-ai-ios` |
| Price | Free (no IAP) |
| Support URL | `https://www.bookmark-ai.cloud/support` (after §4.5) — fallback `https://github.com/Tarachand-Gupta/bookmark-ai/issues` once public |
| Marketing URL | `https://www.bookmark-ai.cloud` |
| Privacy Policy URL | `https://www.bookmark-ai.cloud/privacy` |
| Copyright | `© 2026 Tarachand Gupta` |
| Promotional text (≤170) | `Every link you save, searchable by meaning — and an AI that answers from your own library. Share from Safari, find it later on any device.` |
| Keywords (≤100 chars) | `bookmarks,read later,save links,tabs,session,AI search,reading list,web clipper,sync,library` |
| Description | see below |
| What's New (1.0.0) | `First release.` |
| Review notes | see below |

**Description**

```
Bookmark AI is the place your links go so you can actually find them again.

SAVE FROM ANYWHERE
Tap Share in Safari or any app → "Save to Bookmark AI". The page title, description and preview image are fetched for you, and every link is categorised and tagged automatically.

SEARCH BY MEANING
Type what you remember — "that article about Rust error handling" — and get the right link even when the words don't match. Text search and AI search blend into one result list.

ASK YOUR LIBRARY
Ask AI answers questions using only your own bookmarks and saved sessions, with the sources it used. Attach a photo or a document to ask about it.

SESSIONS AND LIVE TABS
Save a whole browser window as a session with the Bookmark AI browser extension, and see the tabs currently open on your desktop from your phone.

ONE LIBRARY, EVERY DEVICE
iPhone, iPad, the web app at bookmark-ai.cloud, and the Chrome/Firefox/Safari extension share one account and one library.

PRIVATE BY DESIGN
Your data lives in your own isolated database. No ads, no tracking, no selling your data — and you can export everything or delete your account from Settings at any time.

Bookmark AI is open source. The free plan includes unlimited bookmarks and sessions and 1,000 AI credits a week, or bring your own AI provider key for unmetered AI.
```

**Notes for App Review**

```
Bookmark AI is a personal bookmark manager. An account is required because the whole product is the user's own synced library (bookmarks, saved browser sessions, live tabs, and an AI assistant that answers only from that library).

Reviewer account (email + password — please don't use Google sign-in):
  Email:    <fill in>
  Password: <fill in>
It is pre-loaded with a few bookmarks and one saved session.

Account deletion: Home → gear (Settings) → Account → Delete Account → type DELETE → Delete My Account. This deletes the account and all of its data server-side.

Share extension: in Safari, Share → "Save to Bookmark AI" saves the current page.

AI: saved links are categorised with Google Gemini; "Ask AI" sends the question (and any photo/file the user attaches) to our server, which calls Gemini. Disclosed in the privacy policy, linked on the sign-in screen and in Settings → Legal & Support.

No in-app purchases, no ads, no tracking. Sign in with Apple: <state Option A/B/C outcome here>.
```

### 4.2 Google Play Console

| Field | Value |
| --- | --- |
| App name (≤30) | `Bookmark AI` |
| Short description (≤80) | `Save links from any app, search them by meaning, and ask AI about your library.` |
| Full description (≤4000) | reuse the App Store description above, replacing the SAVE FROM ANYWHERE paragraph's first sentence with: `Tap Share in Chrome or any app → "Save to Bookmark AI".` and "iPhone, iPad" with "Android, iPhone, iPad". |
| App category | Productivity |
| Tags | Bookmarks, Read later, Productivity |
| Email (public) | `admin@bookmark-ai.cloud` |
| Website | `https://www.bookmark-ai.cloud` |
| Privacy policy | `https://www.bookmark-ai.cloud/privacy` |
| Contains ads | No |
| App access | "All or some functionality is restricted" → add the reviewer email + password (A2); instructions: "Sign in with the email and password above (do not use Google). Settings is the gear on Home." |
| Target audience | 18 and over (or 13+); do not select any under-13 group |
| News app | No · Financial features: No · Health: No · Government: No |
| Data safety | §4.4 |
| Content rating | §4.4 |
| Store listing contact | `admin@bookmark-ai.cloud` |

### 4.3 Apple — App Privacy label + age rating answers

**Does the app collect data?** Yes.

| Data type (App Store Connect name) | Collected | Linked to user | Used for tracking | Purpose |
| --- | --- | --- | --- | --- |
| Contact Info → **Email Address** | Yes | Yes | No | App Functionality (account) |
| Contact Info → **Name** | Yes (when Google/Apple sign-in supplies it) | Yes | No | App Functionality |
| Identifiers → **User ID** | Yes (Clerk user id keys the tenant DB) | Yes | No | App Functionality |
| **Browsing History** | Yes — saved bookmark URLs/titles, saved tab sessions, live tabs mirrored from the desktop extension | Yes | No | App Functionality |
| User Content → **Other User Content** | Yes — Ask AI messages/conversations, tags | Yes | No | App Functionality |
| User Content → **Photos or Videos** | Yes — only photos the user attaches to an Ask AI question | Yes | No | App Functionality |
| User Content → **Other Data Types**: device type/name + OS attached to each save (`src/api.ts:38-48`) | Yes | Yes | No | App Functionality |
| Search History | **No** — search queries are processed to answer the request and not stored (ephemeral; excluded by Apple's definition) |
| Usage Data / Diagnostics / Crash Data | **No** — no analytics or crash SDK |
| Location, Contacts, Health, Financial, Sensitive Info, Purchases, Advertising Data | No |

Tracking (ATT): **No**. Privacy nutrition "Data Linked to You": all of the above. Third-party processors to name in the policy (not on the label): Clerk, Turso, Google Gemini, Langfuse, Vercel.

**Age rating questionnaire (new format)** — every content question (violence, sexual content, profanity, horror, alcohol/tobacco/drugs, gambling, medical/treatment info, contests) → **None**. Unrestricted Web Access → **No** (links open in the system browser). Made for Kids → No. Gambling → No. Social media / user-to-user communication → No. Parental controls / in-app controls → N/A. Expected result: **4+**.

**Export compliance**: answered in the binary (`ITSAppUsesNonExemptEncryption=false`) — no questions on upload.

### 4.4 Google — Data safety + content rating answers

**Data collection and security**: Collects data → **Yes**. All user data encrypted in transit → **Yes** (HTTPS only; cleartext blocked in release). Provides a way to request deletion → **Yes** (in-app + the web link from G5). Committed to the Families policy → No. Independent security review → No.

| Data type | Collected | Shared | Ephemeral | Required/optional | Purpose |
| --- | --- | --- | --- | --- | --- |
| Personal info → **Email address** | Yes | No* | No | Required | Account management, App functionality |
| Personal info → **Name** | Yes | No* | No | Optional (only via Google/Apple sign-in) | Account management |
| Personal info → **User IDs** | Yes | No* | No | Required | Account management, App functionality |
| **Web browsing history** | Yes (saved bookmark URLs/titles, saved tab sessions, live tabs) | No* | No | Required — it is the product | App functionality |
| App activity → **Other user-generated content** | Yes (Ask AI messages, tags) | No* | No | Optional | App functionality |
| Photos and videos → **Photos** | Yes (only when attached to an Ask AI question) | No* | No | Optional | App functionality |
| Files and docs | Yes (only when attached to an Ask AI question) | No* | No | Optional | App functionality |
| Device or other IDs | **No** (no advertising/device IDs; "iPhone/Android + OS" is not an identifier) |
| App info and performance (crash logs, diagnostics) | **No** |
| Location, Contacts, Calendar, Financial, Health, Messages, Audio, Installed apps | No |

\* "Shared" in Google's definition excludes service providers processing on your behalf (Clerk, Turso, Gemini, Langfuse, Vercel) — answer **No** to sharing, but the privacy policy must name them (A6).

**Content rating (IARC) questionnaire** — category: **Utility, Productivity, Communication, or Other**. Violence/sex/language/controlled substances/gambling → No. User-generated content shared with others → **No** (a user's library is private to that user). Users can communicate with each other → No. Shares location → No. Purchases digital goods → No. Contains ads → No. Unrestricted internet access (in-app browser) → **No** (system browser). Expected: **Everyone / PEGI 3**.

### 4.5 Web copy to add (Tara approves + deploys)

**`apps/web/app/privacy/page.tsx` — "What we collect" bullets, add:**

> **What you ask the AI** — questions you type into Ask AI, and any photos or files you attach to them, are sent to our server and to the AI provider to produce the answer, and are stored with the conversation so you can come back to it. Delete a conversation to remove it.
>
> **Device context** — the browser or device a bookmark was saved from (for example "Chrome", "iPhone", "Android") and its operating system, so your library can show where something came from. No advertising identifiers, no location.

**"We don't sell your data" list, add:**

> **Langfuse** — records the AI requests and responses (including your questions and the AI's answers) so we can debug and improve the assistant. Hosted in the United States.
>
> **Vercel** — hosts the web app and API.

**"Your control" section — replace with (anchor for Play's Data safety deletion link):**

```tsx
<section id="delete-account" className="space-y-3">
  <h2 …>Your control: export and delete your account</h2>
  <p>Export a complete copy of everything you've saved at any time from Settings → Data in the web app.</p>
  <p>To permanently delete your Bookmark AI account and all of its data (bookmarks, sessions, AI conversations and your sign-in):</p>
  <ul>
    <li><b>In the iOS or Android app</b>: Home → gear (Settings) → Account → Delete Account → type DELETE.</li>
    <li><b>On the web</b>: sign in at bookmark-ai.cloud → Settings → Account → Delete account.</li>
    <li><b>By email</b>: write to admin@bookmark-ai.cloud from the address on your account and we will delete it within 30 days.</li>
  </ul>
  <p>Deletion is immediate and irreversible. Deleting the app alone does not delete your account.</p>
</section>
```

Also: "Last updated September 2026", a **Retention** line ("We keep your data until you delete it or your account; server backups age out within 30 days.") and a **Contact** line (`admin@bookmark-ai.cloud`). Then the Play deletion URL is `https://www.bookmark-ai.cloud/privacy#delete-account`.

**New `apps/web/app/support/page.tsx`** (add `"/support"` to `isPublicRoute` in `apps/web/middleware.ts:13-19`):

> # Support
> Bookmark AI is made by Tarachand Gupta. Email **admin@bookmark-ai.cloud** — replies within two business days. Include the app version from Settings → About.
> Common questions: *How do I save a page?* (Share → Save to Bookmark AI) · *How do I delete my account?* (link to `/privacy#delete-account`) · *Where's the browser extension?* (links) · *Is it open source?* (GitHub link).

---

## 5. Screenshots — sizes and which devices produce them

**App Store** ([spec](https://developer.apple.com/help/app-store-connect/reference/screenshot-specifications/)) — 1–10 per size, PNG/JPEG, no alpha. Only the largest size in each family is required; Apple scales down.

| Required | Size | Simulator on this Mac | Command |
| --- | --- | --- | --- |
| iPhone 6.9" — **required** | 1320 × 2868 portrait | `iPhone 17 Pro Max` (installed, iOS 26.5) | `xcrun simctl boot "iPhone 17 Pro Max"; xcrun simctl install booted <Release .app>; xcrun simctl launch booted ai.bookmarkai; xcrun simctl io booted screenshot 01.png` |
| iPhone 6.5" — required only if 6.9" absent | 1284 × 2778 | none installed (iPhone 11 Pro Max class) — skip, Apple scales |
| iPad 13" — **required** (app declares iPad) | 2064 × 2752 portrait | `iPad Pro 13-inch (M4)` or `(M5)` (installed) | same, with the iPad UDID |

Use `EXPO_PUBLIC_INITIAL_TAB=home|library|sessions|search|chat|settings` at build time to land on each tab without tapping; sign in with the reviewer account against prod so the library is real. Suggested set (6): Home, Library, Ask AI answer with sources, Search results, Sessions/Live, Share sheet "Save to Bookmark AI".

**Google Play** ([spec](https://support.google.com/googleplay/android-developer/answer/9866151)):

| Asset | Rule | Device |
| --- | --- | --- |
| App icon | 512 × 512, 32-bit PNG | export from `assets/icon.png` (`sips -Z 512`) |
| Feature graphic — **required** | 1024 × 500 JPEG/PNG, no alpha | design (wordmark + tagline on the neutral background); no source exists yet |
| Phone screenshots — **min 2**, up to 8 | 320–3840 px per side, **long side ≤ 2× short side**; for promotion eligibility ≥ 4 shots at 1080 min with 9:16 | The Pixel 8 AVD `bookmark_pixel` is **1080 × 2400 (2.22:1) → rejected as-is**. Either crop to 1080 × 2160 (2:1) / pad to 1080 × 1920 (9:16), or create a 1080 × 1920 AVD (e.g. "Pixel 2", API 36): `avdmanager create avd -n bookmark_169 -k "system-images;android-36;google_apis;arm64-v8a" -d pixel_2`. Capture: `adb exec-out screencap -p > 01.png`. |
| 7" tablet | ≥ 4 recommended, 1080–7680 px, 16:9 or 9:16 | create AVD "Nexus 7" (1200 × 1920) |
| 10" tablet | same | create AVD "Pixel Tablet" (2560 × 1600) — landscape 16:10; pad to 16:9 if you want promotion eligibility |

Same tab set as iOS. Play also wants the listing in light AND dark? No — one set is fine; light is the safer default.

---

## 6. What could ONLY be verified on physical devices or with the paid accounts

- **Real Google sign-in round trip on a device** (ASWebAuthenticationSession / Custom Tab → `bookmarkai://sso-callback`), including the "Finishing sign-in…" recovery path — simulators stop at the Google consent page (no test account used, per instructions).
- **Signed-in Settings screen on iOS in Release** (Legal & Support rows, Privacy Policy sheet, Contact Support mail composer) — headless input into the iOS Simulator failed; verified on Android Release only. 2-minute manual check on the iPhone.
- **Share sheet placement** and the appex's App Group hand-off on a real iPhone/iPad (the appex runs on simulator, but the share sheet ordering and Safari's "Save to Bookmark AI" position are device-only).
- **Sign in with Apple** end to end — the token exchange with Clerk and the first-time name/email consent (a device with a real Apple ID, or a simulator signed in to one; no Apple ID credentials may be entered by an agent). Simulator builds with the entitlement did NOT need code-signing changes (verified 2026-09-07); a DEVICE build does need the paid team's provisioning profile.
- **ITMS-91053 / ITMS-91061 privacy-manifest verdicts** (A13/A14) — only App Store Connect's upload scanner can rule; check the email after the first TestFlight upload.
- **Play App Signing / upload-key path**, AAB size and the Play pre-launch report (crawls the app on real Firebase devices) — needs the console.
- **Face ID / biometric prompt behaviour** — never triggered by the app; only a device can prove the string is never shown.
- **Cold start on a phone over cellular** (the 1.5 s splash ceiling and Clerk's cold FAPI round trip) — simulator timings (≈0.8–2 s) are optimistic.
- **iPad landscape / Split View** layouts on hardware, and the 13" screenshot set on a device rather than the simulator (fine either way for the store).
- **The update banner's positive path** — needs the `/api/app/releases` route deployed and a record with a version > 1.0.0 published via `PUT /api/admin/releases/ios|android`.
