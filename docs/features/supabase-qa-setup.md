# Supabase QA setup

This branch replaces Clerk with Supabase. Production promotion and existing-account migration were subsequently authorized and completed: Supabase holds authentication and master/account routing, while existing content remains in retained Turso tenant databases. The yellow client identifiers and isolated output folders distinguish test installations from retained Clerk apps. These builds use the live service with `--hosted-production`; they do not require a local server. Store submission remains separate.

## Development and build isolation

Use Node 22+ and `corepack pnpm` (the pinned version is 10.34.1). Copy `.env.supabase.example` to the ignored `.env.supabase.local` and fill its private values locally. The wrapper reads only that file and rejects Clerk, legacy database, production API, and authentication-bypass configuration.

Run commands from the repository root:

```sh
corepack pnpm qa:supabase check
corepack pnpm qa:supabase web dev
corepack pnpm qa:supabase live dev
corepack pnpm qa:supabase chrome build
corepack pnpm qa:supabase firefox build
corepack pnpm qa:supabase safari build
corepack pnpm qa:supabase macos build
corepack pnpm qa:supabase ios generate
corepack pnpm qa:supabase android build
```

Each invocation snapshots source and freezes dependency bytes under `.work/builds/supabase-qa/`. Its manifest records the Git revision, source hash, lockfile hashes, dependency location, and build result. Workspace links resolve inside the snapshot. QA app identifiers, storage, URL schemes, App Groups, Next output, native generation, and DerivedData are separate. A later branch switch does not change an existing snapshot. Use these commands instead of normal release builds for this branch; they do not install or launch native applications.

`ios generate` creates the staged native project. `ios build` additionally installs Pods in that snapshot and compiles a simulator app with Xcode-generated ad-hoc signing for SecureStore; `android build` compiles its staged Debug APK. Native dependencies use a private per-run overlay, with per-run CocoaPods/Gradle caches. Never run prebuild in the original checkout. `ios dev` or `android dev` starts staged Metro on8083. Both share localhost QA API/live aliases; Android translates them to `10.0.2.2`. For Android Debug Metro, use `adb reverse tcp:8083 tcp:8083` plus the QA app private `debug_http_host=127.0.0.1:8083` preference; iOS uses QA app `RCT_jsLocation=localhost:8083`. Physical devices need reachable QA web/Live URLs; localhost refers to the device itself. Live requires explicit QA `REDIS_URL=redis://127.0.0.1:6386/0` and a distinct `LIVE_ENCRYPTION_SECRET`; the wrapper rejects default6379. This Redis holds ephemeral Live content only.

## Provider setup

The QA Supabase project is `xogqaqtyacmecdbmgqqd`. Its dashboard's default `main / PRODUCTION` badge refers to the new project's default branch, not Bookmark AI's deployed Clerk environment. The QA Turso group is `bmai-supabase-qa`; database names must start with `bmai-sbqa-`. Provisioning credentials must be restricted to that group.

Use a private Postgres schema and restricted runtime login, with the transaction pooler and verified TLS. Keep schema-administration credentials outside the runtime environment. Backend secrets and encrypted Turso credentials never belong in client bundles.

Supabase owns refresh tokens and native sessions. Authentication checks validate the JWT and call the provider on each protected human request. No Redis authentication registry or positive session cache is used. Device labels contain display metadata only. Selected-device management operates on owned native sessions through a private server-only adapter; hosted lifecycle tests are required before cutover.

The free project's session/inactivity settings are both `0 / never`. Keep refresh-token replay protection enabled. The current QA access-token lifetime is 3,600 seconds; server-side online validation is still required before expiry. Real multi-week elapsed testing must be distinguished from simulated expiry and refresh tests.

Extensions use separate public OAuth clients with PKCE and exact callbacks. OAuth Server is currently beta: its compatibility and production terms require review before release. Dynamic client registration stays disabled. Firefox's actual QA runtime redirect was observed and registered as `https://2d23e472b97ab51916dd1f2d4be7103f7b50c01b.extensions.allizom.org/`, client `bfd38841-291b-49b7-a710-6ccb5f516348`. Re-observe the callback when changing extension identifiers. Set trusted extension client IDs on the backend so an extension token cannot become an unrestricted account credential.

Production Google/Apple credentials are now configured in the new project with additive provider callbacks; [social provider setup and renewal](supabase-social-providers.md) records the configuration and verification. Real email delivery, native signing, and installed-device journeys remain separate gates. A successful build or unit test does not prove those gates.

On this Mac's Xcode installation, the simulator UI is **Device Hub** at `/Applications/Xcode.app/Contents/Applications/DeviceHub.app` (`com.apple.dt.Devices`). Open that app and select the existing `Bookmark AI Supabase QA iPhone` or `Bookmark AI Supabase QA iPad` in the sidebar. Do not reinstall or rebuild merely because `Simulator.app` is absent. The isolated simulator UUIDs can be obtained from `xcrun simctl list devices`; use the matching QA device only.

## Before merge or release

1. Complete the per-client QA matrix, including two same-user sessions, foreign-user denial, retained unexpired JWT rejection after revoke, rejected refresh, outage recovery, and cache/share isolation.
2. Verify restricted database privileges, Turso provisioning/deletion recovery, MCP credentials, and bounded Live stream revocation.
3. Review provider configuration, Google/Apple account continuity, SMTP, custom accounts-domain changes, and the explicit existing-user migration plan.
4. Production cutover is authorized and live. Build production-connected artifacts with `--hosted-production`, verify the installed executable rather than only the build output, and keep the checkpoint branch and existing outputs available for rollback. Store submission and public distribution remain separate.

Implementation progress and runtime evidence are recorded separately; this setup guide is not a release-readiness declaration.
