# Supabase decisions and Clerk rollback

The owner has authorized independent development and QA decisions in the new Supabase environment. The boundary is preserving the working Clerk version and making rollback straightforward. That original isolated scope was subsequently expanded by explicit owner authorization to the production cutover recorded below. Store submission and existing-user data migration remain excluded.

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
| Default Supabase auth domain and local QA callbacks | The owner subsequently authorized real production Google/Apple credentials in Supabase. Its provider callback was added beside Clerk's existing callbacks; shared credentials were not reset. Google consent is now In production. See [social providers](supabase-social-providers.md). The provider custom domain remains deferred; application deployment was later authorized and completed as recorded below. |
| Runtime PostgreSQL login restricted to the private backend role | Schema administration credentials stay outside app runtime configuration. Certificate verification is required. |
| Mobile Clerk dependency/patch registration removed on this branch | Switching to the checkpoint and reinstalling its pinned dependencies restores the previous implementation. |
| Node 22+ and Corepack pnpm 10.34.1 | Required by the pinned Supabase SDK; avoid the host's different global pnpm version. |
| Hosted breached-password screening is unavailable on Free | The security advisor reports this disabled. Supabase documents it as Pro-only; no paid upgrade was purchased. Review this explicit difference before production password-auth cutover: [password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). |
| Local Docker started for schema generation | Only an isolated shadow database is needed. Record created QA containers before cleaning them up; never remove unrelated Docker data. |
| Recovery worker at `/api/cron/account-operations` | Uses `CRON_SECRET`; production input and Vercel key presence are verified. The deployed configuration initially scheduled only embedding. The active production configuration now includes a separate Hobby-compatible daily recovery schedule (`45 4 * * *`, UTC, imprecise within the hour) alongside unchanged embedding (`30 3 * * *`); both definitions were verified after promotion. Authenticated worker invocation mutates pending operations, so no no-change live run is claimed. |

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

Historical QA instructions above describe the retained local Clerk version. The authorized hosted cutover below supersedes the earlier no-production-change status.

## Production cutover — 4 October 2026

The user authorized production promotion. Web/API now use **https://www.bookmark-ai.cloud**, deployment **dpl_7p5J99r8F5maipGXE4CmW61yGhhB**; Live uses **https://live.bookmark-ai.cloud**, release **supabase-20261004-a89fea9**. Signed-out health200/protected401 and sign-in200 were verified after promotion. Monitoring registered successfully. Chrome, Firefox and Safari OAuth protocol checks passed (five checks each); these are not browser UI E2E claims.

The original Clerk deployment **dpl_5ZmFA7Daf4BHA4nMChpxJKgzn3iU** remains available. CLI rollback to it was executed and health200/me401/sign-in200 verified during the failed-candidate recovery. Root can run `corepack pnpm dlx vercel@62.2.0 rollback dpl_5ZmFA7Daf4BHA4nMChpxJKgzn3iU --scope team_YrK7IQKCrCxbbuxx94RJEZbK --yes`. The old Live sibling and Redis DB2 are retained; Supabase Live uses DB3. Root's preserved release rollback helper restores the old Live directory/environment and restarts only that service. Existing user data and Clerk credentials were not migrated or deleted.

The Vercel environment export contains literal redactions and **must never be replayed as a restore**. The helper now rejects placeholders before applying or restoring. The known private original environment and preserved old deployment are rollback sources; identical historical secret values have not been reconstructed from the redacted export.

No paid upgrade was purchased. Resend custom SMTP is configured on the verified domain, with TLS465 and sender noreply@bookmark-ai.cloud. SMTP authentication passed235; a delivery-only email was accepted by Resend and root verified it in the Hero Gmail Primary inbox. Confirmation/recovery templates retain their original links and include provider OTPs. Actual Supabase signup/recovery email E2E remains unverified until started in the user’s browser. Supabase leaked-password screening is Pro-only; its existing free-plan warning remains. Google/Apple provider enablement is separate from email-delivery proof.

Actual hosted browser/extension and native UI checks are blocked by the locked Mac; no alternate UI automation was used. Safari's signed hosted wrapper compiled and its signature verified, but authenticated Safari runtime is unverified. Hosted Android is installed only in the QA emulator; its browser-return runtime is pending. The hosted yellow iPhone QA update is installed; its initial iOS27 scene lifecycle startup trap was fixed by the installed Expo 57.0.26 scene support build. Physical launch visibly reaches Sign In. The current browser Sign In action fails before opening its browser; mobile auth UX restoration and completed browser login/return remain pending. Manual checks remain in [supabase-user-test.md](supabase-user-test.md).

Native provider proof also passed AAL2 import/refresh, independent browser/native session IDs, wrong-code/PKCE/replay rejection and selected/local revocation while retaining browser access. The disposable proof user was cleaned up. This does not prove native OS callback delivery. New Mac QA app is installed at `/Users/tara/Applications/Bookmark AI Supabase QA.app`; transition from the running older QA process awaits unlock. SMTP configuration and inbox delivery are complete; actual signup/recovery flow testing remains separate from native UI/device prerequisites.

Live logging follow-up completed by root: the three New Relic placeholders were replaced from known private values, only bookmark-live restarted, and public health200/protected401 reverified. Other config, DB3, Redis/Caddy and retained Clerk release were preserved.
