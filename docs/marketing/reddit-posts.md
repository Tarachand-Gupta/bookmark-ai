# Reddit — launch posts (3 drafts)

Reddit punishes salesy self-promo — each draft is written for its community's
norms: lead with the story/tech, disclose it's your project, engage in
comments. Post from your own account, space them out over days, and check
each subreddit's self-promo rules (some require a comment ratio or specific
flair like "Show /r/…"). Replace `{STORE}` / `{REPO}` first.

Suggested targets per draft (pick one per post, don't cross-post the same
text): r/selfhosted, r/opensource, r/SideProject, r/productivity,
r/ClaudeAI, r/vibecoding, r/chrome_extensions, r/DataHoarder.

---

## Draft 1 — for r/selfhosted or r/opensource

**Title:** I built an open-source (MIT) bookmark manager with AI search and
live tab sync across devices — self-hosts with zero external services

**Body:**

After years of bookmark graveyards, I built the thing I actually wanted and
open-sourced it: Bookmark AI.

What it does:
- One-click save from a Chrome/Firefox/Safari extension (or the web app)
- AI categorizes + tags every save, and search works by *meaning* (hybrid
  full-text + vector), so "that article about focus" finds the page
- Save a whole window as a session, restore it later as a tab group
- Live Sessions (opt-in): tabs you have open stream to your other devices in
  real time over SSE, auto-expire after 7 days, private windows never sent

Self-hosting was a first-class goal, not an afterthought:
- Runs with **zero external services** — no auth provider, no AI key, no
  cloud DB. Local SQLite file, heuristic categorization fallback, open API
  mode. `pnpm install`, copy `.env.example`, `pnpm dev`, done.
- Add keys only for what you want: Gemini for real AI, Clerk for auth, Turso
  for a cloud DB. The live-tabs server is one small Fastify+Redis container.
- Web + extension + iOS/Android (Expo) + a native macOS app, one monorepo.

Repo: {REPO}
Hosted version (free, if you don't want to self-host): https://bookmark-ai.cloud

It's my project — feedback, issues, and PRs genuinely welcome. Happy to
answer anything about the architecture (the Safari extension auth story alone
is a saga).

---

## Draft 2 — for r/productivity or r/SideProject

**Title:** I stopped losing my bookmarks by building a tool that files them
for me and finds them by meaning

**Body:**

My bookmark bar was a graveyard — thousands saved, basically none ever opened
again. The problem was never *saving*, it was *filing and finding*.

So I built Bookmark AI around three rules:

1. **Saving must cost one click.** Extension button or Alt+Shift+S. No
   folder-picking, no tags to type.
2. **Filing is the computer's job.** AI reads the page, categorizes and tags
   it. My library organizes itself.
3. **Finding must work like memory works.** You remember what a page was
   *about*, not its title. Search is by meaning — "that article about focus"
   works even if the title never says "focus".

The feature that surprised me by becoming my most-used: Live Sessions — the
tabs open on my laptop show up on my phone in real time (opt-in), so I stop
"emailing myself links to read later."

It's free to use (https://bookmark-ai.cloud) and fully open source (MIT) if
you'd rather run your own: {REPO}

Built solo — I'd love honest feedback on what would make it stick for you.

---

## Draft 3 — for r/ClaudeAI or r/vibecoding

**Title:** I shipped a 5-platform product (web, 3-browser extension,
iOS/Android, native macOS) mostly by directing AI agents — here's what
actually worked

**Body:**

Just launched Bookmark AI — an AI bookmark manager with one-click save,
search-by-meaning, and real-time tab sync across devices. Web app, a
Chrome/Firefox/Safari extension, iOS/Android apps, and a native macOS app.
One person, one monorepo, MIT-licensed, and a large share of the code written
by AI agents I directed.

What actually worked (beyond "write me a function"):

- **Typed contracts as the spine.** Zod schemas in one shared package are THE
  api contract. Agents can't drift when the types fail the build.
- **Parallel agents with disjoint file sets.** I ran 4+ agents at once
  (server auth, extension, Swift app, web UI) — the trick is specs precise
  enough that none of them touch the same files.
- **A "no half features" rule.** A feature isn't done until it runs in
  production — env vars set, deploys wired, migrations shipped. Agents love
  declaring victory locally; the rule catches it.
- **Prod smoke tests catch what local can't.** My extension auth token format
  crashed a middleware ONLY in production. The agent's unit tests were green.
- **The human parts:** architecture, security review (we scoped the auth
  tokens down after a "wait, what if this leaks" moment), and taste.

The repo is public if you want to read a fully agent-built codebase: {REPO}
The product itself: https://bookmark-ai.cloud

Happy to go deep on the workflow in comments.
