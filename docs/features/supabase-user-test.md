# Test with Hero Hiralal

**Manual checklist; not every client has passed.** The Supabase hosted release is live; runtime API checks passed. Complete these checks after each client is installed; retained Clerk apps are rollback artifacts.

## Start and install

- Open **https://www.bookmark-ai.cloud**; Live uses **https://live.bookmark-ai.cloud**. No local server needed.
- Follow [the three-extension install guide](/Users/tara/Developer/bookmark-ai/.work/qa-handoff-2026-10-04/extension-kit/INSTALL-EXTENSIONS.md): Chrome unpacked folder, Firefox temporary `manifest.json`, and the separately signed Safari QA companion are in the kit. **The kit targets the live hosted URLs; actual browser testing awaits Mac unlock.**
- Use **empty, separate Chrome/Firefox QA profiles**. Additive native bookmark sync defaults **ON**. Turn **Settings → Sync → Sync native browser bookmarks OFF** before extension sign-in if possible; otherwise sign in only in the empty profile, then disable it before testing. Keep deletion sync OFF. Safari does not manage native Safari bookmarks.
- Hosted Android is installed in the QA emulator ([evidence](/Users/tara/Developer/bookmark-ai/.work/android-hosted-qa/RESULT.md)); physical Android is unverified. The hosted yellow iPhone QA update is installed (`ai.bookmarkai.supabaseqa`, 1.0.1 build92; [installation evidence](/Users/tara/Developer/bookmark-ai/.work/iphone-qa-install/hosted-install-result.json)). The iOS27 startup crash is fixed by the installed Expo scene support build; physical launch visibly reaches Sign In. The current Sign In action fails before opening its browser, and mobile auth UX restoration is in progress; completed browser login/return remains unverified. Hosted Mac is installed at `/Users/tara/Applications/Bookmark AI Supabase QA.app`; restarting the old QA process waits for unlock.
- Create a **new account yourself** with Google or Apple, name it **Hero Hiralal**, and use it across clients. Resend SMTP is configured; the delivery test reached the Hero inbox. Start email signup/recovery in this browser to test the full journey.

## Check the journey

- [ ] Sign in with Google or Apple. Also test email/password. Check the account identity, then close/reopen each client and confirm it stays signed in.
- [ ] Save a page from Chrome, Firefox and Safari; add a URL on web; try native share capture where installed. Confirm the same saves appear across clients, without duplicates.
- [ ] Search, filter, open and edit a bookmark. Try AI chat about a saved page.
- [ ] Save a browser window as a session. Opt into Live Tabs, check another client, then turn sharing OFF.
- [ ] Check device/browser labels; rename one. Revoke **one device** and confirm it loses access while another stays signed in.
- [ ] Sign out locally, sign back in, and confirm the library returns.
- [ ] Choose two named Tweakcn presets; check light/dark mode and reload persistence. This is web-only.
- [ ] Optionally test password recovery and authenticator MFA. Last, delete **only this disposable account** if you want to test deletion.

Provider protocol checks passed for native MFA and all extensions; browser/native UI checks await Mac unlock. Safari is development-signed; authenticated Safari runtime remains pending. Enable it through normal Safari settings and grant requested website access; stop if blocked—do not enable unsigned extensions or weaken security settings. Firefox’s temporary add-on must be loaded again after quitting Firefox.
