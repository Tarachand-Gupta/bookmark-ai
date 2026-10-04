---
name: test-macos
description: "How to build, run, UI-test, and QA the SwiftUI macOS app (apps/macos) on this Mac: xcodegen + xcodebuild, tests, osascript/screencapture UI verification, window-reopen/cold-start patterns, and safety rules for driving the Mac while the user is present. Use when testing or verifying any macOS feature or fixing a Mac app bug."
---

# Testing the macOS app (apps/macos — SwiftUI)

Sources: `apps/macos/README.md` (build/auth architecture), `docs/TESTING.md` §3/§5, past QA
handoffs (2026-09-03→13 sessions). This is the operational recipe.

## 0. Ground rules

- **The owner is at this machine.** NEVER `pkill`/`killall` any app. Quit gracefully:
  `osascript -e 'tell application id "ai.bookmarkai.macos" to quit'` (poll `ps -p <pid>`
  until gone). Prefer launching fresh builds over quitting what's running.
- **`/Applications/Bookmark AI.app` (space, bundle id `ai.bookmark.safari`) is a DIFFERENT app**
  — the Safari extension's menu-bar companion. Never quit, touch, or screenshot it.
- Never sign out / delete / change persistent settings while QA'ing on Tara's signed-in session;
  viewing, scrolling, searching are fine. Never enter credentials.
- Before ANY System Events keystroke/click: verify BookmarkAI is frontmost
  (`osascript -e 'tell application "System Events" to get name of first process whose frontmost is true'`),
  re-verify right before typing, keep sequences short. If focus is lost, stop that step and note it.
- Screenshots → a scratch/qa dir, named `nn-<what>.png`; every PASS rests on something observed.
- State what you could NOT verify without GUI so Tara can check it herself.

## 1. Build / test / run (exact commands)

```bash
cd apps/macos
xcodegen generate     # BookmarkAI.xcodeproj is generated + gitignored; project.yml is truth
# Build:
xcodebuild -project BookmarkAI.xcodeproj -scheme BookmarkAI -configuration Debug -derivedDataPath build build
# Test (full suite; currently 163 tests):
xcodebuild -project BookmarkAI.xcodeproj -scheme BookmarkAI -configuration Debug -derivedDataPath build test
# Run:
open build/Build/Products/Debug/BookmarkAI.app
```

- If automatic signing blocks a build (no provisioning profile), fall back to ad-hoc:
  `… CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=- PROVISIONING_PROFILE_SPECIFIER= DEVELOPMENT_TEAM= build`.
- Render-preview harness (component-level screenshots, light+dark):
  `TEST_RUNNER_RENDER_PREVIEWS=1 xcodebuild … test` prints `PREVIEW-> <png>` lines; a plain env
  var is NOT forwarded to the test host. Run only previews with
  `-only-testing:BookmarkAITests/RenderPreviewTests`.
- `build-history/` holds prior build snapshots for comparing regressions.

## 2. UI verification without computer-use (the proven recipe)

Accessibility (`osascript` + System Events) IS granted on this Mac. Proven moves:

- Window frame → region screenshot:
  ```bash
  osascript -e 'tell application "System Events" to tell process "BookmarkAI" to get {position, size} of window 1'
  screencapture -x -R x,y,w,h shot.png     # or: screencapture -x -l <windowid>
  ```
  Then READ the PNG and look at it — zoom/crop if text is small.
- Capture came back black (locked screen) ⇒ check the PNG's mean luminance, wake with
  `caffeinate -u -t 2`, recapture.
- Menus: `… to click menu item "…" of menu 1 of menu bar item 1 of menu bar 2` (menu bar 2 for
  the app's own; the Safari companion is also menu-bar — don't touch it).
- Settings window: `Cmd+,` via System Events keystroke `","` with command down while frontmost;
  switch tabs via accessibility: `click button "Account" of toolbar 1 of window "Settings"`.
- Keyboard checks: Esc closes sheets; ⌘↩ sends in chat.
- Paste an image onto the clipboard for attachment tests:
  `osascript -e 'set the clipboard to (read (POSIX file "/path.png") as «class PNGf»)'`.
- App logs: `log show --last 3m --predicate 'process == "BookmarkAI"' --style compact | tail -80`
  (or `log stream --level debug --predicate 'subsystem == "ai.bookmarkai"'`).
- If System Events clicks stall, fall back to clicking at {x,y} only after a screenshot confirms
  the layout, or report the step blocked.

## 3. Auth / server targets in QA

- App has a Local/Cloud server target (Settings ⌘, → General). Local target talks to the dev
  server on :3000 (`DEV_OPEN_API=1`, no sign-in concept). Cloud target uses Clerk via an embedded
  sign-in webview.
- If a session doesn't restore: screenshot the gate, collect the log lines above, report
  "session did not restore" — do NOT try to sign in.
- Never sign Tara out, never touch Delete Account, never send an Ask AI message on her account.

## 4. Recent bug patterns + how they were verified (Sep 2026)

- **Dock-click reopen**: close window → app runs (dot under icon) → clicking the dock icon must
  reopen the window (`applicationShouldHandleReopen(_:hasVisibleWindows:)` path). Verify by
  actually closing the window and clicking the dock icon; two fix rounds were needed before it
  stuck — re-test the REAL app build, not just unit tests.
- **Cold start / persistence**: launch must render last session's data from a disk cache
  immediately, show a small syncing pill while a background refresh reconciles in place (no
  navigation, no full-window spinners). Verify: quit, wait, relaunch, screenshot at ~1 s —
  library must already be visible.
- **Update banner**: sidebar banner appears only when `/api/app/releases` (local or prod)
  reports a version > the running build; silent when the endpoint 404s or has no record.
- **Identity row / footer**: sidebar footer shows the signed-in email (middle-truncated when
  narrow) + host; Settings ▸ Account shows name/email with initials avatar, never stuck on
  "Loading your account…". QA recipe: quit the stale instance gracefully, `open` the fresh Debug
  build, wait ~6 s, capture window, read footer + open Settings ▸ Account, screenshot, close
  with ⌘W, leave the app running.

## 5. Unit tests (Tests/)

163 tests cover URL construction, error mapping, response decoding, chat stream assembly,
attachment classification/downscaling, skills/MCP contracts, SKILL.md import parser, history
grouping, auth state machine + sign-out flush, footer copy, release version arithmetic +
update-banner rules. `RenderPreviewTests` skip unless `TEST_RUNNER_RENDER_PREVIEWS=1`.
Always run the FULL suite green before reporting a fix done; add tests for pure decision
helpers (e.g. reopen→true paths) matching the existing Tests/ style.

## 6. MCP verification (Settings ▸ MCP)

Endpoint + copyable `claude mcp add --transport http bookmark-ai <endpoint> --header
"Authorization: Bearer <token>"` + JSON config; generate a token (one-time reveal), list rows,
revoke with confirm. Install verification in local Claude Code:
`claude mcp add …` then a real tool call round-trip.

## 7. Honesty checklist for the report

Files changed; test counts verbatim; screenshot paths; the restart/reopen sequence actually
observed; anything unverified without GUI; anything requiring Tara (credentials, device,
App Store). Never claim GUI behaviour you did not observe with a screenshot or log line.
