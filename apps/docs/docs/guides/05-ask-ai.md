---
slug: /guides/ask-ai
title: Ask AI
description: Chat over your own library and get answers with citations.
sidebar_custom_props:
  icon: 🤖
---

# Ask AI

**Ask AI** is a chat that answers questions using your own library as its
source. Open it with the **Ask AI** button next to the search box. The chat
**opens empty** — whatever you had typed in the search box is not carried over,
pre-filled, or sent for you, so nothing runs until you ask something.

## What you need

Nothing. Ask AI works out of the box on the **free AI credits** included with
your account — no provider, no API key, no setup. Connecting your own key is an
optional upgrade, covered below.

## How it answers

The chat is an AI agent with tools it can call while it works:

- **search your bookmarks** — by keyword, by meaning, or a blend of both,
- **query your library read-only** — for counts, groupings and date math ("how
  many things did I save about Postgres in July?"),
- **list your saved sessions**, to reason over the windows you snapshotted,
- **see your live tabs** — the tabs open right now on your devices, but only if
  you've turned [live sessions](/guides/live-sessions) on,
- **search the web**, and **fetch a URL** to read a specific page's text.

It calls those tools, reads the results, and writes an answer. Cited bookmarks
render as cards with actions — open the page, copy the link, or jump to the
page's category or a tag to see the filtered library. So an answer is always
traceable back to the pages it came from.

:::note
What the agent can and can't reach: it can read your library, your saved
sessions, your live tabs (when enabled), and public web pages via web search and
URL fetching. It **cannot** see anything behind a login, on your filesystem, or
in another account — and the bookmark cards it cites always come from your own
library, never from the web. Text it pulls off the web is treated as data to
summarize, never as instructions.
:::

## Free credits

Chat runs on a shared service key and draws on a weekly allowance:

- **1,000 credits per week**, where **1 credit = 1,000 tokens** of the
  conversation (everything you send plus everything the model writes, across each
  tool-call round). It is not a count of messages. That figure is the current
  allowance on the hosted service, not a fixed constant.
- The allowance **resets every Monday at 00:00 UTC**. The app says it verbatim:
  *Free credits reset every Monday at 00:00 UTC — next in N days*.
- Only **Ask AI chat** spends credits, and only while it's running on the shared
  key. **Search-by-meaning embeddings and AI categorization/tagging never spend
  credits.**

You can see where you stand in three places: **Settings → AI**, the greeting on
the chat's first open, and the wall you hit if you run out. The meter reads like
`312 of 1,000` — "credits used this week", "resets Monday".

When the week's allowance is gone, the next message stops before anything
streams and the thread shows a card headed **"This week's free credits are used
up"**, explaining that credits reset Monday and offering **Configure API key**.
Nothing else in the app is affected — saving, search and categorization keep
working.

**Your own key is optional and unmetered.** Add one in **Settings → AI** and
chat runs on your key and your provider's quota instead, with the free meter
sitting unused. See [AI credits & providers](/guides/ai-providers).

## Your conversations are saved

Threads are kept, so you can come back to one. The chat header has a
**Conversation history** button (with a search box for finding an old thread) and
a **New conversation** button; each thread in the list can be deleted, with a
confirm step. Saved conversations are also included in your data export — see
[Export & import](/guides/export-import).
