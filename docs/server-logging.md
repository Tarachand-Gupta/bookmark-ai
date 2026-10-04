# Server logs with New Relic

Bookmark AI now has optional structured application log delivery to the New Relic
Log API. The web/API and live server share the dependency-free
`@bookmark-ai/server-logging` package. This is **logs only**, not the New Relic APM
agent, a full stdout drain, infrastructure monitoring, or client analytics.
Langfuse continues to own AI tracing; no second OpenTelemetry provider is added.

## Enable after creating your account

1. Create/select a New Relic account and copy an **INGEST - LICENSE** key (not a
   browser key or user API key). Do not put it in `NEXT_PUBLIC_*` or any client app.
2. Set `NEW_RELIC_LICENSE_KEY` in the web server environment (Vercel production and
   preview separately) and live-server hosting environment. For local development,
   use the root `.env` for web and `apps/live-server/.env` for the live server.
3. Set `NEW_RELIC_REGION=US`, `EU`, or `JP` to match your account. US is the default;
   an invalid region disables uploads instead of sending data to the wrong region.
4. Optionally set `NEW_RELIC_LOG_LEVEL=warn` or `error` to reduce volume. Default
   `info` includes successful requests. Restart/redeploy the relevant server after
   configuring these values; the logger captures its configuration at startup.
5. Exercise `/api/health`, an ordinary authenticated API request, and a rejected
   request. Open New Relic Logs and verify the service and environment fields.

A US ingest key was supplied and configured in Vercel production on September 22,
2026. The server was redeployed, but New Relic rejected direct verification probes
with HTTP 403 from both the Mac and OCI. Ingestion is therefore not verified;
the OCI live server has not yet been changed. A read-only account query on
September 23 confirmed effective Logging retention of 30 days; this does not
resolve the ingestion rejection. See
[rollout status](analytics-rollout-status.md). Blank key means local structured
JSON logs only.

```sql
SELECT count(*) FROM Log
WHERE `service.name` IN ('bookmark-ai-web', 'bookmark-ai-live')
FACET `service.name`, environment, level SINCE 30 minutes ago
```

```sql
SELECT count(*), average(durationMs), percentile(durationMs, 95)
FROM Log WHERE message = 'api_request' AND `service.name` = 'bookmark-ai-web'
FACET route, method, status SINCE 30 minutes ago
```

## Coverage

- All explicitly exported methods in the 40 current web API `route.ts` modules
  record `api_request` with a static route template, method, returned status and
  elapsed handler duration. A 4xx is a warning; a 5xx is an error. Thrown handlers
  record `api_request_failed` and rethrow the original error. Duration ends when
  the handler returns its Response, **not when a stream finishes**. Response body,
  headers and status are preserved. Framework-generated HEAD/OPTIONS/405 responses,
  middleware short circuits, CDN/static asset traffic and cached responses that do
  not execute the handler are outside this coverage.
- Next's Node `onRequestError` hook reports `framework_request_failed` for errors
  Next captures, using its route template, route type and a safe error category.
  A thrown API error may also appear here; count `api_request_failed` separately
  from framework errors to avoid counting an incident twice. The hook does not
  cover Edge middleware errors.
- Explicit caught failures report bookmark enrichment, bookmark embedding and the
  straggler sweep, chat stream failures, chat user/assistant persistence, token
  usage recording, and Langfuse flush failures. The existing awaited post-AI
  `flushObservability()` also flushes logs after background work.
- The live server logs completed HTTP responses and handled errors with Fastify
  hooks, plus explicit SSE initial-state read and stream errors. Hijacked SSE
  connections are not completed-request lifecycle records. There are no startup,
  connection-open or connection-close events in this version.

Additional engine warnings and existing `console.*`/Fastify Pino messages stay in
local/platform logs; they are not automatically forwarded. Abrupt process death,
platform boot errors and resource exhaustion need a hosting log drain or agent for
full coverage. There are no per-request correlation IDs in this first version.

## Data minimization and delivery limits

Only explicitly selected metadata is serialized. Do not pass user-controlled
values as event names, operations or route templates. Unknown fields are dropped;
request URLs/query strings, headers, cookies, IPs, user identifiers, SQL, bookmark
content, chat prompts, provider payloads and raw error messages/stacks/causes are
not included. Errors become built-in categories such as `TypeError` or `Error`.
Existing local console diagnostics are a separate channel with their prior content.

The in-memory queue holds at most 200 entries, dropping oldest entries on overflow.
Each request sends at most 100 bounded records (well below the API's 1 MB limit),
with a 2-second timeout, redirect rejection and no retries. A flush drains at most
200 entries; concurrent flush callers wait for pending delivery then drain newly
queued logs. Failed batches are dropped and a sanitized local warning is emitted
at most once per minute. There is no durable spool or guaranteed delivery.

Web uses Next's awaited `after()` lifecycle and an awaited error hook. The live
server flushes every five seconds and awaits pending delivery during shutdown. This improves serverless
delivery but still depends on host execution time and process survival. Keep
platform logs available for troubleshooting missing delivery.

## Free allowance and retention

New Relic advertises **100 GB of free ingest per month**, not a 100 GB storage
allocation. Its current retention table lists **30 days for Logging on Original
Data**, and 120 days on Data Plus. Confirm your account's effective retention and
billing controls before enabling production; custom retention or data options can
change the terms. This integration cannot impose an account-wide spending cap.

Sources checked September 22, 2026:

- [New Relic pricing](https://newrelic.com/pricing)
- [Data retention table](https://docs.newrelic.com/docs/data-apis/manage-data/manage-data-retention/)
- [New Relic Log API](https://docs.newrelic.com/docs/logs/log-api/introduction-log-api/)
- [Next instrumentation and onRequestError](https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation)
- [Next after lifecycle](https://nextjs.org/docs/app/api-reference/functions/after)

## Implementation verification

September 22, 2026: 13 web transport/wrapper tests and two live-server
privacy/lifecycle tests passed. Web, shared logger and live-server TypeScript
checks passed; live-server production bundle passed. The full web suite passed
678 tests with one macOS-auth stale-account test failing; that failure reproduced
with the original HEAD authorization handler. The additional outside-request
logging fallback test passed in the final focused run. The pinned pnpm 10.34.1
frozen offline lockfile check and whitespace checks passed. No web production
build, deployment, or real New Relic ingestion was tested.
