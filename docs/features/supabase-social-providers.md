# Google and Apple credentials for Supabase

Updated 4 October 2026. The owner authorized configuring real production social-login credentials in the new Supabase project, alongside the preserved Clerk integration. This does not deploy the Supabase branch, migrate users, or change DNS.

## Configuration

Both providers use this hosted callback:

`https://xogqaqtyacmecdbmgqqd.supabase.co/auth/v1/callback`

Google uses the existing BookmarkAI Google Cloud project `aerobic-arc-503412-s1` and Web OAuth client `956911501753-l5de3pbtl676o4dpjqqkqej8i9ebv2hv.apps.googleusercontent.com`. The client's Supabase callback was appended; `https://clerk.bookmark-ai.cloud/v1/oauth_callback` and its existing origin remain. The existing secret was copied directly from the owner's private credential export into Supabase without printing or committing it. Nonce checking remains enabled; missing-email sign-in remains disabled.

Google's consent configuration now includes the live homepage, privacy policy and terms URLs under `https://www.bookmark-ai.cloud`. All three returned HTTP 200. The audience is External and publishing status was changed from Testing to **In production**. No additional Google API scopes were requested. Verification Center confirms that data-access verification is not required because no sensitive or restricted scopes are requested. It also reports that the brand is not yet displayed to users; the observed login screen identifies the Supabase hostname. Brand verification and the previously deferred custom authentication domain remain distinct from working production credentials.

Apple uses team `L3PP7DQZWS`, Services ID `ai.bookmarkai.web`, primary App ID `ai.bookmarkai`, and its existing active Sign in with Apple key. The Apple console was checked live for this association. The Supabase domain/callback was added while retaining the Clerk domain/callback. No key was revoked or replaced.

Supabase's Apple Client IDs are, in order:

1. `ai.bookmarkai.web` — web OAuth Services ID and client-secret subject.
2. `ai.bookmarkai` — production iOS app.
3. `ai.bookmarkai.macos` — production macOS app.
4. `ai.bookmarkai.supabaseqa` — isolated iOS build audience.
5. `ai.bookmarkai.macos.supabaseqa` — isolated macOS build audience.

Allowlisting a native audience does not provision an App ID, sign its app, or prove a native Apple login. Those platform checks remain required. The existing Supabase Site URL and isolated client callbacks remain appropriate for current QA; production app return URLs and Site URL must be selected with the eventual deployment. The production credential configuration can be reused then.

## Apple secret renewal

Apple browser OAuth requires a signed client-secret JWT, not the raw `.p8` key. The configured secret expires **2 April 2027 at 13:41:04 UTC**. Renew and save a replacement before that time; aim for 3 March 2027 or earlier to allow verification time. This is an operational deadline, not an installed reminder or automatic renewal job.

Use the dependency-free generator with the owner's protected key file:

```sh
node scripts/generate-apple-client-secret.mjs \
  --team L3PP7DQZWS \
  --key-id QT9U3K7434 \
  --service-id ai.bookmarkai.web \
  --key-path /secure/path/AuthKey_QT9U3K7434.p8 \
  --output .work/apple-client-secret-next.jwt \
  --metadata-output .work/apple-client-secret-next.json
```

The generator verifies the ES256 signature locally, limits lifetime to 180 days, writes new files with mode `0600`, refuses to overwrite existing destinations, and prints metadata only. Save the JWT in Supabase Authentication → Sign In / Providers → Apple → Secret Key, then verify an actual Apple login. Never paste the signing key or JWT into chat, source control, public environment variables, or client bundles. Renewing this JWT does not require revoking the shared Apple signing key.

## Verification and rollback

Both providers show Enabled in the hosted Supabase dashboard. Google completed a real browser OAuth round trip, provisioned an isolated empty library, appeared under Connected accounts, and signed out locally. Apple reached its correct branded account sign-in page; completed Apple token exchange remains pending owner authentication. This is not a claim of complete native social-login coverage.

Clerk remains usable with its original callbacks, client secret, Apple key, and primary-app association. Rolling back the source branch does not require removing the additive Supabase callbacks. If an operator later retires the new Supabase project, remove only its exact callback/domain entries; do not revoke shared credentials or delete the Clerk callback.

References: [Supabase Google configuration](https://supabase.com/docs/guides/auth/social-login/auth-google), [Supabase Apple configuration and secret renewal](https://supabase.com/docs/guides/auth/social-login/auth-apple), [Apple web configuration](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web).

## Auth email — 4 October 2026

Resend domain `bookmark-ai.cloud` is verified. Supabase project `xogqaqtyacmecdbmgqqd` now uses custom SMTP `smtp.resend.com:465` (TLS), sender **Bookmark AI <noreply@bookmark-ai.cloud>**. Confirmation remains required; Google/Apple and Clerk configuration were unchanged. Original confirmation/recovery subjects, HTML and `{{ .ConfirmationURL }}` links are preserved with `{{ .Token }}` added for native browser-storage fallback. Existing provider OTP length8/expiry3600s are unchanged.

SMTP credential authentication passed235 without sending an extra message. Resend accepted the clearly labeled **Bookmark AI — email delivery test**, reported delivered, and root verified the matching message in Hero Gmail Primary. This proves SMTP credentials and mailbox delivery separately; it does **not** prove actual Supabase signup/recovery email E2E. No Hero account was created or password assigned. Start normal hosted signup/recovery in the user’s browser so its PKCE verifier is available, then check the auth email and finish there. No paid upgrade or DNS changes were needed.
