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
