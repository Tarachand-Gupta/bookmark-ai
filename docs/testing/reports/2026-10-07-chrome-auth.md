# Chrome authentication — 7 October 2026

Hosted production check in the owner's actual Google Chrome profile. Production uses Supabase at `https://www.bookmark-ai.cloud`; the owner's visible baseline was 89 bookmarks/14 saved sessions. No bookmarks were created, edited or deleted. The existing web session, profile and old extension output were preserved.

## Cause and artifact identity

The loaded **Bookmark AI 0.1.5**, ID `ffhbgpgebpmofjkehpjcemepbgcmoelp`, came from `apps/extension/.output/chrome-mv3`. Its built authentication uses Clerk. Its Sign In opens the website sign-in page, and its automatic session-sync promise expects a Clerk session. Current production Google/web login creates a Supabase session, which cannot authenticate this old extension.

The current hosted artifact was loaded alongside it from `.work/production-clients-oct6/extension-kit/chrome`: **Bookmark AI Supabase QA 0.1.5**, ID `peikdeadpkgjgohdndljbciephekdpfg`. Recorded `background.js` SHA256: `ecfc6c916a9178401738f4059b05dbb6ecdff6f8e2ab04069cabbe7e24c1f1d1`. Version alone cannot distinguish these artifacts. The Chrome for Testing inventory initially looked incomplete when examining only Preferences; Secure Preferences contains its addon record. This did not establish a missing QA profile or addon.

## Observed cases

| Case | Result | Evidence boundary |
|---|---|---|
| ENV-03, legacy artifact | FAIL | Loaded directory/ID and built Clerk provider mismatch current production. |
| ENV-03, current hosted kit | PASS | Actual Chrome loaded the named QA kit with its pinned ID. |
| AUTH-11, same-www-profile reuse/callback | PASS | Fresh QA extension was signed out while the owner's www web app was signed in. Real toolbar Sign In opened `/oauth/consent` with an authorization request, immediately showed the existing owner identity, and required first authorization. Clicking Authorize extension closed the auth window. Reopened toolbar showed the masked owner identity, Sign out, Save bookmark and Save session controls; Live was OFF. No credentials form appeared. |
| AUTH-11, authenticated apex repeat | NOT RUN | Read-only signed-out HTTP confirmed apex 307 → www, preserving `/app`; authenticated apex continuation was not exercised. The whole composite AUTH-11 row remains incomplete. |
| AUTH-12, Google extension return | NOT RUN | No Google page or fresh provider login was visited during this check. Existing-session reuse cannot establish Google completion. |
| Old-addon disable/current-addon pin | PASS | Current QA addon ON and pinned (Unpin control observed); legacy addon OFF through its normal toggle, retaining installation, storage and files. |

The 6 October Chrome pass covered the isolated QA kit/profile, hosted callback, retained identity, saves and session restore. It did not test the ordinary `.output/chrome-mv3` folder or establish named Google extension return.

## Prevention and remaining proof

Commit `5ca30e0` guards ordinary build/zip against accidentally producing legacy Clerk auth; explicit `--legacy-clerk` retains deliberate rollback. Seven guard tests, 11 wrapper tests and extension type checking passed. The matrix/runbook now require provider, mode, loaded directory, ID and callback evidence before auth PASS.

This report proves current Chrome web-session reuse. Google completion, cold restart, Live/revoke and other browser/platform journeys retain separate status. Private evidence: `.work/chrome-auth-oct7/PROTOCOL.md`, the operator's forthcoming `QA.md`, and actual signed-in toolbar CUA captures. Local screenshot export was unavailable; inline captures are runtime evidence. No provider configuration, web deployment or store publication was performed for this repair.
