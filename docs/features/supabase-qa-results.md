# Supabase QA verification — 4 October 2026

Work is isolated on `codex/supabase-auth`. This is a verification record, not approval to migrate production or submit store builds. The Clerk checkpoint and rollback instructions are in [decisions and rollback](supabase-decisions-and-rollback.md).

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

## Automated and build evidence

| Surface | Verified result |
| --- | --- |
| Web/API | 754 tests across 58 files pass; isolated production-mode Next.js build passes. Browser email sign-in, device listing/current marker/rename, bookmark save and search verified. |
| Live server | 60 tests pass; compiled ESM server starts and serves authenticated traffic. |
| Mobile | 126 focused tests, typecheck, iOS/Android Hermes exports, and both native compilations pass. Android password login, protected library, cold-start restoration, device rename/revoke and signed-out cold start pass. iPhone/iPad simulator startup and sign-in layout pass; credential entry is blocked by the missing host Simulator application. |
| macOS | Separate signed QA build and 24 auth/state/flush tests pass. UI selection stalled before login; real login, Keychain persistence, cold start and device controls remain unverified. |
| Extension | Chrome/Firefox/Safari JavaScript builds and OAuth tests passed. Safari native wrapper also compiles with distinct app/extension IDs; it is unsigned and has not been installed or enabled. Actual Chrome browser OAuth verification is in progress. |
| Isolation | Separate source/dependency snapshots, native identifiers, storage, callbacks and native compiler overlays. Ten wrapper tests passed; existing Clerk artifacts remain preserved. |

Private detailed logs and manifests are under `.work/supabase-implementation/` and `.work/builds/supabase-qa/`. A build or simulated expiry test does not establish a real device journey or elapsed multi-week persistence.

An exact-value scan found no private QA credentials in 176 changed/new paths or 169 generated frontend files across six web, extension and mobile output directories. This is a specific leak check, not a claim of a complete independent security audit.

## Remaining release gates

- Finish and record actual Chrome, Firefox, Safari, macOS, iOS/iPadOS and Android client journeys. Firefox's isolated runtime currently fails to launch; its callback has not been registered from unverified calculations. macOS automation stalled before returning UI. Safari has build proof but no installed extension journey.
- Configure and verify Google and Apple provider credentials/callbacks, native Apple signing, and real email delivery/recovery. These are not established by confirmed-email test fixtures.
- Review the OAuth Server beta dependency and Free-plan absence of hosted breached-password screening before production adoption.
- Existing-user migration, production environment, recovery-worker scheduling, custom accounts domain, signed store artifacts and deployment remain a separately approved cutover phase.

No claim of complete all-device or store readiness is made while these gates remain.
