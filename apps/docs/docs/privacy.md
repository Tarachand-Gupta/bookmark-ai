---
slug: /privacy
sidebar_position: 6
title: Privacy
description: Plain-language notes on what Bookmark AI stores and how it protects you.
sidebar_custom_props:
  icon: 🔒
---

# Privacy

Plain-language notes on what Bookmark AI stores and how the more sensitive parts
work. This describes the product's behavior, not a legal policy.

## What's stored

When you save a bookmark, the app stores the page URL, the scraped Open Graph
metadata (title, description, image, site name, favicon), the category and tags
it assigned, an embedding vector for search, and provenance — which browser and
device it came from, and when. Saved sessions store the tabs you snapshotted.
That's your library, and it stays until you delete it or delete your account.

You can take it all with you at any time — see
[Export & import](/guides/export-import).

## Live tabs are opt-in and ephemeral

[Live sessions](/guides/live-sessions) are the one feature that broadcasts your
currently-open tabs, so they're the most privacy-sensitive — and built
accordingly:

- **Off by default.** Nothing about your open tabs leaves your browser until you
  explicitly turn live sharing on, per account.
- **Private/incognito windows are never sent.**
- **Credential-looking URLs are reduced to their origin** before they leave your
  browser, so a link carrying a token isn't broadcast in full.
- **They expire automatically.** Live tab data is held with a **7-day** time-to
  -live that resets each time a device checks in; once a device goes quiet, its
  live tabs age out on their own. If the live server's state is ever lost, the
  fail-safe is "off" — nothing is shared.
- **Nothing is saved until you save it.** Live tabs are a mirror. To keep one,
  save it as a bookmark or snapshot the window as a saved session.

You can rename or **forget** any device from the live view; forgetting a device
drops its live tabs immediately.

## Sign-out

Signing out ends your session. Because the browser extension **shares the web
app's session**, signing out from the extension signs you out of the website
too — they're the same session, not two.

## Your AI keys

Bookmark AI is bring-your-own-AI. The API key you configure for a provider is
stored server-side to make requests on your behalf, and it is **never returned to
the client** — reading your settings back shows only that a key is set and its
last four characters (e.g. `••••1234`). Update it by entering a new key; clear it
by saving an empty value. See [AI providers](/guides/ai-providers).

## Self-hosting

Bookmark AI is open source. If you'd rather keep everything on your own
infrastructure, you can [run it yourself](/self-hosting/overview) — with a local
sqlite file, no external AI, and the live server entirely optional.
