# X / Twitter — launch threads (3 variants)

Pick ONE to post first; the others can run days later with different angles.
Before posting: replace `{STORE}` with the Chrome Web Store URL (after review
approval), `{REPO}` with the public GitHub URL. Attach the showcase cards
(store screenshots) or a short screen recording — posts with a visual do 3-5x.

---

## Thread 1 — the problem angle

**1/**
I never open my bookmarks.

I save things all day and never see them again. So I built the tool I wanted:
save in one click, AI files it, and I search it later by *meaning*.

It's called Bookmark AI, and it's open source. 🧵

**2/**
Save from any browser — Chrome, Firefox, Safari. One click.

The AI reads the page, categorizes it, tags it, embeds it. You never file
anything. "That article about focus" finds the right page even if the word
"focus" never appears in it.

**3/**
My favorite part: Live Sessions.

Flip a switch and the tabs you have open stream to your other devices in real
time. Close the laptop, open your phone, keep reading. Opt-in, private windows
never sent, auto-expires.

**4/**
It's a full product: web app, extension, iOS/Android app, even a native macOS
app. All in one open-source monorepo (MIT). Self-host it with zero external
services, or use the free hosted version.

Try it: https://bookmark-ai.cloud
Code: {REPO}
Extension: {STORE}

---

## Thread 2 — the live-tabs demo angle

**1/**
Your phone knows what tabs your laptop has open. Right now. Live.

I built this into my bookmark manager and I can't go back. 🧵

**2/**
It's called Live Sessions: opt in on any browser, and that window's tabs mirror
to every device you're signed in on — updating in real time as you browse.
Walk away from the desk, pick up mid-research on your phone.

**3/**
Privacy first, because tab data is sensitive: strictly opt-in, per-window
control, private windows never leave the machine, and everything auto-expires
after 7 days. The server is a tiny Fastify+Redis box streaming SSE.

**4/**
It ships inside Bookmark AI — my open-source bookmark manager with one-click
save and search-by-meaning.

Free hosted: https://bookmark-ai.cloud
MIT source: {REPO}
Chrome: {STORE}

---

## Thread 3 — the "how I built it" angle

**1/**
I shipped a bookmark manager that runs on 5 platforms:

→ web app
→ Chrome/Firefox/Safari extension
→ iOS + Android app
→ native macOS app

One person. One monorepo. Mostly AI pair-programming. Open source. 🧵

**2/**
Stack: Next.js 15 (web + API on Vercel), Turso/libSQL with FTS5 + vector
search, Gemini for categorization + embeddings, WXT for the extension, Expo
for mobile, a Zig native desktop app, and a Fastify+Redis SSE server for live
tab sync on a $5 VM.

**3/**
The hardest problem nobody warns you about: Safari extensions can't see your
web login (full cookie partitioning). Solved it with scoped 90-day device
tokens the extension mints once and silently renews. Chrome-parity auth,
finally.

**4/**
Everything is MIT and self-hostable — it even runs with zero external
services (local SQLite, no API keys, heuristic fallbacks).

https://bookmark-ai.cloud · {REPO} · {STORE}

If you read this far: what's YOUR bookmark graveyard size? Mine was 4,000.
