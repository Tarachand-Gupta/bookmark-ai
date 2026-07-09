# Desktop app — Agent Guide (zero-native / Native SDK)

Native-rendered macOS app built with vercel-labs/native ("zero-native"): **Zig 0.16** logic +
declarative `.native` markup, drawn by the SDK's own engine — NO WebView, NO React, NO DOM.

**Do not code from general model knowledge.** Before ANY change, load the SDK's own guidance:

```bash
native skills get core        # mental model, app.zon, permissions, packaging
native skills get native-ui   # markup grammar, bindings, Model/Msg/update, effects — THE reference
native skills get automation  # driving/verifying the running app
```

## Files

- `src/app.native` — the entire UI (sidebar + cards). Hot-reloads while `native dev` runs.
- `src/main.zig` — `Model` (fixed-size, every field defaulted), `Msg` (tagged union),
  `update(model, msg, fx)`, `boot` (init_fx), JSON intake, view-binding fns.
- `src/tests.zig` — headless tests: JSON intake, filtering, markup build per model state,
  typed dispatch via `tree.msgForPointer`, engine layout.
- `app.zon` — manifest (id `ai.bookmark.desktop`, window 1100×720, permissions view+command).
- Zero-config: **no build.zig** — the CLI owns the build graph. Verbs: `native dev|check|test|build|package`.

## Loop / verify cycle

```bash
native check    # markup + typed model contract + app.zon (contract refreshed by `native test`)
native test     # 11 tests must pass
native build    # ReleaseFast → zig-out/bin/bookmark-ai
```

Run + drive (GUI session; start apps/server first or you'll see the offline state):

```bash
native dev -Dautomation=true &
native automate wait
native automate snapshot                    # full widget tree with ids/roles/names
native automate screenshot main-canvas      # deterministic PNG → .zig-cache/native-sdk-automation/
native automate widget-click main-canvas <widget-id>
native automate assert 'role=text name="..."'
```

**Snapshot id gotcha**: on a line like
`widget @w1/main-canvas#111… role=listitem name="Design  (1)" … parent=#222…`
the widget id is the FIRST `#` number (`111…`); the trailing `parent=#222…` is a different
widget — a naive "last #number" regex clicks the container and nothing happens.

## How this app works (TEA)

- `boot` (init_fx, runs once pre-paint) and the `refresh` Msg both call `startLoad` →
  `fx.fetch` GET `http://127.0.0.1:4000/api/bookmarks?limit=30` (key=1, 10 s timeout) →
  terminal Msg `.loaded: native_sdk.EffectResponse`.
- `applyResponse` (pub, pure, unit-tested directly) checks `outcome`/`status`, then
  `parseBookmarks` uses `std.json.parseFromSliceLeaky(std.json.Value, arena, …)` into a
  throwaway ArenaAllocator and COPIES every string into the Model's bounded `Str(N)` buffers
  (effect payloads are drain-scratch — never store slices from them).
- Card/right-click "Open in Browser" → `.open_bookmark: i64` → `fx.spawn {"open", url}`
  (macOS `open`); its mandatory terminal Msg is `.opened` (ignored).
- Filtering: `pick_category: []const u8` copies into `model.filter`; the view derives
  everything (`rows`, `cats`, `statusLine`, bools) via pub fns on Model — **derive, don't
  store**; formatted strings go into the per-build arena.
- Search: the header `<search-field>` mirrors edits into `model.search_buffer`
  (`query_changed: canvas.TextInputEvent`); Enter (`run_search`) fetches
  `/api/search?mode=text&limit=30&q=…` (key=2, percent-encoded by `buildSearchUrl`) →
  `.search_loaded` → `applySearchResponse`. `model.awaiting` guards stale/cancelled
  terminals; emptying the field (typing or the built-in ✕) restores the library list.

## SDK rules that bit us (respect them)

1. Model fns used by bindings/`for each` MUST be declared INSIDE `pub const Model = struct`.
2. Effect-only Msg tags and markup-untouched fields need `pub const view_unbound = .{ "…" }`
   on Msg/Model or `native check` warns (Msg declares `loaded`,`opened`; Model declares
   `bookmarks`,`error_text`,`bookmark_count`,`total`,`filter`,`status` — every field consumed
   only through derived pub fns belongs in that list).
3. Markup is a closed grammar: no `<img>` (Zig-only `ui.image`), attributes take ONE `{expr}`,
   colors/radius ONLY by token name (`background="surface"`, `foreground="text_muted"`),
   `wrap`/`overflow` are invalid on a `<text>` containing `<span>`s (span paragraphs always wrap).
4. Payload coercions: `on-press="tag:{path}"` coerces to int/float/enum/`[]const u8`/bool —
   paths only, no expressions in message payloads.
5. Effects: max 16 in-flight, keys are caller-owned u64s, EVERY fetch/spawn delivers exactly
   one terminal Msg (`.rejected` if it never started). Response bodies cap at 256 KiB —
   that's why the fetch uses `limit=30` (also keeps the view under the 1024-widget budget).
6. Fixed-size Model: `create` requires defaults on every field; strings are `Str(N)` bounded
   buffers with UTF-8-safe truncation. No allocators in the Model.
7. Comparisons in markup reject arena-computed operands — precompute booleans in Zig
   (e.g. `CatRow.selected`) instead of `{a == b}` against derived strings.

## Extending

- New UI state → Model field/fn + markup binding + a test in `tests.zig` (copy the
  `buildTree`/`expectByText` pattern; run `native test` so the typed contract refreshes).
- Search UI is implemented exactly on that pattern (`startSearch`/`applySearchResponse` in
  main.zig, the header `<search-field>` in app.native) — an AI-mode toggle would add a mode
  field + `mode=ai` in `buildSearchUrl` and surface the response's `fallback` flag.
- Images in cards require the Zig-builder view path (`canvas.Ui`) + runtime image
  registration — a bigger lift; see the native-ui skill's Images section.
- Packaging a distributable .app: `native build && native package --target macos`.
