# Quick production check

Use the normal black **Bookmark AI** apps and the packages in `dist/production`; yellow QA apps are separate. No local server is needed. Exact versions and hashes are in the kit manifests. Installation is not store publication.

1. Open **https://www.bookmark-ai.cloud** and sign in with your test account. Use Google for an existing Google-only account, or **Forgot password** to set a Supabase password on that same email address. Old Clerk passwords were not copied. A new account should show immediate progress, then “Setting up your account” while its library is prepared.
2. **Chrome:** open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select `dist/production/chrome` (or `apps/extension/.output/chrome-mv3`). If already loaded, click **Reload**. **Firefox:** `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → `dist/production/firefox/manifest.json`; reload it after restarting Firefox. **Safari:** open the installed **Bookmark AI for Safari** companion, then enable it in Safari Settings → Extensions. Use the browser profile where you signed in.
3. Click **Sign in** in each extension. Confirm it returns to a signed-in popup. Save one harmless page in each browser and confirm each appears in the web library. Name your test items clearly so they can be removed individually later.
4. Open the installed Mac app and iPhone app; install the kit's Android APK on your Android device if testing there. Sign in with the same account, find your test pages, add one bookmark, close/reopen the app, and confirm it remains signed in. Test the phone's Share → Bookmark AI flow as well.
5. On Mac, repeatedly open the app, minimize/reopen it, close its main window/reopen it, and complete a sign-in return. Each action should leave **one main library window**. In web Settings → Appearance, choose a named theme and Light/Dark/System, then refresh to confirm it stays selected.
6. On mobile, Settings opens a short menu. Open **Devices** to see **Apps & Web** and **Browser Extensions**, with the current device first. Open one disposable session's details, rename it, and revoke only that test session; confirm that client requires sign-in again.
7. For an iOS PWA password reset, stay in the PWA after requesting the email and enter its code in the recovery form. If you already opened the email link in Safari and the original code no longer works, choose **Send a new code**, then enter the new email's code directly in the PWA. Set a new password and check that sign-in succeeds.

Remove only your named test bookmarks afterward. Report the client, build/version, action, visible error and screenshot if anything fails.

These are short acceptance checks. The [full matrix](MATRIX.md), [runbook](RUNBOOK.md), and [release reports](reports/2026-10-09-production-release.md) distinguish tested behavior from remaining provider, device and store checks.
