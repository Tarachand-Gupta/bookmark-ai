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
device it came from, and when. Saved sessions store the tabs you snapshotted, and
your **Ask AI conversations** are kept so you can come back to a thread (you can
delete any of them from the chat's conversation history). That's your library, and
it stays until you delete it or delete your account.

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
drops its live tabs immediately. **Settings → Live sessions** holds the master
**"Show my open tabs"** switch — turning it off purges every device — plus
**Forget all**.

## Mirroring your browser's bookmarks and reading list

On **Chrome and Firefox** the extension mirrors the bookmarks you make natively —
the star button, Ctrl/Cmd+D, the bookmarks menu — into your library, and on Chrome
it also mirrors anything you add to the **Reading List**. This is **on by default**
in the extension, so it's worth being explicit about what it means: a page you
bookmark in your browser is sent to the service, scraped, categorized and stored,
exactly as if you'd clicked **Save bookmark**.

- **One-way only: browser → Bookmark AI.** Nothing is ever written back into your
  native bookmarks.
- **Additive by default.** Removing a native bookmark or Reading List item does
  *not* delete the saved copy unless you turn on **"Full sync — apply removals
  too"**, which is off by default.
- **Safari is not affected** — Apple doesn't expose bookmarks or the Reading List
  to extensions at all.
- **To turn it off:** **Settings → Sync**, switch **"Sync native browser
  bookmarks"** off. The setting is stored on your account, so it applies to every
  browser you're signed in to.

## Sign-out

Signing out ends your session. Because the browser extension **shares the web
app's session**, signing out from the extension signs you out of the website
too — they're the same session, not two.

On Chrome and Firefox the extension also holds its own long-lived credential so it
can keep saving without you re-opening the web app: it's minted from your signed-in
session, lasts 90 days, and renews itself in the background before it expires.
Signing out from the popup clears that credential as well.

## Your AI keys

**You don't need an AI key.** Chat runs on included free credits against a shared
service key, and search-by-meaning embeddings and categorization are provided by
the service too. The trade-off is worth stating plainly: while chat is running on
the shared key, the messages you send are processed by whichever AI provider the
service uses on your behalf.

If you'd rather not rely on that, configuring **your own** provider key sends chat
to your provider instead, on your quota. A key you supply is:

- stored server-side, **encrypted at rest (AES-256-GCM)**, so it can make requests
  on your behalf;
- **never returned to the client** — reading your settings back shows only that a
  key is set and its last four characters (e.g. `••••1234`).

Update it by entering a new key; clear it by saving an empty value. See
[AI credits & providers](/guides/ai-providers).

## MCP tokens

Connecting an AI agent over [MCP](/guides/mcp) means handing that agent a token
that reads your library, so the controls are deliberately narrow:

- **A token only reaches the MCP tools.** It can search your bookmarks, page
  through your library, read your category/tag/device counts, and save a new
  bookmark — nothing else. It can't read your settings, your AI key, your live
  tabs, or your saved Ask AI conversations, and it can't mint or revoke tokens.
- **Only one tool can write** — the one that saves a bookmark. Everything else is
  read-only.
- **You choose which tools are exposed.** The switches in **Settings → MCP →
  Tools** apply to every token; a tool you turn off disappears from the agent's
  list and refuses to run. Turning any switch persists an explicit allowlist, so
  tools added in future releases stay off until you opt in.
- **One token per client, individually revocable.** Revoke a machine's token and
  it stops working on its very next request; the others are untouched. Tokens are
  valid for a year.
- **The raw token is shown exactly once**, when you create it — nothing stores it
  afterwards. The token list keeps only a name, timestamps, and a short hint like
  `bkmcp_eyJhb…Qk3Fa` so you can tell tokens apart.
- **Managing tokens needs your signed-in session**, so a leaked token can never be
  used to create more.

## Deleting your account

**Settings → Account → Delete account** removes everything. It's a two-step
confirmation — "Are you sure? This is permanent and cannot be undone." then
**"Yes, delete my account"** — and it deletes your account along with the whole
database holding your bookmarks, sessions and conversations, then signs you out.
Export first if you want a copy: see
[Export & import](/guides/export-import).

## Self-hosting

Bookmark AI is open source. If you'd rather keep everything on your own
infrastructure, you can [run it yourself](/self-hosting/overview) — with a local
sqlite file, no external AI, and the live server entirely optional.
