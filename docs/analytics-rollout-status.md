# Analytics release status

September 23, 2026. This records observed results, not approval of any store release.

## Production

- PostHog product analytics is deployed to `https://www.bookmark-ai.cloud`.
  Production token and explicit enablement, 900,000-event shared budget, billing
  start day 22 and 10% search sampling are configured in Vercel.
- Health, sign-in and privacy endpoints passed; protected APIs still return 401
  signed out. Extension CORS supports attribution and consent headers.
- Real export actions produced one event each for `web` and `macos`, visibly
  verified in PostHog with platform, item count and sample rate. Export content
  stays in the downloaded file; the library was not changed.
- Real reviewer saves from Chrome and Safari 0.1.5 produced visible
  `bookmark_save_completed` events with platforms `extension-chrome` and
  `extension-safari`, `item_count=1`, and `sample_rate=1` on September 23.
  No Android save event was visible in the same activity check.
- Langfuse remains configured in production.
- New Relic US key was configured and Vercel redeployed. The account UI shows
  the free 100 GB allowance, but US Log API probes from Mac and OCI returned 403.
  Ingestion is not verified. A read-only NerdGraph query on September 23 confirmed
  effective Logging retention of 30 days. OCI deployment is prepared but the
  running live server remains unchanged while this is resolved.

## New client artifacts

| Client | New version | Verified so far |
| --- | --- | --- |
| Mac | 0.1.0 (4) | 201 tests, 10 skipped, zero failures; signed archive/package; Apple validation passed; real export event reached PostHog; App Store Connect upload succeeded September 23 (processing) |
| iOS/iPadOS | 1.0.1 (2) | Typecheck, signed archive/IPA, host/share versions, production endpoints and embedded privacy declarations |
| Android | 1.0.1 (4) | Signed APK/AAB; certificate matches build 3; production endpoints; installed on QA emulator; signed build 4 GitHub draft with verified asset hashes; runtime analytics pending |
| Chrome/Firefox | 0.1.5 | 207 extension tests and TypeScript pass; ZIPs/sources audited; Chrome reviewer save and PostHog receipt passed; Firefox consent/runtime checks pending |
| Safari | 0.1.5 (10500) | Signed universal app/extension archive/package; installed 0.1.5; reviewer bookmark save and PostHog receipt passed |

Artifacts and detailed logs are in the gitignored `.work/posthog/` directory.
The iOS archive passed on an incremental retry after a transient ExpoModulesJSI
compiler-driver error. The extension's stale declaration and version assertion
were corrected as part of packaging.

## Remaining release work

1. Finish device/browser analytics checks, including Firefox consent denial and
   grant. Packaging checks do not establish real event delivery.
2. Save updated store privacy answers using `docs/analytics-privacy.md` as the
   mapping. Source manifests are updated; store-console answers remain separate.
3. Record the three Apple physical-device walkthroughs on the final builds.
   Existing recording scripts and import fixtures are in
   `.work/release-publishing-20260920/review-videos/recording-kit/`.
4. Finish Apple processing/build selection, attach reviewed videos, and resubmit.
   Mac build 4, iOS build 2 and Safari build 10500 uploads succeeded September 23.
   Apple processing and build selection remain to be verified. Chrome redirected
   App Store Connect to login with `authResult=FAILED` on September 23 and now
   requires the owner to sign in again before privacy/build edits can proceed.
   No new submission has been sent. Last portal review
   status was Rejected for all three; selected builds still require verification.
5. Publish Chrome/Firefox updates and the Android download update after checks.
   Android build 4 is staged as a GitHub draft, targeting commit `664496c`, with
   APK/AAB and verified SHA256 checksums; the public download still points to build 3.
   Prior Android distribution was GitHub APK/AAB; Google Play listing/enrollment
   remains unverified, not assumed complete.
6. Resolve New Relic key/account rejection and verify both services in Logs.
   Both the named and original license keys returned 403, while the USER key
   authenticated to NerdGraph. A support diagnostic is prepared under
   `.work/posthog/newrelic-ingest-diagnostic.md`; it has not been sent.
   OCI service health and deployment readiness were rechecked September 23.

All three Apple uploads are complete; processing and final submission
are separate. The iOS upload succeeded with a missing Hermes framework dSYM
warning; this limits symbolication of Hermes crashes, not the upload itself. Keep
the permanent reviewer account active and preserve personal app sessions/data.
