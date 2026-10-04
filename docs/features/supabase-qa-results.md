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
| Mobile | 126 focused tests, typecheck, iOS/Android Hermes exports, and both native compilations pass. Actual Android password login, protected library, cold-start restoration, device rename/revoke and signed-out cold start pass. An external share captured before sign-in survives a process restart and saves one matching bookmark after sign-in. Account switching shows no prior account content. Disposable account deletion through the app passes independent server verification. iPhone/iPad simulator startup and sign-in layout pass; credential entry is blocked by the missing host Simulator application. |
| macOS | Separate signed QA build and 24 auth/state/flush tests pass. UI selection stalled before login; real login, Keychain persistence, cold start and device controls remain unverified. |
| Extension | Chrome/Firefox/Safari JavaScript builds and OAuth tests pass. Actual Chrome popup OAuth creates a distinct native extension session; saving the active QA article succeeds. After selected-session revoke completes, the retained old bearer returns 401 and the popup shows Sign in. Firefox runtime is blocked before add-on installation. Safari native wrapper compiles with distinct app/extension IDs; it is unsigned and has not been installed or enabled. |
| Isolation | Separate source/dependency snapshots, native identifiers, storage, callbacks and native compiler overlays. Ten wrapper tests passed; existing Clerk artifacts remain preserved. |

Private detailed logs and manifests are under `.work/supabase-implementation/` and `.work/builds/supabase-qa/`. A build or simulated expiry test does not establish a real device journey or elapsed multi-week persistence.

An exact-value scan found no private QA credentials in 176 changed/new paths or 169 generated frontend files across six web, extension and mobile output directories. This is a specific leak check, not a claim of a complete independent security audit.

Final browser evidence is recorded in `.work/supabase-implementation/browser-runtime-report.json`. Its label follow-up verifies a fresh login displaying `Web · Chrome`, `Chrome · macOS`, and `This device`; a user-chosen name survives a full reload and re-registration, followed by local logout. The follow-up screenshots are `web-automatic-chrome-label-qa.png` and `web-rename-preserved-after-reload-qa.png` in the same report directory. Android evidence is in `mobile-report.md`, `android-share-row-proof.json`, `android-delete-proof.json` and `mobile-qa/` there. Browser-created bookmarks and sessions were cleaned individually; other QA clients' fixtures were preserved.

## Remaining release gates

- Finish Firefox, Safari, macOS and iOS/iPadOS authenticated runtime journeys. Firefox's isolated runtime fails before add-on installation with "Could not find profile folder"; its callback has not been registered from unverified calculations. macOS automation stalled before returning UI. Safari has build proof but no installed extension journey. iOS/iPadOS have launch proof but no credential-entry UI tooling on this host.
- Complete physical-device, offline/reconnect, and native share-extension coverage. The verified Android share flow is one pending encrypted capture, not a multiple-item queue. Multi-week idle checks are simulated; real elapsed 21/30-day persistence has not been observed.
- Configure and verify Google and Apple provider credentials/callbacks, native Apple signing, and real email delivery/recovery. These are not established by confirmed-email test fixtures.
- Review the OAuth Server beta dependency and Free-plan absence of hosted breached-password screening before production adoption.
- Existing-user migration, production environment, recovery-worker scheduling, custom accounts domain, signed store artifacts and deployment remain a separately approved cutover phase.

No claim of complete all-device or store readiness is made while these gates remain.
