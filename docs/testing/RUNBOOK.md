# Adaptable E2E runbook

Read [the quick start and dated gaps](README.md), choose cases from [the matrix](MATRIX.md), and start a [run report](RUN-REPORT-TEMPLATE.md). Commands below assume repository root unless a directory is specified. Placeholders describe paths discovered in the current run, not historical machine paths to reuse blindly.

## 1. Pick the mode and evidence level

| Mode | What it proves | What it does not prove |
|---|---|---|
| U — unit | Pure decisions/parsing/state, SDK with mocked provider HTTP, ownership/filter/security helpers. | Live provider, installed UI, signing, callback or persistence on a device. |
| I — integration/protocol | Real route/SDK interactions with disposable database/provider fixtures; record which endpoints are mocked or live. | Toolbar clicks, OS return, physical share sheet, real email delivery unless explicitly exercised. |
| L — local UI | Full app journey against isolated local API/data; local UI/error injection. | Hosted deployment, production keys/signing, standalone Release environment. |
| H — hosted QA | Installed/browser client against canonical production with a controlled account. | Store publication, physical-device behavior, elapsed weeks of idle time. |
| S — embedded Release simulator/emulator | Compiled JS/native runtime, actual auth/data/restart without Metro. | Physical phone unlock, cellular, hardware provider/share behavior. |
| D — physical device | Actual installed signed app, provider return, share capture, lock/background/reconnect. | Other OS versions/devices or store review approval. |

Do not seed bearer tokens/storage to call a hosted UI journey PASS. Mock/open-mode tests are valid only with an explicit L/U/I label and isolated data. Do not use legacy `DEV_OPEN_API` or `EXPO_PUBLIC_SKIP_AUTH` for hosted Supabase acceptance. A protocol-native session and a UI signed-in screen are separate proof stages.

## 2. Orient, authorize and preserve

Record `git rev-parse HEAD`, `git status --short`, affected dirty diff/source hashes, the lockfile hash, public hosts, and intended account role. Re-read package scripts and the relevant source when a command has drifted. Root `package.json` pins **pnpm 10.34.1**, requires Node 22+, and owns `qa:supabase`; use `corepack pnpm`. Native projects derive from XcodeGen/Expo configuration. Capture `node --version`, `corepack pnpm --version`, `xcodebuild -version`, XcodeGen and browser/SDK versions.

Use installed/pinned tools and the repository wrappers. Query each tool's supported `--help` before using unfamiliar flags; the current `supabase-qa.mjs` has **no `--help` switch**, so inspect its `main` usage/argument checks and [setup guide](../features/supabase-qa-setup.md). Do not substitute an unpinned latest `dlx` tool during a run. If web-ext or a deployment CLI is needed, record and pin the approved version first. Deployment, store submission and signing-account/provider configuration are distinct operations, not implied by testing instructions.

Preserve the original installed app, its data/Keychain, browser profile and rollback artifact. Build into an isolated snapshot; copy before replacing a QA install. No broad `pkill`, `killall`, profile deletion, simulator erase, data clear, Redis flush, LaunchServices reset, TCC change or unsigned-extension bypass. Quit/relaunch the exact authorized QA app gracefully; if blocked, prove its PID/executable and request or use already-authorized exact-process lifecycle handling.

Use a new empty browser profile for native-sync tests. Additive browser bookmark sync currently defaults ON, deletion sync OFF; disable additive sync before sign-in if possible, otherwise sign in only in an empty profile then disable it before other cases. Safari has no native bookmark/Reading List API. Keep personal profiles and independent bookmarks out of write tests.

## 3. Accounts and fixtures

- **A — disposable owner:** a new user-created account with controlled email/provider access. Use the same A across clients to prove propagation. Existing secure fixtures can substitute if their identity is confirmed before writes.
- **B — disposable foreign:** separate identity/profile/storage for isolation. Never infer B from a changed display name.
- **M — migrated owner:** read-only identity/library/session verification. The observed M had89 bookmarks on6 October. Capture a current baseline; counts may change legitimately. Do not sign M out, reset its password, rename it, send AI requests or change settings without separate authorization.

The migration created eight confirmed users without passwords/hashes and matched the owner to an existing Google identity. Old Clerk email/password credentials do not authenticate those Supabase users. Current-owner read-only metadata confirmed no Supabase password and provider Google. Use that established Google identity or verified **Forgot password** for the original email to set a password on the existing UUID. Do not create a replacement account or guess a password. Other providers are usable only when linked to the same identity; do not assume Apple continuity from an email match. This establishes what the migration did; it does not claim compatible historical hash import was technically impossible.

Keep credentials/codes/tokens in approved private storage. Do not put them in README examples, shell argv/history, screenshots, raw HAR, logs or reports. Credential entry/password choice belongs to the owner or an authorized fixture workflow. Ordinary email recovery must start in the browser/profile where its PKCE verifier will remain; open the email link in that same profile. Native Mac/mobile recovery can offer code entry in its original scoped browser context; Safari extension uses the normal email-link flow. SMTP configuration/delivery-only proof is not actual recovery E2E.

Choose a unique run ID plus nonce and a benign http(s) fixture URL. Before creating, record baseline IDs and confirm the exact URL is absent. At creation, record returned new IDs, account role, action/time and object type. A duplicate/upserted existing row is not a cleanup-owned object. Settings need before/after snapshots and exact restoration. Browser native node IDs and server library IDs are separate ledger entries.

## 4. Sequence and branch around blockers

Adjust priority to risk: auth-migration email/recovery/MFA/refresh/revoke, foreign-user isolation and MCP scope checks are release gates, even though the matrix groups them under P2. Run them ahead of cosmetic/theme cases when auth/security changed. If the controlled identity has no Supabase password, recovery is a dependency of password login; the established provider journey can proceed independently.

1. Public hosted health and exact installed-artifact inspection; fast source/type checks. Do not rebuild an already-matching artifact solely because UI tools cannot see it.
2. A web login/library, then each client's original sign-in → authenticated callback/session → protected library → local quit/cold restart. iOS simulator Release first, then phone; Android installed APK inspection before emulator UI.
3. A unique bookmark from each writer, observed from another client; search/filter/detail/edit and saved sessions. Chrome new-window restore must use the actual extension and all tabs. Verify cached/offline content belongs to the same identity; keeping an authorized same-user cache readable offline is not itself a leak, but signout/account swap must never expose it to another identity.
4. Live, sync, AI/chat/attachments, data/skills/MCP, auth refresh/recovery/MFA/revoke/isolation as capabilities and credentials permit.
5. Destructive A-only cases last, after evidence/export; cleanup and final restored state.

If one provider requires unavailable credentials, complete password/recovery where authorized, cancellation, pure auth security tests and the other client journeys. If phone locked, keep S/I/U work running. If native UI unavailable, record BLOCKED UI and continue supported browser DOM/manual, backend read-only corroboration or source checks; do not label those substitutes UI PASS. Do not change the user's default browser to make automation easier.

## 5. Source checks and isolated builds

Use the package scripts rather than a universal build that clobbers a running dev server:

```sh
corepack pnpm test:supabase:isolation
node --test scripts/legacy-master-import.test.mjs scripts/generate-apple-client-secret.test.mjs
corepack pnpm --filter @bookmark-ai/web test
corepack pnpm --filter @bookmark-ai/web check-types
corepack pnpm --filter @bookmark-ai/extension test
corepack pnpm --filter @bookmark-ai/extension check-types
corepack pnpm --filter @bookmark-ai/mobile test
corepack pnpm --filter @bookmark-ai/mobile check-types
corepack pnpm --filter @bookmark-ai/live-server test
corepack pnpm --filter @bookmark-ai/live-server check-types
```

Also inspect/run current tests for changed `packages/db`, `engine`, `types`, `server-logging`, `ui` using their package scripts, or the root `corepack pnpm test`/`check-types` when an integrated pass is justified. A test failure caused by sandbox IPC is an environment blocker, not an application pass/failure. Retry with narrowly authorized host IPC access; do not weaken app permissions. For a focused Vitest case, use `corepack pnpm --filter @bookmark-ai/web exec vitest run lib/extension-bridge.test.ts`; `test -- <file>` previously ran the whole suite, so inspect the actual executed count.

The hosted wrapper reads private `.env.supabase.production.local` and requires its production marker plus `--hosted-production`. It rejects mixed legacy/auth-bypass configuration. Do not copy/read secret values into reports. Source snapshots/output appear under `.work/builds/supabase-qa`; preserve each printed run root and `build-manifest.json` (Git SHA, dirty source hash, frozen dependency/lock hashes, result).

```sh
corepack pnpm qa:supabase check --hosted-production
corepack pnpm qa:supabase web typecheck --hosted-production
corepack pnpm qa:supabase chrome build --hosted-production
corepack pnpm qa:supabase firefox build --hosted-production
corepack pnpm qa:supabase safari build --hosted-production
corepack pnpm qa:supabase macos prepare --hosted-production
corepack pnpm qa:supabase ios generate --hosted-production
corepack pnpm qa:supabase android generate --hosted-production
```

These commands do not install clients. Current native wrapper `build` defaults to Debug (Safari unsigned, Mac explicit signing mode, iOS simulator, Android Debug). **A hosted flag does not turn Debug into Release.** For standalone acceptance, build Release from the generated isolated snapshot, using its recorded public env and frozen dependencies. Do not run Expo prebuild or native generation in the live checkout. Prefer matching existing Release artifacts before paying for another build.

For local UI, omit the hosted flag and use private `.env.supabase.local`: staged `web dev` on3100, `live dev` on its QA configuration, mobile Metro on8083. Android maps host aliases to10.0.2.2; physical devices require reachable hosts. Local Redis is separately6386/0, hosted configuration6379/3; never change/flush an unrelated instance. Check wrapper/source for current aliases. Do not point local open/auth-bypass modes at production tenant data. Do not run Next build over a live dev output directory.

## 6. Web/API and harness selection

Start hosted smoke without local processes:

```sh
curl --fail --silent --show-error --max-time 20 https://www.bookmark-ai.cloud/api/health
```

Record response/status and signed-out protected-route401 separately. Health may show AI availability; it does not prove a database, authenticated account or completed save. Use canonical www directly for authenticated API calls rather than relying on apex redirects. Never put a bearer in argv or shared output; use the harness's secret mechanism or a private restricted curl config/stdin. Redact response bodies when they contain personal content.

Prefer supported browser DOM APIs for website forms. Reobserve the page after navigation; do not use stale selectors/coordinates or retry credential submissions blindly after a tool timeout. Native accessibility, screenshots and human clicks are valid alternatives when authorized. With current Codex, browser/native UI goes through supported CUA/connector APIs; do not substitute JXA/AppleScript/CDP/ADB input to evade a denied/unavailable UI channel. Another harness may use its own supported UI interfaces and authorization, but must honor explicit denials and OS permissions. Lifecycle/build/package inspection commands are distinct from input automation.

Use **headed** browsers/native apps for actual extension toolbar clicks, popup lifecycle and OS/provider return acceptance. Headless is useful only for supported web rendering/contracts/API smoke or clearly labeled component tests; it does not prove the installed toolbar, Safari permissions, default-browser handoff or physical share/provider journey. A plan, source review, unit assertion or backend correlation never replaces a required observed runtime action. If the display is locked or headed automation is unavailable, record those GUI cases BLOCKED and continue independent supported checks.

Only one operator drives the shared foreground UI. In a team, transfer a lease with app/profile, current state, last pending action and next steps; release it while compiling. An unresponsive native binding can exceed requested timeouts by minutes. Use short bounded calls, report the stall, inspect eventual state before retrying, and avoid repeated Chrome/native-app rebind loops when connected browser DOM works. A timeout is not proof an action failed.

### When a reviewed web fix needs promotion

Deployment is a separately authorized operation. Freeze the reviewed source with `corepack pnpm qa:supabase web build --hosted-production`; use the returned snapshot source, not a changing checkout. Verify logged-in Vercel user, `.vercel/project.json` project/team, remote root/build/output configuration, and the exact **current Supabase** rollback deployment. Use existing production secrets; never upload local `.env`, replay a redacted backup, or redeploy Live for a web-only bridge fix.

The October run used pinned Vercel CLI62.2.0 and a protected no-domain production candidate (`deploy --prod --skip-domain --yes --cwd <frozen-source> --scope <verified-team>`), authenticated candidate smoke, then `promote <exact-deployment-id>` and canonical-domain smoke. Check current CLI help before reuse; preserve deployment protection. Use bounded curl timeouts. Health200/me401/sign-in200 is smoke, not restored-session proof. Cloud builds can change chunk IDs; inspect the served page's current scripts rather than declaring an old local asset filename404 a runtime failure. Record candidate/promoted/rollback IDs in the run report and rerun affected actual UI cases after promotion.

## 7. Mac app

Discover the generated Xcode project/scheme/destination in the staged `apps/macos`. Set task-specific paths to the current run, not an old snapshot:

```sh
export QA_MACOS="/absolute/current/snapshot/source/apps/macos"
export QA_MAC_DERIVED="/absolute/current/run/DerivedData-macos"
cd "$QA_MACOS"
xcodegen generate
xcodebuild -project BookmarkAI.xcodeproj -scheme BookmarkAI -showdestinations
xcodebuild -project BookmarkAI.xcodeproj -scheme BookmarkAI -configuration Debug \
  -destination 'platform=macOS' -derivedDataPath "$QA_MAC_DERIVED" test
xcodebuild -project BookmarkAI.xcodeproj -scheme BookmarkAI -configuration Release \
  -derivedDataPath "$QA_MAC_DERIVED" build
```

Signing flags depend on installed identities/profiles. Inspect entitlements, bundle ID, callback scheme, sandbox/network/file permissions and Keychain namespace. Use approved signing; do not generically remove entitlements to force success. The Oct6 local Apple Development Release had a reviewed **staged-only** native Apple entitlement removal because login occurs in the hosted browser; it retained sandbox/hardened runtime and removed injected get-task-allow. That recorded exception is not a universal build recipe or notarized distribution proof. A sandbox trust-store CSSMERR_TP_NOT_TRUSTED may require authorized host verification; do not label it a valid signature until `codesign --verify --deep --strict` actually succeeds.

For both hosted and ordinary auth test variants, isolate host bundle/storage IDs. Never let a test host capture the installed app's callback. Hosted tests use configured Info.plist origin, not hardcoded cloud/apex assumptions. Three legacy Clerk-ticket cases skip in native variant and run in ordinary isolated host;10 preview cases skip unless explicitly opting into `TEST_RUNNER_RENDER_PREVIEWS=1`. Explain counts/skips instead of assuming a forever-current count.

Before install/relaunch, inspect exact PID/executable path, version, binary SHA256 and installed Info.plist. The original Oct6 issue was an obsolete Debug process running from an old `.work` snapshot even though a newer browser-flow app was installed. Launch the installed exact path (historical QA destination `~/Applications/Bookmark AI Supabase QA.app`), then prove the new running path/hash. Sign In must open the actual default browser's production page; the native sheet has progress/cancel/retry, no credential form.

If callback/Dock resolves an old duplicate, inspect LaunchServices records for the exact isolated bundle ID `ai.bookmarkai.macos.supabaseqa`. Unregister only observed obsolete owned QA snapshot entries and register the installed exact path; preserve files/backups, other IDs and original apps. No global reset. Repeat metadata cleanup if tests registered duplicate hosts. Verify callback returns to the installed process, library loads, cold restart restores, close-window/Dock reopen works. Measure first-frame cache and later network load separately.

## 8. Chrome, Firefox and Safari

Build using `qa:supabase` above, then read each generated manifest and build manifest before copying into a stable per-run extension kit. ChromeMV3, FirefoxMV2 and SafariMV3 differences must be intentional. Preserve exact loaded-path/hash evidence after a reload; copying files alone is not proof the running worker changed.

**Chrome:** use an empty QA profile and official Chrome for Testing for CLI unpacked launch when branded Chrome rejects that flag. Discover installed binary; record version. Current pinned QA ID is `peikdeadpkgjgohdndljbciephekdpfg`; store ID remains `ffhbgpgebpmofjkehpjcemepbgcmoelp`. Derive/check ID from manifest public key or extension details. Use normal `chrome://extensions` Load unpacked/Reload in the authorized profile; Developer mode is a persistent setting requiring the harness/user's authorization. Oct6 explicit approval covered only the separate QA profile. Reload while Developer mode OFF disabled the addon; verify ON after every final reload. Use real toolbar Sign In: opening `popup.html` as a page has a sender tab and deliberately fails trusted START_OAUTH admission. Preserve that guard. If using an authorized background popup page for non-auth save tests, keep the article tab active so capture does not save the popup's own URL.

Verify web extension detection and actual saved-session New window/Tab group on the deployed page. Web bridge must discover the fixed store/QA IDs with PING and send only one RESTORE_SESSION; arbitrary page IDs are not allowed. No restore broadcast/retry after ambiguous mutation. The old store-only bridge caused QA fallback to one popup-blocked tab. Existing boolean fallback may still run after a timed-out restore; do not hide an error with popup exceptions or call partial fallback a new-window pass.

**Firefox:** use a disposable/existing empty QA profile. Normal `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → current kit `firefox/manifest.json`; choose the QA toolbar action alongside retained legacy addons. ID `bookmark-ai-supabase-qa@bookmark-ai.cloud`; moz-extension UUID is per install/profile and must be observed. Current OAuth callback allowlist must match the actual identity redirect. Prefer existing pinned web-ext only when authorized and functional. macOS `profiles.ini` EPERM persisted even elevated; GUI loading worked, so do not bypass TCC or disable signature/security settings. After copying an updated kit, normal Reload must happen before final-runtime claims. Temporary addons disappear on quit: relaunch/reload the same addon, then test saved auth; distinguish this from persistent signed-XPI installation.

**Safari:** build the QA snapshot's XcodeGen companion Release with the approved identity/team. The generic legacy `safari:xcode --install` script installs its standard target and can collide with the Mac app; do not invoke it blindly for isolated QA. Inspect script flags/project/QA IDs first. Use distinct installed companion name `Bookmark AI Supabase QA for Safari.app`, appID `ai.bookmark.safari.supabaseqa`, appexID `ai.bookmark.safari.supabaseqa.Extension`; the main Mac yellow app is a different file. Verify both signatures, embedded resource hashes and pluginkit/LaunchServices paths. Use a clean build when embedding updated resources: an incremental native build can keep stale appex resources. Stale owned DerivedData registrations can create duplicate QA rows: remove only exact observed registrations, preserve artifacts and legacy rows, register intended companion. Require one intended enabled QA row.

Use normal Safari Settings → Extensions enablement and requested website access; no Allow Unsigned Extensions. A grant for example.com does not cover www production callback. Use real QA toolbar popup; manual click is acceptable evidence when accessibility targeting dismisses it without dispatching the handler. Develop/Web Inspector can corroborate current worker source/listeners, not authenticated UI success. Do not toggle a denied checkbox as a reload workaround. The popup now awaits START_OAUTH acknowledgement before explicit close; Chrome/Firefox acknowledgement may wait through the full provider journey. Do not treat a pending acknowledgement alone as failed dispatch, and do not leave an expired native/browser flow indefinitely waiting after a stopped run. Old companion tutorial may describe Clerk; it is not the Supabase flow's source of truth. Safari exposes no native bookmark/Reading List API to this extension, and the current client's web restore/tab-group bridge supports Chrome only; record those Safari cases N/A, not FAIL. Recheck capabilities when source/platform support changes.

## 9. iOS and Android

Generate only in snapshots. Preserve original native screen: email/password, code/recovery, Google and Apple controls; social buttons open their named provider and return through the isolated callback. Expo-generated `ios`/`android` directories are output; source changes belong in app/config/plugins.

**iOS:** discover with `xcrun simctl list devices` and `xcodebuild -showdestinations`, then build the staged workspace/scheme Release for the selected QA simulator (after staged Pod install) using `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`. Install only that bundle/device:

```sh
xcrun simctl install "$QA_SIMULATOR_ID" "$QA_IOS_APP"
xcrun simctl launch "$QA_SIMULATOR_ID" ai.bookmarkai.supabaseqa
xcrun simctl get_app_container "$QA_SIMULATOR_ID" ai.bookmarkai.supabaseqa app
```

Compare installed `main.jsbundle` SHA256 with the exact Release input; verify canonical public endpoints, no legacy LAN/Metro dependence. Discover native UI launcher: this Mac uses **Device Hub** (`com.apple.dt.Devices`), not the old Simulator.app path. Select the actual QA iPhone/iPad; inspect fresh screenshot/accessibility state. The RN URLSearchParams polyfill lacks `.size`; endpoint validation must count iterator entries without accepting malformed/duplicate URLs. Simulator password/library/save/server-read/restart is the regression gate before phone install, not a substitute for physical-provider return.

For phone, discover paired device with `xcrun devicectl list devices`; inspect profiles/device compatibility/expiry/signature, then `xcrun devicectl device install app --device "$QA_PHONE_ID" "$QA_IOS_DEVICE_APP"`. Query actual installed bundle/version and input hash. `devicectl` may not expose app-bundle bytes; say input hash + installer/installed identity rather than claiming a direct installed digest. Locked phone can accept install but launch returns CoreDevice10002/FBSLocked. Owner unlock is required; do not request/read/pass a passcode or wipe/re-pair. Physical launch/auth/share remain BLOCKED until observed.

**Android:** discover SDK/JDK/AVDs/devices; use the approved isolated emulator (historical `bookmark_pixel`). Avoid environment variable names that overwrite system defaults; use task-specific path variables when a command needs them. Inspect `adb -s "$QA_ANDROID_SERIAL" shell pm path ai.bookmarkai.supabaseqa` first. A restored old AVD snapshot may not include the installed QA package even when the artifact exists. Install the exact APK with `adb -s "$QA_ANDROID_SERIAL" install -r "$QA_ANDROID_APK"`, without uninstall/wipe. Pull the installed APK from `pm path` and compare SHA256, package/version/code and embedded JS/endpoints to the artifact. Record absent hardware separately from emulator success.

Release Gradle can reuse stale JS assets when EXPO_PUBLIC target changes; use clean isolated generation or explicitly rerun the Release JS/assets task, then hash/inspect the actual APK. Use the original complete screen and actual browser callback, not fabricated custom-scheme success. If the harness cannot see Qt/qemu UI, request its supported authorized alternative or manual test. In current Codex, ADB input/UI dump/screenshot automation needs explicit authorization rather than being used to bypass missing CUA surfaces. An approved other harness can use its supported ADB UI capability under its own permissions. `pm`, install and hash inspection alone do not prove auth/save/restart.

## 10. Evidence, failures and cleanup

For each case, preserve artifact provenance → action → visible result → protected server/data confirmation where applicable. Number screenshots/logs by case/client/run. Distinguish source revision from dirty snapshot hash, compiled artifact from installed bytes, current session from old persisted Keychain, web session from separate native/extension session, and simulator from hardware. Read-only backend correlation may use client label/time/session-match booleans; never dump Auth hashes/tokens or personal metadata.

Do not conceal FAIL as BLOCKED: a real wrong endpoint, lost callback or wrong window after exercising it is FAIL; no device/UI/credentials is BLOCKED. Do not continue guessing after repeated tool failures. Record pending action and inspect eventual state before another submission. Fix source, rerun focused affected checks, then actual failed journey on the new installed/deployed artifact. Broader repeat tests require new changes or unresolved concerns.

Clean exact newly created IDs on A with normal authorized API/UI; verify absence and all pre-existing IDs preserved. Restore settings/Live/sync/privacy/browser appearance to baseline. Never delete by URL/title/time/prefix alone, unknown imported/native nodes, personal sessions or another agent's fixtures. Revoke only this run's tokens/sessions; keep an observer session for revoke tests. If account deletion was explicitly in scope, do it last only for a confirmed disposable newly created account; imported legacy-account automatic deletion is not ready. Record residue if ownership/cleanup is blocked.

Store sanitized evidence and the completed report under a durable run folder (for example `qa-runs/<run-id>` or an approved external artifact location). Machine-local `.work` is staging, not the only handoff. Before sharing, redact secrets/personal content and copy the report/evidence manifest to durable storage. Update this guide only with reproducible procedure improvements; append dated results/gaps separately. A new PASS names the exact artifact/mode/action and never erases another platform's blocked case.
