# Selected features — local verification, 22 October 2026

Scope and recovery branches: [selected release scope](../../features/selected-release-scope-2026-10-22.md).
This verifies the reduced local release. Production was not deployed or migrated.

## Automated evidence

| Check | Result |
| --- | --- |
| Web full Vitest suite | 937 tests across 87 files passed |
| Chat workspace after final draft-retention fix | 8 tests passed, including two new regressions |
| Shared types/database/engine and web TypeScript | Passed |
| Extension TypeScript and tests | Passed; 284 tests across 32 files |
| Mobile TypeScript and library tests | Passed; 182 tests across 37 suites |
| macOS Swift sources/tests syntax | 118 files parsed; not compilation or XCTest |
| Frozen offline dependency lock validation | Passed |

The web suite includes isolated file-backed libSQL tests for edits, category/tag
bulk operations, tenant isolation, optimistic conflicts, idempotent retries,
receipts, undo, pagination, export, and 5,000-bookmark query bounds. Backend
targeted tests are included in the web count, not additional tests.

Old folder/read data remains stored but unavailable through the removed feature
APIs. Historical chat context does not silently become whole-library context.
Draft text and failed-turn recovery survive reload and require an explicit
supported context choice before sending.

## Browser verification

GPT-6.1 Sol performed the visual pass in an isolated headed browser. Parent review
also inspected the saved screenshots. QA mutations used disposable fixture C at
`http://127.0.0.1:3000`; the owner's fixture A at localhost was not modified.

- Desktop Grid/List/Compact restored; no new folder, Topics, reading-state,
  Table, or import wizard controls.
- Manual title/category/tag edits persist after reload.
- Bulk category/tag changes affect only the two selected test bookmarks;
  selected CSV contains exactly those two rows; confirmed delete removes only
  those test rows.
- Settings and avatar Account open without a document reload and preserve the
  existing composer node and draft. Desktop modal height remains stable;
  Account scrolls internally. Primary Sign out is at the bottom of the left
  Settings navigation; per-device revocation remains in device management.
- Sidebar minimum is 256px with the full brand on one line; expansion works.
- Collapsed composer is 360px on desktop and 366px at a 390px mobile viewport,
  with 12px mobile gutters, translucent background, and 24px backdrop blur.
  Repeated focus/open/close preserves the draft and stays closed after closing.
- Mobile views have no horizontal overflow. Legacy scoped draft text is retained;
  Send stays disabled until the user chooses a supported context.

- Compact rows were checked again after the requested spacing change. The title
  measures 45% both at full width (461.7 of 1026px) and beside the AI panel
  (267.3 of 594px); domain width is capped at 14ch and column gaps are 8px.
  Desktop actions are hidden and ignore pointer events at rest, becoming visible
  on hover or keyboard focus without shifting columns. In a coarse-pointer touch
  context, both actions stay visible at 36px and Edit opens the editor. Full-URL
  tooltips and safe new-tab links were verified; the synthetic destination is
  deliberately not a real website.
- Focus styling passed after the final sync: clicking library search, Settings
  display name, and the AI composer produces a 1px accent border with zero outer
  ring spread. The composer's inner textarea has no second border. Keyboard Tab
  still shows a thin 1px accent ring on the Save name button. Screenshots confirm
  the thick halo is gone.

## Reproduce and extend

1. Start with the isolated preview and verify `/api/me` reports fixture B or C
   before creating, editing, or deleting test links. Reserve fixture A for the
   owner's review.
2. Check Grid/List/Compact, edit/reload, then select two disposable links for
   category/tag updates, CSV export, and confirmed deletion.
3. Keep an unsent AI draft while opening Settings and avatar Account, switching
   sections, resizing the sidebar, and opening/closing chat. Test at desktop
   1440px and mobile 390px widths, including a short landscape viewport.
4. Check compact rows both with the AI side panel open and closed, using pointer,
   keyboard focus, and touch. Inspect actual screenshots as well as geometry.
5. Re-run focused tests for changed code. Relevant commands:

```sh
corepack pnpm --filter @bookmark-ai/web test
corepack pnpm --filter @bookmark-ai/web check-types
corepack pnpm --filter @bookmark-ai/extension test
corepack pnpm --filter @bookmark-ai/extension check-types
corepack pnpm --filter @bookmark-ai/mobile check-types
# From apps/mobile:
node --import tsx --test src/lib/*.test.ts
```

Local screenshots, detailed measurements, CSV, and worker reports are under
`.work/reduction-oct22/`. They are QA evidence, not release packages.

## Limits

Synthetic fixture authentication and deterministic chat do not prove real
provider login, sign-out, cloud AI, or production end-to-end behavior. This pass
did not rebuild or install native apps/extensions, run native GUI/simulator
tests, submit stores, or interact with the owner's phone. Native runtime and
extension installation checks remain necessary before releasing new packages.
