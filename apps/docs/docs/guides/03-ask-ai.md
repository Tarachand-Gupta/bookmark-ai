---
slug: /guides/ask-ai
title: Ask AI
---

# Ask AI

**Ask AI** is a chat that answers questions using your own library as its
source. Open it from **Ask AI** in the header — if you have a search query
typed, the chat opens seeded with it.

## How it answers

The chat is an AI agent with tools that search your saved data directly:

- **full-text search** over your bookmarks,
- **semantic search** by meaning,
- **list sessions** to reason over your saved sessions.

It calls those tools, reads the results, and writes an answer. Cited bookmarks
render as cards with actions — open the page, copy the link, or jump to the
page's category or a tag to see the filtered library. So an answer is always
traceable back to the pages it came from.

## What you need

Ask AI runs on the AI provider you connect in **Settings → AI** (Google Gemini,
OpenAI, Anthropic, or an OpenAI-compatible endpoint like OpenRouter). If you
haven't set one up, connect one first — see [AI providers](/guides/ai-providers).

:::note
Ask AI only reads your library. It doesn't browse the web — if something isn't
in your saved pages, it can't cite it.
:::
