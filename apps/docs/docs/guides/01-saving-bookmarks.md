---
slug: /guides/saving-bookmarks
title: Saving bookmarks
---

# Saving bookmarks

Saving is one click in the extension. What you get back is a rich, organized
entry — not just a URL in a folder.

## What happens when you save

1. The extension sends the page URL (and the title it sees) to the API.
2. The API scrapes the page's **Open Graph** metadata — title, description,
   image, site name, favicon.
3. It **categorizes** the page into a fixed set of categories, so the sidebar
   stays tidy.
4. It **tags** the page, reusing your existing tags where they fit before
   inventing new ones. A tag that just repeats the category is dropped.
5. It builds a **semantic embedding** for search-by-meaning.

Steps 3–5 run right after the save response is sent, so saving feels instant and
the page becomes fully searchable moments later.

## Provenance

Each save records where it came from — the **browser** (Chrome, Firefox, Safari,
Edge, Arc, or "other"), the **device type** (desktop, laptop, mobile, tablet),
an optional device name and OS, and when you saved it. The library sidebar lets
you filter by browser, device, category, tag, and day.

## Re-saving is safe

Bookmarks are keyed by URL. Save the same page again and it **updates** the
existing entry (refreshing metadata and re-running categorization and
embedding) rather than creating a duplicate.

## If something fails

Saving is designed to degrade gracefully:

- If Open Graph scraping fails, the bookmark still saves with the title the
  browser provided.
- If no AI provider is configured, categorization falls back to simple
  domain/keyword heuristics and the page is still saved and findable by text.

:::note
Categories come from a fixed vocabulary so your library doesn't sprawl. Tags are
open-ended but converge on the vocabulary you're already using.
:::
