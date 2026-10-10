# Production release continuation — 10 October 2026

The release is **not fully accepted**. Production web and Chrome/Firefox 0.1.6 are live. The following evidence extends the October 9 run; it does not turn package checks into end-to-end passes.

## Completed

- Web/API: anonymous checks 18/18; real SDK refresh and individual session revocation; MFA/provider/backend gates 19/19; cleanup 6/6; symmetric cross-account session rename/revoke denial 25/25; real owned-bookmark read isolation and exact cleanup 19/19. Root independently checked the final bookmark receipt contains 19 true assertions. This covers bookmark reads and session mutations, not every content/Live/MCP operation. See [web report](2026-10-10-web.md).
- Android production 102: original package/signature audit, minimum API 24 startup/restart and measured 16 KB API 36 startup/restart. Previous password/save/share checks remain separately recorded.
- iPad simulator production 102: light/dark login layout, disposable-account sign-in, authenticated Home and session restoration after app restart. Full navigation and landscape were not completed. See [mobile report](2026-10-10-mobile.md).
- iOS 1.0.2(102), Mac 0.1.1(8), and Safari 0.1.6(10601) App Store distribution exports prepared. Root verified both Mac installer signatures and deep/strict application signatures, including Safari's nested extension. Local exports are not Apple upload/processing proof.
- Safari 10601 changes companion instructions only; existing embedded extension resources are preserved. Focused tests pass 21/21. The updated companion has not been installed or run; installed production remains 10600.
- Obsolete installed Mac/Safari QA bundles moved recoverably to Trash with complete rollback copies. App data, accounts, databases and production installations were preserved.
- Signed AMO XPI: 20 payload files byte-identical, manifest semantically identical to tested package; signature metadata present. Store-installed restart remains unverified.

## Remaining and concrete dependencies

| Work | Why still open | Next action |
|---|---|---|
| Safari toolbar authorization, callback/save and per-client Live OFF/ON | Earlier clicks did not reach an authorization page; cause unproven. Native CUA later timed out across Safari and Firefox, including a fresh tool reset. | Restore supported native control; read existing scoped OAuth diagnostics and perform real toolbar flow with a disposable fixture. Do not weaken sender validation on a guess. |
| Install/run Safari 10601 | Package built and signed; native control unavailable for graceful lifecycle and installed UI verification. | Preserve 10600 rollback, replace only intended companion, verify version/resources and actual UI. |
| Store-installed Chrome/Firefox authentication/restart | Public availability/package audit are proved, signed installed lifecycle is not. Chrome internal extension-management URL was tool-blocked; no alternate-surface bypass attempted. | Use permitted official store and normal runtime surfaces; preserve personal profiles. |
| Remaining native/provider/security UI | API and password evidence do not prove Google/Apple completion, full iPad navigation/landscape, or MFA UI. | Supported native/browser UI plus controlled accounts; human provider passkey/credential steps if required. |
| Apple uploads, processing and listing | App Store Connect Chrome session shows email/passkey sign-in. No existing documented upload/API credential was found in scoped locations. | Owner sign-in, then upload/validate exact exports and select processed builds. Check highest build numbers and agreements before submission. Owner supplies three review videos. |
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
