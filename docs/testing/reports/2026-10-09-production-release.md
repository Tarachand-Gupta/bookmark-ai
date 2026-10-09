# Supabase production release — 9 October 2026

## Scope and evidence boundaries

This release promotes Supabase from the isolated QA identities to production web and locally installable Chrome, Firefox, Safari, macOS, iOS and Android packages. The owner subsequently authorized Chrome Web Store and Firefox AMO submissions after production extension checks and the recovery repair pass; actual submission receipts must be recorded before claiming publication. Apple/Google Play store submissions are outside this release. The original Clerk checkpoint and previously installed Apple apps remain available for rollback. Existing user data is preserved; the earlier nine-account migration was not repeated.

All delivered clients use `https://www.bookmark-ai.cloud`, `https://live.bookmark-ai.cloud` and Supabase project `xogqaqtyacmecdbmgqqd`. They do not require a local server. Build and unit-test success is separate from observed login, callback, library, restart and physical-device success; see the individual platform reports for actual results.

## Production configuration decisions

- `supabase-production` is the explicit build variant and `bookmark-ai:supabase-production` the client auth storage namespace. Earlier QA/Clerk sessions are not silently imported; sign in again.
- `scripts/supabase-production.mjs` freezes source and public client configuration, checks canonical service endpoints, produces real production identities, and records source and artifact hashes in `dist/production/ARTIFACTS.json`. Mobile additionally has `mobile-manifest.json` and a signed-release audit.
- The standard extension output folders are refreshed from the same production artifacts: `.output/chrome-mv3`, `.output/firefox-mv2`, `.output/safari-mv3`. Old output is retained under the ignored release rollback directory. Ordinary extension build/zip commands must not silently regenerate Clerk output.
- macOS callbacks use `bookmarkai-macos://auth/callback`; iOS/Android use `bookmarkai://sso-callback`. Native handoff accepts only fixed known build variants and callback mappings, with existing PKCE/state validation. It still stores the base client type supported by the database. No schema migration was necessary.
- Supabase received three separate public production OAuth clients. The prior QA clients remain registered. Web and Live accept the exact six client IDs during this transition; this is an allowlist, not dynamic registration.

| Client | Production OAuth client | Exact redirect |
|---|---|---|
| Chrome | `24c554b4-11f7-4730-9432-18686788ceeb` | `https://ffhbgpgebpmofjkehpjcemepbgcmoelp.chromiumapp.org/supabase` |
| Firefox | `ded2e62b-58e9-44ab-8a91-9dbf3ac7afd9` | `https://bbf8f95c67aba661548c23a9abdd835bdefe81a3.extensions.allizom.org/` |
| Safari | `0f8ad82f-846d-4342-af9f-02e02e7b57f5` | `https://www.bookmark-ai.cloud/auth/extension-callback` |

The identifiers above are public configuration, not credentials. No private key belongs in this report or in a shipped client.

Independent review found that mobile's persisted custom Live URL was pinned only in QA mode. Production now pins the canonical Live address before reading persisted overrides, matching the existing exact API/Supabase endpoint validation. Both Live list requests and the event stream use this fixed destination. This fix requires refreshed mobile artifacts; the final mobile report/manifest identifies the rebuilt revision.

## Hosting and rollback

Production Vercel project is `prj_FX3kySx48ohakKTqvg9gO62HNBcj`, under `team_YrK7IQKCrCxbbuxx94RJEZbK`, with `apps/web` as root. A frozen snapshot must explicitly copy and verify the repository's `.vercel/project.json` before deployment; otherwise Vercel may create an unrelated project from the staging-directory name.

The production build sets `BOOKMARK_BUILD_VARIANT=supabase-production`, uses `.next-supabase-production`, and sets `BOOKMARK_PRODUCTION_STAGE_ROOT` to the snapshot root in the build command. Candidate deployments are created with domain promotion skipped, checked, then explicitly promoted. Deployment protection remains enabled; use the authenticated CLI for candidate smoke checks.

The final web promotion in this release is `dpl_B8qCYyGUSPgqVbuw5EpcnH8aa3fE` (frozen source hash `982e17123be72d346f327659a56600bc7b780a760fd64ecedeb188d37a18f1b6`). It also repairs ordinary web/PWA password recovery with code entry and resend controls and includes the corrected extension callback allowlist. It includes the owner's requested auth-navbar removal, immediate signing feedback, and an MFA transition fix: identity changes remount the auth form, so the verified MFA requirement now navigates to the dedicated challenge route rather than relying on state in the old form. Candidate checks returned health/sign-in **200**, anonymous account access **401**, and real disposable-fixture metadata **200**. The smoke-test session alone was revoked afterward. Live health and anonymous-access checks passed after promotion.

`dpl_3tkawjUVtdkahUnQqY5GMbVXBcWW` is the immediately preceding deployment; `dpl_H7FxVrisGh4Fizyh9Lmx1SpwRotZ` is an earlier release candidate; `dpl_Fyxuf1Bj8rx6U8dAiPFbjZBpESDu` is retained as the pre-release rollback. The production timing and browser evidence for the final presentation patch is in the web report.

Live stayed on the existing OCI service. Only the exact extension OAuth client allowlist was expanded from three to six entries, and only `bookmark-live` was restarted. The prior environment was backed up on the server; service and public health checks passed. Redis data and other services were not modified.

For rollback, promote the known prior Vercel deployment and restore only the changed variant/allowlist/build settings from the private release snapshots when necessary. Native rollback uses the preserved prior app copies and original Clerk source checkpoint. Do not replay unrelated stale environment backups, remove user databases, or erase app data to roll back authentication.

## Additional regression requirement

The owner observed two macOS library windows after opening/reopening and after authentication. The release must retain one main library window and one normal app process through launch, Dock reopen, close→reopen, minimize→reopen and login callbacks. Settings and authentication auxiliary windows are separate from this main-window invariant. Verify the actual installed executable path as well as window count; do not mistake an old QA bundle or build-directory copy for the installed production app. Signed installed Mac 0.1.1(8) now passes these main-window lifecycle checks through the supported application reopen/return paths and retains its fixture session after a full relaunch. Direct Dock accessibility timed out, so a literal Dock click is not claimed. The client report records exact process and window evidence.

## Handoff

Use `dist/production/INSTALL.md` for local package installation and the testing runbook/matrix for the portable test order. Signed local Apple packages are not claims of notarization or App Store approval. Firefox temporary add-ons must be loaded again after a browser restart until a separately signed store package is published. Keep private fixture credentials, environment files and raw auth logs outside Git. Any cleanup must target the exact recorded disposable fixture and tenant ownership receipt, never inferred personal-account or database names.

## Browser store baseline

On 9 October the public [Chrome listing](https://chromewebstore.google.com/detail/bookmark-ai/ffhbgpgebpmofjkehpjcemepbgcmoelp) showed **0.1.5**, updated 23 September; the public [Firefox listing](https://addons.mozilla.org/en-US/firefox/addon/bookmark-ai-cloud/) showed **0.1.4**, updated 19 September. Developer portals must still be checked for unpublished versions before upload. Firefox's current slug is `bookmark-ai-cloud` and GUID `bookmark-ai@bookmark-ai.cloud`; the older `bookmark-ai` slug belongs to the retired `@purecode.ai` listing and must not receive this update. Chrome updates use the ordinary ZIP, not the first-upload archive containing a signing key. Firefox needs the exact matching reproducible source archive and build instructions alongside the minified package.

## Recovery repair and hosted callback verification

The first real Chrome toolbar check exposed a missing redirect allowlist entry even though its client ID was allowed. `SUPABASE_EXTENSION_REDIRECT_URIS` now contains the exact five distinct QA/production callbacks (Safari shares its canonical bridge). Both this field and the six public client IDs are stored as readable Vercel configuration, not secret fields; provider/backend credentials remain secret. A decrypted hosted export passed `production-oauth-preflight.mjs` before the final build. A redacted export cannot count as proof. The two allowlists must be checked independently on every release.

The recovery repair passed 15 checkpoints using two real emails sent to an explicitly approved disposable alias. Opening its actual PKCE link in a separate browser reproduced the missing-verifier failure; the original code was correctly rejected after that link consumed it, and a newly requested code verified in the original context. Password update retry, replay rejection, old-password rejection and new-password success passed. This was patched local web UI against production Supabase, not an installed physical iPhone PWA test. The deployed candidate then returned the code-entry form successfully. Final canonical mobile-width browser smoke passed 14/14 checks, including eight-digit/leading-zero input, resend controls, actual invalid-code retry, callback guidance, anonymous password-update admission and layout. The production alias was independently verified against the exact deployment ID. Owner passwords were not changed.

## Final mobile delivery and retained fixtures

Production mobile 1.0.2(102) is installed on the paired iPhone, iOS simulator and a clean Android emulator. It includes the compact Settings menu, separate Apps & Web / Browser Extensions device groups, current-device badges, icons and session details with confirmed actions. Simulator/Android save, cross-client read, restart and Settings checks passed. Final phone installation was verified without changing the owner's session; completed Google/Apple provider login and physical sharing remain separate unverified checks.

The owner explicitly chose **Keep them for now** for disposable QA accounts. Six fixture identities and five test databases remain recorded in the private inventory; no account or database cleanup occurred. Do not run cleanup without fresh authorization.
