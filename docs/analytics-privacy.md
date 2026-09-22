# Analytics privacy declarations for releases

Source review: September 22, 2026. This is the mapping for the implemented
server-side analytics; it does not assert that any store-console answers have
been saved. See [PostHog events and controls](posthog-analytics.md) and
[server logging](server-logging.md).

The client sends its existing authenticated API request with a platform header.
The server records selected outcomes, not clicks or screen views. There is no
PostHog client SDK to add to a binary's third-party SDK inventory. Collection is
still reportable: the server retains information about app activity beyond the
immediate request. App manifests describe our app's collection; App Store
Connect labels must be updated separately. A generated Xcode privacy report is
an aid to that declaration, not a replacement for saving the labels.

## Apple mapping

| Data type | iOS/iPadOS and Mac | Safari extension | Purpose / linkage |
| --- | --- | --- | --- |
| User ID | Account ID and project-scoped HMAC in PostHog | Same | App Functionality + Analytics; linked, not tracking |
| Product Interaction | Quota counters; supported save/search/chat/import/export outcomes | Quota counters; explicit bookmark/session saves | App Functionality + Analytics; linked, not tracking |
| Performance Data | Search/chat server elapsed time in PostHog | Not emitted by Safari's save/session analytics | Analytics; linked, not tracking |
| Search History | Search query can be retained in enabled Langfuse traces | No extension search path | App Functionality; linked, not tracking; not sent to PostHog |
| Device ID | No persistent device identifier added by analytics | Existing optional live-sync per-install UUID | App Functionality only; linked, not tracking; not sent to PostHog |

The HMAC is a stable account-level identifier. The operator holds the account ID
and the derivation secret, so this is pseudonymous **linked** data rather than
anonymous data. Disabling PostHog person profiles does not change that assessment.
No advertising identifier, advertising measurement, data-broker sharing or
cross-company ad tracking is implemented. Tracking remains false and there is
no PostHog tracking domain or ATT request to add.

Account names/emails and bookmark/chat/attachment content retain their existing
App Functionality purposes; PostHog does not receive those fields. Product
Interaction also includes existing account-linked quota counters, which is why
its purposes include App Functionality as well as Analytics.

The iOS source manifest lives in `apps/mobile/app.json`; Expo prebuild must
regenerate native projects before packaging. The Mac manifest is
`apps/macos/Resources/PrivacyInfo.xcprivacy`, explicitly copied by XcodeGen.
Safari's app and appex manifests mirror the collection of the shipped product;
the companion's setup screens themselves emit no analytics. The iOS share
extension stages data locally and the main app performs the authenticated save;
this change does not add remote collection to the share-extension process.

Server request logs contain allowlisted route/method/status/duration and error
categories without account IDs, raw paths, IPs, query text or payloads. They are
operational diagnostics, distinct from device crash reporting. New Relic remote
export requires its key; host console retention and other host telemetry have
their own configuration. Before saving a blanket Diagnostics answer, check all
enabled production processors. PostHog search/chat durations already justify the
Performance Data declaration on mobile and Mac even while New Relic is disabled.

## Android and browser stores

Android User IDs and App interactions add Analytics as a purpose. Search/chat
elapsed time falls under App info and performance / Diagnostics; enabled
Langfuse search traces mean In-app search history is not purely ephemeral.
Android has no end-user analytics toggle. Service-provider processing can be
excluded from Google's Shared answer only while the provider acts on our behalf
under the applicable terms; it is still collection and must be disclosed.

Chrome's data-usage disclosure must reflect activity/outcome analytics and the
account pseudonym; do not infer no collection from absence of an SDK. Firefox
adds optional `technicalAndInteraction` permission; denying or revoking it
suppresses the PostHog events. The required authentication/bookmark/live-sync
data remains separate. Recheck the exact live questionnaire at upload time.

## Sources and implementation evidence

- [Apple: App privacy details](https://developer.apple.com/app-store/app-privacy-details/) defines collection, linkage, purposes and tracking.
- [Apple: Describing data use in privacy manifests](https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests) describes app collection manifests and Xcode reports.
- [Apple: Collected data type values](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatype) and [purpose values](https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatypepurposes) define the manifest keys used here.
- [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) is the versioned mobile documentation required by the app's AGENTS.md.
- [Google Play: Data safety](https://support.google.com/googleplay/android-developer/answer/10787469) defines collection, sharing and its service-provider exception.
- Implementation: `apps/web/lib/server/analytics/posthog.ts`, `apps/web/app/api/product-analytics.ts`, `apps/web/app/api/search/route.ts`, `packages/engine/src/search.ts`, `packages/db/src/master.ts`, `apps/extension/lib/device-id.ts`.
