# Supabase QA verification — 4 October 2026

Work is isolated on `codex/supabase-auth`; initial implementation checkpoint `5362d91`, followed by the automatic web-session label correction and final QA record on the same branch. This is a verification record, not approval to migrate production or submit store builds. The Clerk checkpoint and rollback instructions are in [decisions and rollback](supabase-decisions-and-rollback.md).

## Verified against the new hosted project

Twenty-eight checks passed against the real Supabase project and isolated local services:

- Separate native sessions, recognizable device labels, own-session rename/list, and denial of cross-user management.
- Selected-device revoke rejects an already-issued, unexpired JWT and its refresh token. Other devices remain signed in. Concurrent refresh cannot restore a revoked session.
- “Sign out others” and account-wide sign-out have the expected user scope.
- Extension PKCE creates a distinct native session; authorization-code reuse fails. Extension credentials have restricted capabilities and can be revoked independently.
- New canonical accounts provision separate, owned `bmai-sbqa-` Turso databases. Bookmark create/read/search/delete and cross-account isolation pass.
- Existing `bkmcp_` integration credentials work with the new identity routing and stop working after token revocation or account deletion.
- Disposable account deletion removes its Supabase identity/sessions and Turso content database, while completing its durable deletion receipt.
- Real TOTP enrollment produces an accepted AAL2 session. A new password-only session for that account cannot access protected application data.
- Live Tabs isolates accounts and limits extension writes/deletes to their own native-session device ID. An existing stream closed 15.296 seconds after revocation; reconnection was denied. The implementation's worst-case watchdog bound is 25 seconds after the last successful check.

Test users and credentials are private, ignored fixtures. No production users or databases were used.

The later Android UI deletion also passed three independent server checks: a separate session's retained access and refresh credentials were rejected, the disposable Supabase identity returned 404, and the private account deletion receipt completed with no remaining identity, tenant or usage rows. Its recorded QA Turso database returned 404.

## Automated and build evidence

| Surface | Verified result |
| --- | --- |
| Web/API | 758 tests across 59 files pass; isolated production-mode Next.js build passes after the final automatic browser-label fix. Actual browser email sign-in, device listing/current marker/rename, bookmark save/search and local logout pass. Signing into a different account in the same browser shows an empty library; the first account's exact bookmark returns 404. |
| Live server | 60 tests pass; compiled ESM server starts and serves authenticated traffic. |
| Mobile | 126 focused tests, typecheck, iOS/Android Hermes exports, and both native compilations pass. Actual Android password login, protected library, cold-start restoration, device rename/revoke and signed-out cold start pass. An external share captured before sign-in survives a process restart and saves one matching bookmark after sign-in. Account switching shows no prior account content. Disposable account deletion through the app passes independent server verification. A later Device Hub tooling recovery enabled actual iPhone and iPad password login, protected library, cold-start restoration, and current-device local logout; all passed. iPhone current-device renaming also passed. |
| macOS | Separate signed QA build and 24 auth/state/flush tests pass. Real login, Keychain persistence, cold start and device controls remain unverified. The later computer-use retry was denied; after a connection refresh the native app API was unavailable despite the owner's enabled setting. |
| Extension | Actual Chrome popup OAuth, save and selected-session revocation pass. Firefox's launch blocker was later resolved: actual consent/PKCE login, protected save, full-process restart restoration and local logout pass. Its retained old bearer returns 401. Safari has a distinct development-signed QA wrapper with verified signatures; installation, enablement and authenticated runtime remain pending. |
| Isolation | Separate source/dependency snapshots, native identifiers, storage, callbacks and native compiler overlays. Ten wrapper tests passed; existing Clerk artifacts remain preserved. |

Private detailed logs and manifests are under `.work/supabase-implementation/` and `.work/builds/supabase-qa/`. A build or simulated expiry test does not establish a real device journey or elapsed multi-week persistence.

An exact-value scan found no private QA credentials in 176 changed/new paths or 169 generated frontend files across six web, extension and mobile output directories. This is a specific leak check, not a claim of a complete independent security audit.

Final browser evidence is recorded in `.work/supabase-implementation/browser-runtime-report.json`. Its label follow-up verifies a fresh login displaying `Web · Chrome`, `Chrome · macOS`, and `This device`; a user-chosen name survives a full reload and re-registration, followed by local logout. The follow-up screenshots are `web-automatic-chrome-label-qa.png` and `web-rename-preserved-after-reload-qa.png` in the same report directory. Android evidence is in `mobile-report.md`, `android-share-row-proof.json`, `android-delete-proof.json` and `mobile-qa/` there. Browser-created bookmarks and sessions were cleaned individually; other QA clients' fixtures were preserved.

The simulator tooling blocker was resolved without a build or reinstall: this Xcode installation exposes **Device Hub**, not the historical `Simulator.app` path. The earlier chats and setup notes were reviewed; the current launcher and actual iPhone/iPad evidence are recorded in `simulator-recovery-oct4.md` and `mobile-qa/`. Both isolated simulators were left signed out; the Android fixture's session was preserved.

Production Google and Apple credentials were configured in the new Supabase project under the owner's subsequent authorization. Both provider flags were independently confirmed through the hosted Auth settings endpoint (HTTP 200). The existing Clerk callbacks and credentials remain intact. Google's consent app is now External / In production; a real Google browser login, connected-account display and local logout passed. Apple reached its correct branded login page, with completion pending owner sign-in. See [provider configuration and Apple renewal](supabase-social-providers.md). The Apple JWT generator also passed six focused tests for claims/signature, expiry bounds, key types, protected output files, and secret-free CLI output.

## Additional readiness pass

A fresh review found and fixed four defects before owner handoff:

- Public `/api/health` returned 500 because it opened the legacy API context. It now reads AI configuration without opening any database; four regressions and a live HTTP 200 check pass. Protected signed-out endpoints still return 401.
- Mobile admitted a password session without presenting the required authenticator challenge. It now gates protected views/token delivery until the SDK verifies the required assurance level, supports TOTP/retry/local cancellation, and rejects late verification results after signout or identity changes. Twenty-two focused mobile tests pass, independently repeated from an isolated snapshot. These use real SDK code with mocked provider HTTP, not native MFA UI proof.
- Profile names differed across clients because metadata keys disagreed. Profile edits now write both fields and read canonical `full_name` with the earlier `display_name` as fallback. Seventeen focused web auth/profile/health tests, web/mobile typechecks, the isolated web production build and iOS/Android Hermes exports pass. A fresh hosted-account check also verified profile PATCH, `/api/me`, and both provider metadata fields; original values were restored and the observer session signed out locally (`profile-name-runtime-oct4.json`).
- Extension auth recovery left a stale warning after a slow startup, with incorrect website-session-sync guidance in Supabase mode. Successful background responses clear that warning; Supabase-specific guidance describes retrying the separate extension session. Four recovery/copy tests, nine OAuth tests (including malformed-token handling), the isolated extension typecheck, and Chrome/Firefox/Safari builds pass. The final Firefox artifact's actual popup was inspected and shows no stale warning (`firefox-final-popup-content-oct4.png`).

Fresh iPad save/search, iPhone visibility of that saved bookmark, and iPad background/reopen around a brief service restart passed. Only the newly created, exact-ID test record was deleted; the original Android record and other sessions were preserved. Keyword search explicitly reported that AI ranking was unavailable. This is not device-offline or complete AI feature evidence.

Firefox's actual callback was observed in a disposable profile and registered in the QA project. Launching Firefox through macOS LaunchServices resolved the earlier profile error. The test used a temporary add-on, so the restart check reinstalled that same add-on before verifying preserved authentication; this does not claim a temporary add-on survives browser restart.

The final Safari source snapshot was development-signed separately at `.work/supabase-implementation/safari-readiness-final-signed-oct4/Build/Products/Debug/Bookmark AI Supabase QA.app`. Strict/deep signature verification passes for the companion and extension; their identifiers remain `ai.bookmark.safari.supabaseqa` and `ai.bookmark.safari.supabaseqa.Extension`. The artifact includes the latest extension fixes and was not installed or enabled. No production companion was replaced.

Detailed current evidence: `.work/supabase-implementation/extension-readiness-oct4.md`, `mobile-readiness-oct4.md`, `readiness-audit-oct4.md`, and their referenced screenshots/logs. After the agent refreshed the shared computer-use connection, it exposed only browser APIs; the owner's screenshot confirmed Any App enabled. macOS/Safari runtime and fresh mobile MFA UI remain explicitly unverified. The running mobile apps still use the earlier immutable snapshot; the latest MFA fixes have export/test evidence, not installed native UI evidence. No claim that all apps are bug-free or ready for release is supported.

## Remaining release gates

- Restore native computer-use access, finish Safari/macOS authenticated runtime journeys, and verify the new mobile MFA challenge on iPhone/iPad/Android. Firefox's former launch/callback blocker is resolved. Safari has signed build proof but no installed extension journey. The earlier Device Hub recovery enabled iOS checks, but native control is currently unavailable again.
- Complete physical-device, offline/reconnect, and native share-extension coverage. The verified Android share flow is one pending encrypted capture, not a multiple-item queue. Multi-week idle checks are simulated; real elapsed 21/30-day persistence has not been observed.
- Complete Apple browser login, native Google/Apple journeys and Apple signing, and real email delivery/recovery. Provider credentials and Google browser login are now verified separately from confirmed-email test fixtures.
- Review the OAuth Server beta dependency and Free-plan absence of hosted breached-password screening before production adoption.
- Existing-user migration, production environment, recovery-worker scheduling, custom accounts domain, signed store artifacts and deployment remain a separately approved cutover phase.

No claim of complete all-device or store readiness is made while these gates remain.
