# Portable end-to-end testing

Use this guide with a human tester or any authorized automation harness. It covers the web/API, native Mac app, iOS, Android, Chrome, Firefox, Safari, auth, Live Tabs and MCP. **The production release path uses black Bookmark AI packages and production identities. Yellow `supabase-qa` packages remain separate test installations. Neither local package creation nor installation is store publication.** Build success is not a runtime pass.

## Quick start

1. Read [the runbook](RUNBOOK.md), record the checked-out revision and dirty diff, and create a private run directory using [the report template](RUN-REPORT-TEMPLATE.md). Discover current scripts/devices rather than copying a historical build path.
2. For production and hosted yellow QA clients, use **https://www.bookmark-ai.cloud** and **https://live.bookmark-ai.cloud**. No local server or Metro is required for an embedded Release. Confirm each actual installed/running artifact, profile and hash before rebuilding.
3. Use a new disposable account for writes and a second disposable account for isolation tests. Keep credentials private. Existing migrated/personal accounts are read-only: the observed owner's 89-bookmark library is a dated baseline, not a permanent expected count. Imported Clerk passwords were not inherited; use the established provider or verified recovery on the same account.
4. Run fast source checks, then [P0 identity/auth/library/restart journeys](MATRIX.md). Use the real extension toolbar popup; the Mac Sign In button must open the default browser. Preserve the complete native mobile sign-in screen.
5. Continue [P1 feature journeys](MATRIX.md) on every supported client. If phone unlock, provider credentials, UI access or one browser is blocked, record that step and continue independent API/unit/simulator/client tests. One operator owns shared UI at a time.
6. Capture action → visible result → protected data evidence, then clean up only exact objects created by this run. Publish a sanitized report with **PASS / FAIL / BLOCKED / NOT RUN / N/A**, the test mode and source/artifact identity. Leave original apps and personal data intact.

## Production package path — 9 October 2026

Use `corepack pnpm production:supabase <surface> <action>` for production (`supabase-production`). The stable handoff folder is `dist/production`, with `ARTIFACTS.json` hashes/identity and `INSTALL.md`; confirm the folder's completed artifacts rather than assuming every requested platform built. Chrome uses `ffhbgpgebpmofjkehpjcemepbgcmoelp`, Firefox `bookmark-ai@bookmark-ai.cloud`, Mac `ai.bookmarkai.macos` / `bookmarkai-macos://auth/callback`, and mobile `ai.bookmarkai` / `bookmarkai://sso-callback`. Verify Safari companion/extension identifiers from its manifest and Info.plist. Production sessions are separate from earlier native/extension QA storage; inspect each running artifact before testing.

The web auth pages adapt upstream shadcn login-03 with one centered logo/form, no navbar and a standalone top-right theme icon. Marketing retains its navbar and complete theme dropdown; authenticated Appearance controls live in Settings. Password submission immediately shows truthful full-screen sign-in feedback, followed by account setup until readiness is confirmed, with retry on failure. The [production release report](reports/2026-10-09-production-release.md), [client report](reports/2026-10-09-clients.md), [mobile report](reports/2026-10-09-mobile.md) and [web UI report](reports/2026-10-09-web-ui.md) distinguish deployed/runtime evidence from package/source checks and uncompleted provider journeys.

## Starting gaps — 6 October 2026

This is a handoff snapshot, not a current universal-pass claim. Recheck it when starting a new run and append new evidence rather than promoting old build proof into runtime proof.

| Surface | Observed boundary at this handoff | Next proof |
|---|---|---|
| Mac | Fresh installed Release opens default browser; a consumed native flow matches the signed-in owner; 89 bookmarks and cold restart observed. | Disposable-account write/search/session management and named-provider completion. Keep the personal session read-only. |
| iOS | Embedded Release simulator password login, save/read and restart passed; corrected signed app installed on phone. | Unlock phone and prove physical launch/auth/share/provider return; successful mobile MFA. |
| Android | Release installed in QA emulator; pulled installed APK hash matches artifact. | Actual UI auth/save/restart/provider return. No physical Android hardware was attached. |
| Chrome | Final unpacked QA addon enabled/reloaded; retained identity and fresh production save passed. Two-tab session save and actual two-tab new-window restore on promoted web bridge passed. | Cold browser restart, Live and revoke. |
| Firefox | Hosted authorization produced a distinct Firefox extension session corroborated by backend. | Final normal addon reload, signed-in popup, save/session UI and restart after temporary-addon reload. Native UI tool timed out. |
| Safari | Signed distinct companion installed/enabled; running worker verified; user manually opened hosted login. | Authenticated callback and save/read. Old migrated password failure is a separate account issue; recovery E2E is not yet proved. |
| Shared | Web source: 810 tests/69 files; extension: 242/28; mobile: 155/37; both Mac configurations zero failures. | These dated source checks do not replace any pending runtime journey. Actual email recovery, Apple completion and real multi-week idle survival remain separate gates. |

The Chrome restore patch preserves the store ID, discovers the fixed QA ID with harmless PING, and sends one restore only. On 6 October it was promoted as deployment `dpl_Fyxuf1Bj8rx6U8dAiPFbjZBpESDu`, frozen source `7595517` with runtime patch `b64162d`; canonical health 200, signed-out me 401 and sign-in 200 passed. After a hard refresh, one New window click opened a distinct window with the two saved URLs; the original four-tab window stayed unchanged and no fallback appeared. This is a dated `EXT-04` hosted Chrome PASS, not other-platform or future-artifact proof. The previous Supabase deployment remains available for rollback; do not revert to Clerk merely because a new UI case is blocked.

## Pasteable harness handoff

> Test Bookmark AI using docs/testing/README.md, RUNBOOK.md, MATRIX.md and RUN-REPORT-TEMPLATE.md. Verify current source/scripts and actual installed artifacts before acting. Preserve original native sign-in entrypoints, original installations and production personal data. Web auth uses the centered logo/form with no navbar and a standalone theme icon; marketing keeps its navbar, and authenticated Appearance controls live in Settings. Use controlled disposable accounts for writes and exact-ID cleanup; migrated owner access is read-only. Execute the applicable journeys with observed evidence, not only a plan or code review. Choose supported headed browser/native/manual paths and continue independent tests when a device/tool/provider is blocked. Respect explicit denials and OS permissions; do not infer deployment, store submission or security-setting authorization. Report each case by client/mode/artifact as PASS, FAIL, BLOCKED, NOT RUN or N/A, retain sanitized evidence, and leave the final state clear.

## Contents and source of truth

- [Quick check](QUICK-CHECK.md): short user-facing release checklist.
- [9 October production release report](reports/2026-10-09-production-release.md): final deployment/package identity, observed release results and remaining gates.
- [9 October clients report](reports/2026-10-09-clients.md): browser/Mac production packages, source checks and actual client runtime boundaries.
- [9 October mobile report](reports/2026-10-09-mobile.md): signed production mobile artifacts, endpoint checks, simulator results and physical-device boundaries.
- [9 October web UI report](reports/2026-10-09-web-ui.md): local and deployed login-03, Appearance, setup timing, session revocation and provider launch evidence, with completion limits.
- [7 October Chrome authentication report](reports/2026-10-07-chrome-auth.md): wrong-provider artifact cause, actual personal-Chrome same-www-profile reuse/callback PASS, and Google return/authenticated apex repeat NOT RUN; supersedes only the cases it exercises.
- [Runbook](RUNBOOK.md): environments, build/install commands, harness alternatives, sequencing, platform failure patterns and evidence/cleanup.
- [Journey matrix](MATRIX.md): stable case IDs, prerequisites, steps, expected results and evidence; includes destructive disposable-account tests and isolation.
- [Run report template](RUN-REPORT-TEMPLATE.md): copy into each run and keep all results attributable.
- [Historical playbook](../TESTING.md): older recipes; its Clerk/open-mode paths do not define current hosted Supabase behavior.
- Relevant architecture: [Supabase QA setup](../features/supabase-qa-setup.md), [migration](../features/supabase-auth-migration-plan.md), [provider setup](../features/supabase-social-providers.md), [MCP](../features/mcp.md), [Live Tabs](../features/live-sessions.md), [theme and AI settings](../features/theme-picker.md), [native sync proposal and ownership risks](../features/universal-bookmark-sync-proposal.md).

The October run's `.work/production-clients-oct6` reports/screenshots are useful historical evidence if present, but are ignored machine-local artifacts. The procedures and expectations here are committed and do not depend on those files. Preserve sanitized evidence outside the checkout when handing work to another machine; never publish private credential files.
