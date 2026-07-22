---
slug: /guides/ai-providers
title: AI providers
---

# AI providers

Bookmark AI is **bring-your-own-AI**. You connect a provider and your key, and
that powers **Ask AI** chat and AI answers over your library. Configure it in
**Settings → AI**.

## Supported providers

| Provider | Notes |
| --- | --- |
| **Google** (Gemini) | The default. |
| **OpenAI** | Standard OpenAI API. |
| **Anthropic** | Claude models. |
| **Custom** | Any **OpenAI-compatible** endpoint — you supply a base URL. This is how you use services like [OpenRouter](https://openrouter.ai). |

## Recommended: OpenRouter

OpenRouter is an OpenAI-compatible endpoint with **free models**, which makes it
the quickest way to get started at no cost. In **Settings → AI**:

1. Create an OpenRouter API key.
2. Use the **OpenRouter** preset — it sets the provider to *custom* with the base
   URL `https://openrouter.ai/api/v1`.
3. Paste your key, pick a model, and save.

For a custom provider you must supply a valid `http(s)` **base URL**. After
saving a key you can list the provider's models and choose one.

## Your key is stored safely

When you read your settings back, the API **never returns your key** — only
whether one is set and its last four characters, enough to show a
`Saved (••••1234)` hint. To change the key, enter a new one; to clear it, save an
empty value.

## About embeddings

Search by meaning needs **embeddings**, and those are a separate thing from the
chat model:

:::note
Embeddings for search are **provided by the service for now — no key needed**.
Your AI provider key is used for chat and answers, not for search-by-meaning
embeddings.
:::
