# Production checklist

What stands between the current setup (live but dev-grade) and a real production release —
for the web app + API, and for shipping the extension to the Chrome / Firefox / Safari stores.
Ordered so that items later in the list depend on items earlier in it.

## 1. Web + API hardening (do this first — the stores will ask about it)

- [x] **API auth (done 2026-07-12; now in the Next.js API).** Every `/api` route except
      `/api/health` calls `requireUser()` (`apps/web/lib/server/require-user.ts`): a Clerk
      session (browser cookie or `Authorization: Bearer` JWT, verified by `@clerk/nextjs`),
      an `azp` origin check, and the user pinned via `CLERK_ALLOWED_USER_IDS`. Open modes:
      `CLERK_SECRET_KEY` unset → keyless self-host; `DEV_OPEN_API=1` in dev → bypass
      (desktop/import/curl). Vercel has the Clerk keys + allowlist set.
- [x] **CORS allowlist (done 2026-07-12; now in `apps/web/middleware.ts`).** Browser
      origins are restricted to the known web origins (+ extension schemes) via
      `AUTHORIZED_PARTIES` (`apps/web/lib/authorized-parties.ts`); the bearer token is the
      real gate. **Re-check when origins change**: a new web domain, new extension id, or a
      prod Clerk instance all require updating that list (and Clerk's `allowed_origins`).
- [x] **Rate limiting (done 2026-07-12; now in `apps/web/lib/server/rate-limit.ts`).**
      120 req / 60s per client IP (health + preflight exempt). Per-instance in-memory state
      on Vercel serverless, so it's coarse; per-user quotas come with multi-tenancy later.
- [ ] **Buy a domain.** A production Clerk instance requires one (dev keys can't be used —
      they're origin-promiscuous and show the "development keys" warning). The domain also
      replaces `bookmark-ai-theta.vercel.app`.
- [ ] **Create the Clerk production instance**: add the domain in the Clerk dashboard, set the
      DNS records it asks for (frontend API + accounts CNAMEs), take the new `pk_live`/`sk_live`
      keys. Configure `allowed_origins` for the prod domain + extension origin (it is a
      RESTRICTION list — include every origin that should work).
- [ ] **Vercel**: attach the custom domain; swap Clerk env vars to the live keys.
- [ ] **Extension config for prod**: the baked default in `apps/extension/lib/clerk.ts` still
      points at the dev instance. Build store packages with `WXT_`-prefixed env overrides
      (or an `.env.production`): prod publishable key, prod syncHost/web URL.
      DONE 2026-07-15: `lib/api.ts` defaults to `https://bookmark-ai.cloud`, and both
      `host_permissions` and `externally_connectable.matches` include the prod web domain
      (apex + www) — verified live (tab-group restore from bookmark-ai.cloud). Still pending:
      the prod Clerk frontend API domain in `host_permissions` once production Clerk exists.
- [ ] **Vercel functions**: the API now runs as Vercel serverless functions in the same
      deployment as the web app (Render is retired). Watch function execution limits and the
      daily embed cron; `/api/health` stays the liveness check.
- [ ] **Quotas**: Gemini API billing/limits (categorization + embeddings), Turso plan limits.
- [ ] **Monitoring**: an uptime monitor on the web domain + `/api/health`; Vercel analytics
      optional.

## 2. Chrome Web Store

- [ ] Developer account: Google account + one-time **$5** registration fee.
- [ ] Package: `pnpm --filter @bookmark-ai/extension zip` → zip in
      `apps/extension/.output/` (built with the prod env overrides above).
- [ ] **Remove the manifest `key`** for the store build (CWS rejects packages that pin it).
      To KEEP the extension id `ffhbgpgebpmofjkehpjcemepbgcmoelp` (Clerk `allowed_origins`
      and `apps/web/lib/extension-bridge.ts` depend on it), include the private key as
      `key.pem` in the zip root on the FIRST upload — verify this flow in the current CWS
      docs at upload time. If the id changes anyway: update Clerk `allowed_origins` and the
      `EXTENSION_ID` constant, and redeploy the web app.
- [ ] Store listing: 128px icon, 1280×800 screenshots, description, category.
- [ ] **Privacy policy URL** (required — the extension handles auth cookies) + a data-use
      disclosure, and per-permission justifications for `tabs` (session snapshots), `cookies`
      (Clerk session sync), `tabGroups` (session restore), `storage`, `activeTab`, and each
      host permission.
- [ ] Review typically takes 1–3 days; broad host permissions can slow it down, so keep
      `host_permissions` to exactly the prod domains.

## 3. Firefox Add-ons (AMO)

- [ ] Developer account: free.
- [ ] Package: `pnpm --filter @bookmark-ai/extension zip:firefox` (MV2 build; gecko id
      `bookmark-ai@purecode.ai` + data-collection manifest already set).
- [ ] AMO requires **source code upload + build instructions** for bundled/minified
      extensions (this repo qualifies: WXT/Vite build).
- [ ] Known gaps to resolve or accept before submitting:
      - `externally_connectable` is Chrome-only → the web app's "Open all in window/group"
        handoff doesn't reach the Firefox extension (users get the pop-up-blocker fallback).
      - `@clerk/chrome-extension` officially targets Chrome; syncHost auth on Firefox is
        unverified. Fallback plan: the Clerk-minted-JWT flow (web login → token handed to
        the extension) discussed earlier.
      - Tab groups API exists only in recent Firefox; the extension already degrades
        (`ok:false` → web shows a note).
- [ ] Review includes human source review; expect days, not hours.

## 4. Safari (App Store)

- [ ] **Apple Developer Program, $99/yr** — required. (The same membership covers a future
      iOS app.)
- [ ] Convert: `pnpm --filter @bookmark-ai/extension build:safari`, then
      `xcrun safari-web-extension-converter .output/safari-mv2` → an Xcode project that wraps
      the extension in a small macOS (and optionally iOS) host app.
- [ ] Sign + submit through Xcode / App Store Connect; App Review applies.
- [ ] Same caveats as Firefox (no `externally_connectable`, Clerk syncHost unverified,
      plus Safari's stricter cookie access) — realistically the Safari port ships after the
      JWT auth flow exists.

## 5. Post-launch

- [ ] Keep dev and store builds separated: dev keeps the pinned `key` + localhost origins;
      store builds get prod origins only.
- [ ] Version bumps in `apps/extension/package.json` flow into the manifest — stores reject
      re-uploads of the same version.
- [ ] After any Clerk origin/instance change, re-test extension sign-in AND the web→extension
      session-restore handoff on the prod domain.
