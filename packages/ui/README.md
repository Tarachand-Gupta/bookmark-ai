# @bookmark-ai/ui — branding + shared components

The single source of the product's look:

- **`src/theme.css`** — every design token (colors, radii; currently the shadcn
  *neutral* palette in light + dark). The web app imports this file directly. Do
  **not** add tokens to `apps/web/app/globals.css` (the shadcn CLI tries to append
  duplicates there — delete them).
- **`src/BookmarkCard`** — the shared presentational bookmark card.

Consumers that can't import the CSS directly mirror the tokens instead:

- `apps/extension/assets/tailwind.css` — Tailwind theme mirroring these tokens
- `apps/mobile/src/theme.ts` — hex ports of these tokens for React Native
- the desktop app uses the Native SDK's stock tokens, following OS light/dark

If you retheme `theme.css`, update the mobile port manually.

Like every `packages/*` folder, this is a **workspace package** — apps import
`@bookmark-ai/ui` and pnpm symlinks it straight to this directory (no publishing, no
copies). Extensionless relative imports only (webpack gotcha).
