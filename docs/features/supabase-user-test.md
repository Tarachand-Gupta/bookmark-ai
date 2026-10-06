# Test with Hero Hiralal

**Production-connected builds; not every device flow has passed.** The hosted Supabase release is live. The current install guide and per-platform evidence are in [the 6 October handoff](/Users/tara/Developer/bookmark-ai/.work/production-clients-oct6/TRY-IT.md). These yellow builds need no local server; retained Clerk apps remain rollback artifacts.

## Start and install

- Open **https://www.bookmark-ai.cloud**; Live uses **https://live.bookmark-ai.cloud**. No local server needed.
- Follow [the three-extension install guide](/Users/tara/Developer/bookmark-ai/.work/production-clients-oct6/TRY-IT.md): Chrome unpacked folder, Firefox temporary `manifest.json`, and the separately signed Safari QA companion are in the kit. **The kit targets the live hosted URLs. Chrome sign-in, bookmark saving and saved-session creation passed. With explicit approval, Developer mode was enabled only in the separate QA profile; the final bundle reloaded successfully and restored the existing QA login. Firefox is installed and its authenticated callback is corroborated by production; its popup/save UI check remains unverified. Safari status is in the current handoff.**
- Use **empty, separate Chrome/Firefox QA profiles**. Additive native bookmark sync defaults **ON**. Turn **Settings → Sync → Sync native browser bookmarks OFF** before extension sign-in if possible; otherwise sign in only in the empty profile, then disable it before testing. Keep deletion sync OFF. Safari does not manage native Safari bookmarks.
- **Mac:** the fresh signed yellow Release is installed at `/Users/tara/Applications/Bookmark AI Supabase QA.app`; its actual process now launches from this path. Sign In opens the production page in the default browser. The installed app visibly loads the migrated account’s 89 bookmarks and restores that account after a cold restart. The old native login sheet came from an obsolete build still running since 4 October; stale workspace callback registrations were removed.
- **Mobile:** the corrected yellow iPhone Release is installed, and the same source passes simulator production password login, bookmark save/read and cold-start session restoration. The “Unexpected sign-in address” rejection is fixed; Google reaches the provider page. Full social-provider return and physical iPhone launch remain separate checks. Android Release is installed in the `bookmark_pixel` QA emulator; no physical Android device is attached. See the current [mobile report](/Users/tara/Developer/bookmark-ai/.work/production-clients-oct6/MOBILE.md) for runtime results and blockers.
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

Provider protocol checks passed for native MFA and all extensions. Current browser/native UI results are recorded in the 6 October handoff; build success does not establish untested journeys. Safari is development-signed, installed and enabled, with the latest worker source verified in Web Inspector. The user confirmed the manual toolbar Sign in action opens the login flow; automated popup click targeting was unreliable. Authenticated Safari runtime remains unverified. Enable it through normal Safari settings and grant requested website access; stop if blocked—do not enable unsigned extensions or weaken security settings. Firefox’s temporary add-on must be loaded again after quitting Firefox.

Existing libraries are now mapped to retained Turso databases. Database verification and the current account’s production library rendering passed. Reauthenticate extensions and reissue old MCP credentials. Imported accounts do not inherit Clerk passwords. The existing owner was verified to have a Google identity and no Supabase password. Use the existing provider or Forgot password with the same email to set a Supabase password without creating a new account. Open the recovery link in the same browser profile that requested it; restart extension sign-in if its request expires. The hosted recovery page is available, but recovery email through password update still needs end-to-end verification. Automatic deletion of imported legacy accounts is not ready.
