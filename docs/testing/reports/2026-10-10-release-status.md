# Production release continuation — 10 October 2026

The release is **not fully accepted**. Production web and Chrome/Firefox 0.1.6 are live. The following evidence extends the October 9 run; it does not turn package checks into end-to-end passes.

## Completed

- Web/API: anonymous checks 18/18; real SDK refresh and individual session revocation; MFA/provider/backend gates 19/19; cleanup 6/6; symmetric cross-account session rename/revoke denial 25/25; real owned-bookmark read isolation and exact cleanup 19/19. Root independently checked the final bookmark receipt contains 19 true assertions. This covers bookmark reads and session mutations, not every content/Live/MCP operation. See [web report](2026-10-10-web.md).
- Android production 102: original package/signature audit, minimum API 24 startup/restart and measured 16 KB API 36 startup/restart. Previous password/save/share checks remain separately recorded.
- iPad simulator production 102: light/dark login layout, disposable-account sign-in, authenticated Home and session restoration after app restart. Full navigation and landscape were not completed. See [mobile report](2026-10-10-mobile.md).
- iOS 1.0.2(102), Mac 0.1.1(8), and Safari 0.1.6(10601) App Store distribution exports prepared. Root verified both Mac installer signatures and deep/strict application signatures, including Safari's nested extension. Local exports are not Apple upload/processing proof.
- Uploads succeeded for all three Apple packages. Live ASC then rejected Mac 0.1.1(8) processing with 90284 for the development-signed `swift-crypto_Crypto.bundle`; root completed isolated build 9 signing repair and its CLI upload succeeded at 16:05:53; root verified build 9 processing Complete, with Missing Compliance unsaved and draft selection pending because the Mac is locked and automatic unlock failed. Safari 0.1.6(10601) and iOS 1.0.2(102) finished processing and are selected in their saved release drafts. Safari authorization instructions were corrected and reloaded; screenshots/reviewer credentials were preserved. No review submission occurred. iOS has nonfatal missing third-party-framework dSYM warnings.
- Safari 10601 changes companion instructions only; embedded extension resources are preserved and focused tests pass 21/21. Root installed the audited development build with exact hashes/deep-strict signatures and complete 10600 rollback, then confirmed visible 0.1.6(10601) and corrected companion copy. Actual toolbar authorization remains pending.
- Obsolete installed Mac/Safari QA bundles moved recoverably to Trash with complete rollback copies. App data, accounts, databases and production installations were preserved.
- Signed AMO XPI: 20 payload files byte-identical, manifest semantically identical to tested package; signature metadata present. Store-installed restart remains unverified.

## Remaining and concrete dependencies

| Work | Why still open | Next action |
|---|---|---|
| Safari toolbar authorization, callback/save and per-client Live OFF/ON | A bounded click with the production Inspector open dismissed the popup without authorization navigation; root saw recurring background diagnostics but no OAuth launch-request/failure log. Message delivery was not observed; cause remains unproven and the flow is unverified. | Root reads existing scoped OAuth diagnostics and performs the real toolbar flow while preserving the owner's session. Do not weaken sender validation on a guess. |
| Store-installed Chrome/Firefox authentication/restart | Public availability/package audit are proved, signed installed lifecycle is not. Chrome internal extension-management URL was tool-blocked; no alternate-surface bypass attempted. | Use permitted official store and normal runtime surfaces; preserve personal profiles. |
| Remaining native/provider/security UI | API and password evidence do not prove Google/Apple completion, full iPad navigation/landscape, or MFA UI. | Supported native/browser UI plus controlled accounts; human provider passkey/credential steps if required. |
| Apple replacement Mac build and review submission | Mac 0.1.1(8) failed processing with 90284; repaired build 9 uploaded and processing Complete; Missing Compliance unsaved and draft selection pending solely on the current native lock. Safari 10601 and iOS 102 are processed and selected in saved matching-version drafts, with no final review submission. iOS framework symbols remain incomplete; no matching dSYMs were found in preserved build/Pods archives. Live ASC IDs: Mac 6813968477, Safari 6813967498, iOS 6813968206. | Complete Mac encryption compliance and select its exact processed build 9. Complete remaining metadata/runtime checks and attach owner-supplied three review videos before final review submission. |
| Google Play release | Owner-confirmed personal account still shows “Create a developer account,” not a listing dashboard. | Establish access to the enrolled developer account, or owner completes enrollment. Do not purchase/create a duplicate account on an assumption. |
| Physical phone/PWA checks | Owner explicitly prohibited physical-phone testing. | Leave unverified; use simulators/emulators for agent work. Owner may perform optional physical acceptance. |
| Actual weeks-long idle survival | Cannot observe 21/30 days in this run. | Record elapsed-time testing separately from manual refresh and clock/protocol tests. |

No phone interaction, install or cleanup is authorized under the current instruction. Device Hub contains both physical and simulated devices: match the simulator name/UDID before any input. Native control timeouts are a tool limitation, not proof of a product failure.

## Preserved upload artifacts

- Mac: `.work/production-oct10/apple-distribution/mac-export-explicit/Bookmark AI.pkg`
- Safari: `.work/production-oct10/apple-distribution/safari-10601/store-export/Bookmark AI.pkg`
- iOS: `.work/production-oct10/mobile-store/export/BookmarkAI.ipa`
- Android: existing audited APK/AAB in `dist/production/`, identified by `mobile-manifest.json`.

Hashes, signing/provenance and scope limitations are in the [Apple distribution report](2026-10-10-apple-distribution.md) and [mobile report](2026-10-10-mobile.md). Keep private receipts outside Git. Resume using the [runbook](../RUNBOOK.md) and [matrix](../MATRIX.md), without repeating completed unrelated unit suites.
