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

## What's in an export

A **lossless, versioned bundle** containing:

- **Bookmarks** — URL, title, description, category, tags, provenance (browser,
  device, OS, saved date), domain, and the raw Open Graph payload.
- **Saved sessions** — name, tabs, and provenance.

The bundle is versioned with a schema version, so a bundle exported today keeps
importing cleanly even after the data format evolves.

:::note
Embeddings are **not** included in the export — they're regenerable. After an
import, the embedding sweep refills them so imported bookmarks become searchable
by meaning without any manual step.
:::

## Importing

Import upserts bookmarks **by URL**, so re-importing over an existing library
merges rather than duplicates. The response tells you how many bookmarks and
sessions were imported.

## Live sessions are never exported

[Live sessions](/guides/live-sessions) are ephemeral and are deliberately left
out of exports — only durable data (bookmarks and saved sessions) is included.

See the [API reference](/reference/api#get-apiexport) for the export and import
endpoints.
