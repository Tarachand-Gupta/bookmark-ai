# Mobile web UX and accessibility — 24 October 2026

Released source: `d479be338d2b` on `codex/mobile-bookmark-actions-oct24`.
Canonical site: https://www.bookmark-ai.cloud
Deployment: `dpl_8st8y6sDn3L4VU1HFutwrYPUcnCp`
Build URL: https://bookmark-4c0wn5et8-4mnwkdsnmc-5578s-projects.vercel.app

## Independently reviewable changes

| Commit | Scope |
| --- | --- |
| `b631bc6` | One labelled 44px action menu on mobile/touch in grid, list, compact, and Home recent saves. Desktop direct actions appear on hover or keyboard focus. Removed permanent two-button padding; desktop date ends at the normal 12px row inset. Touch selection has an explicit mode and larger controls. |
| `4fc7f15` | Interactive “Your library” explanation, bookmark-picker entry, larger context controls, bounded picker scrolling and focus return. Library access remains unconditional; attaching sources does not restrict retrieval. |
| `c95373d` | Editor/delete focus restoration, skip-to-library link, one main landmark, larger dialog/menu targets, labelled progress, keyboard focus indicators and reduced-motion rules for overlays. |
| `6ee118c` | Full-screen chat makes background content inert through the body level and restores its previous state on close. |
| `d479be3` | Accessible names for library-context, attached-bookmark and conversation-history panels. |

This release also includes the previously local `7d17645` conversation-restoration and fractional-scroll fixes. Deferred folders, reading list, import redesign and rejected popup redesign have not been reintroduced. No native app or store package was required for these website changes.

## Verification

- 996 web tests across 93 files passed. Web, shared UI and extension typechecks passed. The production build compiled and checked types successfully.
- Used real Android Chrome on the existing `bookmark_pixel` emulator for grid, compact, touch menu, editor and delete confirmation. Cancelled destructive dialogs; no bookmarks were deleted. The physical phone was not used.
- Checked 320, 375, 414 and 767 CSS-pixel layouts, plus 1440px desktop. The nominal 768 capture measured 767 because of browser zoom rounding. No horizontal document overflow. Menu trigger measured approximately 44×44 CSS pixels; desktop direct buttons are 32×32.
- Keyboard: Enter opens menu and selects actions; Escape returns to its trigger. Closing the editor returns to the bookmark action; closing the bookmark picker returns to the library-context button. Direct desktop actions appear on keyboard focus without moving columns.
- Checked mobile filters, tags overlay, selection and bulk-action menu, layered account settings, context picker and chat. Full-screen chat has a name and modal semantics, and its page background is inert.
- Verified canonical production source after promotion: new touch menu, skip link, one main landmark, live device list and named “Library context” panel. A real library-count AI request returned **92**, and both the submitted message and answer survived a full reload. SQL output remained collapsed behind its activity row.
- Candidate/production health: `{"ok":true,"ai":true}`. Candidate signed-out session endpoint returned 401, and sign-in returned 200. The production snapshot retained product auth and tenant-routing files, checked against the repository; no fixture auth was uploaded.

## Evidence and limits

Local gallery: `.work/mobile-ux-oct24/review.html`. Full-size screenshots and the overview image are beside it. Logs: `tests-final.log`, `typecheck-final.log`, `ui-typecheck.log`, `extension-typecheck.log`, `vercel-deploy-final.log`, `vercel-promote-final.log`, and `production-final.json`.

The local synthetic account cannot list Supabase provider devices; the real production device list was checked successfully instead. The emulator's initial LAN-address origin did not provide secure-context `crypto.randomUUID`; testing used emulator loopback with ADB reverse, without browser security changes. The iOS Simulator app is missing from this Xcode installation. Android's local-origin PWA installation prompt was exercised, but installation did not complete, so standalone installation and a complete VoiceOver/TalkBack audit are not claimed. Screenshots show browser/touch operation; this is not a full WCAG conformance certification. Reduced-motion behavior is covered by source rules, not a recorded assistive-technology session.

## Standards and skill selection

Applied [WCAG 2.2](https://www.w3.org/TR/WCAG22/), the [WAI-ARIA menu-button pattern](https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/), [Vercel's web-design guidelines](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) and [Addy Osmani's accessibility skill](https://github.com/addyosmani/web-quality-skills/tree/main/skills/accessibility). GitHub API counts checked on 24 October: Vercel agent-skills **32,925** stars; web-quality-skills **2,984** stars. Chose complementary guidance by relevance and maintained examples; popularity is not conformance evidence. Skills were read and applied without installing global plugins.

## Rollback

For a selective revert, create a new `codex/` branch from this branch and `git revert` the desired feature commit, then verify and deploy the resulting source. Revert `d479be3` before `4fc7f15` when removing the whole chat-context group, because it names the new panel. Other combinations may need normal patch-conflict review.

The exact previous production deployment remains available:

`dpl_rdJDk5kkBaroQtAUpnLj8CdamaFd`

https://bookmark-k8mspjasj-4mnwkdsnmc-5578s-projects.vercel.app

Promoting that deployment restores the entire pre-release website. No database migration or data deletion accompanied this release.
