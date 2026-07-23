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

Build both store zips locally (Chrome + Firefox) without CI:

```bash
pnpm --filter @bookmark-ai/extension release:zip
```

Outputs land in `apps/extension/.output/` (e.g. `bookmark-aiextension-<version>-chrome.zip`
and the Firefox zip). Upload the **zip** by hand at the CWS dashboard if you ever need to
publish outside CI.

> The `.crx` file WXT also writes into `.output/` is for **self-hosted sideloading only**
> (loading a signed package directly / enterprise policy install). The Chrome Web Store
> takes the **zip**, not the `.crx`.

## One-time setup

Do these once; after that, pushes to `main` publish automatically.

### 1. Chrome Web Store developer account + first upload (manual)

1. Register a Chrome Web Store developer account (one-time US$5 fee) at
   <https://chrome.google.com/webstore/devconsole>.
2. **The very first upload must be done by hand** in the dashboard — CI can only *update* an
   existing item, it cannot create one. Build the zip locally
   (`pnpm --filter @bookmark-ai/extension release:zip`), click **Add new item**, upload
   `apps/extension/.output/*-chrome.zip`, fill in the listing (name, description, icons,
   screenshots, privacy fields), and save/submit.
3. Grab the **item id** from the dashboard URL
   (`.../devconsole/.../items/<THIS_IS_THE_ID>/edit`). This is `CWS_EXTENSION_ID`.

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
