# QA continuation — 16 October 2026

Status: **Safari launch PASS; first-attempt sign-in reliability FAIL; final signed-in popup observed after retry.** Root continues runtime QA; this is not whole-auth acceptance or a bug-fix claim. This report combines independent artifact/simulator preflight with attributed root UI evidence. October 9–10 portal/blocker/session observations remain historical until refreshed. Store readiness is not claimed.

## Current source and concurrent work

- Observed HEAD: `2e0e787`; current branch: `codex/release-1-organization-composer`. Active Release 1 organization/composer/import changes and preexisting retention work remain preserved.
- Newer local evidence exists in `.work/release-1/STATUS.md`, `CONTRACT.md`, `QA-BRIEF.md` and October 16 baseline logs: web **823 tests / 72 files**, mobile **166 tests**, extension **251 tests / 29 files**, all passed in those logs. This operator read the results; it did not rerun the suites. No Mac baseline or new-feature UI E2E is recorded there.
- Release 1 acceptance and any future packages are separate from the preserved October production artifacts. Its contract requires isolated fixtures/databases and protects installed applications. Do not run broad suites against moving dirty source solely to repeat the baseline.

## Fresh artifact and simulator preflight

| Item | Fresh observation | Boundary |
|---|---|---|
| Canonical mobile kit | `dist/production/mobile-manifest.json` describes Supabase production Release **1.0.2 (102)**, original identity `ai.bookmarkai`. Simulator ZIP, Android APK and development IPA freshly SHA256-match their manifest entries. | Files date from October 9; hash equality is artifact identity, not a fresh journey. AAB was not rehashed in this continuation. |
| Canonical desktop/extension kit | `dist/production/ARTIFACTS.json` still records Chrome/Firefox/Safari **0.1.6**, Mac **0.1.1 (8)**. | It predates the preserved isolated Mac build 9 and Safari 10601 archives; do not use it as their manifest. |
| Preserved replacement archives | `.work/production-oct10/mac-signing-repair/build9/BookmarkAI-0.1.1-9.xcarchive`; `.work/production-oct10/apple-distribution/safari-10601/BookmarkAISafari-0.1.6-10601.xcarchive`; `.work/production-oct10/mobile-store/Bookmark-AI-iOS-1.0.2-102.xcarchive` exist. | Existence/dated metadata were checked; signing, processing and current portal selection were not repeated. |
| iPad simulator | **Bookmark AI Supabase QA iPad**, UDID `AD8B3E9B-18D7-4391-8D08-658052254678`, iOS **26.5**. Initially Shutdown; subsequently booted and launched under explicit authorization below. | No physical device was queried or selected. |
| Installed iPad production app | `ai.bookmarkai`, **1.0.2 (102)**, executable `BookmarkAI`; installed path below. `main.jsbundle` SHA256 **`d5a4c13edf307246186dd990767520668f0613f343ef74f385517fd34546320f`** matches canonical simulator manifest. | Info.plist and installed bundle bytes were read directly without launch. Existing separate `ai.bookmarkai.supabaseqa` **1.0.1 (92)** remains installed. |
| Android | SDK `~/Library/Android/sdk`; emulator and adb binaries available. `adb devices -l` lists no attached devices. Preserved `bookmark_production_oct10_api24` uses API24 Google APIs ARM64; `bookmark_production_oct10_16kb` uses API36 `google_apis_ps16k` ARM64. `bookmark_pixel`, `bookmark_api24`, `bookmark_production_oct9` also exist. | No emulator launched, device inspected or app installed. Prior measured 16KB runtime evidence remains historical. |

Exact installed iPad production bundle:

```text
/Users/tara/Library/Developer/CoreSimulator/Devices/AD8B3E9B-18D7-4391-8D08-658052254678/data/Containers/Bundle/Application/8E5F91CF-4E78-4124-8955-1F6E80356FE1/BookmarkAI.app
```

## Evidence map and remaining proof

| Priority / case | Applicable existing evidence | Next proof; current status |
|---|---|---|
| Safari AUTH-04/11/12, BOOK-01/02, AUTH-05 | **Fresh root/user runtime:** user manually activated Sign in. Authorization opened/completed once but popup remained signed out; a second sign-in succeeded. Root saw a generic retry callback page and then the real popup signed in with masked owner email, Save bookmark/session controls and Live OFF. Earlier CUA AX/coordinate attempts dismissed the popup; right-click reached the underlying page, indicating a separate targeting limitation. | **Launch PASS; first-attempt reliability FAIL; final signed-in UI observed after retry.** Not whole auth PASS. Root continues callback/session reliability diagnosis, protected reads, exact save/observer proof and restart. No source fix claimed. Google-specific completion remains independent. |
| Safari LIVE-01 | Fresh signed-in popup shows **Live OFF**. Historical Chrome OFF / Firefox continuing-writer evidence and backend race tests are separate. | Safari own OFF/ON must preserve other writers and account opt-in. **Toggle behavior not freshly observed here.** |
| iPad AUTH-05/09, LIB-01/UI-01 | **Fresh root CUA:** exact simulator selected in Device Hub; production Settings shows **1.0.2 (102)** and expected **Release web fixture** identity. Session persisted into October 16, about seven days after the earlier login. Library loads **4 bookmarks**; Filters opens; observed landscape screenshot shows no overflow. | This closes those specific observed gaps. Bookmark detail, complete filter behavior, other layouts and real 21/30-day idle survival remain separate. No fresh credential entry was needed. |
| iPad Sessions/Devices | **Fresh root CUA:** Sessions shows valid **Saved 0** empty state; grouped Devices loads **Apps/Web 12**, **Extensions 2**, with current device marked. | A Firefox row is labeled `firefox extension` while its subtitle says `Chrome extension · firefox · macOS`. **Uninvestigated possible metadata-label mismatch**, not a confirmed cause or regression. No device revoked or renamed. |
| iPad SEARCH-01 | **Fresh root CUA:** `setValue('Example')` after typeText failed produced **4 matching results**. Opening a result reached **example.com in simulator Safari**; native BookmarkAI return crumb restored the query/results. | **Observed search/open/return continuity PASS.** Clear and other facets remain separate. CUA text-entry targeting limitation is not a confirmed app defect. Capture Keyboard restored **OFF**. |
| iPad AI-01 read-only history | **Fresh root CUA:** Ask AI existing-conversation list opened `hi`; stored answer and bottom composer rendered in landscape. | History/display subset observed; **no AI message sent**, and no streaming/tool/budget acceptance claimed. |
| iPad Home portrait | **Fresh root CUA:** Home restored in portrait after the landscape walkthrough. | Specific restored layout observed; no physical device selected or personal-data mutation. |
| Mac bounded runtime | **Fresh root CUA:** installed `/Applications/Bookmark AI.app` **0.1.1 (8)** restores expected Release web fixture and **4 bookmarks**. Settings General reports **Reachable / Yes / Configured**; Account shows correct fixture identity; Devices loads **14 rows**, including **This Mac**. Window menu lists one **All Bookmarks** entry. | No writes/session mutations. After a close/reopen action the Window menu again showed one All Bookmarks entry, but CUA getAX autoactivation may itself reopen the window: **do not claim complete reopen-lifecycle PASS**. The same Firefox/Chrome subtitle mismatch is also visible on Mac, confirming cross-client display inconsistency; cause remains unverified. |
| API-01 public HTTP subset | **Fresh root curl:** health **200**; anonymous bookmarks **401**, sessions **401**; apex sign-in redirects to canonical www and finishes **200**. | HTTP smoke, not authenticated UI/data proof. Local Python urllib certificate-chain verification was unavailable; system-trust curl worked. No TLS-verification bypass was used. |
| Store-installed extension lifecycle | October reports contain public availability and signed-package evidence. | Chrome/Firefox signed installed auth/restart: reconcile current chats/runtime. Store/package availability alone does not close this case. |
| Auth/security | October 10 API refresh, exact revoke, MFA gates, symmetric session isolation and bookmark read isolation passed. | Delivered signup; final deployed recovery UI/expiry/MFA; security UI and account-cache swap; other content/Live/export/MCP isolation remain separate from those API passes. Use exclusively assigned fixtures. |
| Apple recording/distribution | Historical Safari 10601/iOS102 selected; Mac9 processed with compliance/selection pending then. Fresh independent installed signatures: Mac **0.1.1 (8)** and Safari **0.1.6 (10601)** both pass deep/strict codesign verification. | **Current Apple portal status unverified.** Installed Mac build 8 is distinct from preserved store-repair build 9. Confirm recording/review artifact parity and disposable recording identity; do not reassert old lock/compliance blockers as current. |
| Web deployment rollback provenance | **Fresh root Vercel inspection:** canonical production remains **`dpl_6naNLjTs1FxkztXCgB1W5x9G3n3N`**, October 9, Ready. Current project settings match `apps/web` and `.next-supabase-production`. | Root preserved current rollback evidence at `/Users/tara/.codex/worktrees/safari-auth-reliability/bookmark-ai/.work/safari-auth-oct16/rollback.json`. This is refreshed rollback identity, not deployment or auth acceptance of an upcoming repair. |
| Physical/elapsed cases | Physical-phone restriction remains documented; API24/16KB startup/restart already evidenced; iPad fixture restored after about seven days as observed above. | No physical device work in this continuation. Actual 21/30-day idle survival and physical provider/share/PWA behavior retain separate evidence requirements. |

Private fixture filenames were located, without reading or printing credentials: `web-fixture-private.json`, `production-web-fixture-private.json`, `production-web-fixture-1791491930413-private.json`, `recovery-web-fixture-private.json`, `mfa-fixture.json`. Existing ownership, assignment and account state must be reconfirmed before use; filename existence is not assignment or current credential validity.

### Safari Inspector corroboration

Root observed the Personal extension worker's **two trusted launch-request events**. After the first, repeated GET_USER results remained `signedIn:false`. After the second, GET_USER was false at about **80 ms**, then true at about **1630 ms**; subsequent credential-warm metadata reported `hasToken:true` and nativeAuth `signedIn:true`. These safe booleans corroborate the runtime sequence; no raw credentials were logged. They do not establish the cause of the first-attempt failure or prove the whole auth/save/restart journey.

### Feasible independent read-only follow-ups

- Compare exact installed Mac/Safari versions, signature validity and resource hashes with preserved recording/review artifacts; do not replace applications or promote package identity to runtime PASS.
- Trace the Firefox device subtitle from existing source and frozen source only. Current mobile presentation maps `clientType` directly to its label; server registration can fall back to `chrome-extension` when its OAuth-client display map has no valid entry (`apps/web/lib/server/session-management.ts`). **Possible explanation only**: the current stored row and deployed mapping have not been read, and no metadata correction is authorized here.
- Reconcile current store/build selections from newer chat receipts before repeating portal work; verify public support/privacy/download targets with bounded anonymous HTTP if still uncovered. No inbox action, auth/session mutation, builds or broad suite repeat is required for these checks.

## Authorized simulator preparation

After preflight, root explicitly authorized CLI-only boot and launch of this exact simulator/app while preserving Safari UI for the user's manual click. These commands completed successfully:

```sh
xcrun simctl boot AD8B3E9B-18D7-4391-8D08-658052254678
xcrun simctl bootstatus AD8B3E9B-18D7-4391-8D08-658052254678 -b
xcrun simctl launch AD8B3E9B-18D7-4391-8D08-658052254678 ai.bookmarkai
```

Launch returned **PID 36705**. A subsequent exact-simulator `launchctl list` check found running `UIKitApplication:ai.bookmarkai` with PID 36705 and status 0; the simulator inventory reports **Booted**. This independent preparation establishes process readiness only; root's subsequent actual UI observations are separately recorded above.

Root subsequently selected only this exact simulator through **Device Hub (`com.apple.dt.Devices`)**, the current supported simulator UI. The old `com.apple.iphonesimulator` app identifier is invalid on this installation. No physical-device stream was selected; Capture Keyboard is restored OFF. No personal-device or personal-data mutation is reported. Android does not need another startup/16KB smoke solely to repeat historical proof; boot an existing isolated AVD only for an assigned uncovered account/provider/navigation case. No rebuild, install or broad suite repeat is required by this preflight.

This operator wrote this report and, under subsequent explicit preparation authorization, the isolated worktree's `.work/safari-auth-oct16/install-safari-10602.py`. The installer was **not executed**; no plan or installation receipt was created. It requires an exact successful staged source, pins both bundles' IDs/version/build/hashes/signatures/App Group, preserves the original canonical kit, checks the companion is closed, and retains one original verified rollback through a guarded replacement. Only static syntax parsing was performed.

This operator performed authorized CLI simulator boot/launch and process verification, without GUI/input/screenshots, installation, fixture mutation, explicit production API requests, builds, commits or pushes. Root's CUA and public HTTP observations are attributed separately above; no product changes are reported.
