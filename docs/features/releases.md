# App releases + update banners

Shipped 2026-09-07 (master migration **v5** `app-releases`). The source of truth for "latest
version per platform", polled by the native apps at launch (and every 6 h) to decide whether to
show an update banner. Control-plane data in the **master** DB — not user data, so no export-format
impact. Types + pure helpers: `packages/types/src/releases.ts`; queries:
`packages/db/src/queries/app-releases.ts`; server logic: `apps/web/lib/server/releases.ts`.

## Record

One row per platform in `app_releases(platform PK, version, build, min_supported_version,
download_url, release_notes, published_at, updated_at)`. API shape (`appReleaseSchema`):

| Field | Rules |
| --- | --- |
| `platform` | `"macos" \| "ios" \| "android"` (`appPlatformSchema`, `APP_PLATFORMS`) |
| `version` | semver `^\d+\.\d+\.\d+$` — no `v`, no prerelease |
| `build` | `null` or numeric, dots allowed (`"2"`, `"1.0.3"`); CFBundleVersion / Expo buildNumber / versionCode |
| `minSupportedVersion` | `null` or semver **≤ `version`**; below it the client shows a blocking banner |
| `downloadUrl` | `https://` only. macOS: releases page; iOS: App Store URL; Android: Play URL |
| `releaseNotes` | `null` or ≤ 2,000 chars of short markdown |
| `publishedAt` / `updatedAt` | ISO instants (server-stamped, see PUT) |

## API

- **`GET /api/app/releases`** — PUBLIC (no auth; rate-limited per IP like every route;
  `Cache-Control: public, max-age=300`) → `{ releases: { macos?, ios?, android? } }`
  (`appReleasesResponseSchema`). A deployment with no master DB (`MASTER_DATABASE_URL` unset,
  i.e. single-tenant / self-host) or a failed read answers `{ releases: {} }` — never a 5xx —
  so clients never show a banner without data.
- **`PUT /api/admin/releases/:platform`** — admin only (`admin-gate.ts`: open mode, or
  `ADMIN_USER_IDS`), body `upsertAppReleaseSchema` `{version, build?, minSupportedVersion?,
  downloadUrl, releaseNotes?, publishedAt?}` → `{ release }`. Empty strings clear the optional
  fields. `publishedAt` omitted ⇒ re-saving the SAME version+build keeps the existing timestamp
  (fixing notes is not a new release); a new version or build is stamped now. 400 `{error}` with
  the first Zod message (unknown platform, bad semver, non-https URL, `minSupportedVersion` >
  `version`, …); 503 without a master DB.
- **`DELETE /api/admin/releases/:platform`** → 204, idempotent (clearing an absent record is
  fine); 400 unknown platform; 503 without a master DB.

```bash
# admin (open mode locally); prod needs an admin Clerk session
curl -s -X PUT localhost:3000/api/admin/releases/macos -H 'content-type: application/json' \
  -d '{"version":"0.2.0","build":"2","downloadUrl":"https://github.com/Tarachand-Gupta/bookmark-ai/releases"}'
curl -si localhost:3000/api/app/releases          # public; shows cache-control: public, max-age=300
curl -s -X DELETE -o /dev/null -w '%{http_code}\n' localhost:3000/api/admin/releases/macos   # 204
```

## Client helpers (pure, shipped with `@bookmark-ai/types`)

- `compareVersions(a, b) → -1 | 0 | 1` — numeric semver (`0.10.0` > `0.9.0`; missing components
  read as 0; a leading `v` is tolerated). Each side may be a string or `{ version, build? }`;
  when versions tie and BOTH sides carry a build, the build (numeric, segment-wise) breaks the tie.
- `updateState(current, release) → "current" | "update-available" | "unsupported"` — no record ⇒
  `current`; `current.version` < `minSupportedVersion` ⇒ `unsupported`; `current` < release
  (version, then build) ⇒ `update-available`; else `current`.

Client rule (CONTRACT §12): compare the bundle's own version/build (macOS
`CFBundleShortVersionString` + `CFBundleVersion`; Expo `nativeApplicationVersion` +
`nativeBuildVersion`); `update-available` ⇒ dismissible banner with Download/Update + "Later"
(24 h snooze per version); `unsupported` ⇒ the same banner, not dismissible. Never show for the
same/older version, an absent record, or a failed request. The web app shows no banner.

## Tests

`apps/web/lib/server/releases.test.ts` — helpers, schema, the queries against an in-memory
libSQL DB running the real `MASTER_MIGRATIONS` (v5 exercised), and both route handlers with the
admin gate + master context mocked (gate passthrough, validation 400s, 503 without master, the
PUT → GET → DELETE → GET round trip, `publishedAt` semantics).

## Building and publishing downloads

The `downloadUrl` each record points at is a **GitHub Release asset** built by CI. Three
workflows, one per platform, all idempotent (re-running replaces the assets with `--clobber`):

| Workflow | Tag / trigger | Asset(s) on the release | Secrets |
| --- | --- | --- | --- |
| `.github/workflows/macos-release.yml` | tag `macos-v<version>` or dispatch (`version` input, blank = `MARKETING_VERSION` in `apps/macos/project.yml`) | `BookmarkAI-<version>-macos.zip` (+ `.sha256`) — `ditto -c -k --keepParent` of the ad-hoc-signed Release app | none (`GITHUB_TOKEN`, `contents: write`) |
| `.github/workflows/android-release.yml` | tag `android-v<version>` or dispatch (blank = `expo.version` in `apps/mobile/app.json`) | `bookmark-ai-<version>-android.apk` (+ `.sha256`) — `expo prebuild` + `gradlew assembleRelease`, signed with the release keystore | `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD` (all four required — the job refuses to build a debug-signed "release") |
| `.github/workflows/extension-release.yml` → job `github-release` | push to `main` (only when tag `extension-v<apps/extension/package.json version>` does not exist yet) or dispatch (always creates/updates) | `bookmark-aiextension-<v>-chrome.zip`, `-firefox.zip`, `-sources.zip` + `SHA256SUMS`. The `-chrome-store.zip` (carries the private `key.pem`) is asserted ABSENT | none for the release job (the CWS publish job keeps its `CWS_*`) |

The version in the tag/input **must equal the manifest version** (`project.yml` / `app.json`) —
the native apps compare their own bundle version against the published record, so a mislabeled
asset would break the update banner; the jobs fail on a mismatch instead. Both native workflows
run the unit tests first (`xcodebuild test` for `BookmarkAITests`; Gradle's `lintVitalRelease`) and
assert the built binary reports the expected version.

Release flow (the owner does this; CI never publishes the record itself):

1. Bump the version (`MARKETING_VERSION` + `CURRENT_PROJECT_VERSION` / `expo.version` +
   `android.versionCode` / `package.json`), commit, push.
2. `git tag macos-v0.1.0 && git push origin macos-v0.1.0` (or `gh workflow run macos-release.yml
   -f version=0.1.0`); same for `android-v…`. The extension release happens on the push to `main`.
3. Wait for the run; the last step prints the download URL and the exact `PUT /api/admin/releases/…`
   body. Publish it from **Settings → Releases** (admin) or `curl` — `downloadUrl` for macOS is the
   release **page** (the user unzips), for Android the direct **APK** URL.

### macOS: ad-hoc signed, Gatekeeper caveat, notarization follow-up

The Mac app is signed **ad-hoc** (`CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=-`, the same
fallback `apps/macos/README.md` documents; the sandbox entitlements still apply). There is no
Developer ID certificate on the team yet, so the app is **not notarized**: on macOS 14+ the first
launch of a downloaded copy shows "Apple could not verify BookmarkAI is free of malware". The
release notes tell users the two ways through: **System Settings ▸ Privacy & Security ▸ Open
Anyway**, or `xattr -d com.apple.quarantine /Applications/BookmarkAI.app`. A locally-built copy
carries no quarantine attribute, so this only bites real downloads — test with a browser download.

**Follow-up (owner):** a *Developer ID Application* certificate (Apple Developer Program) exported
as `.p12` + an App Store Connect API key for `notarytool`. Then the workflow gains: import the cert
into a temporary keychain, build with `CODE_SIGN_IDENTITY="Developer ID Application: …"` +
`OTHER_CODE_SIGN_FLAGS=--timestamp`, `xcrun notarytool submit … --wait`, `xcrun stapler staple`,
re-zip. Suggested secret names: `MACOS_DEVELOPER_ID_P12_BASE64`, `MACOS_DEVELOPER_ID_P12_PASSWORD`,
`APPLE_API_KEY_ID`, `APPLE_API_ISSUER_ID`, `APPLE_API_KEY_P8_BASE64`.

### Android: release keystore custody (`.keys/`)

`expo prebuild`'s template signs the `release` build type with the **debug** keystore.
`apps/mobile/plugins/withReleaseSigning.js` (registered in `app.json`) rewrites that block so
`release` reads `ANDROID_KEYSTORE_PATH` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` /
`ANDROID_KEY_PASSWORD` from the environment or Gradle properties and falls back to the debug
keystore when any is unset (dev builds keep working; Gradle prints a `[withReleaseSigning]` line
saying which one it used). It is idempotent across repeated prebuilds and throws if the template
block it expects is gone.

The keystore lives at the repo root, gitignored and Vercel-ignored (`/.keys/` in `.gitignore`,
`**/.keys` in `.vercelignore` — check with `git check-ignore -v .keys/android-release.keystore`):

- `.keys/android-release.keystore` — PKCS12, RSA 2048, alias `bookmark-ai`, `CN=Bookmark AI,
  O=purecode.ai`, valid 10,000 days. PKCS12 keystores use ONE password for store and key.
- `.keys/android-release.env` — the four `ANDROID_*` variables (`set -a; . .keys/android-release.env;
  set +a` before a local release build). The GitHub secrets carry the same values;
  `ANDROID_KEYSTORE_BASE64` is `base64 < .keys/android-release.keystore`.

**Back both files up outside this machine.** Every future APK must be signed with this key or
Android refuses to update an existing install (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`) and users have
to uninstall. Never print the passwords, never commit `.keys/`.

A release bundle has `__DEV__ == false`, so `src/api.ts` selects the production target
(`https://www.bookmark-ai.cloud` + the prod Clerk key) by itself; the workflow blanks every
`EXPO_PUBLIC_*` override, and a local build must not have one exported either.

### Local equivalents

```bash
# macOS (apps/macos) — what the workflow runs; outputs under .work/release (gitignored)
xcodegen generate
xcodebuild -project BookmarkAI.xcodeproj -scheme BookmarkAI -configuration Debug -destination 'platform=macOS' \
  -derivedDataPath .work/release/DerivedData CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- PROVISIONING_PROFILE_SPECIFIER= DEVELOPMENT_TEAM= test
xcodebuild … -configuration Release … build
ditto -c -k --keepParent .work/release/DerivedData/Build/Products/Release/BookmarkAI.app .work/release/BookmarkAI-0.1.0-macos.zip

# Android (apps/mobile)
export JAVA_HOME=/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home ANDROID_HOME=$HOME/Library/Android/sdk
set -a; . ../../.keys/android-release.env; set +a
npx expo prebuild --platform android --no-install && (cd android && ./gradlew assembleRelease)
$ANDROID_HOME/build-tools/36.0.0/apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk

# Extension
pnpm --filter @bookmark-ai/extension release:zip     # chrome + firefox + sources (+ the local-only chrome-store zip)
```
