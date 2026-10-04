# Web themes and AI source settings

The floating Theme button offers Default plus 42 named Tweakcn presets, a searchable swatch list, and Light/Dark/System. Choosing a preset applies its light/dark colors, surfaces, sidebar/chart tokens, radius, and generated shadows globally. Default restores Bookmark AI's exact shared colors and existing Tailwind shadows. Presets never replace the brand fonts, typography, or spacing. The established marketing navbar and auth shell remain shared.

Preset data is pinned to Tweakcn commit `a3b47b37cba97dd637de517aab52c45ec0f83456`. Source, Apache-2.0 license, adaptation notice, and pinned shadow formula are vendored in `apps/web/lib/theme-picker`. The picker makes no runtime request to Tweakcn.

Appearance uses browser-local `bookmark-ai:appearance:v2`, independent of next-themes' color mode. Only allowlisted preset identifiers are accepted. Old v1 editor preferences safely resolve to Default; arbitrary stored CSS is ignored. A static bootstrap restores validated CSS before paint. Disabled storage still allows appearance changes in the current tab. Changes synchronize across tabs. Every preset replaces the whole token map, so switching back cannot leave an accent or shadow behind. Browser theme-color follows the active page background.

The picker moves left of side-docked chat and hides during overlay/full chat, dialogs, sheets, alert dialogs, and bulk-selection actions. It returns when those close. Controls have 44px targets; the popover is bounded and scrollable on narrow/short viewports.

## AI settings

The shared AI setup card has one source choice: Included AI or Your own provider. This choice displays the relevant panel; the separate Active status reflects the latest successful server response. Opening a setup panel does not change routing. Save and use provider explicitly activates a complete configuration; switching back to included preserves the saved key/provider/model and the existing weekly-credit fallback behavior. Removing a key retains the existing separate confirmation.

New Google/OpenAI/Anthropic keys must pass the existing Verify key & list models request before activation. Editing the key/provider/endpoint invalidates that local verification. Saved unchanged keys remain usable without a new verification. Custom OpenAI-compatible endpoints support manual model IDs and clearly show an unverified connection when they do not support model listing; an explicitly rejected key cannot activate. Provider credentials remain password fields and only the saved last-four hint is displayed. Search-by-meaning remains service-provided, independent of chat's source.

## Verification — 2026-10-04

All work ran against isolated Supabase QA snapshots, never a production deployment.

- `corepack pnpm qa:supabase web typecheck` passed, final snapshot `3cf0323dd9ea-1791129414015-web`.
- `corepack pnpm qa:supabase web prepare`, then from staged `source/apps/web`: `corepack pnpm exec vitest run lib/theme-picker.test.ts lib/ai-setup.test.ts lib/ai-mode.test.ts lib/server/settings-patch.test.ts lib/auth-policy.test.ts lib/auth.test.ts lib/app-layout.test.ts` — **7 files, 68 tests passed**, snapshot `3cf0323dd9ea-1791129413421-web`.
- `corepack pnpm qa:supabase web build` passed, final snapshot `3cf0323dd9ea-1791129441536-web`, log `.work/theme-picker/final-build.log`. One earlier build hit an existing Google next/font loader error; its retry and the final build both passed. No fonts or dependencies were changed.
- Chrome UI: Bubblegum light/dark on auth, Catppuccin on homepage, Claude on signed-in app; colors changed outside the picker. Bricolage Grotesque heading font stayed identical. Bubblegum browser meta color matched background (`#f6e6ee` light, `#12242e` dark).
- Reload, real homepage/auth navigation, and a second tab all preserved/synchronized selection. Default restored dark background `.145`, primary `.922`, sidebar-primary `.488 .243 264.376`, and radius `.625rem` exactly. Neo Brutalism produced 0px control corners. Escape closed the popover and returned focus to Theme. Empty search displayed a clear result.
- Actual CSS widths **320, 375, 414, 768**: no horizontal overflow; theme panel stayed within the viewport. AI modal setup and Save controls remained reachable through its scrolling pane. Browser zoom was accounted for by verifying `innerWidth`, rather than assuming override pixels equal CSS pixels.
- Signed-in existing QA fixture: settings/add-bookmark dialogs hid the picker and closing restored it. Overlay/full chat hid it; at 1280 CSS px, side-docked chat began at x896 and the Theme button ended at x880, preserving a 16px gap from chat/composer. No chat message or bookmark was submitted.
- AI settings: no-key Included status loaded, own-provider panel changed independently, Save stayed disabled without a complete key source. A placeholder new Google key remained unsaved with the verification guard shown. Custom manual model setup retained explicit unverified status. Returning to Included hid provider fields and preserved Active: included AI. No settings writes or provider calls occurred. The test fixture's localhost session was signed out locally afterward; appearance returned to its original Default/System.
- No theme hydration errors were observed. Chrome logged unrelated “Receiving end does not exist” extension connection errors. Authenticated data checks used localhost to match the QA public API origin; 127.0.0.1 was used for separate appearance checks.

Evidence screenshots are in `.work/theme-picker/screenshots`: `bubblegum-auth.png`, `catppuccin-home-320.png`, `ai-source-desktop.png`, `ai-source-mobile-320.png`, `ai-source-final-included.png`, and `named-picker-final-home.png`.

Limitations: this is desktop Chrome with responsive viewport overrides, not physical mobile/native theme QA. Saved-key activation, verification errors, and backend save failures are covered by meaningful request/completeness and existing server semantics tests, but were not exercised with real provider credentials in the browser. Bulk-selection suppression was source-reviewed but not runtime-tested because the fixture library was empty. Native auth release and production cutover are separate work.
