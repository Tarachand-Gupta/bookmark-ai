# Dashboard — the landing page (web + mobile)

Status: BUILT (web). Written 2026-08-10 from Tara's brief plus product reasoning as a
proposal to react to; P0+P1 shipped, then **redesigned 2026-08-27** ("calm, glanceable" —
see the callout in §3). Sections below describe what is on screen today, with the original
reasoning kept where it still holds and dated notes where reality overruled it. The mobile
Home tab (§4) shipped on the ORIGINAL composition and has not been through the redesign.

## 1. Problem & intent

Today `/app` lands on the library grid — a wall of everything, newest first. That's a
*storage* view, not a *landing* view. When a user arrives (typed URL, extension "Go to App",
mobile app open), they arrive with a job in mind, and the grid serves only one of those jobs
(browse). The dashboard is the first page: it should answer, within one screen,
**"where was I, and what do I do next?"**

Guiding principles (in priority order — these decide every inclusion/exclusion fight):

1. **Every card is a verb.** If a card has no click-through action a user actually takes, it
   doesn't ship. No decoration, no vanity numbers.
   *Revised 2026-08-27:* and at most TWO actions — the header's "View all →" plus, at most,
   one inline action. A card that offers a user five verbs has stopped recommending anything.
2. **Resume beats browse.** Bookmark AI's unique data is *cross-device continuity* (live
   sessions, saved sessions, save timestamps per device/browser). The dashboard should make
   "pick up where I left off — even from another machine" the hero experience. Nothing else
   in the market does this well; recent bookmarks alone is a commodity.
   *Revised 2026-08-27:* resume is a NOUN now (the Live now card) rather than a ranked hero
   that blends three kinds of thing — see §3.4. *Revised again the same day (Tara):* it no
   longer *leads*. Live sessions are opt-in, so for most accounts that card is a promise the
   page can't keep on first visit; Recent saves leads instead, and resume sits one row down.
3. ~~**Empty cards are forbidden.**~~ **The grid is fixed; an empty card says one quiet
   sentence.** *(Reversed 2026-08-27.)* Cards used to render only when they had data, which
   meant the layout changed shape with the payload — column spans reflowed, neighbours moved,
   and the page you learned yesterday was a different page today. A layout that reflows around
   missing data is a layout nobody can learn. The same cards, always, in the same places; a
   card with nothing to show says so in one muted line and offers no CTA (whatever the user
   would have to *do* about it lives once, in the setup strip). The one exception is a
   genuinely empty account, where the whole grid yields to the FirstRunPanel — see §6.
   *Narrowed 2026-08-27 (Tara), two named cards only:* **Activity** and the **install nudge**
   are absent, not empty, when they have nothing to say (§3.2's override box; §3.3, card 6).
   Absence moves the following card into the freed cell and leaves a trailing cell blank —
   what stays banned is the thing that actually broke the old page: **col-spans and widths that
   change with the data**. The other cards keep their quiet empty states, and this list is
   closed: adding a third exception is a design decision, not an implementation detail.
4. **Perceived speed is a feature.** One aggregated fetch, skeletons on first paint, cached
   snapshot rendered instantly on revisit (stale-while-revalidate). The 2-3s facet-change
   lesson from the library applies doubly here.
5. **Usability over completeness.** Fewer, denser, better-ranked cards. Anything that needs a
   "view all" already has a home (library, sessions, live) — the dashboard shows the top-N
   and links out.
6. **One of everything.** *(Added 2026-08-27.)* One card chrome, one row shape, one chip, one
   dismiss button, three type sizes, one status colour. Every duplicate is a decision a reader
   has to make about whether two things that look different mean something different. The
   enforceable version of this rule is §3.5.

## 2. What we can actually show (data inventory)

Everything below exists today — no new tracking needed for P0/P1:

| Signal | Source |
| --- | --- |
| Recent bookmarks (title, og image, category, tags, device/browser/os, savedAt) | `GET /api/bookmarks?limit=N` |
| Facets: categories, tags, days histogram, device/browser split, total | `GET /api/meta` |
| Saved sessions (name, tab count, browser/device/os badges, savedAt) | `GET /api/sessions` |
| Live devices right now (label, browser, windows/tab counts, last_seen) | live server `GET /live` (+ SSE stream) |
| Reading queue | bookmarks tagged `reading`/`article` (native-sync applies these) — still in the payload, no card since 2026-08-27 (§3.4) |
| AI availability + chat history | `/api/health.ai`, chat conversations |
| Extension installed? | the new `useExtensionInstalled()` detection |

What we deliberately do **not** have (and should not quietly add): page-visit tracking,
time-on-site, or any telemetry beyond what the user explicitly saved or opted into (live
sessions). Analytics cards must be computed from *saves and sessions*, not surveillance.
If we ever want "most opened bookmark," opening-count tracking becomes an explicit,
documented schema change — out of scope here.

## 3. Web dashboard — composition

Route: `/app` is the dashboard; the old grid lives at `/app/library` (sidebar: "Home" above
"Library"). Every legacy deep link (`?category=`, `?q=`, `?ai=1`, `?section=live`…) is
redirected to the library WITH its query intact by `middleware.ts`, so nothing that used to
resolve stopped resolving — the dashboard owns only the bare `/app` landing (plus
`?settings=<id>`, which it handles itself).

> **Redesigned 2026-08-27 (Tara's brief: "calm, glanceable").** The nine-card, two-flex-column
> layout is GONE. It had reached nine cards across an asymmetric `lg:col-span-7|5` grid that
> reflowed to 12 whenever a column emptied, ~9 distinct CTA styles, 6 type sizes (including
> `text-[13px]`/`text-[11px]`/`text-[10px]`), 6 radii, solid AND dashed card chrome, and a
> 474-line resume hero whose rows mixed live devices, saved sessions and other-device
> bookmarks into one ranked list with two to three buttons apiece. Live state alone appeared
> in three unrelated places with three vocabularies.
>
> What ships now is THREE first-class nouns — **all bookmarks, saved sessions, live sessions**
> — plus one awareness card and one install nudge, in a grid whose *geometry* never depends on
> what came back:
>
> ```
> Omnibox                                  full width — the universal entry
> ┌ Recent saves ────┬ Saved sessions ────┐  grid grid-cols-1 lg:grid-cols-2 gap-4
> ├ Live now ────────┼ Activity *  ───────┤  equal widths, NO col-spans, ever
> └ Install nudge * ─┴ (empty) ───────────┘  * conditional — absent, never empty
> Setup strip                              full width, renders null once done/dismissed
> ```
>
> **Order revised 2026-08-27 (Tara), same day:** the first pass led with Live now. Recent saves
> leads now — it is the card every user has data in from their first save, and it is the
> save-confirmation surface; live sessions are opt-in and empty for most accounts, which is a
> weak thing to open a landing page with.
>
> Reading order IS the hierarchy, and it is the same order when the grid stacks to one column
> below `lg`. Cards are equal-width halves, so there is no narrow-rail case left to shrink
> type or padding for. The two starred cards may be ABSENT (see §3.2 and §3.3) — that changes
> which cell is last, never how wide any cell is; with both gone the grid is three cards and
> the bottom-right cell is simply empty. What was removed and why: §3.4. The rules that keep it
> calm: §3.5.

### 3.1 Tier 1 — act

> Since the 2026-08-27 order revision, **the tier heading says what a card is FOR; the number
> says where it SITS.** They stopped agreeing when Recent saves took the lead slot, and forcing
> them back into agreement would mean either lying about the layout or re-filing a recall card
> as an action card. The numbers below run in grid order (1 = omnibox, 2 = top-left, …) across
> both subsections.

**1. Omnibox (full width, slim).** Search-first: the library's hybrid search, plus an
"Ask AI" affordance that opens the empty chat panel (per the no-auto-fire behavior).
Submitting jumps to `/app/library?q=…`. Keyboard focus on `/` like the library.
*Revised 2026-08-27:* **Ask AI is the page's ONE solid button.** Search demoted to `ghost` —
Enter in the field is the real search gesture and the `/` hint says how to get there, so the
button is a fallback affordance, not a competing CTA. Two solid buttons side by side read as
a choice the user has to make before doing anything.

**4. Live now (grid, bottom-left).** The live surface — and now the ONLY place on the page that
talks about live devices. Up to 4 rows, ranked by `rankLiveDevices` (§5): device icon, device
name, browser, tab count, honest freshness (`liveAgeLabel` — "Active now" / "Active 20 min
ago" / "Earlier today"), and a single presence dot. The whole row is the link to the live
view; there is nothing else on it to click. Header: count + "View all →" (`?section=live`).
Empty states are two different sentences, deliberately — live off/unreachable ("turn them on
to see the tabs open on your other devices") is not the same fact as live on with nobody home
("Nothing is open on your other devices right now").

*The 2026-08 "merge Live now into the hero" decision is hereby reversed.* That merge was the
right fix for the wrong shape: it removed a duplicate by putting live devices inside a card
about something else, which is how live ended up with no home of its own. With the hero gone,
live is a noun again.
*Moved 2026-08-27 (Tara), top-left → bottom-left.* Still a first-class noun and still its own
card; it simply stops being the first thing on the page, because live sessions are opt-in and
this card is empty for every account that hasn't turned them on.

**3. Saved sessions (grid, top-right).** Up to 4 saved sessions, newest first: name, tab
count, when, device badge (`SessionIdentity`). Row click → the sessions view. The TOP row —
and only the top row — carries "Open all" (`outline`, small) when that session's tabs actually
came back in this payload (`lastSessionTabs`); this is the card's single inline action, and
the one place the old hero's best verb survives. Header: total + "View all →"
(`?section=sessions`).
The AI session description is deliberately NOT on these rows: it wrapped rows to different
heights, which is the one thing a scan surface cannot afford. It's one click away.

### 3.2 Tier 2 — recall & awareness

**2. Recent saves (grid, TOP-LEFT — first in reading order).** 5 compact bookmark rows — favicon, title, domain,
relative time, a small device icon, and an inert category chip. **The whole row is the anchor**
(one row, one destination, one tab stop), which is why the chip is inert here: an anchor may
not contain another anchor, and a second tab stop per row is a second decision per row.
Header: total + "View all →" (`/app/library`).
Cross-device saves fold in here rather than getting a heading of their own (see
`mergeRecentSaves`, §5) — they are the same objects from the same table, and one save
appearing twice under two labels was exactly the duplication the old hero produced. The device
icon on the row carries that fact instead.
*Promoted 2026-08-27 (Tara), bottom-left → top-left.* It is the only card that has data from
the user's very first save, and it answers the question people actually arrive with ("did the
page I just clipped land?"). Its tier is still "recall" — see the note at the top of §3.1.

**5. Activity (grid, bottom-right, deliberately small, and the one card that can be ABSENT).**
Exactly three facts, computed from saves:
   - a 14-day sparkline of saves/day (inline SVG, bars not a line — a smoothed line would
     invent values between discrete daily counts; scaled against a floor of 4 so a quiet
     fortnight looks quiet instead of looking like a placeholder graphic);
   - top 3 categories, the card's only clickable elements → filtered library;
   - the browser split as one proportion bar in neutral theme-aware shades.
   No streaks, no gamification, no "you saved 23% more than last week" — awareness, not
   nagging. Below `ACTIVITY_MIN_BOOKMARKS` the server sends `activity: null`.
   *Revised 2026-08-27:* no header action (there is no "all activity" view to send anyone to)
   and the browser legend is plain text — it used to be four more links to a filter the sidebar
   already offers, in the quietest card on the page.

> ### ⚠️ Principle override — 2026-08-27 (Tara), Activity only
>
> §3.5's rule is "the grid is fixed; an empty card says one quiet sentence." **Activity is
> exempt: with no activity it does not render at all.** No empty state, no placeholder, no
> reserved cell.
>
> The reasoning Tara gave, recorded so nobody re-litigates it from the principle alone: an
> empty *list* card still tells you something true and useful ("nothing is open on your other
> devices right now" is a fact you wanted). An empty *chart* card tells you only that the chart
> has nothing to draw — it is a caption for an absence, and it occupies a quarter of the grid
> to say it. The card is awareness, and there is no awareness to offer.
>
> The other three cards keep their quiet empty states. This is a one-card exemption, not the
> start of a conditional dashboard.
>
> **The rule, exactly** (`hasDashboardActivity`, `apps/web/lib/dashboard.ts`, unit-tested in
> `lib/dashboard.test.ts`): render the card iff `activity !== null` **and** at least one bucket
> in `activity.days` has `count > 0`. Both halves matter — the server suppresses the payload
> below the small-N floor, and *above* it still returns a fully zero-filled 14-day window, so
> an account whose saves are all older than the window gets 14 zeros and no card.
> `topCategories`/`browserSplit` are ALL-TIME facets and are deliberately NOT part of the test:
> they can be non-empty over an empty window, and a card whose headline chart is blank does not
> earn a grid slot for its footnotes.
>
> **Layout consequence:** none beyond flow. With Activity gone the grid runs three cards (plus
> the install nudge if it applies) and the bottom-right cell is empty. **No content-dependent
> col-spans** — that is the thing the redesign deleted, and it is not coming back to fill a gap.
> `ActivityCard`'s own empty branch stays in the component for any non-dashboard consumer, but
> the dashboard never reaches it.

### 3.3 Contextual

**6. Install nudge (grid, LAST slot — after Activity when it renders, in its place when it
doesn't).** *Added 2026-08-27 (Tara).* Exactly ONE card, chosen by platform, never both, and
never alongside the other's job:

| Platform | Card | Shows when | Never shows when |
| --- | --- | --- | --- |
| Desktop browser | **"Install the extension"** — one-line pitch ("Save any page — and whole windows of tabs — in one click") + the browser-appropriate store button (`ExtensionStoreButton`, so the store URLs stay in `lib/extension-links.ts` and are not copied here) | detection settles on NOT installed | the extension is detected, detection is still running (`null`), or the card was dismissed |
| Phone / tablet | **"Get the mobile app"** — pitch: save straight from the share sheet; link = `MOBILE_APP_URL`, a single exported constant in `install-card.tsx`, currently the public repo with a `TODO` to swap for TestFlight/App Store | always, until dismissed | dismissed on this browser |

  A mobile browser NEVER gets the extension card: none of them install one, so a store button
  there is an offer the browser can't accept. Detection and dismissal are both client-only
  decisions, so the card renders **nothing** during SSR and first paint and appears once its
  answer settles — a card that paints and then swaps or vanishes is worse than one that arrives
  a beat late.
  - **Extension detection** is the app's existing `useExtensionInstalled()`
    (`components/library/extension-cta.tsx` → `lib/extension-detect.ts`), reused rather than
    re-implemented: `data-bookmark-ai-extension="1"` on `<html>` (stamped by
    `apps/extension/entrypoints/marker.content.ts` on Firefox + Safari, watched here with a
    MutationObserver as well as read synchronously, because the content script lands at
    `document_idle`, i.e. possibly after hydration), the Chromium `externally_connectable`
    ping retried over ~8s, and a localStorage memo of the last positive answer. Both channels
    are scoped to `APP_PAGE_MATCHES` (`apps/extension/lib/app-origins.ts`), whose
    `http://localhost/*` entry covers the dev server on :3000 — match patterns ignore ports.
  - **Mobile has no equivalent.** There is no reliable way for a mobile web page to know a
    native app is installed (`getInstalledRelatedApps()` is Chromium/Android-only and needs a
    manifest relationship we don't have; scheme probing navigates or stalls the page). So the
    **dismiss IS the "I already have it" signal**, persisted at
    `bmk:dashboard-mobile-app-dismissed` (the extension card's is
    `bmk:dashboard-extension-dismissed`, separate from the detection memo: one records what we
    found, the other what the user decided).
  - **Platform detection**: `isMobilePlatform()` in `lib/dashboard.ts` — pure, unit-tested
    against fake navigator shapes. Positives only, OR'd: `navigator.userAgentData?.mobile ===
    true`, an Android/iPhone/iPod/iPad UA, or iPadOS's *desktop* UA (a "Macintosh" UA with
    `maxTouchPoints > 1`; a real Mac reports 0). `userAgentData.mobile === false` is
    deliberately not a final "no" — it is false on Android tablets, which have no extension
    story either.
  - Card chrome is the standard `DashboardCard`; its single header action is the shared
    `DismissButton` (via the new `headerAction` slot, which is mutually exclusive with
    `viewAllHref` — still one header action per card), and its body carries one `outline`
    button. Like Activity, it is ABSENT rather than empty when it has nothing to say.

**7. Setup strip (full width, BELOW the grid).** Everything this account still has to switch
on, as one quiet strip: save the first bookmark, turn on live sessions, connect an AI agent
(MCP). One LINE per step, one `outline` action per step, one shared dismiss for the lot
(`bmk:dashboard-setup-dismissed` + `bmk:dashboard-mcp-dismissed` — from the user's side there
is one thing on screen to make go away). Renders **nothing at all** once every step is done or
it is dismissed, at which point the grid is the whole page — the steady state this dashboard
is designed around. Below the grid, not above it: setup is temporary, the cards are the page.
*De-duplicated 2026-08-27 (Tara):* the strip's "install the browser extension" step is GONE —
card 6 owns that nudge, and the same prompt in two places is the duplication this redesign
exists to remove. For a typical account that leaves the strip empty, which is the correct
outcome: it renders null.
MCP visibility still comes from a lazy client-side `GET /api/mcp/tokens` (`useMcpPromo`),
deliberately NOT from `/api/dashboard` — the aggregator is on every visit's critical path and
a promo has no business slowing it down. Any failure = don't show the step. On a first-run
account the strip is not rendered at all, so that request never fires there.

### 3.4 Removed 2026-08-27 (and why)

| Gone | Rationale | Where its job went |
| --- | --- | --- |
| **"Continue where you left off" hero** (`continue-card.tsx`, 474 lines) | Ranked three unrelated kinds of thing into one list with 2–3 buttons per row; the single biggest source of "what am I looking at?" | Split back into the nouns it was blending: Live now, Saved sessions, Recent saves |
| **Reading queue card** | A tag filter dressed as a first-class noun — it competed with three real ones for a fifth slot the two-column grid doesn't have | `/app/library?tag=reading`; the payload still carries `readingQueue` |
| **Sessions shelf** (`sessions-shelf.tsx`) | Rebuilt, not deleted: same data, uniform rows, one inline action instead of a per-row verb that meant two different things | Saved sessions card (§3.1, item 3) |
| **MCP promo card** (`mcp-promo-card.tsx`) | A dashed dismissible card in a data column, for a one-line pitch | One step in the setup strip; `useMcpPromo` moved to `use-mcp-promo.ts` unchanged |
| **Setup card** (`setup-card.tsx`) | Rendered four different tile geometries depending on how many steps remained | Merged into the setup strip |

Two dashed cards each with their own heading and their own hand-rolled dismiss "×" were,
between them, the loudest thing on a page whose actual content is four cards.

*Also removed 2026-08-27 (Tara):* the setup strip's **"install the browser extension" step**.
Card 6 (§3.3) is the one install nudge now — same detection, more room to say why, and one
prompt instead of two.

### 3.5 System rules (enforceable — grep these in review)

- **ONE card chrome**: `dashboard-card.tsx` — solid border, `rounded-xl`, `bg-card`. No dashed
  variant (dashed used to mean "this goes away", which meant the page carried two card
  languages at once). No nested bordered boxes inside a card: inner grouping is a `bg-muted/40`
  fill. Exactly one border level survives — hairline `divide-y` row separators aside.
- **The grid never re-spans.** Two equal columns, `grid-cols-1 lg:grid-cols-2`, no col-spans,
  no width or padding that depends on what came back. Cards that stay put say one quiet
  sentence when they're empty.
  *Amended 2026-08-27 (Tara):* two cards may be ABSENT rather than empty — **Activity** (§3.2's
  override box) and the **install nudge** (§3.3, card 6). Absence is a FLOW decision: the next
  card moves into the freed cell, and a trailing empty cell stays empty. Nothing stretches to
  fill a gap; that is the behavior this redesign deleted. Everything else still renders
  unconditionally.
- **One header action per card**: a quiet "View all →" text link, or — for a card that goes
  away instead of leading somewhere — the shared `DismissButton` via `headerAction`. One or the
  other, never both. The footer link is gone; it and the header action were two ways to say the
  same thing.
- **Rows are the action.** Every row is a real `<a>`/`<Link>` (never a div with a handler),
  with `focus-visible` rings and real `<time>` elements. At most one *additional* inline
  action anywhere in a card.
- **Type scale is three sizes**: `text-base` (card titles) / `text-sm` (rows) / `text-xs`
  (meta). **Zero bracket font sizes** — `grep 'text-\[' components/dashboard` must be empty.
- **Radii**: `rounded-xl` cards, `rounded-md` everything else, `rounded-full` pills/dots.
  (The one `rounded-sm` is a 16px favicon image, where `rounded-md` reads as a circle.)
- **Buttons only from `buttonVariants`.** Exactly **one `default`** on the whole page (Ask AI);
  `outline` sparingly (setup steps, the single "Open all"); `ghost` for the rest. Three
  variants total, down from ~9 bespoke CTA styles.
- **Shared primitives, used everywhere**: `DismissButton` (was duplicated in two cards),
  `CategoryChip` (was near-duplicated in the bookmark row and Activity).
- **The emerald presence dot is the ONLY status colour on the page** — that is what makes it
  mean something. A device gone quiet (>10 min, the live view's own `FRESH_MAX_SECONDS`) gets a
  muted ring, never a second colour. No amber anywhere: the "Open all" pop-up-blocker result is
  a muted `bg-muted/40` notice, because it's an outcome, not a warning. Emerald carries an
  explicit dark-mode pair (`bg-emerald-500 dark:bg-emerald-400`); everything else is tokens.
- **`packages/ui/src/theme.css` is not touched by dashboard work** — the extension hand-copies
  it. Emerald stays a raw Tailwind class by design.

Explicitly rejected for v1: AI weekly digest (LLM cost per landing; revisit as P2 opt-in),
tag cloud (low action density), calendar heatmap (vanity at our data volumes), pinned/
favorite bookmarks (no favorite primitive exists yet — worthy, but a separate feature),
"most used websites" (requires visit tracking — see §2 privacy stance).

## 4. Mobile dashboard (new Home tab)

> **Not redesigned.** The 2026-08-27 pass was web-only (`apps/web/components/dashboard/*`).
> The mobile Home tab still ships the ORIGINAL composition described here — including its own
> `HomeContinueCard` and `HomeLiveStrip`, with mobile-local ranking. Web and mobile therefore
> DIVERGE today: the same account shows "Continue where you left off" on the phone and four
> nouns on the desktop. Deliberate for now (mobile has one column and a different thumb-first
> job), but if the two are ever reconciled, the direction of travel is this doc's §3.

Constraint: one column, ~390pt wide, thumb-first. The tab bar gains **Home** as the first
tab (Library, Sessions, Search, Settings follow). Order = priority; everything is one
swipe-scroll, no horizontal carousels except where noted:

1. **Search field** (existing SearchScreen input style) — tapping focuses inline search;
   this may simply *be* the Search tab experience embedded, not a navigation hop.
2. **Continue card** — the single best resume target (originally "same ranking as web, but
   only the winner"; since 2026-08-27 the web ranking is gone, so this is mobile-local logic
   with no shared counterpart). Full-width, one tap to act.
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

- **One aggregator endpoint**: `GET /api/dashboard` → `{ recentBookmarks, readingQueue,
  recentSessions, lastSessionTabs, otherDeviceBookmarks, activity, totalBookmarks,
  totalSessions }` (the frozen shape in `packages/types/src/dashboard.ts`), assembled
  server-side in `packages/engine` from parallel queries against existing db modules. One
  round-trip, one skeleton pass. Clerk-session only (device tokens must NOT gain read scope —
  keep the existing security posture).
  **Live state is deliberately NOT in this payload** and never was: the live server is a
  separate origin with its own auth, so this endpoint can't forward the caller's credentials
  to it. Clients compose "live now" themselves from the live SSE hook.
- **Client caching**: render last snapshot from localStorage/AsyncStorage instantly, refresh
  in background (SWR, `useDashboard`, keyed by Clerk user id so a shared browser never flashes
  one account's data at another). The Live now card updates itself via the existing SSE stream
  (`useLiveDevices`) after paint.
- **Presentation helpers** live in `apps/web/lib/dashboard.ts`, framework-free and unit-tested
  in `lib/dashboard.test.ts` — the two genuinely non-obvious rules on the page are tested, not
  eyeballed:
  - `rankLiveDevices(devices | null)` — which devices Live now may call live, best first.
    De-dupes ids (a re-announcing device appears twice in one snapshot), drops anything
    unseen for 24h or holding zero tabs, then orders by freshness BUCKET
    (`LIVE_FRESHNESS_BUCKET_SECONDS`, 5 min) → tab count → raw age. Two laptops that both
    checked in a minute ago are equally live, and the one holding 20 tabs is the one you left
    mid-task; raw-second ordering between them is heartbeat noise, not user intent.
  - `mergeRecentSaves(recent, otherDevice, limit)` — one newest-first stream, de-duped by id
    (`otherDeviceBookmarks` is a filtered slice of the same table, so overlap is the normal
    case), unparseable timestamps sorting last rather than scrambling the list.
  - *Added 2026-08-27:* `hasDashboardActivity(activity)` — the exact render rule for the one
    card allowed to vanish (§3.2's override box), and `isMobilePlatform(navigator)` — which
    install nudge a visitor gets (§3.3, card 6). Both pure, both tested against literal
    payload/navigator shapes rather than eyeballed in a browser.
  - *Replaced 2026-08-27:* `rankContinueTargets`/`ContinueTarget` (the hero's mixed ranking)
    and `dominantReadingTag` (the reading-queue footer's tag picker) were deleted with the
    cards that used them. The live-ordering assertions carried over verbatim into
    `rankLiveDevices`; the session/bookmarks-fallback and reading-tag cases went with the
    behavior they covered.
- **Link builders** are centralized in `components/dashboard/links.ts` so the whole
  click-through contract is auditable at a glance. Five destinations now: live, sessions, all
  bookmarks, a category filter, search/Ask AI. The tag/browser/device builders went with the
  cards that used them — the sidebar owns those filters.
- **Skeletons**: the route's Suspense fallback (`app/app/page.tsx`) and the in-page loading
  state paint the SAME geometry as the real thing — omnibox strip, then the 2×2 grid — so
  nothing moves sideways when the boundary resolves or the data lands. Row counts follow the
  card ORDER (5/4/4/4 = recent saves, saved sessions, live now, activity). The install nudge
  gets NO placeholder: it is a client-only decision that renders nothing until it settles, so a
  skeleton would promise a card that may never arrive.
- **No schema change for P0/P1.** Activity computes from existing columns; reading queue is
  a tag filter. (If "continue" ranking later wants per-window last-activity, that data
  already rides the live snapshots.)
- **Relation to the shelved New Tab Canvas** (docs/features/newtab-canvas.md): the dashboard
  is the fixed, first-party, fast answer to the same jobs. If Canvas ever ships, its preset
  templates should be able to embed these same dashboard cards as components — design the
  card data contracts (props in, actions out) so cards are reusable, not page-welded.

## 6. First-run (empty account)

A genuinely empty account (`totalBookmarks === 0 && totalSessions === 0`) sees the **omnibox
plus `FirstRunPanel`, and no grid at all** — the library's own teaching surface, which is the
richer version of the job the setup strip does later. The setup strip is not rendered there
either, so its steps can't duplicate the panel's (and `useMcpPromo`'s request never fires on
an account with nothing to connect an agent *to*).

*Revised 2026-08-27:* this is the whole-page exception to principle 3, and it exists because
the alternative is a grid of cards saying "nothing yet" three different ways above a panel that
says what to do first. (Distinct from the per-card absences that principle now allows: those
drop one cell, this replaces the grid.) The moment anything lands, the grid takes over
permanently — the panel never competes with real data.

## 7. Success criteria & phasing

Measure (client-side, privacy-safe counters are fine): % of landings that interact with a
dashboard card within 10s; "Open all"/continue usage; search-from-dashboard usage; time-to-
first-interaction vs today's library landing.

- ~~**P0**~~ **SHIPPED**: `/app` route swap + omnibox + Recent saves (web); Home tab with
  Search + Continue + Recents (mobile). Aggregator endpoint + skeletons + snapshot cache.
- ~~**P1**~~ **SHIPPED**: Activity, sessions, setup, first-run.
- **Redesign 2026-08-27 (web) — DONE**: two-column fixed grid; Live now and Saved sessions
  promoted to first-class cards; Continue hero and Reading queue card removed; setup + MCP
  merged into one strip; the §3.5 system pass (one chrome, three type sizes, three button
  variants, one `default` per page, shared `DismissButton`/`CategoryChip`). `check-types` and
  `vitest` green.
- **Follow-up pass, same day (Tara's approved changes) — DONE**: card order is Recent saves →
  Saved sessions → Live now → Activity; Activity renders only when its window has saves
  (§3.2's override box); a platform-picked install nudge takes the last slot (§3.3, card 6 —
  extension on desktop when not detected, mobile app on phones/tablets, dismissible, never
  both); the setup strip's duplicate extension step removed. New pure helpers
  `hasDashboardActivity`/`isMobilePlatform` with 12 unit tests; `check-types` and `vitest`
  green (233 tests).
- **Open follow-ups**: reconcile the mobile Home tab with §3 (or decide the divergence in §4
  is permanent); no dashboard card has a `?device=`-scoped live deep link yet (rows land on
  the live view generally).
- **P2**: AI weekly digest (opt-in), pinned/favorites (new primitive), card-level
  personalization (reorder/hide, persisted in user_settings).
