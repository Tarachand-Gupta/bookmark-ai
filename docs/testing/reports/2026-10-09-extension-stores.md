# Extension store receipts — 9 October 2026

## Chrome Web Store

- Public item ID: `ffhbgpgebpmofjkehpjcemepbgcmoelp` ([listing](https://chromewebstore.google.com/detail/bookmark-ai/ffhbgpgebpmofjkehpjcemepbgcmoelp)).
- Submitted version: **0.1.6**, exact `dist/production/chrome.zip` production artifact.
- Status: **SUBMITTED — pending review**. Root observed the submission confirmation modal and developer-portal status. Automatic publication was selected. This is not store approval or proof that 0.1.6 is publicly available.
- Store description accurately states separate Supabase extension authentication and free credits. Identity/host/storage permission justifications were updated; the 478-character reviewer instructions were saved.
- Retained machine-local receipt: `.work/production-oct9/chrome-016-submitted.png`. Private publisher credentials and reviewer account details are excluded from this report.

## Firefox AMO

Public add-on GUID: `bookmark-ai@bookmark-ai.cloud`; intended current listing is [bookmark-ai-cloud](https://addons.mozilla.org/en-US/firefox/addon/bookmark-ai-cloud/). Production 0.1.6 package and matching reproducible source archive are prepared. **NOT SUBMITTED**: Mozilla publisher sign-in remains pending. Do not use the retired `bookmark-ai` / `@purecode.ai` listing. Package/source reproduction and actual Firefox auth/save checks are separate from submission or approval.

## Runtime boundary

Chrome and Firefox production auth/callback/save checks passed as recorded in the [client report](2026-10-09-clients.md); Firefox's full-tab save is distinguished from toolbar authentication. The [Live backend correction](2026-10-09-live-tabs.md) is deployed with 72/72 backend tests passed and health/auth smoke passed. Actual post-deployment Chrome OFF / Firefox continuation **passed**: the real Chrome toolbar OFF removed only Chrome, and the canonical viewer displayed Firefox's subsequent new owned tab. Safari's owner session was preserved; no fresh Safari fixture OFF/ON claim is made. Store submission does not upgrade pending browser, physical-device, provider or PWA cases to PASS. Apple and Google Play submissions are outside these receipts.
