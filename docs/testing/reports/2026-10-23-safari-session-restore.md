# Safari saved-session restore — 23 October 2026

Follow-up to [the selected release](2026-10-23-production-selected-release.md).
Source commit: `695e87027e59`, branch `codex/safari-session-restore-oct23`.

## Cause and correction

The website only used Chrome's external extension messaging. Safari and Firefox
could show the installed marker but could not receive session-restore requests.
The page fallback called `window.open` once per URL, so Safari's pop-up blocker
usually allowed only one tab. Group failure text incorrectly named Chrome.

Safari/Firefox now have a content-script relay. Both ends validate the page
source, origin, request ID and message shape; the background additionally checks
the extension ID, top-level frame and configured application origin. Only HTTP(S)
URLs are accepted, up to the session API's 500-tab limit. No credentials are sent
through the page channel. Production accepts the configured canonical app origin.

A capability probe controls the tab-group action. Safari cannot create native
tab groups through its WebExtension API, so it offers New window. Browsers with
`tabs.group` retain New tab group. See [MDN compatibility data](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/group).
The mutating request is sent once. A missing/late response never triggers another
restore or a page pop-up fallback. Partial failures instruct users to check for
already-opened tabs first.

## Fresh verification

- Web: **973 tests / 89 files passed**.
- Extension: **298 tests / 33 files passed**.
- Web and extension TypeScript passed; `git diff --check` passed.
- Regression coverage includes all URLs in one window, a 113-tab session without
  truncation, group capability/order/title, invalid URLs, sender and origin
  rejection, replay protection, missing replies and no automatic retry.
- Real Safari production check: clicked New window once on the existing two-tab
  GeForce NOW saved session. A new window contained both saved destinations in
  order. The test window was then closed, returning to the original library.
- Safari's production session cards showed New window and no New tab group.
  No Chrome-install error appeared. Library remained **92 bookmarks / 15 sessions**.
  No saved data, account setting or Live Tabs preference was modified.
- Evidence under `.work/safari-session-oct23/`: `safari-restored-two-tabs.png`,
  `safari-restore-windows.txt`, `safari-supported-session-actions.png`.

## Deployment and packages

Web deployment `dpl_GNv5C34zJsHRZSgm558T7NNCoSvr` is Ready and promoted to
`https://www.bookmark-ai.cloud`. Deployment URL:
`https://bookmark-oxcuwx42n-4mnwkdsnmc-5578s-projects.vercel.app`.
Source hash: `927b1fe091822a52c25294378278ccb121ee53304694a3253207f4fb4ed6342f`.
Canonical health/sign-in returned 200 and protected `/api/me` returned 401.
The deployment URL is protected (302); it was not misreported as public health proof.
The prior live deployment `dpl_8yjYL4Dd7WErRrCVMLumQhgHt67Q` is retained for rollback.

Safari **0.1.7 (10701)** is installed at `/Applications/Bookmark AI for Safari.app`.
PlugInKit lists one intended Safari extension registration at that path.
The prior 10700 app is retained at
`.work/safari-session-oct23/rollback/Bookmark AI for Safari 10700.app`.
The production kit and `.output/safari-mv3` contain the new bridge.

Store package:
`.work/safari-session-oct23/store-10701/export/Bookmark AI.pkg`.
SHA-256: `21f7e7ece1bb02996e4c3e790f22df2a184a6866fa2b62db283c1923e64022c6`.
Both bundle IDs/version/build values match; both Apple Distribution signatures
verify deeply/strictly; neither has get-task-allow; all 13 shipped web resources
match the production kit. Both architecture UUIDs match their dSYMs for each binary.
Upload succeeded at 13:39 IST; upload receipt is `store-10701/upload.log`.

Chrome and Firefox's already-submitted 0.1.7 store packages were not replaced.
The Firefox relay is present in source for its next extension release, but the
currently submitted Firefox package does not gain that code from a web deployment.
Chrome retains its existing external messaging compatibility. Neither browser
received a fresh live restore test during this Safari-specific fix.

## Apple requirements

The Apple Developer account displays the updated Program License Agreement as
**accepted October 23, 2026**. App Store Connect's agreement warning is absent;
the current review item offers Resubmit to App Review. Evidence:
`apple-agreement-accepted.png`, `apple-review-agreement-cleared.png`.

The user's physical-Mac Safari demo video remains required by Apple's existing
Guideline 2.1 request. No video was fabricated, and Resubmit has not been clicked.
The recording should use 0.1.7 (10701), including the corrected New window flow.
