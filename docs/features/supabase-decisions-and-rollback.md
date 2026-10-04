# Supabase decisions and Clerk rollback

The owner has authorized independent development and QA decisions in the new Supabase environment. The boundary is preserving the working Clerk version and making rollback straightforward. No production migration, DNS cutover, deployment, store submission, or merge is part of this isolated work.

## Preserved checkpoint

- Working Clerk source checkpoint: `87f1995` on `codex/server-logging-analytics-audit`.
- Local rollback tag: `checkpoint/clerk-before-supabase-2026-10-04` (points to that checkpoint; nothing was pushed).
- Supabase implementation branch: `codex/supabase-auth`.
- Initial implementation checkpoint: `5362d91`; subsequent fixes and final runtime evidence stay on the same Supabase branch. Nothing has been pushed or merged.
- Existing production environment files, Turso master/content databases, store versions, and installed release apps remain outside the QA setup.
- Supabase artifacts use `.work/builds/supabase-qa/`, distinct app IDs, callbacks, credential storage, native generation, and build manifests. Their source/dependency snapshots survive branch switches unchanged.

## Decisions that matter for rollback or cutover

| Decision | Reason / consequence |
| --- | --- |
| New Supabase project `xogqaqtyacmecdbmgqqd`; private schema `bmai_qa` | Authentication and all master/control-plane records are isolated from the old Turso master. Existing users are not migrated. |
| Separate Turso group `bmai-supabase-qa`, `bmai-sbqa-` database prefix | QA provisioning credentials can access only the QA group. No production tenant adoption. |
| Native Supabase sessions; no auth Redis records | SDK refresh and provider-owned sessions replace Clerk. Private server-only functions support selected-device controls. Hosted lifecycle checks, including rejection of retained access/refresh credentials after selected revoke, pass; remaining client journeys are recorded in the QA results. |
| Dedicated local Redis at `127.0.0.1:6386` for Live Tabs content | This preserves the existing Live Tabs architecture, using a separate QA encryption key. It is not an authentication cache or token registry. The QA instance is ephemeral and does not use the existing Redis service. |
| No session/inactivity timeout | Supports the requested multi-week return. Refresh-token replay detection stays enabled. Current QA access JWT expiry is one hour, with online validation on each protected human request. |
| OAuth Server enabled for extension clients; dynamic registration disabled | Keeps each extension's credential separate and restrictable through its signed client ID. This provider feature is beta and needs review before production adoption. |
| Default Supabase auth domain and local QA callbacks | No changes to Clerk's domain or production Google/Apple callbacks are required for the isolated build. Custom-domain cutover is deferred. |
| Runtime PostgreSQL login restricted to the private backend role | Schema administration credentials stay outside app runtime configuration. Certificate verification is required. |
| Mobile Clerk dependency/patch registration removed on this branch | Switching to the checkpoint and reinstalling its pinned dependencies restores the previous implementation. |
| Node 22+ and Corepack pnpm 10.34.1 | Required by the pinned Supabase SDK; avoid the host's different global pnpm version. |
| Hosted breached-password screening is unavailable on Free | The security advisor reports this disabled. Supabase documents it as Pro-only; no paid upgrade was purchased. Review this explicit difference before production password-auth cutover: [password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). |
| Local Docker started for schema generation | Only an isolated shadow database is needed. Record created QA containers before cleaning them up; never remove unrelated Docker data. |
| Recovery worker at `/api/cron/account-operations` | Requires the separate `CRON_SECRET`. QA invokes it manually; scheduling this endpoint is required before a later production cutover. The existing production cron configuration has not changed. |

## Request and extension security decisions

Supabase cookie mutations require an exact matching request Origin and reject missing Origin or cross-site browser requests. Middleware overwrites the trusted target-origin header. Explicit bearer clients continue through signature and online provider validation; an invalid bearer never falls back to cookies.

Extension OAuth credentials may publish their own Live snapshot and remove only the snapshot whose device ID equals their verified native `session_id`. They cannot list library-wide Live data, stream it, rename other devices, or delete another device. Existing account-wide Live enable/disable remains an explicit consented capability; disabling it clears account-wide Live shares. Consent states this consequence. Queued extension requests are bound to their original login generation and cannot acquire a later account's credential.

Human authorization has a ten-second whole-request deadline, including provider and control-plane work, and fails closed with 503 on timeout. Live revalidates every fifteen seconds and has an independent watchdog: it closes no later than twenty-five seconds after the last successful validation, even if validation or the initial content read never resolves. This bounds streamed revocation rather than claiming instant closure.

An active QA tenant with an interrupted provisioning receipt is completed only with its exact account-derived database name and durable owned creation receipt. Recovery never adopts an unowned database, never repeats remote creation/token issuance after a committed tenant insert, and stages are guarded by their operation kind so provisioning cannot overwrite a deletion receipt.

Supabase CLI scratch files from this setup are preserved under `.work/supabase-implementation/`, alongside the other QA outputs, so returning to the Clerk checkpoint does not leave new generated files in the source tree.

## Returning to the Clerk version

1. Stop only the QA processes started for this work. Preserve their manifests/reports if useful.
2. Save or commit any remaining Supabase edits on `codex/supabase-auth`; do not discard them to switch branches.
3. Switch to `codex/server-logging-analytics-audit` at the verified checkpoint, then run `corepack pnpm install --frozen-lockfile` to restore that branch's dependency graph.
4. Use the original environment and original apps/build workflows. Do not copy `.env.supabase.local` into `.env` or reuse a Supabase QA output as a Clerk release.
5. The separately installed QA apps can remain alongside the working apps or be removed later. Do not reset the original app's storage or credentials.

No reverse data migration is needed for this phase because production data and authentication have not been moved. If a later production migration is approved, its rollback procedure must be designed separately before cutover. QA-project cleanup is optional and is not required to return to Clerk.
