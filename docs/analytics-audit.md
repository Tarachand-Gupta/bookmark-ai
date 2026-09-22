# Analytics coverage and proposed event contract

Audited September 22, 2026 from repository source and dependency manifests. This is not verification of deployed builds, dashboard ingestion, or production credentials. PostHog is **not implemented**; the events below are proposals, not events shipped by this change. New Relic server logging setup is described in [server-logging.md](server-logging.md).

## Current client coverage

| Platform | Product analytics today | Source checked |
| --- | --- | --- |
| Web and installed PWA | No PostHog SDK, initialization, identity calls, or events | `apps/web/package.json`, `apps/web/app/layout.tsx` |
| Chrome extension | None | `apps/extension/package.json`, shared `entrypoints/` and `lib/` |
| Firefox extension | None | Same WXT code, `apps/extension/wxt.config.ts` |
| Safari extension | None | Same WXT code and native wrapper |
| Native macOS SwiftUI app | None | `apps/macos/project.yml`, `Sources/App/BookmarkAIApp.swift` |
| iOS and iPadOS app | None | `apps/mobile/package.json`, `apps/mobile/App.tsx`, native share extension |
| Android app | None | Same Expo app |
| Safari companion app | None | Native companion source/configuration |
| Legacy Zig desktop | None | `apps/desktop/app.zon` and source |

The extension has local diagnostic breadcrumbs in `apps/extension/lib/diag.ts`: a 300-entry ring mirrored to console/storage and a development-only localhost sink. These are not production product events. macOS has local OSLog diagnostics. Bookmark provenance fields such as browser/device are saved application data, not PostHog events.

## Langfuse is implemented

`apps/web/instrumentation.ts` loads `lib/server/observability/register.ts` for the Node runtime. It creates a dedicated OpenTelemetry provider, Langfuse span processor and AI SDK integration. It deliberately does not export Next.js framework/request spans. The shared engine is instrumented, so supported AI operations requested by any client can generate traces on the backend; native apps do not need a Langfuse SDK.

The required environment names are `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY`, `LANGFUSE_BASE_URL` and optional `LANGFUSE_TRACING_ENVIRONMENT`. Both keys are required to enable export. Admin `/api/admin/observability` controls five surfaces: Ask AI, session summaries, categorization, embeddings and search. Defaults are on when credentials exist; the admin may disable each surface. These flags are cached for approximately 60 seconds.

| Existing observation name | Coverage / defining source |
| --- | --- |
| `ask-ai` | Chat turns, model generations and tool calls; `apps/web/app/api/chat/route.ts` |
| `categorize-bookmark` | Classification; `packages/engine/src/categorize.ts` |
| `summarize-session` | Saved session naming/summary; `packages/engine/src/sessions.ts` |
| `embed-bookmark`, `embed-saved`, `embed-session`, `embed-sweep` | Individual and batch embedding; `packages/engine/src/embeddings.ts` |
| `search-bookmarks` | Query, mode, result count and fallback; `packages/engine/src/search.ts` |
| `gemini-generate-json`, `gemini-grounded-search`, `gemini-embed` | Child model observations when a recording parent exists; `packages/engine/src/gemini.ts` |

Routes flush spans after AI/background work to support serverless execution. Standalone engine calls default to tracing off. These traces are not app-open, navigation, auth, or conversion events. They may contain query text, bookmark text, prompts and generated output; current masking targets secret patterns rather than removing all user content. The privacy page already describes Langfuse.

## Recommended product events

Start with activation, successful saves, successful retrieval and repeat use. Add the following at actual action boundaries, only where a feature exists. Slash-separated endings below denote separate event names, e.g. `bookmark_save_started`, `bookmark_save_completed`, `bookmark_save_failed`.

| Platform | Events to add |
| --- | --- |
| Shared web/mobile/macOS library flows | `app_opened`, `screen_viewed`, `sign_in_started/completed/failed`, `sign_out_completed`, `bookmark_save_started/completed/failed`, `bookmark_opened`, `bookmark_deleted`, `search_submitted/completed/failed`, `search_result_opened`, `filter_applied`, `chat_message_sent`, `chat_response_completed/failed`, `session_opened`, `session_save_started/completed/failed`, `settings_changed` |
| Web/PWA | Shared flows plus `landing_viewed`, `sign_up_started/completed`, `download_clicked`, `extension_install_clicked`, `pwa_install_prompt_shown`, `pwa_installed`, `view_mode_changed`, `import_started/completed/failed`, `export_completed/failed`, `skill_created`, `skill_imported` |
| Chrome extension | `extension_installed`, `extension_updated`, `popup_opened`, `sign_in_opened`, bookmark/session save outcomes, `native_sync_enabled/disabled`, `native_sync_completed/failed`, `live_sharing_enabled/disabled`, `auth_recovery_completed/failed` |
| Firefox extension | Same extension events with `browser=firefox`; collection must follow the extension's declared data permissions |
| Safari extension | Same applicable extension events with `browser=safari`, plus `auth_bridge_started/completed/failed`; do not invent events for APIs Safari does not support |
| Native macOS | Shared flows plus `onboarding_completed`, `window_opened`, `window_reopened`, `keyboard_shortcut_used` (named command only), `app_update_clicked` |
| iOS/iPadOS | Shared flows plus `onboarding_completed`, `share_received`, `share_save_started/completed/failed`, `deep_link_opened`, `app_update_clicked`; distinguish main app from share extension |
| Android | Shared flows plus the mobile share/deep-link/onboarding events, `platform=android` |
| Safari companion | `setup_opened`, `extension_settings_opened`, `setup_completed` when enablement is actually confirmed, `companion_sign_in_opened` |
| Legacy Zig desktop | If still maintained: `app_opened`, `library_load_completed/failed`, `search_submitted/completed`, `bookmark_opened`, `filter_applied` |
| Backend / MCP | Authoritative successful mutations and AI outcomes; `mcp_tool_completed/failed`, `quota_reached`, `ai_fallback_used`. Keep operational request logs in New Relic and detailed model traces in Langfuse |

### Properties and counting rules

- Use consistent names across clients. Properties: `platform`, `browser`, `app_version`, `environment`, `entry_point`, named `screen`, `duration_ms`, `result_count`, `item_count`, stable `error_code`, and schema version as applicable. Platform distinguishes web/PWA, macOS, iOS, Android and extension. Browser distinguishes Chrome/Firefox/Safari.
- Identify authenticated users with a stable opaque analytics identifier and reset identity on sign-out. Anonymous installation IDs can support pre-sign-in funnels; never use advertising IDs or email addresses. Define the anonymous-to-signed-in identity transition once across clients.
- Track intent in the client and authoritative success once, preferably on the backend. A click is not a successful save. Avoid emitting the same conversion in both places; use an event/correlation ID to deduplicate retried or offline actions.
- Attribute backend product events through validated client metadata. A backend route alone cannot reliably identify the caller's app. Device/browser provenance fields on a bookmark do not prove which client issued the current request.
- Record search submission after deliberate submission or debounce, not every keystroke. Chat completion means successful stream completion, not HTTP 200 headers. Record actual errors separately from cancellation.
- Do not put raw queries, URLs, titles, tab lists, prompts, responses, attachments, tokens, emails, request bodies or arbitrary error messages into product analytics. Use counts, enums and durations. Disable automatic click/text capture and session replay initially.
- Build activation funnels: sign-up → first save → first successful retrieval; retention by platform; save/search/chat failure rates; share-sheet success; extension auth recovery; cross-device adoption. Existing AI traces answer model-quality questions separately.

## Can macOS and iOS collect events?

Yes. PostHog's [Swift SDK package](https://github.com/PostHog/posthog-ios/blob/main/Package.swift) declares macOS and iOS support. Use it for the native SwiftUI macOS app. This repository's main iOS/iPadOS and Android app is Expo, so the [React Native SDK](https://posthog.com/docs/libraries/react-native) is the natural shared integration. A native share extension needs its own bounded delivery strategy or backend success events; the main app's SDK does not automatically observe another process. Extensions need an explicit background-worker-compatible delivery/lifecycle strategy rather than assuming a popup stays alive.

Before shipping PostHog, update the concrete existing disclosures: `apps/web/app/privacy/page.tsx` says no client analytics SDKs, `apps/extension/STORE-LISTING.md` denies user-activity collection, and Firefox's `apps/extension/wxt.config.ts` excludes interaction telemetry. Update applicable app-store privacy declarations and analytics controls together with the eventual integration. No client analytics collection is enabled by this audit/logging change.

## New Relic cost and activation

New Relic advertises [100 GB of free monthly ingestion](https://newrelic.com/pricing/free-tier), not 100 GB of stored capacity. Its [retention table](https://docs.newrelic.com/docs/data-apis/manage-data/manage-data-retention/) lists 30 days for Logging on Original Data and 120 days on Data Plus. The generic free-tier page says at least eight days across data types. Verify the account's effective Logging retention and usage settings before enabling collection; additional ingestion/retention may incur charges depending on account settings. Application queue bounds are not a global monthly billing cap.

The server integration uses an ingest/license key and region. Neither PostHog client analytics nor a New Relic account/deployment is provisioned by this change. See the logging setup document for environment variables, coverage, tests and a verification query.
