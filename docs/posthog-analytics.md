# PostHog product analytics

Implemented September 22, 2026. Product analytics only: the Self-driving wizard
was closed without enabling agents, connecting GitHub, or purchasing anything.
PostHog US project `621987` is the target. Its billing page was checked: free plan,
zero product events before setup, and a Product Analytics billing limit and free
allowance of one million events. The displayed cycle is September 22–October 22.

## What is collected

The shared Next.js backend emits explicit product outcomes through PostHog's
US batch API. There is no browser/native PostHog SDK, click autocapture, automatic
pageviews, session replay, feature-flag polling, identify events, or AI tracing
sent to PostHog. Langfuse retains AI tracing and New Relic retains server logs.

| Event | Capture rule |
| --- | --- |
| `bookmark_save_completed` | Successful explicit save; automatic native bookmark sync excluded |
| `session_save_completed` | One event per successful session save, not per tab |
| `search_completed` | First page only, sampled at 10% by default; no query text |
| `chat_response_completed` | One terminal successful chat outcome, not per streamed token |
| `chat_response_failed` | One terminal failed/interrupted chat outcome; no exception text |
| `import_completed` | One summary for the import with item count, not individual records |
| `export_completed` | One summary for the export with item count |

These are server-observed operations, not a full UI funnel. App launches, screen
views, bookmark opens, shortcuts, sign-up, install conversion, and the other
events proposed in the earlier audit are not implemented in this pass. MCP,
legacy Zig desktop, and Safari companion-only setup interactions are not
instrumented. Existing clients without the attribution header are skipped.

The main web/PWA, Expo iOS/iPadOS/Android, macOS, and browser extension transports
label their main API requests with `X-Bookmark-Client`. This does not create a
separate analytics request from each device and is never used for authorization.
Firefox additionally requires an actual grant of its optional
`technicalAndInteraction` data permission, communicated through
`X-Bookmark-Analytics-Consent`. A denied consent header suppresses analytics on
every platform. Live-tab polling and background heartbeat traffic have no product
analytics callsites.

Properties are allowlisted counts, durations and enums, plus platform and
sampling metadata. The account ID is transformed into a project-scoped HMAC
pseudonym; no email/name or person profile is sent. No URL, title, search query,
prompt, generated answer, attachment, raw error, IP address or token is included
in event properties. The project token is used only in the server's capture
request. PostHog geo-IP enrichment is disabled.

## Keeping event volume low

**Batching saves HTTP requests, not billable events.** A batch of 100 events still
uses 100 events. Actual volume reduction comes from the small allowlist, sampled
search, skipped pagination, no background sync/poll events, and one summary per
bulk operation. Search event counts are sampled estimates, not exact totals.

Every outbound event must first reserve capacity through an atomic conditional
update in the existing master database's `platform_config` table. All server
instances share the same project-scoped budget. The configured ceiling defaults
to 900,000 and cannot exceed 900,000, leaving headroom below the free allowance.
There is no per-process fallback: absent/unavailable master storage, invalid
configuration, or an exhausted budget drops analytics without failing the app.
Reservations are not refunded after a timeout or failed send, because delivery
may already have happened. Queues, batches and transport waits are bounded, with
no automatic retries or durable replay backlog.

Budget reset uses a configured UTC billing-cycle start day; use `22` for this
account. This day-level application budget is not PostHog's exact billing clock.
The provider's existing one-million-event free-plan limit remains the final
account-level control, including data from any other producers. If the account
is later upgraded, retain a $0 Product Analytics billing limit; do not assume
application-side budgeting controls other SDKs, projects, or products.

## Server configuration

```dotenv
POSTHOG_PROJECT_TOKEN=<project token, server environment only>
POSTHOG_ENABLED=true
POSTHOG_MONTHLY_EVENT_LIMIT=900000
POSTHOG_BILLING_CYCLE_START_DAY=22
POSTHOG_SEARCH_SAMPLE_RATE=0.1
```

The supplied token is saved in the gitignored root `.env`, not source control.
Production needs the same settings in the Vercel server environment. A configured
`MASTER_DATABASE_URL` and existing master schema are required for shared budget
reservations. No user-data schema change is needed.

Local and preview environments do not export by default. Only for an intentional
isolated check, use `POSTHOG_ALLOW_NON_PRODUCTION=true`; routine tests use fake
tokens, mock HTTP and temporary local SQLite. `POSTHOG_ENABLED=false` is the kill
switch. Both kill switch and limit changes require a server restart/redeployment.

Production configuration and the web/API deployment were completed September 22,
2026. Real `export_completed` events were observed in PostHog from the deployed
web app and the new Mac build, attributed to `web` and `macos` respectively.
See [rollout status](analytics-rollout-status.md) for remaining client/store work.
Deploying the server does not update installed clients.
Verify an actual save/search/chat after the server and relevant client releases
are deployed. In PostHog, filter by event name and platform; distinguish any
explicit setup verification event from real product traffic.

## Verification on September 22, 2026

- The US batch endpoint returned HTTP 200 for one synthetic
  `analytics_setup_verified` event. The PostHog activity page then displayed
  exactly one entry with that name. It uses a random setup ID and
  `environment=verification`; it is not a real user conversion. This confirms the
  project token and destination, not a deployed app flow.
- 32 new tests passed: 19 transport/budget tests, seven route/lifecycle tests, and
  six extension attribution/consent tests. Budget testing includes concurrent
  writes through two independent SQLite connections.
- Full web suite: 705 passed, one previously reproduced macOS-auth stale-account
  assertion failed (403 versus expected 409). Web, mobile and DB TypeScript
  checks passed; changed Swift files passed syntax parsing.
- Extension TypeScript retains an existing missing `resolveBuildSuffix` export
  error in `scripts/safari-version.test.ts`; 19 existing auth/native-sync tests
  passed. No production build, deployment, app installation or store-console
  update was performed.

## Sources

- [Capture and batch API](https://posthog.com/docs/api/capture)
- [Cutting analytics costs](https://posthog.com/docs/product-analytics/cutting-costs)
- [Billing limits and alerts](https://posthog.com/docs/billing/limits-alerts)
- [Account billing](https://us.posthog.com/organization/billing/overview)
- [Firefox built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/)
