# Production extension release runbook

Current release: Bookmark AI 0.1.6, Supabase PKCE, canonical API `https://www.bookmark-ai.cloud`, Live `https://live.bookmark-ai.cloud`, storage namespace `bookmark-ai:supabase-production`. Release sources and dependency inputs are frozen; a later repository commit alone does not require rebuilding a verified artifact.

## Build and source review

The ignored root `.env.supabase.production.local` supplies approved URLs, Supabase publishable key and per-browser public OAuth IDs. From the root:

```sh
pnpm --filter @bookmark-ai/extension release:zip
pnpm --filter @bookmark-ai/extension zip:safari
```

The stable kit is `dist/production/`. The ordinary `.output/chrome-mv3`, `.output/firefox-mv2` and `.output/safari-mv3` match its browser directories. `ARTIFACTS.json` records exact versions, identities, frozen source references and file/archive SHA256. Earlier outputs and installed apps remain in recorded rollback copies.

- `chrome.zip`: ordinary update package for existing CWS ID `ffhbgpgebpmofjkehpjcemepbgcmoelp`.
- `firefox.zip`: AMO update for GUID `bookmark-ai@bookmark-ai.cloud`, listing `bookmark-ai-cloud`.
- `firefox-sources.zip`: exact frozen reviewer source, shared workspace packages, lockfile, production wrapper, public-only `BUILD_PUBLIC.env`, `BUILD.md` and expected Firefox output hashes. The included instructions reproduced all 21 release file hashes on October 9. Backend credentials/private signing keys are excluded and privately byte-scanned.
- `safari.zip`: web resources; the signed companion `Bookmark AI for Safari.app` is installed separately.

`zip:store` regenerates the reviewer source archive from the last frozen Firefox package. Existing first-upload/private-key and unqualified legacy CI instructions do not apply to these production updates. The ignored extension RELEASING.md is supplementary; this tracked runbook is durable.

## Hosted configuration and runtime gates

Both hosted consent allowlists must be correct. Check a readable exact provider snapshot against package configuration:

```sh
node scripts/production-oauth-preflight.mjs .env.supabase.production.local /private/path/hosted.env /private/path/preflight.json
```

The check requires all three production IDs, exact callbacks and retained QA rollback IDs/callbacks. It prints booleans/counts; redacted provider downloads cannot pass. Record submitted public inputs/provider update evidence separately when a readable snapshot is unavailable.

| Browser | Exact production callback |
| --- | --- |
| Chrome | `https://ffhbgpgebpmofjkehpjcemepbgcmoelp.chromiumapp.org/supabase` |
| Firefox | `https://bbf8f95c67aba661548c23a9abdd835bdefe81a3.extensions.allizom.org/` |
| Safari | `https://www.bookmark-ai.cloud/auth/extension-callback` |

Each browser gate uses the actual loaded production identity/version/path and toolbar, existing hosted web session → authorization → validated callback/token exchange → exact fixture identity → unique owned bookmark save → fresh hosted library read. Contract tests/builds do not replace runtime proof. Keep Live/native sync off for these fixture checks. Firefox can use official isolated WebDriver/Marionette if native control is unavailable; preserve personal profiles and identify the exact QA process before relaunching.

Safari may select a preserved archived app with the same extension ID. Compare actual popup behavior/version with installed file hashes and inspect exact registered paths. Unregister only a proven stale duplicate, preserve archive bytes, and reopen Safari using “Quit and Keep Windows”. Verify intended installed version and Supabase popup after registration refresh; an enabled toolbar alone is insufficient.

## Authorized existing-store update

Verify publisher account, exact item and highest published/pending version before uploading. Check existing privacy disclosures against Supabase authentication/device metadata and server PostHog analytics, including Firefox optional consent. Use truthful existing declarations; update stale claims before submission.

- [Chrome existing item](https://chromewebstore.google.com/detail/bookmark-ai/ffhbgpgebpmofjkehpjcemepbgcmoelp): plain `chrome.zip` update.
- [Firefox existing item](https://addons.mozilla.org/en-US/firefox/addon/bookmark-ai-cloud/), [developer page](https://addons.mozilla.org/en-US/developers/addon/bookmark-ai-cloud/edit): `firefox.zip` plus matching `firefox-sources.zip`. The retired `bookmark-ai` slug uses a different old GUID.

The user authorized these October 9 submissions once the individual browser runtime and web recovery gates pass. Record upload/submission receipt, package hash, version and actual review/publication state. Submission does not establish publication. Human sign-in/CAPTCHA/legal challenges or an explicit access restriction remain separate blockers; do not bypass protections. Reports belong in `docs/testing/reports/2026-10-09-clients.md`.
