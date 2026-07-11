# Production checklist

What stands between the current setup (live but dev-grade) and a real production release —
for the web app + API, and for shipping the extension to the Chrome / Firefox / Safari stores.
Ordered so that items later in the list depend on items earlier in it.

## 1. Web + API hardening (do this first — the stores will ask about it)

- [ ] **Lock down the API.** `apps/server` is currently unauthenticated with permissive CORS —
      anyone with the Render URL can read/write/delete bookmarks. Before calling anything
      "production": verify a Clerk session JWT in an Express middleware (networkless
      verification against the instance JWKS; web + extension already carry Clerk sessions),
      restrict CORS to the known origins (web domain, extension origin), and add basic rate
      limiting. This is the single biggest production blocker.
- [ ] **Buy a domain.** A production Clerk instance requires one (dev keys can't be used —
      they're origin-promiscuous and show the "development keys" warning). The domain also
      replaces `bookmark-ai-theta.vercel.app`.
- [ ] **Create the Clerk production instance**: add the domain in the Clerk dashboard, set the
      DNS records it asks for (frontend API + accounts CNAMEs), take the new `pk_live`/`sk_live`
      keys. Configure `allowed_origins` for the prod domain + extension origin (it is a
      RESTRICTION list — include every origin that should work).
- [ ] **Vercel**: attach the custom domain; swap Clerk env vars to the live keys.
- [ ] **Extension config for prod**: the baked defaults in `apps/extension/lib/clerk.ts` and
      `lib/api.ts` point at the dev instance and localhost. Build store packages with
      `WXT_`-prefixed env overrides (or an `.env.production`): prod publishable key, prod
      syncHost/web URL, Render API URL. `host_permissions` must gain the prod web domain +
      prod Clerk frontend API domain; `externally_connectable.matches` must gain the prod
      web domain.
- [ ] **Render**: free tier cold-starts (~50s) after idle. Either upgrade to Starter (~$7/mo)
      or accept it / add an uptime pinger. Health check is already `/api/health`.
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
