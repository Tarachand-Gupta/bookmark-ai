# Ask AI tool paging

The chat agent's list-shaped tools return **one page**, never a whole result set.
Nothing is summarized away from the model — it reads every page verbatim — and the
context is bounded by paging plus a prompt rule against enumerating. The same page
renders beside the answer as an interactive card the **user** can filter and page
on without spending a model turn.

Contract: `packages/types/src/chat-tools.ts` · tools: `apps/web/app/api/chat/route.ts` ·
cards: `apps/web/components/library/chat-*-card.tsx`.

## The page object

Every list tool's output ends with:

```ts
page: {
  total: number | null;  // full count; null when the source can't cheaply know it
  offset: number;        // rows skipped before this page
  limit: number;         // page size (max 50 = TOOL_PAGE_LIMIT)
  hasMore: boolean;      // more rows follow
  nextOffset: number | null; // pass back as `offset` for the next page
}
```

`TOOL_PAGE_LIMIT` is 50 and is also the maximum a tool call may request. Row payloads
are clamped per field (`apps/web/lib/server/chat-tool-text.ts`): titles 160 chars,
URLs 300, descriptions 400.

## Per-tool schemas

| Tool | Input | Page rows | `total` |
| --- | --- | --- | --- |
| `searchBookmarks` | `{query, mode: hybrid\|text\|semantic, limit, offset}` | `results: [{id, title, url, category, tags[], day, score}]`, plus `query`, `mode`, `fallback` | `null` — ranked retrieval only knows `hasMore` (depth capped at `MAX_SEARCH_DEPTH` 200) |
| `queryDatabase` | `{sql, purpose?, limit, offset}` — write **no** LIMIT/OFFSET; the engine wraps them | `columns[]`, `rows[][]`, `rowCount`, `truncated` (a long cell was clipped), plus `sql` | exact — a `SELECT COUNT(*)` over the same query on the first page |
| `listSessions` | `{query?, limit, offset}` — `query` matches name, description, tab titles/URLs | `sessions: [{id, name, description, tabCount, browser, savedAt, tabs[≤15]}]`, plus `query` | exact — sessions matching the filter |
| `listLiveTabs` | `{query?, limit, offset}` — `query` matches tab title/URL | `devices: [{label, browser, lastSeenAgeSeconds, tabCount, matchingTabCount, hiddenTabCount, windows: [{windowId, name, index, windowTabCount, tabs: [{title, url, favIconUrl}]}]}]`, plus `query` | exact — tabs matching the filter, across all devices |

`listLiveTabs` pages over the **flat** tab order (device → window → tab) and re-nests
the page into its device/window scaffolding, so a page is renderable as sections
without the client re-deriving anything. Devices and windows with no tabs on the page
are omitted; the ones that survive keep their full counts (`tabCount`,
`windowTabCount`) so a partial group can say "12 of 34". Non-page shapes are unchanged:
`{enabled: false}` when live sharing is off, `{error}` when the live server can't be read.

## Filtering beats paging

Every tool that can narrow server-side does: `query` on `listLiveTabs` and
`listSessions`, a tighter query on `searchBookmarks`, a `WHERE` clause on
`queryDatabase`. "Which of my open tabs is about DigitalOcean" is one filtered call,
not eight blind pages — the prompt says so explicitly.

## Client paging (no model turn)

Each card's "Load next 50" hits the same engine path the tool used:

| Card | Route |
| --- | --- |
| bookmarks | `GET /api/search?q&mode&limit&offset` |
| SQL | `POST /api/query {sql, limit, offset}` (auth'd; `runReadOnlySql` guards, no recount) |
| sessions | `GET /api/sessions` (whole list, sliced client-side with the tool's filter) |
| live tabs | `GET /live` via `getLive()` (one snapshot, flattened/filtered/sliced client-side) |

Cards accumulate rows across pages, show `rows 51–100 of N`, keep their own substring
filter over what's loaded, and fold long groups behind a chunked "show N more"
(10 rows, then 25 at a time).

## Porting to mobile / macOS

The shapes above are the whole contract; `ToolPageMeta`, `TOOL_PAGE_LIMIT`,
`pageOf`, `clampPageLimit/Offset` and `describePageRange` are exported from
`@bookmark-ai/types` for any client that renders these cards.
