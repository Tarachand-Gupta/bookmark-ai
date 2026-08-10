# Dashboard — the landing page (web + mobile)

Status: REQUIREMENTS — not scheduled. Written 2026-08-10 from Tara's brief plus product
reasoning; numbers/cards below are a starting proposal to react to, not a contract.

## 1. Problem & intent

Today `/app` lands on the library grid — a wall of everything, newest first. That's a
*storage* view, not a *landing* view. When a user arrives (typed URL, extension "Go to App",
mobile app open), they arrive with a job in mind, and the grid serves only one of those jobs
(browse). The dashboard is the first page: it should answer, within one screen,
**"where was I, and what do I do next?"**

Guiding principles (in priority order — these decide every inclusion/exclusion fight):

1. **Every card is a verb.** If a card has no click-through action a user actually takes, it
   doesn't ship. No decoration, no vanity numbers.
2. **Resume beats browse.** Bookmark AI's unique data is *cross-device continuity* (live
   sessions, saved sessions, save timestamps per device/browser). The dashboard should make
   "pick up where I left off — even from another machine" the hero experience. Nothing else
   in the market does this well; recent bookmarks alone is a commodity.
3. **Empty cards are forbidden.** Cards render only when they have data. A fresh account sees
   a focused first-run dashboard (see §6), never five hollow boxes.
4. **Perceived speed is a feature.** One aggregated fetch, skeletons on first paint, cached
   snapshot rendered instantly on revisit (stale-while-revalidate). The 2-3s facet-change
   lesson from the library applies doubly here.
5. **Usability over completeness.** Fewer, denser, better-ranked cards. Anything that needs a
   "view all" already has a home (library, sessions, live) — the dashboard shows the top-N
   and links out.

## 2. What we can actually show (data inventory)

Everything below exists today — no new tracking needed for P0/P1:

| Signal | Source |
| --- | --- |
| Recent bookmarks (title, og image, category, tags, device/browser/os, savedAt) | `GET /api/bookmarks?limit=N` |
| Facets: categories, tags, days histogram, device/browser split, total | `GET /api/meta` |
| Saved sessions (name, tab count, browser/device/os badges, savedAt) | `GET /api/sessions` |
| Live devices right now (label, browser, windows/tab counts, last_seen) | live server `GET /live` (+ SSE stream) |
| Reading queue | bookmarks tagged `reading`/`article` (native-sync applies these) |
| AI availability + chat history | `/api/health.ai`, chat conversations |
| Extension installed? | the new `useExtensionInstalled()` detection |

What we deliberately do **not** have (and should not quietly add): page-visit tracking,
time-on-site, or any telemetry beyond what the user explicitly saved or opted into (live
sessions). Analytics cards must be computed from *saves and sessions*, not surveillance.
If we ever want "most opened bookmark," opening-count tracking becomes an explicit,
documented schema change — out of scope here.

## 3. Web dashboard — proposed composition

Route: `/app` becomes the dashboard; the current grid moves to `/app/library` (sidebar:
"Home" above "Library"). All existing deep links (`?category=`, `?q=`, `?ai=1`…) continue to
resolve to the library, so nothing breaks — the dashboard owns only the bare `/app` landing.

Layout: 12-col responsive grid, two visual tiers. Tier 1 is the working row (always above
the fold at 1280×800); tier 2 is informational.

> **Revised 2026-08 (design review on prod).** Cards are no longer placed individually into
> the 12-col grid. The grid now holds exactly TWO flex columns — main `lg:col-span-7`
> (Continue hero, Recent saves) and rail `lg:col-span-5` (Activity, Reading list, Sessions
> shelf, MCP promo) — plus the full-width omnibox and setup card. Reason: a grid row is as
> tall as its tallest card, so a null or short card left dead space beside/above its
> neighbour's footer. Columns end where their content ends. An empty column hands its span
> back (`lg:col-span-12`) so nothing leaves a hole. Below `lg` everything is ONE column: at
> `md` the content area is ~510px next to the sidebar, too narrow for a 7/5 split.
> Card-by-card deltas are noted inline below.

### Tier 1 — act

**1. Omnibox (full width, slim).** Search-first: the library's hybrid search, plus an
"Ask AI" affordance that opens the empty chat panel (per the new no-auto-fire behavior).
Submitting jumps to `/app/library?q=…`. Keyboard focus on `/` like the library.

**2. "Continue where you left off" (hero card, ~2/3 width).** The differentiator. A ranked
resume target, picking the single best of:
   - a live device that went quiet recently ("MacBook · Chrome — 14 tabs across 3 windows,
     active 20 min ago") → click = live view of that device; secondary action "Open all here"
     (opens that window's tabs in a new local window — the cross-device handoff);
   - else the most recent saved session → "Open all in new window";
   - else the last few bookmarks saved on a *different* device than the current one.
   Show at most the winner + one runner-up row. The ranking is recency-weighted, and the
   card labels itself honestly ("Active now" vs "Earlier today on iPhone").

   *Revised 2026-08:* BOTH ranked targets render as equally rich rows — identity tile with
   presence dot, title + freshness, browser/tab/window counts and last-seen, a preview of the
   first 3 tab titles (+N more) from the live/session snapshot, and that row's own verbs. Only
   the top row gets the solid button. Header carries an "N live" pill; the footer is
   "All live sessions →" (or All sessions / All bookmarks when no row is live).

**3. "Live now" — MERGED into the hero (2026-08), component deleted.** It listed the same
devices the hero was already ranking, so a device appeared twice on the landing page with two
different verbs. The hero's live rows are that list (same SSE stream, so they still update
without a refresh) and its footer goes to the live view for everything the two-target cap
leaves out. The "N live" pill counts devices the live view would show, not ranked rows.

### Tier 2 — recall & awareness

**4. Recent saves (main column).** 6–8 compact bookmark rows (favicon, title, domain, category
chip, relative time + device origin badge). Row click opens the URL; category chip jumps to
the filtered library. Footer link "All bookmarks →".
*Revised 2026-08:* capped at 6 rows and rendered in the row's `dense` variant (tighter
padding, 14px favicon, 13/11px type) — at 8 full-height rows this was the tallest thing on
the page. The endpoint still returns 8; the card just stops drawing them.

**5. Reading queue (rail).** Bookmarks tagged `reading`/`article`, newest first, count
in the header ("Reading list · 12"). This is native-sync's payoff surface. One-click open;
footer jumps to `/app/library?tag=reading`.

**6. Sessions shelf (rail).** 3–4 most recent saved sessions as rows (name, tab count,
browser/device/os badges — the badges shipped in 355e01a). Primary action per row: "Open all".
Footer "All sessions →".

**7. Activity (rail, FIRST in it since 2026-08 — it was two rows lower, below a card nobody
scrolled to; deliberately small).** Exactly three facts, computed from saves:
   - a 14-day sparkline of saves/day (from `meta.days`);
   - top 3 categories this month (clickable → filtered library);
   - a device/browser split donut or simple "Chrome 62% · Safari 30% · Mobile 8%".
   No streaks, no gamification, no "you saved 23% more than last week" — awareness, not
   nagging. If total < ~20 bookmarks the card hides (small-N charts look broken).

**8. Setup / quick actions (contextual, low priority).** Renders only while relevant:
install extension (detection-gated — reuses the CTA card logic), import browser bookmarks,
enable live sessions, "Connect an AI client (MCP)" once, dismissible. Once everything's set
up this card never appears again.

**9. MCP promo (rail, added 2026-08).** "Connect any AI agent" — one line of copy and a
"Set up MCP" button that opens Settings → MCP (the same panel `?settings=mcp` and the new
sidebar MCP row land on; there is one implementation of that UI). Shown ONLY while the
account has no live MCP token and hasn't dismissed it (`bmk:dashboard-mcp-dismissed`), and
never on a first-run account. Visibility comes from a lazy client-side `GET /api/mcp/tokens`
(`useMcpPromo`), deliberately NOT from `/api/dashboard` — the aggregator is on every visit's
critical path and a promo has no business slowing it down. Any failure = don't show it.

Explicitly rejected for v1: AI weekly digest (LLM cost per landing; revisit as P2 opt-in),
tag cloud (low action density), calendar heatmap (vanity at our data volumes), pinned/
favorite bookmarks (no favorite primitive exists yet — worthy, but a separate feature),
"most used websites" (requires visit tracking — see §2 privacy stance).

## 4. Mobile dashboard (new Home tab)

Constraint: one column, ~390pt wide, thumb-first. The tab bar gains **Home** as the first
tab (Library, Sessions, Search, Settings follow). Order = priority; everything is one
swipe-scroll, no horizontal carousels except where noted:

1. **Search field** (existing SearchScreen input style) — tapping focuses inline search;
   this may simply *be* the Search tab experience embedded, not a navigation hop.
2. **Continue card** — the single best resume target (same ranking as web, but only the
   winner; no runner-up). Full-width, one tap to act.
3. **Live now strip** — horizontal chips, one per live device (icon + tab count + pulse).
   Tap → Sessions tab, Ongoing segment, that device expanded.
4. **Recent saves** — 5 rows, then "See all" → Library tab.
5. **Reading queue** — 3 rows + count, "See all" → Library filtered by tag. On mobile this
   ranks high in *utility* but sits below recents because recents double as save-confirmation
   ("did my save from the share sheet land?" — the #1 mobile reassurance loop).
6. **Activity** — a single compact stat row (saves this week · top category · sparkline),
   not a card grid. Tappable → nothing in v1 (it's the one allowed non-verb, kept tiny).

Nothing else. Settings/quick-actions don't belong on a phone dashboard; the setup card is
web-only.

## 5. API & implementation notes

- **One aggregator endpoint**: `GET /api/dashboard` → `{ continueTarget, liveSummary,
  recentBookmarks, readingQueue, recentSessions, activity, flags }` assembled server-side in
  `packages/engine` (parallel queries against existing db modules; live summary proxied from
  the live server with a short timeout + graceful absence). One round-trip, one skeleton
  pass. Clerk-session only (device tokens must NOT gain read scope — keep the existing
  security posture).
- **Client caching**: render last snapshot from localStorage/AsyncStorage instantly, refresh
  in background (SWR). Live-now card upgrades itself via the existing SSE stream after paint.
- **Skeletons**: every card has a fixed-height skeleton so the layout never jumps.
- **No schema change for P0/P1.** Activity computes from existing columns; reading queue is
  a tag filter. (If "continue" ranking later wants per-window last-activity, that data
  already rides the live snapshots.)
- **Relation to the shelved New Tab Canvas** (docs/features/newtab-canvas.md): the dashboard
  is the fixed, first-party, fast answer to the same jobs. If Canvas ever ships, its preset
  templates should be able to embed these same dashboard cards as components — design the
  card data contracts (props in, actions out) so cards are reusable, not page-welded.

## 6. First-run (empty account)

A fresh account sees: omnibox + a single onboarding card sequence (install extension →
save first bookmark → optionally enable live sessions), plus the existing FirstRunPanel
content folded in. As real data arrives, cards appear in place of the sequence. Never show
an empty "Continue" or zeroed analytics.

## 7. Success criteria & phasing

Measure (client-side, privacy-safe counters are fine): % of landings that interact with a
dashboard card within 10s; "Open all"/continue usage; search-from-dashboard usage; time-to-
first-interaction vs today's library landing.

- **P0**: `/app` route swap + omnibox + Continue + Live now + Recent saves (web); Home tab
  with Search + Continue + Recents (mobile). Aggregator endpoint + skeletons + snapshot cache.
- **P1**: Reading queue, Sessions shelf, Activity, setup card, first-run sequence.
- **P2**: AI weekly digest (opt-in), pinned/favorites (new primitive), card-level
  personalization (reorder/hide, persisted in user_settings).
