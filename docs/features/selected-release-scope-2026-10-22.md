# Selected local release scope — 22 October 2026

The owner reduced the local Release 1 scope before deployment. Production was the
reference for existing behavior. The subsequent web/API deployment and final
checks are recorded in the [23 October release report](../testing/reports/2026-10-23-production-selected-release.md).

## Recovery points

- Production source reference: `24dcfab` (Safari auth fix included).
- Full pre-reduction checkpoint: `9487f535d7e715c79f616f2bdb9515d87ff4b8ec`.
- Backup branch: `codex/backup-release-1-full-2026-10-22`.
- Reduced branch: `codex/release-1-selected-features`.
- Follow-up sidebar/attachment polish: `codex/sidebar-collapsed-spacing`, based
  on the reduced release checkpoint `efb0b44`.

The backup contains folders, reading-list changes, the new onboarding/import
flow, Table view, and the extension popup redesign. Recover selected paths or
build a separate branch from that checkpoint when revisiting a feature. Do not
merge the entire checkpoint into the reduced release: it restores all deferred
features together. Environment files, credentials, databases, and build products
are not part of the Git checkpoint.

## Retained

- Current production auth, recovery, device/session, and live-tab behavior.
- Settings/avatar navigation without reloading the application; stable Settings
  height, internal scrolling, cached data, and failures confined to each section.
- Account privacy, late-response guards, profile metadata, and reauthentication
  return destinations.
- Manual bookmark title, category, and tag editing.
- Bulk category assignment, tag editing, delete, and export. Categories and tags
  retain their existing distinct data models; the UI does not call categories Topics.
- Persistent AI composer and drafts, including the close/focus-loop fix.
- Resizable sidebar and improved Settings navigation.
- Existing production Grid, List, and Compact bookmark presentations.
- Clearer Saved / Already saved extension feedback within the production popup.
- Independent build-retention and cache fixes.

## Deferred

- User-created folders/subfolders, folder navigation, moving, filters, and AI context.
- New reading-list/read-state work.
- New onboarding and bookmark-import wizard; existing backup import/export stays.
- Table presentation and its added dependencies.
- Remaining extension popup redesign, quick editor, and composer transfer.

Removing a feature does not authorize deleting user data. Old additive local
storage can remain inert for compatibility; no folder/read controls or mutation
operations belong in the reduced release.

## UX acceptance notes

- The collapsed desktop composer is approximately half its previous width
  (360px maximum), using exactly the header's background tint (80% with backdrop
  support, 95% fallback), 8px blur and fine 1px theme border. The card corner
  radius follows the theme; text and controls remain opaque. This supersedes
  the 30% tint, which the owner found too translucent.
- Appearance includes separate floating AI bar switches for desktop (default on)
  and mobile (default off), saved in this browser. When enabled on mobile it uses
  narrow edge gutters. Hiding the shortcut removes its reserved space without
  unmounting the chat or losing a draft. The navbar always opens the AI panel.
- Mobile web Settings uses a grouped menu, section details, Back and Done, with
  every desktop web section available under the same existing permission gates.
  Direct section links still open the requested pane; generic Settings opens the
  menu. Desktop keeps the sidebar and content pane. Long sections scroll inside
  the dialog. Below 640px the navbar AI button is a non-shrinking 44px square,
  matching the search field's height.
- At the sidebar's minimum expanded width, the full **Bookmark AI** brand must
  stay on one line. Its composer offset follows the actual sidebar width.
- Closed desktop facet headings have compact 40px spacing. The icon rail has one
  divider above the facets and one icon per available section, without empty
  section separators. Choosing a facet icon expands its section.
- The AI attachment overlay must clear after leaving the panel, cancelling a
  drag, dropping elsewhere, or returning to normal clicks. Nested movement in
  the panel must remain stable, and a valid drop must attach a file only once.
- Compact rows prioritize the bookmark title (approximately 45% where metadata
  fits), limit the domain to about 14 characters, and adapt to the space remaining
  beside the AI panel. Full URLs are available on link hover; the links open the
  bookmark. Edit/delete appear on pointer hover or keyboard focus, with visible
  controls on touch screens.
- Web focus indicators use a thin 1px line in the existing accent color. Keep
  keyboard focus visible. Text inputs, textareas, and grouped inputs change their
  existing thin border to the accent color, without an additional outer halo.
- The desktop tag chips, dropdown, date control, and layout control align at
  36px high. The tag dropdown opens a searchable, scrollable overlay card with
  every tag and its count; it never expands the toolbar or pushes bookmarks
  down. Mobile uses the same card with 44px choices. Categories remain their
  existing separate facet. The date trigger is an accessible calendar icon until
  a range is selected, then retains its existing range label and clear action.
- Account starts with identity and four quiet disclosures: Profile, Sign-in
  methods, Security and Devices. Only one task is expanded at a time. Name/email
  actions are disabled until edited. Device actions live in an overflow menu;
  bulk sign-out is a separate disclosure. Account deletion is collapsed by
  default and retains its existing final confirmation. Mobile does not repeat
  the Account heading beneath its navigation bar. Existing provider operations
  and account permission checks are unchanged.
- The current-session **Sign out** action belongs at the bottom of the Settings
  navigation, styled as a red ghost button. Account retains device-management
  controls, including signing out other/all devices, but no duplicate standalone
  current-session exit.

## Local review

Use the isolated preview at `http://localhost:3000/app/library`. Fixture A is
reserved for the owner's review. Automated mutations use B or C only. Synthetic
authentication and deterministic chat make this a feature/UX preview; they do not
establish production provider-authentication or live-server E2E success.

Verification evidence and its limits are recorded in the
[local testing report](../testing/reports/2026-10-22-selected-features.md).
