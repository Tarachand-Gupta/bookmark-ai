---
slug: /guides/live-sessions
title: Live sessions
---

# Live sessions

Live sessions show the tabs you have open **right now** on your other devices,
updating in real time. Leave a page open on your laptop and jump to it from your
phone — without saving anything.

Live sessions are **off by default** and entirely opt-in.

## Turning it on

1. In the extension popup, use **Share window as live session**.
2. That browser starts publishing its open tabs to a dedicated live server.
3. In the app's live view, your devices appear with their open windows, each
   marked with a green **LIVE** pip while it's actively publishing.

The opt-in is account-wide: turning it on enables live publishing; turning it
off purges every device's live tabs immediately.

## Device names

Each publishing browser shows up as a device you can **rename** (so "laptop" and
"work desktop" are easy to tell apart) or **forget**. Forgetting a device
removes its live tabs; it'll reappear if that browser is still sharing.

## Privacy guarantees

Live sessions are built to be private by default:

- **Opt-in only.** Nothing is shared until you turn it on, per account.
- **Private/incognito windows are never sent.**
- **URLs that look credential-bearing are reduced to their origin** before
  leaving your browser, so a link with a token in it isn't broadcast in full.
- **Ephemeral.** Live tab data expires automatically after **7 days** of a
  device going quiet (the timer resets each time the device checks in). There is
  no long-term store of your open tabs.
- **Nothing is saved until you save it.** Live tabs are a mirror, not a
  bookmark. To keep a tab, save it as a bookmark or snapshot the window as a
  [saved session](/guides/saved-sessions).

See [Privacy](/privacy) for the full picture, and
[self-hosting the live server](/self-hosting/live-server) if you want to run it
yourself.

:::warning
Live sessions and saved sessions are different things. Live sessions are
temporary and expire; saved sessions are permanent snapshots you take on
purpose.
:::
