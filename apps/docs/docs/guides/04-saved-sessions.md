---
slug: /guides/saved-sessions
title: Saved sessions
---

# Saved sessions

A **saved session** is a deliberate snapshot of every tab in a browser window,
kept as one item. Use it to clear a pile of tabs without losing them.

## Saving a session

From the extension popup, choose **Save session** and optionally name it. Every
open tab in the window is captured, including which window each tab belonged to,
so the layout can be rebuilt on restore. A session snapshots every tab —
including browser-internal pages — but only real `http(s)` links are ever made
clickable.

## Restoring a session

In the app's **Sessions** view, each saved session can be restored as:

- **A window** — reopen all its tabs together, rebuilding the original grouping, or
- **A tab group / individual tabs** — open tabs one at a time instead of the whole set.

## Saved vs live

Saved sessions are durable snapshots you took on purpose. They stay until you
delete them and are included in your [data export](/guides/export-import).

They're distinct from [live sessions](/guides/live-sessions), which are an
opt-in, real-time mirror of your currently-open tabs that expires on its own and
is never exported.
