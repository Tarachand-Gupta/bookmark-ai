# LinkedIn — launch posts (3 variants)

Short by design — LinkedIn truncates at ~3 lines ("see more"), so the first
line must earn the click. Replace `{STORE}` / `{REPO}` before posting. Attach
2-3 of the showcase cards as images.

---

## Post 1 — the launch

I built the bookmark manager I always wanted — and open-sourced it.

Bookmark AI: save any page in one click, AI categorizes and tags it, and you
find it later by meaning ("that article about focus"), not by remembering
keywords. Plus my favorite feature — Live Sessions: opt in and the tabs open
on your laptop appear on your phone in real time.

Web, browser extension (Chrome/Firefox/Safari), iOS/Android, and a native
macOS app. Free hosted version, or self-host it — it runs with zero external
services.

Try it: https://bookmark-ai.cloud
Source (MIT): {REPO}
Chrome extension: {STORE}

Feedback very welcome — especially from fellow tab hoarders.

---

## Post 2 — the builder story

One person can ship a 5-platform product now. I just did it.

Over the past weeks I built Bookmark AI — an AI bookmark manager with a web
app, a cross-browser extension, iOS/Android apps, and a native macOS app —
largely by pair-programming with AI agents. The AI wrote a lot of the code;
the architecture, the taste, and the "no, that's wrong, here's why" were the
human parts.

Things I'd tell anyone trying this:
• Ship enablement with the code — a feature isn't done until it runs in prod.
• Test against production early; my auth design had a bug only prod could reveal.
• Monorepos + typed contracts are what make multi-platform survivable solo.

It's open source (MIT): {REPO}
Live: https://bookmark-ai.cloud

---

## Post 3 — the feature hook

Close your laptop. Open your phone. Your tabs are already there.

That's Live Sessions, part of Bookmark AI — the open-source bookmark manager
I just launched. Tabs stream across your devices in real time (strictly
opt-in, private windows never sent, auto-expiring). Alongside it: one-click
saving from any browser and AI search that works by meaning, not keywords.

Free to use at https://bookmark-ai.cloud — or self-host it; the whole thing
is MIT on GitHub: {REPO}

Would love your thoughts — what would make this your daily driver?
