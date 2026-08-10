---
slug: /getting-started/first-session
title: Save a session
description: Snapshot a whole window of tabs as one session you can restore later.
sidebar_custom_props:
  icon: 🗂
---

# Save a session

A **saved session** is a snapshot of every tab in a window, kept as one item you
can restore later. It's the answer to "I have 20 tabs open and need to close
them, but I'll want them back."

1. With the window you want to keep open, open the extension popup.
2. Choose one of the two session buttons — both show the tab count, so you can
   see what you're about to capture:
   - **Save session & keep open (N tabs)** — snapshot and carry on.
   - **Save session & close (N tabs)** — snapshot, then clear the window.
3. Every open tab is captured as one session.

:::note Your tabs are never at risk
On the **& close** path, tabs close only *after* the server confirms the save.
A failed save can't cost you your tabs. If the save is slow you'll see
`Saving N tabs… your tabs stay open until the save is confirmed.` — that's the
same promise, spelled out.
:::

Saving is quick. A warm session save was measured at roughly 50 ms on the
developer's machine, down from about 420 ms, because the popup now reuses its
stored credential and resolves the window before you click. Your numbers will
differ — the point is it no longer feels like a pause.

Now you can close the tabs. In the app's **Sessions** view you can:

- **Restore as a window** — reopen all the tabs together, or
- **Open tabs one at a time** — pick tabs individually.

Sessions arrive with a name generated from what was in the window, and you can
**rename** any of them — type your own, or ask the AI to name it from the tabs.
A name you typed is never overwritten. The list is newest-first by default, and
you can re-sort it by oldest, tab count, or name.

Saved sessions are durable — they stay until you delete them, and they're
included when you [export your data](/guides/export-import).

:::note
Saved sessions are different from **live sessions**. A saved session is a
snapshot you took on purpose; live sessions are an opt-in, real-time mirror of
your currently-open tabs that expires on its own. See
[Live sessions](/guides/live-sessions).
:::

## Next

Mirror your open tabs across devices →
[Share your first live session](/getting-started/first-live-session).
