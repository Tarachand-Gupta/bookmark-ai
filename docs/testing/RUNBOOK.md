# Adaptable E2E runbook

Read [the quick start and dated gaps](README.md), choose cases from [the matrix](MATRIX.md), and start a [run report](RUN-REPORT-TEMPLATE.md). Commands below assume repository root unless a directory is specified. Placeholders describe paths discovered in the current run, not historical machine paths to reuse blindly.

## 1. Pick the mode and evidence level

| Mode | What it proves | What it does not prove |
|---|---|---|
| U — unit | Pure decisions/parsing/state, SDK with mocked provider HTTP, ownership/filter/security helpers. | Live provider, installed UI, signing, callback or persistence on a device. |
| I — integration/protocol | Real route/SDK interactions with disposable database/provider fixtures; record which endpoints are mocked or live. | Toolbar clicks, OS return, physical share sheet, real email delivery unless explicitly exercised. |
| L — local UI | Full app journey against isolated local API/data; local UI/error injection. | Hosted deployment, production keys/signing, standalone Release environment. |
| H — hosted client | Production or yellow QA client against canonical production with a controlled account; record exact build variant. | Store publication, physical-device behavior, elapsed weeks of idle time. |
| S — embedded Release simulator/emulator | Compiled JS/native runtime, actual auth/data/restart without Metro. | Physical phone unlock, cellular, hardware provider/share behavior. |
| D — physical device | Actual installed signed app, provider return, share capture, lock/background/reconnect. | Other OS versions/devices or store review approval. |

Do not seed bearer tokens/storage to call a hosted UI journey PASS. Mock/open-mode tests are valid only with an explicit L/U/I label and isolated data. Do not use legacy `DEV_OPEN_API` or `EXPO_PUBLIC_SKIP_AUTH` for hosted Supabase acceptance. A protocol-native session and a UI signed-in screen are separate proof stages.

## 2. Orient, authorize and preserve

Record `git rev-parse HEAD`, `git status --short`, affected dirty diff/source hashes, the lockfile hash, public hosts, and intended account role. Re-read package scripts and the relevant source when a command has drifted. Root `package.json` pins **pnpm 10.34.1**, requires Node 22+, and owns `production:supabase` plus `qa:supabase`; use `corepack pnpm`. Native projects derive from XcodeGen/Expo configuration. Capture `node --version`, `corepack pnpm --version`, `xcodebuild -version`, XcodeGen and browser/SDK versions.

Use installed/pinned tools and the repository wrappers. Query each tool's supported `--help` before using unfamiliar flags; the current `supabase-qa.mjs` has **no `--help` switch**, so inspect its `main` usage/argument checks and [setup guide](../features/supabase-qa-setup.md). Do not substitute an unpinned latest `dlx` tool during a run. If web-ext or a deployment CLI is needed, record and pin the approved version first. Deployment, store submission and signing-account/provider configuration are distinct operations, not implied by testing instructions.

Preserve the original installed app, its data/Keychain, browser profile and rollback artifact. Build into an isolated snapshot; copy before replacing a QA install. No broad `pkill`, `killall`, profile deletion, simulator erase, data clear, Redis flush, LaunchServices reset, TCC change or unsigned-extension bypass. Quit/relaunch the exact authorized QA app gracefully; if blocked, prove its PID/executable and request or use already-authorized exact-process lifecycle handling.

Use a new empty browser profile for native-sync tests. Additive browser bookmark sync currently defaults ON, deletion sync OFF; disable additive sync before sign-in if possible, otherwise sign in only in an empty profile then disable it before other cases. Safari has no native bookmark/Reading List API. Keep personal profiles and independent bookmarks out of write tests.

## 3. Accounts and fixtures

- **A — disposable owner:** a new user-created account with controlled email/provider access. Use the same A across clients to prove propagation. Existing secure fixtures can substitute if their identity is confirmed before writes.
- **B — disposable foreign:** separate identity/profile/storage for isolation. Never infer B from a changed display name.
- **M — migrated owner:** read-only identity/library/session verification. The observed M had89 bookmarks on6 October. Capture a current baseline; counts may change legitimately. Do not sign M out, reset its password, rename it, send AI requests or change settings without separate authorization.

The migration created eight confirmed users without passwords/hashes and matched the owner to an existing Google identity. Old Clerk email/password credentials do not authenticate those Supabase users. Current-owner read-only metadata confirmed no Supabase password and provider Google. Use that established Google identity or verified **Forgot password** for the original email to set a password on the existing UUID. Do not create a replacement account or guess a password. Other providers are usable only when linked to the same identity; do not assume Apple continuity from an email match. This establishes what the migration did; it does not claim compatible historical hash import was technically impossible.

Keep credentials/codes/tokens in approved private storage. Do not put them in README examples, shell argv/history, screenshots, raw HAR, logs or reports. Credential entry/password choice belongs to the owner or an authorized fixture workflow. Web/PWA recovery shows an email-code field after sending, including the configured eight-digit code, and offers direct code entry after reload. Enter the newest recovery code in the original Bookmark AI window. If using the link, open it in the same browser/profile where its PKCE verifier remains. Opening the verification link in another browser can consume the code before PKCE exchange fails: return to the original window, send a new code and enter that newest code without opening its link. Exercise invalid/expired/used-code guidance, resend/change-email, provider-validated password update, required MFA and old/new-password sign-in only with an exact authorized disposable identity. Never place codes/passwords in URLs or screenshots. Native code flows and hosted native continuations retain their scoped session. Record actual inbox delivery and elapsed expiry separately; generated tokens, simulated PKCE errors and SMTP acceptance do not prove delivered-email/PWA recovery E2E.

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

Production packages use `scripts/supabase-production.mjs`, private `.env.supabase.production.local`, and its explicit hosted marker. It emits `supabase-production` snapshots under `.work/builds/supabase-production`, validates `BOOKMARK_PRODUCTION_STAGE_ROOT`, and saves completed packages under `dist/production`. The kit's `ARTIFACTS.json`, per-run build manifest and file hashes are the identity authority; a black icon alone is insufficient. Extension default build scripts now call this production wrapper, but old cached `.output` directories can still contain a different provider.

```sh
corepack pnpm production:supabase web prepare
corepack pnpm --filter @bookmark-ai/web check-types
corepack pnpm production:supabase chrome build
corepack pnpm production:supabase firefox build
corepack pnpm production:supabase safari build
corepack pnpm production:supabase macos build
corepack pnpm production:supabase ios prepare
corepack pnpm production:supabase android prepare
```

`prepare` freezes source/config without claiming a finished artifact. The production wrapper currently supports only `prepare` for web, Live and mobile; use the owning release procedure for their builds. Mobile production `build` rejects a generic Debug fallback. Consult the current platform guide/kit install instructions. These commands do not publish stores or install clients automatically. Production IDs are the registered original identities, so installation requires checking/backing up an existing app rather than assuming QA-side-by-side isolation.

The following yellow QA commands retain their isolated IDs and storage for regression work. The hosted wrapper reads private `.env.supabase.production.local` and requires its production marker plus `--hosted-production`. It rejects mixed legacy/auth-bypass configuration. Do not copy/read secret values into reports. Source snapshots/output appear under `.work/builds/supabase-qa`; preserve each printed run root and `build-manifest.json` (Git SHA, dirty source hash, frozen dependency/lock hashes, result).

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

Deployment is a separately authorized operation. Freeze the reviewed source with `corepack pnpm production:supabase web prepare`; use the returned snapshot source, not a changing checkout. Verify logged-in Vercel user, `.vercel/project.json` project/team, remote root/build/output configuration, and the exact **current Supabase** rollback deployment. Use existing production secrets; never upload local `.env`, replay a redacted backup, or redeploy Live for a web-only bridge fix.

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

For the production single-main-window regression (`AUTH-05`), verify the installed path/bundle/version/hash and exactly one installed production process separately from any old QA process. Test launch/reopen bursts, minimize→Dock reopen, close→Dock reopen and a real authenticated callback: each must leave exactly one main window. Keep Settings open during relevant cases and confirm it remains independent; auxiliary/auth/helper windows must not be mistaken for the main window or closed as duplicates. Main-window lifecycle unit tests are source evidence; record actual built-app window/process counts and callback results separately in the client report.

## 8. Chrome, Firefox and Safari

Build using the production or isolated QA wrapper for the recorded mode, then read each generated manifest and build manifest before copying into a stable per-run extension kit. ChromeMV3, FirefoxMV2 and SafariMV3 differences must be intentional. Preserve exact loaded-path/hash evidence after a reload; copying files alone is not proof the running worker changed.

Before testing authentication, execute `ENV-03` and record the **auth provider + build mode + exact loaded directory + extension ID + artifact hash + public OAuth client/callback configuration**. The hosted QA wrapper builds a frozen snapshot's `apps/extension/.output-supabase-qa/chrome-mv3` (or corresponding browser directory); the run's copied kit must match it. The 6/7 October standard `.output` folders could contain legacy Clerk and remain historical evidence. Current default extension build/zip scripts use the production wrapper and update standard outputs plus `dist/production`; cached output still requires identity/hash verification. The guard rejects unqualified underlying WXT build/zip operations; `--legacy-clerk` is deliberate rollback only. Do not interpret a folder name, version number, source checkout or successful build as proof of current authentication. If the loaded output/provider/ID does not match, record artifact gate FAIL and correct the delivery before recording dependent auth results. Never weaken registered callback/origin checks to accommodate an unintended ID.

Before promotion, run `scripts/production-oauth-preflight.mjs` with the package's public environment and the exact freshly pulled hosted promotion environment; retain its boolean report. It independently requires all production public client IDs **and** exact Chrome/Firefox/Safari redirect URLs, plus retained QA IDs/callbacks. Correlate its pinned callbacks with the actual produced manifests/installed identities recorded in `ENV-03`. Updating the client-ID allowlist alone does not register callback URLs. The helper selects only public auth fields and does not publish backend credentials; successful preflight remains configuration evidence, separate from actual toolbar login/callback.

Run both extension entry journeys independently in the same authorized browser/profile. For `AUTH-11`, keep A signed into the canonical www web app while the extension has no session; click the real toolbar Sign In, reuse the web identity without another credentials form, complete required authorization, and verify the returned toolbar identity plus a distinct extension session/protected read. Retaining a previously signed-in extension is a separate persistence result. For `AUTH-12`, start A signed out on web and extension, click toolbar Sign In then Google, and prove the provider returns through `/auth/callback` to the preserved `/oauth/consent?authorization_id=…`, followed by the registered extension callback and signed-in toolbar. Record Google launch and completion separately from password/Apple, for each exact artifact. A successful web Google login alone does not prove extension return. Use A for setup; do not sign out/reset M implicitly.

Check apex navigation separately: `https://bookmark-ai.cloud/<path>?<query>` must resolve to `https://www.bookmark-ai.cloud/<path>?<query>` while preserving the authorization continuation. Inspect final URLs without logging codes/state/tokens. Web cookies currently have no shared-domain override; canonical www is the supported session origin. Authenticated API calls use www directly. In the run report, each PASS must name provider, browser/profile, auth provider/build mode, loaded directory/ID/hash, and the observed action; a result from the isolated QA ID cannot establish the legacy/store artifact passed.

**Chrome:** use an empty QA profile and official Chrome for Testing for CLI unpacked launch when branded Chrome rejects that flag. Discover installed binary; record version. Current pinned QA ID is `peikdeadpkgjgohdndljbciephekdpfg`; store ID remains `ffhbgpgebpmofjkehpjcemepbgcmoelp`. Derive/check ID from manifest public key or extension details. Use normal `chrome://extensions` Load unpacked/Reload in the authorized profile; Developer mode is a persistent setting requiring the harness/user's authorization. Oct6 explicit approval covered only the separate QA profile. Reload while Developer mode OFF disabled the addon; verify ON after every final reload. Use real toolbar Sign In: opening `popup.html` as a page has a sender tab and deliberately fails trusted START_OAUTH admission. Preserve that guard. If using an authorized background popup page for non-auth save tests, keep the article tab active so capture does not save the popup's own URL.

Verify web extension detection and actual saved-session New window/Tab group on the deployed page. Web bridge must discover the fixed store/QA IDs with PING and send only one RESTORE_SESSION; arbitrary page IDs are not allowed. No restore broadcast/retry after ambiguous mutation. The old store-only bridge caused QA fallback to one popup-blocked tab. Existing boolean fallback may still run after a timed-out restore; do not hide an error with popup exceptions or call partial fallback a new-window pass.

**Firefox:** use a disposable/existing empty QA profile. Normal `about:debugging#/runtime/this-firefox` → Load Temporary Add-on → current kit `firefox/manifest.json`; choose the QA toolbar action alongside retained legacy addons. ID `bookmark-ai-supabase-qa@bookmark-ai.cloud`; moz-extension UUID is per install/profile and must be observed. Current OAuth callback allowlist must match the actual identity redirect. Prefer existing pinned web-ext only when authorized and functional. macOS `profiles.ini` EPERM persisted even elevated; GUI loading worked, so do not bypass TCC or disable signature/security settings. After copying an updated kit, normal Reload must happen before final-runtime claims. Temporary addons disappear on quit: relaunch/reload the same addon, then test saved auth; distinguish this from persistent signed-XPI installation.

### Firefox official driver fallback

Verified on Firefox157.0.1 with the production0.1.6 ID `bookmark-ai@bookmark-ai.cloud`; [exact release evidence and limits](reports/2026-10-09-firefox.md). This is independent of the historical isolated QA ID above.

If CUA binding times out, first preserve the disposable QA profile and identify its exact web-ext owner/process. Stop only its owning session normally; never quit Firefox globally or kill personal processes. Install Selenium into a run-local Python environment and obtain the architecture-matched geckodriver from [Mozilla's official release](https://github.com/mozilla/geckodriver/releases), verifying its vendor digest. The successful run used Selenium4.50.0/geckodriver0.37.1. Do not remove quarantine or bypass a macOS warning.

Use [official web-ext arguments](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/) to relaunch the **verified delivered** production directory with that profile:

```sh
MOZ_REMOTE_ALLOW_SYSTEM_ACCESS=1 corepack pnpm dlx web-ext@10.7.0 run \
  --source-dir apps/extension/.output/firefox-mv2 \
  --firefox-profile /absolute/disposable-qa-profile \
  --keep-profile-changes --no-reload --no-input \
  --arg=--marionette --pref marionette.port=2830
```

Wait for temporary add-on installation. [Mozilla](https://firefox-source-docs.mozilla.org/testing/geckodriver/Flags.html) requires `--allow-system-access` for browser UI control; current [Firefox security documentation](https://firefox-source-docs.mozilla.org/remote/Security.html) uses the process-local environment above. This privileged test scope must stay local to the authorized QA process; no global preferences or certificate exceptions. geckodriver0.37.1 no longer supports the old browser `--remote-allow-system-access` option.

```python
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys

profile = Path("/absolute/disposable-qa-profile").resolve()
options = Options()
options.binary_location = "/Applications/Firefox.app/Contents/MacOS/firefox"
options.accept_insecure_certs = False
service = Service("/absolute/run-local/geckodriver", service_args=[
    "--connect-existing", "--marionette-host", "127.0.0.1",
    "--marionette-port", "2830", "--host", "127.0.0.1",
    "--allow-system-access",
])
driver = webdriver.Firefox(service=service, options=options)
assert Path(driver.capabilities["moz:profile"]).resolve() == profile

driver.set_context("chrome")
driver.find_element(By.ID, "unified-extensions-button").click()
# Observe the actual installed widget first; do not assume the QA/production ID.
driver.find_element(By.ID, "bookmark-ai_bookmark-ai_cloud-BAP").click()
popup = driver.find_element(By.CSS_SELECTOR, "browser.webextension-popup-browser")
popup.click()
popup.send_keys(Keys.TAB, Keys.ENTER)
driver.set_context("content")
```

This final keyboard step was verified for the **signed-out popup's single Sign In button**. Do not reuse an assumed tab order on signed-in/settings UI: it could invoke Sign Out or Live controls. Identify the new hosted window by parsed canonical host/path, privately fill the fixture through ordinary `auth-email`/`auth-password` inputs, submit, then observe `/oauth/consent`, **Authorize extension**, provider-window closure, and authenticated extension UI. Never log URL code/state/token parameters. A launched provider window alone is not callback completion.

Opening popup.html as a tab for Sign In intentionally fails the trusted sender guard (`!sender.tab`). Preserve it. Standard `switch_to.frame` on Firefox's remote extension `browser` raised NoSuchFrameException; driver chrome screenshots also omitted its native popup. Native AX traversal denied(-1719) must stop without bypass. A focus check/raise is separate from a denied AX traversal, and screenshots must contain only the scoped QA surface. Standalone [official BiDi](https://developer.mozilla.org/en-US/docs/Web/WebDriver/How_to/Create_BiDi_connection) can attach on a process-local remote-debugging endpoint, but was not needed here; the normal realm tree omitted the extension popup. geckodriver rejects `--connect-existing` together with `--websocket-port`; classic and standalone BiDi sessions cannot run simultaneously.

For an explicitly authorized **non-auth** full-tab save alternative, keep the owned article active while loading the already observed extension popup URL in a background tab. In chrome context, `gBrowser.addTab(observedPopupUrl, {inBackground:true, triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()})` opens that UI without changing extension state. Wait for mount/capture before switching to its content handle; verify the article title/domain and enabled Save button, then use its normal DOM button. Label this full-tab save separately from a toolbar save. Require both an exact link in the canonical web library and an independent API read of the same owned URL/ID. Never click Live or bulk/session actions as part of this fallback.

Finally stop the driver and its exact owning web-ext session; preserve the profile and requested fixtures. Temporary add-on installation does not establish AMO-signed persistence or store publication.

**Safari:** build the QA snapshot's XcodeGen companion Release with the approved identity/team. The generic legacy `safari:xcode --install` script installs its standard target and can collide with the Mac app; do not invoke it blindly for isolated QA. Inspect script flags/project/QA IDs first. Use distinct installed companion name `Bookmark AI Supabase QA for Safari.app`, appID `ai.bookmark.safari.supabaseqa`, appexID `ai.bookmark.safari.supabaseqa.Extension`; the main Mac yellow app is a different file. Verify both signatures, embedded resource hashes and pluginkit/LaunchServices paths. Use a clean build when embedding updated resources: an incremental native build can keep stale appex resources. Stale owned DerivedData registrations can create duplicate QA rows: remove only exact observed registrations, preserve artifacts and legacy rows, register intended companion. Require one intended enabled QA row.

Use normal Safari Settings → Extensions enablement and requested website access; no Allow Unsigned Extensions. A grant for example.com does not cover www production callback. Use the verified intended production or separate QA toolbar popup; manual click is acceptable evidence when accessibility targeting dismisses it without dispatching the handler. Develop/Web Inspector can corroborate current worker source/listeners, not authenticated UI success. Do not toggle a denied checkbox as a reload workaround. The popup now awaits START_OAUTH acknowledgement before explicit close; Chrome/Firefox acknowledgement may wait through the full provider journey. Do not treat a pending acknowledgement alone as failed dispatch, and do not leave an expired native/browser flow indefinitely waiting after a stopped run. Old companion tutorial may describe Clerk; it is not the Supabase flow's source of truth. Safari exposes no native bookmark/Reading List API to this extension, and the current client's web restore/tab-group bridge supports Chrome only; record those Safari cases N/A, not FAIL. Recheck capabilities when source/platform support changes.

## 9. iOS and Android

Generate only in snapshots. Preserve original native screen: email/password, code/recovery, Google and Apple controls; social buttons open their named provider and return through the isolated callback. Expo-generated `ios`/`android` directories are output; source changes belong in app/config/plugins.

**iOS:** discover with `xcrun simctl list devices` and `xcodebuild -showdestinations`, then build the staged workspace/scheme Release for the selected QA simulator (after staged Pod install) using `LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8`. Install only that bundle/device:

```sh
xcrun simctl install "$QA_SIMULATOR_ID" "$QA_IOS_APP"
xcrun simctl launch "$QA_SIMULATOR_ID" ai.bookmarkai.supabaseqa
xcrun simctl get_app_container "$QA_SIMULATOR_ID" ai.bookmarkai.supabaseqa app
```

Compare installed `main.jsbundle` SHA256 with the exact Release input; verify canonical public endpoints, no legacy LAN/Metro dependence. Discover native UI launcher: this Mac uses **Device Hub** (`com.apple.dt.Devices`), not the old Simulator.app path. Match the named simulator and its UDID before input: Device Hub also controls physical phones, so its presence does not establish simulation. Use its sidebar controls to select the simulator without interacting with a physical-device stream. The RN URLSearchParams polyfill lacks `.size`; endpoint validation must count iterator entries without accepting malformed/duplicate URLs. Simulator password/library/save/server-read/restart is the regression gate before phone install, not a substitute for physical-provider return.

**Current owner restriction (10 October): simulators/emulators only.** Do not inspect, control, install, remove, or test apps on the physical iPhone. The physical-device procedure below is inactive unless the owner explicitly authorizes it again. If an OS Save Password prompt obstructs a disposable simulator session, do not save credentials without authorization; a scoped app restart may dismiss it and independently test session restoration. Record any remaining navigation/landscape gaps instead of counting them as passed.

For phone, discover paired device with `xcrun devicectl list devices`; inspect profiles/device compatibility/expiry/signature, then `xcrun devicectl device install app --device "$QA_PHONE_ID" "$QA_IOS_DEVICE_APP"`. Query actual installed bundle/version and input hash. `devicectl` may not expose app-bundle bytes; say input hash + installer/installed identity rather than claiming a direct installed digest. Locked phone can accept install but launch returns CoreDevice10002/FBSLocked. Owner unlock is required; do not request/read/pass a passcode or wipe/re-pair. Physical launch/auth/share remain BLOCKED until observed.

**Android:** discover SDK/JDK/AVDs/devices; use the approved isolated emulator (historical `bookmark_pixel`). Avoid environment variable names that overwrite system defaults; use task-specific path variables when a command needs them. Inspect `adb -s "$QA_ANDROID_SERIAL" shell pm path ai.bookmarkai.supabaseqa` first. A restored old AVD snapshot may not include the installed QA package even when the artifact exists. Install the exact APK with `adb -s "$QA_ANDROID_SERIAL" install -r "$QA_ANDROID_APK"`, without uninstall/wipe. Pull the installed APK from `pm path` and compare SHA256, package/version/code and embedded JS/endpoints to the artifact. Record absent hardware separately from emulator success.

Release Gradle can reuse stale JS assets when EXPO_PUBLIC target changes; use clean isolated generation or explicitly rerun the Release JS/assets task, then hash/inspect the actual APK. Use the original complete screen and actual browser callback, not fabricated custom-scheme success. If the harness cannot see Qt/qemu UI, request its supported authorized alternative or manual test. In current Codex, ADB input/UI dump/screenshot automation needs explicit authorization rather than being used to bypass missing CUA surfaces. An approved other harness can use its supported ADB UI capability under its own permissions. `pm`, install and hash inspection alone do not prove auth/save/restart.

## 10. Evidence, failures and cleanup

For MFA enrollment, use a dedicated disposable fixture and persist a zero-preexisting-session/factor baseline before verification: successful provider MFA verification may invalidate other lower-assurance sessions. Create a fresh AAL1 session after enrollment to test the MFA gate, and preserve any AAL2 sibling. Never enroll MFA on a shared fixture merely to satisfy the test.

For foreign-content isolation, first obtain an existing exact owned object and prove the owning account can read it successfully; then test the foreign account. Empty libraries or an arbitrary unknown ID returning 404 do not prove isolation. Keep per-attempt private receipts distinct, including the original assertion failure and cleanup, rather than overwriting an earlier run with a passing retry.

If native computer control times out across multiple apps, retry a fresh binding or reset the supported tool once. Preserve application state, record the UI checks as blocked, and continue independent API/package checks; do not force-quit personal apps or switch to prohibited input automation.

For each case, preserve artifact provenance → action → visible result → protected server/data confirmation where applicable. Number screenshots/logs by case/client/run. Distinguish source revision from dirty snapshot hash, compiled artifact from installed bytes, current session from old persisted Keychain, web session from separate native/extension session, and simulator from hardware. Read-only backend correlation may use client label/time/session-match booleans; never dump Auth hashes/tokens or personal metadata.

Do not conceal FAIL as BLOCKED: a real wrong endpoint, lost callback or wrong window after exercising it is FAIL; no device/UI/credentials is BLOCKED. Do not continue guessing after repeated tool failures. Record pending action and inspect eventual state before another submission. Fix source, rerun focused affected checks, then actual failed journey on the new installed/deployed artifact. Broader repeat tests require new changes or unresolved concerns.

Clean exact newly created IDs on A with normal authorized API/UI; verify absence and all pre-existing IDs preserved. Restore settings/Live/sync/privacy/browser appearance to baseline. Never delete by URL/title/time/prefix alone, unknown imported/native nodes, personal sessions or another agent's fixtures. Revoke only this run's tokens/sessions; keep an observer session for revoke tests. If account deletion was explicitly in scope, do it last only for a confirmed disposable newly created account; imported legacy-account automatic deletion is not ready. Record residue if ownership/cleanup is blocked.

Store sanitized evidence and the completed report under a durable run folder (for example `qa-runs/<run-id>` or an approved external artifact location). Machine-local `.work` is staging, not the only handoff. Before sharing, redact secrets/personal content and copy the report/evidence manifest to durable storage. Update this guide only with reproducible procedure improvements; append dated results/gaps separately. A new PASS names the exact artifact/mode/action and never erases another platform's blocked case.

### Live publishing switches

For `LIVE-01/02`, use three exact owned extension sessions and an independent reader, with only controlled fixture tabs. An extension OFF must remove only its verified session snapshot, emit its device-delete update and keep sibling writers/account opt-in active. Sibling next pushes succeed. Explicit own ON resumes; website account-wide OFF retains its all-device purge/stop behavior. New-window and window-name preferences survive an extension stop. Foreign device IDs or body capability labels never grant ownership.

Run the isolated backend race fixture from `apps/live-server` with `node --import tsx --test src/extension-publishing.integration.test.ts`. It starts its own Redis UNIX socket (TCP disabled), owns an ephemeral AOF directory and removes only that directory. `LIVE_TEST_REDIS_SERVER` optionally selects the Redis binary; no provider/production credentials or Redis URL are used. Provider verification/account lookup are simulated while actual auth policy, routes and Redis Lua commits execute. Pause each commit branch, test OFF and OFF→ON, account-wide OFF, retry and actual Redis AOF restart. A stale epoch after ON returns success without writing: unchanged extensions interpret an OFF response as a command to stop. This local integration proof does not establish installed Safari or hosted production behavior. Never flush production Redis or stop its service for fault testing.

An inherited child-agent sandbox can still reject loopback socket binding with `EPERM` after the parent enables full access. Hand the parent the exact scoped command/profile and review its retained result; do not broaden access or claim the child executed it. In the October 9 production run, a Python canonical HTTP probe returned non-JSON403 outside the application's JSON auth response. That does not prove app auth/scope rejection. No User-Agent, route or protection workaround was used: normal revealed fixture identity, actual Chrome toolbar OFF and a subsequent owned Firefox tab visible in the canonical viewer supplied the bounded browser proof. If cleanup times out after a switch click, inspect existing normal UI checked/enabled state before another action; never blindly toggle again.
