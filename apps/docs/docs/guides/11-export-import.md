---
slug: /guides/export-import
title: Export & import
description: Take your whole library with you and bring it back, losslessly.
sidebar_custom_props:
  icon: 📦
---

# Export & import

Your data is yours. You can export your entire library to a single file and
import it back — into the same account or a self-hosted instance.

## Where it lives

Both sides are in **Settings → Data**:

- **Export** — "Downloads every bookmark and session as a single JSON file." The
  **Export data** button downloads `bookmark-ai-export-YYYY-MM-DD.json` and
  reports what it wrote, e.g. `Exported 412 bookmarks and 9 sessions.`
- **Import** — "Merges an exported file by URL and keeps original timestamps —
  re-importing the same file is safe and won't create duplicates." Pick a file
  with **Import data**.

## What's in an export

A **lossless, versioned bundle** containing:

- **Bookmarks** — URL, title, description, category, tags, provenance (browser,
  device, OS, saved date), domain, and the raw Open Graph payload.
- **Saved sessions** — name, tabs, and provenance.
- **Ask AI conversations** — your saved chat threads, with their messages.

The bundle carries a schema version (currently `schemaVersion: 4`) plus the time
it was made and a count of each kind of record, so a bundle exported today keeps
importing cleanly even after the data format evolves.

One bundle holds up to **10,000 bookmarks**, **1,000 saved sessions** and
**5,000 conversations** — well past what a normal library reaches, but worth
knowing if you're archiving something enormous.

:::note
Embeddings are **not** included in the export — they're regenerable. After an
import, the embedding sweep refills them so imported bookmarks become searchable
by meaning without any manual step.
:::

## Importing

Import upserts bookmarks **by URL** and keeps their original timestamps, so
re-importing over an existing library merges rather than duplicates — running the
same file twice is safe. The result tells you how many **bookmarks**, **sessions**
and **conversations** were imported.

An import file may be at most **20 MB**; a larger one is rejected rather than
half-applied.

## Live sessions are never exported

[Live sessions](/guides/live-sessions) are ephemeral and are deliberately left
out of exports — only durable data (bookmarks, saved sessions and saved
conversations) is included.

## Not the same thing: Export CSV

The library's selection bar has its own **Export CSV** button, and it is a
different feature:

|  | **Settings → Data → Export data** | **Export CSV** |
| --- | --- | --- |
| Scope | Your whole library | Only the rows you've ticked |
| Format | JSON bundle, re-importable | CSV, for a spreadsheet |
| Built | On the server | In your browser — nothing is uploaded |

Use the JSON export for backups and moving accounts; use CSV when you want a
handful of rows in a spreadsheet. See [Library](/guides/library) for how
selection and CSV work.

See the [API reference](/reference/api#get-apiexport) for the export and import
endpoints.
