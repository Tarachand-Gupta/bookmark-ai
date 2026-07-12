# @bookmark-ai/types — the API contract

Zod schemas that define every request and response shape the API speaks. This package
is **the single source of truth**: the server validates incoming bodies with these
schemas (`safeParse`), and every client (web, extension, mobile) imports the inferred
TypeScript types — so a shape change here is immediately type-checked across the whole
repo. Adding an API field always starts in this package.

Main exports:

| Schema / type | What |
| --- | --- |
| `CreateBookmarkInput` | what clients send to save: `{url, title?, browser?, device?, deviceName?, os?, savedAt?}` |
| `Bookmark` | the full stored shape: OG data + AI category/tags + `source` provenance + embedding flag |
| `ListBookmarksResponse`, `SearchResponse`, `MetaResponse` | GET endpoint responses |
| `SearchMode` | `"text" \| "ai"` |
| session schemas | saved-tab-snapshot shapes for `POST/GET /api/sessions` |

It never gets published to npm — apps depend on it as `"@bookmark-ai/types": "workspace:*"`,
which pnpm resolves to a **symlink** to this folder inside each app's `node_modules`.

House rule: **extensionless relative imports only** (no `./foo.js`) — Next.js's webpack
cannot resolve `.js` specifiers to `.ts` sources.
