# Selected web and extension release — 23 October 2026

Scope: [accepted features and deferred work](../../features/selected-release-scope-2026-10-22.md).
Release branch: `codex/selected-release-production-oct23`.
Web application source: `a3c9979a14b4`. Extension release/packaging baseline: `89d71e9b12a4`.
Full experimental backup remains `codex/backup-release-1-full-2026-10-22`
at `9487f535d7e715c79f616f2bdb9515d87ff4b8ec`.

## Fresh release checks

- Final web source: **969 tests / 89 files passed**. This includes isolated database tests for
  edit, bulk operations, tenant isolation, retries, conflicts, export and scale.
- Extension: **284 tests / 32 files passed**, including Saved / Already saved feedback.
- TypeScript: web, extension, types, database, engine and shared UI passed.
- Production/QA build-isolation and retention scripts: **27 tests passed**.
- After the two live findings below: **28 focused account/privacy/request tests
  passed**, including four added identity regression cases, and web TypeScript
  passed again. The full 969-test suite was then rerun successfully on the final source.
- Final local review used the actual browser UI in desktop and 375px/320px
  responsive layouts, in light and dark themes. No horizontal overflow observed.
- Grid, List and Compact render; compact title/domain proportions and hover
  actions remain. Manual editor exposes title, category and tags only. Bulk
  selection exposes category assignment and tag editing. This pass opened and
  cancelled these controls; mutation/export/delete evidence is in the October 22
  report and freshly passing backend suites.
- Tag search opens an overlay card on desktop/mobile. Date is icon-only when
  unset and shows Last month after selection; clear restores the icon.
- Closed facet headings have tight spacing; the icon rail has no empty divider
  stack. Sidebar minimum remains 256px with the complete brand on one line.
- An unsent AI draft survived Settings and close/reopen. No AI message was sent.
  Input focus is thin; default mobile bar is hidden. Mobile opt-in works and was
  restored off. Header and bar computed backgrounds match at alpha 0.8 with
  8px backdrop blur; bar has a fine 1px theme border.
- Navbar AI control measured 44 by 44px at 375px. Mobile Settings exposes all
  nine non-admin web sections, with Back/Done. Account starts with quiet collapsed
  task rows; Profile opens with unchanged Save disabled. Desktop Sign out stays
  at the bottom of the settings rail.
- The fixture Live sessions section correctly reported its unconfigured live
  server. This is not production Live verification. No real credentials, account
  settings, bookmarks or device registrations were changed during local QA.

Local evidence: `.work/release-oct23/` and screenshots 52–54 under
`.work/reduction-oct22/visual-qa/`. Earlier drag lifecycle, theme-corner, edit and
bulk mutation evidence remains in the October 22 report; it is not relabeled as
a newly performed native/OS drag test.

## Deployment and rollback

The release uses the production wrapper's frozen web source, with real auth
adapters verified byte-for-byte against the checkout and no `.env` files. The
fixture preview is not deployable production source. Existing Vercel project,
production environment and root directory `apps/web` are retained.

Previous deployment: `dpl_wjbUShZ9qTFnds1UGWC7xn2avJmm`
(`bookmark-9mjjc07i0-4mnwkdsnmc-5578s-projects.vercel.app`).
Initial candidate: `dpl_HyWgKjG1M7Kzr1ER5BgTN23DkR9q`, promoted after health/sign-in
200 and protected me/bookmarks/organization 401 checks. Public HTTP checks also
passed. Real signed-in review preserved 92 bookmarks and 15 saved sessions, but
found two client-side issues that the synthetic fixture could not establish:

1. Migrated users have distinct canonical Bookmark AI and Supabase provider IDs.
   The settings cache compared the canonical ID with the browser's provider ID,
   showing a false Account refresh warning. `3a76318` compares the response's
   provider ID, with legacy fallback; another provider is still rejected even if
   its canonical ID happens to match the requested cache scope.
2. Account-bound Live settings reads added `X-Bookmark-Client`, although the Live
   origin only permits Authorization and Content-Type. Its real OPTIONS response
   confirmed that contract. `a3c9979` preserves the account-switch guard and sends
   only the bearer header to Live; the regression now asserts the exact headers.

Intermediate identity-only build `dpl_agHVkHxhS1S1YcrY96SQDtkCxaXK` was cancelled
before completion. Final combined production deployment (promoted and canonical alias verified):
`dpl_8yjYL4Dd7WErRrCVMLumQhgHt67Q`
(`bookmark-5tstejx6z-4mnwkdsnmc-5578s-projects.vercel.app`).

Rollback uses the retained pre-release deployment, without reverting environment
settings or deleting additive data:

```sh
corepack pnpm dlx vercel@62.2.0 rollback dpl_wjbUShZ9qTFnds1UGWC7xn2avJmm \
  --scope team_YrK7IQKCrCxbbuxx94RJEZbK --yes
```

Final source SHA-256:
`3266936d446f4c62dd5caf278c317009708397fb2ad03eca66330e49148b184f`.

## Final production visual verification

- The canonical production site loads the retained UI with the existing account's
  **92 bookmarks and 15 saved sessions** intact.
- Account settings now loads without the false refresh warning. Live sessions
  settings now loads Chrome and Safari clients without the CORS fetch failure.
- The real bookmark editor exposes title, category and tags; it was cancelled
  without modifying the account's bookmark.
- Evidence: `production-account-final.png` and
  `production-live-settings-final.png` in `.work/release-oct23/`.
- This proves an existing signed-in session, not a fresh Google/Apple login.

## Extension 0.1.7 release

| Target | Fresh result | Distribution state |
| --- | --- | --- |
| Chrome | User reloaded 0.1.7; actual signed-in toolbar popup visually verified | Uploaded and submitted; **Pending review**, automatic publication enabled |
| Firefox | Clean locked install: **284 tests / 32 files passed**; second clean rebuild matched **21/21 files** | Version **6610253**, file **5154372**, **Awaiting Review**; matching reviewer source attached |
| Safari | 0.1.7 **10700** installed; one extension registration; signed-in toolbar popup retained the session | Uploaded, processed, selected and saved; existing review item updated to **0.1.7 (10700), Ready for Review**; not resubmitted |

Chrome package: `dist/production/chrome.zip`
SHA-256: `7e8b6fc01e7fe4df3123e6032a372208f8046fc9fc0fb2aa0a81a914c0d965b7`.

Firefox package: `dist/production/firefox.zip`
SHA-256: `06a91fd628774dfece09585ee7a8e37e0b0fcae3ef3eafdc066864dff40682b0`.

Firefox reviewer sources: `dist/production/firefox-sources.zip`
SHA-256: `9b426386e15fd961487bbd33c1bff6253d40f705868de4a10a9e171cae4cb1b8`.

Safari store package:
`.work/release-oct23/safari-store-10700/store-export/Bookmark AI.pkg`
SHA-256: `412aabba41c3e8c56c848641eeab4ba2e1bd85ba01cabfc4d8420f31618dd7db`.

Local Chrome and Firefox folders are refreshed at
`apps/extension/.output/chrome-mv3` and `apps/extension/.output/firefox-mv2`.
Safari is installed at `/Applications/Bookmark AI for Safari.app`; the prior
10602 app is retained at `.work/release-oct23/rollback/`.

Safari's store export was audited after expansion: both bundle IDs, version and
build are correct; both Apple Distribution signatures verify deeply/strictly;
no get-task-allow entitlement; all 12 shipped web resources match the tested
Safari bundle. Both dSYM UUID sets match their executables. Upload receipt is
`safari-store-upload.log`; **upload/processing is not App Review approval**.

App Store Connect subsequently showed build **0.1.7 (10700)** available for
selection. The old 0.1.6 (10601) draft association was replaced, the editable
version changed to 0.1.7, and Save completed. The page then showed **macOS App
Version 0.1.7**, **Prepare for Submission**, and the selected **0.1.7 (10700)**
build. Evidence: `safari-017-draft-selected.png`. **Update Review** then replaced
the old item in the existing submission. The review page visibly shows **macOS
App 0.1.7**, **0.1.7 (10700)** and **Ready for Review**. **Resubmit to App Review**
is available, but was not clicked because the requested demo evidence is still
missing. Evidence: `safari-017-ready-for-review.png`.

Apple's account banner requires the Account Holder to review and accept an
updated Developer Program License Agreement. The existing App Review request
also requires the user's physical-device demo recording. No agreement was
accepted and no video evidence was fabricated. These remain Apple release
requirements; this report does not claim Safari has been submitted or approved.

### Reproduction and automation limitations

The first Firefox clean rebuild exposed a pre-existing local dependency-hoisting
difference in `background.js` (20/21 files matched). The final uploaded Firefox
package is the clean pnpm 10.34.1 frozen-lockfile build, not that earlier package.
A second extraction/install/build matched all 21 final output hashes. Its
reviewer source includes only public configuration and the exact expected hashes.

A test-only cross-workspace web helper is outside the minimal reviewer source
archive. It was copied byte-for-byte from the release checkout into the test
sandbox to run the full 284-test suite. This does not alter compiled extension
inputs. The documented reviewer build succeeds without that helper.

Packaging now reads the frozen package version instead of hard-coding 0.1.6,
retains build helper files while excluding generated build directories, and
fails closed if required reviewer build helpers are missing.

Chrome/Safari popup rendering and retained sign-in were observed. Native popup
save clicks did not yield a reliable observed result before dismissal; direct
extension-page automation was blocked by the computer-use URL policy. Therefore
this report does **not** claim a freshly completed save/duplicate-save UI journey.
Saved / Already saved behavior is covered by the passing regression suite.
AMO reported zero validation errors and 11 warnings; submission was accepted,
with review pending. Store status screenshots and final package audit JSON are
under `.work/release-oct23/`.

The optional cross-harness read-only audit timed out with outcome unknown and was
not retried. No result from that worker is counted as validation.

## Native app scope

No iOS/Android changes were needed for this web/extension UI release; their builds
remain unchanged. No fresh native-mobile test or physical-device test is claimed.
The user's physical iPhone was not used. Standalone Mac work remains out of scope.

