---
slug: /guides/mobile-app
title: Mobile app
description: The native iOS and Android app reading the same library.
sidebar_custom_props:
  icon: 📱
---

# Mobile app

There's a native iOS and Android app (built with Expo) that reads the same
library as the web app.

## Signing in

Sign in with the same account you use everywhere. The app's own sign-in screen
offers:

- **Continue with Google** — Google single sign-on.
- **Email and password.** The **Continue** button does double duty: an email it
  recognizes signs you in, and an unknown email creates the account and verifies
  it with a code sent to that address. Creating a new account does require a
  password.
- **"Email me a code instead"** — a one-time code instead of your password, for
  an account that already exists.
- **"Forgot password?"** — resets your password with an emailed code.

There's no phone/SMS sign-in and no passkeys. Once you're in, you land on the
**Home** tab.

## The tabs

The tab bar is **Home**, **Library**, **Sessions**, **Search**, **Settings**.

### Home

The Home tab is the dashboard: a **Continue** card that picks the single most
likely thing to pick up (the freshest live device with tabs, else your newest
saved session, else your newest save from another device), a **Live now** row of
chips for each device currently sharing tabs, **Recent saves**, a **Reading
queue** (what the web calls the reading list), and — once you have 20 or more
bookmarks — a one-line **Activity** summary. Cards with nothing to show don't
appear at all. Pull down to refresh. See [Dashboard](/guides/dashboard) for what
each card means and how it differs from the web version.

### Library, Sessions, Search

- **Library** — browse your bookmarks, in grid, list or compact layout. On a
  phone the desktop tag rail and date popover become two bottom sheets: a
  **Filters** sheet (date range, categories, browsers, devices, recent days) and
  a **Tags** sheet, each entry showing a count. Applied filters appear as
  dismissible chips above the list. There's a **Select** button for picking
  several bookmarks at once. See [Library](/guides/library).
- **Sessions** — your saved session snapshots, plus the tabs your other devices
  have open right now when you've opted in. See
  [Saved sessions](/guides/saved-sessions) and
  [Live sessions](/guides/live-sessions).
- **Search** — hybrid search by default: keywords plus meaning.

## Save from the share sheet

This is the main way pages get into your library from a phone. Share a link from
any app and pick Bookmark AI from the share sheet.

What the row is called differs by platform, and it's worth knowing before you go
hunting for it:

- **Android** — the row reads exactly **"Save to Bookmark AI"**.
- **iOS** — the row reads **"Bookmark AI"**. The share extension's own name *is*
  "Save to Bookmark AI", but iOS labels a share-sheet row with the containing
  app's name, so "Bookmark AI" is what you'll actually see.

It accepts:

- a **link**,
- a **web page** — sharing from Safari also hands over the page title,
- **plain text** — the first URL in the text is used, which is what makes Chrome
  on Android work (it shares the page title and the URL together) and lets you
  share a "check this out https://…" message.

The link is **saved automatically**, with the device, browser and OS recorded
alongside it. You get a haptic tap and a floating **"Saved ✓"** banner showing the
raw link, which upgrades to the real page title a few seconds later once the page
has been scraped. If the save fails nothing is lost — the **Add Bookmark** sheet
opens prefilled so you can retry.

If you share a link while signed out, it's held **in memory only** — never
written to disk, because a shared link can be private — until you finish signing
in, then saved. Home and Library refresh immediately after a share-save, and
sharing the same link twice updates the existing bookmark rather than duplicating
it.
