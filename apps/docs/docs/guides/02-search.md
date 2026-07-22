---
slug: /guides/search
title: Search
---

# Search

Search has three modes. All of them run server-side against your library.

| Mode | What it does |
| --- | --- |
| **text** | Keyword full-text search over titles, descriptions, tags, and metadata. Fast and exact. |
| **ai** | Search by meaning. Your query is embedded and compared to your bookmarks' embeddings by similarity. |
| **hybrid** | Blends the two lists with Reciprocal Rank Fusion (RRF), so exact keyword hits and meaning-based matches both surface. |

The web grid and the mobile app both use **hybrid** by default — it's the best
of both.

## Search by meaning, honestly

"Search by meaning" means the query and your saved pages are turned into
numeric vectors (embeddings), and results are ranked by how close those vectors
are. In practice this surfaces the right page even when you don't remember its
exact title — searching *"that article about slow database queries"* can find a
post titled *"Diagnosing N+1 problems in production"*.

It is not magic and it is not a web search: it only searches **your** library,
and quality depends on the page metadata that was captured. When it works it
feels like the app read your mind; when a page has thin metadata it leans on the
keyword side of the blend.

In hybrid results, matches that the keyword side found are marked as exact, so
clients can present them as direct "matches" versus meaning-based "related"
results.

## Graceful fallback

If AI search can't run — for example when embeddings aren't available — search
silently falls back to full-text and marks the response with `fallback: true`.
You still get results; they're just keyword-based.

See the [API reference](/reference/api#get-apisearch) for the exact request and
response shape.
