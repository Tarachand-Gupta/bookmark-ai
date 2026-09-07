# Releasing the Bookmark AI extension

The extension ships to the **Chrome Web Store (CWS)** through CI. Firefox/Safari zips
are also built every run (as workflow artifacts) but are not auto-published.

Pipeline: [`.github/workflows/extension-release.yml`](../../.github/workflows/extension-release.yml)

## How the auto-trigger works

Two jobs, `verify-build` → `publish-chrome`:

- **`verify-build`** runs on:
  - every **push to `main`** that touches `apps/extension/**`, `packages/types/**`
    (the extension's only workspace dependency), or the workflow file itself, and
  - any manual **workflow_dispatch**.

  It installs the extension subgraph (`pnpm --filter @bookmark-ai/extension... install
  --frozen-lockfile`), runs `test` (vitest) + `check-types`, builds both store zips
  (`zip` = Chrome MV3, `zip:firefox` = Firefox MV2), and uploads them as the
  `extension-zips` artifact (30-day retention). This job always runs.

- **`publish-chrome`** (needs `verify-build`) uploads the Chrome zip to the CWS and
  publishes it. It runs **only when all four `CWS_*` secrets are present** AND either:
  - the run was a **push to `main`** (auto-publish), or
  - the run was a **manual dispatch with the `publish` input set to `true`**.

  So: pushing extension changes to `main` publishes automatically once the secrets are
  configured; before that (or on any dispatch left at `publish: false`) the pipeline is
  build-and-verify only, and the publish job is skipped.

There are **no third-party marketplace actions** — publishing is plain `curl` against the
CWS API v2: refresh the OAuth token at `accounts.google.com/o/oauth2/token`, `PUT` the zip
to `.../upload/chromewebstore/v1.1/items/$ID`, then `POST` `.../items/$ID/publish`. The job
fails loudly (and prints the store's response) if the upload state isn't `SUCCESS`/`IN_PROGRESS`
or the publish status isn't `OK`.

## Manual dispatch

GitHub → **Actions** → **extension release** → **Run workflow**:

- Leave **publish** unchecked (default) → build + test + upload zips only. Use this to get
  fresh store zips as artifacts without shipping.
- Check **publish** → also publish to the CWS (requires the secrets).

## Local command

Build every store artifact locally without CI:

```bash
pnpm --filter @bookmark-ai/extension release:zip   # = zip → zip:firefox → zip:store
```

Outputs in `apps/extension/.output/` (all `production` mode — prod origins ONLY in the
manifest, see `lib/app-origins.ts`):

| File | Use |
| --- | --- |
| `bookmark-aiextension-<v>-chrome.zip` | CWS **updates** (what CI uploads) |
| `bookmark-aiextension-<v>-chrome-store.zip` | CWS **first upload only** ("Add new item"): manifest `key` removed, private key inside as `key.pem` (re-wrapped as **PKCS#8** `-----BEGIN PRIVATE KEY-----` — the dashboard answers "Can not process the key.pem file." to the PKCS#1 `BEGIN RSA PRIVATE KEY` form our `.keys/crx-key.pem` is stored in) so the store keeps id `ffhbgpgebpmofjkehpjcemepbgcmoelp`. Needs `.keys/crx-key.pem` (gitignored) — `zip:store` aborts if it is missing or derives a different id. |
| `bookmark-aiextension-<v>-firefox.zip` | AMO add-on package (MV2, gecko id `bookmark-ai@purecode.ai`) |
| `bookmark-aiextension-<v>-sources.zip` | AMO **source code** upload: `apps/extension` + `packages/types` + root workspace files + generated `BUILD.md` (Node 22 / pnpm 10.34.1, install + `build:firefox` steps, output file hashes). Reproduces `firefox-mv2` byte-for-byte. Never contains `.keys/`, `*.pem`, `.env`, `.env.local`. |

`pnpm zip:store` alone re-derives the last two from zips already present (`--chrome-only` /
`--sources-only` to pick one).

> The `.crx` file WXT also writes into `.output/` is for **self-hosted sideloading only**
> (loading a signed package directly / enterprise policy install). The Chrome Web Store
> takes the **zip**, not the `.crx`.

## One-time setup

Do these once; after that, pushes to `main` publish automatically.

### 1. Chrome Web Store developer account + first upload (manual)

1. Register a Chrome Web Store developer account (one-time US$5 fee) at
   <https://chrome.google.com/webstore/devconsole>.
2. **The very first upload must be done by hand** in the dashboard — CI can only *update* an
   existing item, it cannot create one. Build locally
   (`pnpm --filter @bookmark-ai/extension release:zip`), click **Add new item**, upload
   `apps/extension/.output/*-chrome-store.zip` (the one WITH `key.pem` — this is what keeps
   the pinned id; the plain `*-chrome.zip` would get a new id and break Clerk auth), fill in
   the listing (name, description, icons, screenshots, privacy fields —
   `STORE-LISTING.md`), and save/submit.
3. **Verify the item id** in the dashboard URL
   (`.../devconsole/.../items/<THIS_IS_THE_ID>/edit`) is `ffhbgpgebpmofjkehpjcemepbgcmoelp`.
   This is `CWS_EXTENSION_ID`. If it differs, stop: register the new id in Clerk
   `allowed_origins` + `apps/web/lib/authorized-parties.ts` before announcing.

### 2. OAuth client + refresh token for the CWS API

The CWS API authenticates as *you* via an OAuth 2.0 refresh token.

1. In the **Google Cloud Console** (<https://console.cloud.google.com>), create/select a
   project and enable the **Chrome Web Store API**
   (APIs & Services → Library → "Chrome Web Store API" → Enable).
2. APIs & Services → **OAuth consent screen**: configure it (User type "External" is fine;
   you can leave it in "Testing" and add your own Google account as a test user).
3. APIs & Services → **Credentials** → **Create credentials** → **OAuth client ID** →
   application type **Desktop app**. Note the **client id** (`CWS_CLIENT_ID`) and
   **client secret** (`CWS_CLIENT_SECRET`).
4. Mint a **refresh token** once, using that client, with scope
   `https://www.googleapis.com/auth/chromewebstore`:
   - Open (replace `CLIENT_ID`):
     ```
     https://accounts.google.com/o/oauth2/auth?response_type=code&scope=https://www.googleapis.com/auth/chromewebstore&access_type=offline&redirect_uri=urn:ietf:wg:oauth:2.0:oob&client_id=CLIENT_ID
     ```
     Approve, and copy the authorization **code** it shows.
     (If Google rejects the `oob` redirect for your client, add `http://localhost` as an
     authorized redirect URI on the client and use that instead, copying the `code` query
     param off the redirect.)
   - Exchange the code for tokens:
     ```bash
     curl -s "https://accounts.google.com/o/oauth2/token" \
       -d "client_id=CLIENT_ID" \
       -d "client_secret=CLIENT_SECRET" \
       -d "code=THE_CODE" \
       -d "grant_type=authorization_code" \
       -d "redirect_uri=urn:ietf:wg:oauth:2.0:oob"
     ```
   - Copy `refresh_token` from the JSON. This is `CWS_REFRESH_TOKEN` (long-lived; reused on
     every CI run to mint short-lived access tokens).

### 3. GitHub repository secrets

Set these four (Settings → Secrets and variables → Actions → **New repository secret**), or
via the CLI:

```bash
gh secret set CWS_EXTENSION_ID
gh secret set CWS_CLIENT_ID
gh secret set CWS_CLIENT_SECRET
gh secret set CWS_REFRESH_TOKEN
```

| Secret | Value |
| --- | --- |
| `CWS_EXTENSION_ID`  | item id from the CWS dashboard URL |
| `CWS_CLIENT_ID`     | Google OAuth 2.0 Desktop-app client id |
| `CWS_CLIENT_SECRET` | that client's secret |
| `CWS_REFRESH_TOKEN` | refresh token minted with the `chromewebstore` scope |

Until all four exist, CI stays in build-only mode and the `publish-chrome` job is skipped
(no failure).

### 4. Firefox Add-ons (AMO) — manual, not automated

1. <https://addons.mozilla.org/developers/> → Submit a New Add-on → upload
   `apps/extension/.output/*-firefox.zip`. The manifest already carries the mandatory
   `data_collection_permissions` (required: `authenticationInfo`, `bookmarksInfo`,
   `browsingActivity`) and `strict_min_version: "140.0"` — the AMO form's data questions must
   match it. Pre-check locally:
   `pnpm dlx web-ext@8 lint --source-dir apps/extension/.output/firefox-mv2 --no-input`
   (0 errors; `UNSAFE_VAR_ASSIGNMENT` warnings come from bundled React/Clerk and are expected).
2. When asked for **source code** (required — the bundle is minified), upload
   `apps/extension/.output/*-sources.zip`; reviewers follow its `BUILD.md`.
3. No AMO API credentials exist in this repo/CI (`WEB_EXT_API_KEY`/`_SECRET`), so Firefox
   releases stay manual; bump `version` and re-run `release:zip` for each.

### 5. Safari — Mac App Store (manual, not automated)

Safari ships as a Mac app that embeds the `safari-mv3` build. The Xcode project is generated
from the committed `apps/extension/safari-app/project.yml` (XcodeGen) — never from
`safari-web-extension-converter` — and the app/appex versions are derived from `package.json`
by `scripts/safari-version.mjs` (`0.1.2` → `CFBundleVersion` `10200`).

1. Bump `version` in `package.json` — App Store Connect needs a strictly higher `CFBundleVersion`
   per upload. To re-upload the SAME version, set `SAFARI_BUILD_SUFFIX=1`…`99` (→ `10201`…).
2. `pnpm --filter @bookmark-ai/extension safari:xcode -- --archive` →
   `safari-app/build/BookmarkAISafari.xcarchive` (Release, automatic signing with team
   `L3PP7DQZWS`; needs the paid membership's distribution certificate, which Xcode ▸ Settings ▸
   Accounts issues on first use). `--unsigned` proves the Release build compiles without a team.
3. Export + upload:
   ```bash
   cd apps/extension && xcodebuild -exportArchive -archivePath safari-app/build/BookmarkAISafari.xcarchive \
     -exportOptionsPlist safari-app/ExportOptions.plist -exportPath safari-app/build/export -allowProvisioningUpdates
   ```
   then upload `safari-app/build/export/*.pkg` with Transporter (or Xcode ▸ Window ▸ Organizer ▸
   Distribute App straight from the archive). App Store builds are NOT notarized by us — Apple
   signs them after review; notarization is only for Developer ID (outside-the-store) builds.
4. Metadata, App Privacy answers, screenshots and the review notes: `docs/safari-store-readiness.md`.

## Notes / caveats

- Publishing **queues** the item; CWS may hold it for review before it goes live. The job
  reports success once the store accepts the publish request (`status: ["OK"]`).
- CI publishes whatever `pnpm --filter @bookmark-ai/extension zip` produces — the **prod**
  build target (`.env.production`, `bookmark-ai.cloud`, the prod Clerk instance). Bump
  `version` in `apps/extension/package.json` before shipping a new store release; the CWS
  rejects re-uploads that don't increase the version.
- The refresh token can be revoked/expired by Google (e.g. if the OAuth consent screen stays
  in "Testing", tokens can expire after 7 days). If publishing starts failing at the token
  step, re-mint `CWS_REFRESH_TOKEN` (step 2.4) or move the consent screen to "In production".
