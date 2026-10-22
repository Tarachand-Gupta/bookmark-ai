# Web bookmark views — 16 October 2026

Status: implemented in the working branch and verified in the isolated local web preview. This report does not claim production deployment, native-app acceptance, extension runtime acceptance, or store readiness.

## Accepted behavior

- Desktop has exactly two bookmark presentations: the original image-led Grid and Table.
- Phones below 768px retain the original image-led cards independently of the desktop preference. The rejected compact cards and three-line list are no longer web view options.
- A device-local view preference is shared across the library, folders, topics, tags, search results and dashboard recent saves. Legacy List/Compact preferences migrate to Table.
- The desktop toolbar no longer includes the standalone Select button or library-wide ellipsis. Per-bookmark actions and folder context menus remain available. Mobile retains its explicit Select control.
- Table reuses shadcn/Table and tablecn patterns with TanStack Table and dnd-kit. Upstream revision and MIT attribution are in `docs/licenses/tablecn.md`.
- Title receives spare width by default. Website and Added date are the other default data columns. Folder, Topic, Tags, Browser and Device are optional through Columns. Explicit resizing, ordering and visibility are stored locally on the device; Reset table restores defaults.
- Selection appears on row hover or keyboard focus and remains visible while selected. Header selection exposes its mixed state. Shift-range selection follows the displayed row order. Touch controls remain available without requiring hover.
- Column dividers support mouse dragging and keyboard resizing. Column reordering supports dragging and Move left/Move right menu alternatives. The Title column cannot be hidden.
- Added date follows the bookmark's saved timestamp, consistent with the existing grid.

## Fresh automated evidence

| Check | Result | Local evidence |
| --- | --- | --- |
| Relevant web regression suite | 146 tests across 15 files passed | `.work/release-1/ux-two-view-regression-tests.log` |
| Table preferences, selection and ordering tests | 23 tests passed | `.work/release-1/bookmark-table-tests.log` |
| Final view/table test rerun after last changes | 39 tests passed; subset of the 169 above | `.work/release-1/two-view-final-tests.log` |
| Final full web TypeScript check | Passed, exit 0 | `.work/release-1/two-view-final-web-types.log` |
| Extension TypeScript compatibility check after workspace dependency installation | Passed | `.work/release-1/ux-two-view-extension-types.log` |
| Static table semantic render checks | Passed | `.work/release-1/bookmark-table-render-probe.log` |
| Full workspace frozen-lockfile installation | Passed | `.work/release-1/table-workspace-install.log` |

## Fresh browser evidence

Tested through the running UI at `http://localhost:3000/app/library`, using the isolated synthetic fixture. No bookmark records or account credentials were changed.

- Desktop shows exactly Grid and Table, with the original image hero and top-left selection affordance restored in Grid.
- Space on the first table checkbox selected one row; the header reported `aria-checked="mixed"`.
- Shift-click on the third row selected the first three rows. Header Select loaded bookmarks selected all 100 loaded rows. Done selecting cleared selection.
- Mouse resizing changed the Title width from 526px to 606px; keyboard adjustment changed it to 622px. The final implementation also shrank Title to 280px using Home, with that width surviving a reload.
- Both Move left and pointer drag changed column order. The reordered layout and width survived a reload.
- Hiding Website survived a reload. Reset table restored Title, Website and Added date and restored automatic title expansion.
- Navigation from All bookmarks to Design and Start here retained Table. Those rows did not repeat Folder or Topic metadata with the default columns. Switching to Grid in a folder retained Grid when returning to All bookmarks.
- At 390px and 320px, a saved desktop Table preference still rendered the original mobile cards. At 320px the document width was exactly 320px, with no table and no horizontal overflow. Filters, Tags and Select each measured 44px high.
- Browser viewport was restored after responsive testing. Final preview preference was left on Grid, with default table columns and the user's existing sidebar width preserved.

Screenshots:

- `.work/release-1/web-e2e/desktop-original-grid-final.png`
- `.work/release-1/web-e2e/desktop-bookmark-table-final.png`
- `.work/release-1/web-e2e/mobile-original-cards-restored.png`

## Preview parity and limits

The local server uses `.work/release-1/web-fixture`. The 18 view-related source files were copied there, with matching SHA256 values recorded in `.work/release-1/two-view-preview-manifest.json`. Fixture authentication and database isolation adapters were preserved. Shared card source was copied into the fixture's Tailwind scan path as well as retained in the source package.

Table sorting currently applies to loaded rows; the UI states this scope. The library still loads pages of 100 bookmarks, so column sorting does not yet promise an order across unloaded records. Selection similarly distinguishes loaded rows from the existing complete-result selection operation.

The preview uses synthetic bookmarks without real article images, so their existing image fallback is visible. Responsive browser testing covers mobile web, not a physical iPhone or the native iOS application. Earlier account/settings/editor/sidebar checks have separate evidence; they were preserved, not all repeated during this final view check.
