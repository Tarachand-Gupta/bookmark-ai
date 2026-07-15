/**
 * Clerk config for the extension. Only PUBLIC values live here — the secret
 * key must never ship in an extension bundle.
 *
 * The publishable key is public by design (the web app serves it to every
 * visitor), so a baked-in default keeps fresh clones building with auth
 * working. Defaults target the PRODUCTION instance (`clerk.bookmark-ai.cloud`)
 * so the shipped extension mirrors sign-in on https://bookmark-ai.cloud out of
 * the box. For local development against the dev instance, override either
 * value in `apps/extension/.env` (see .env.example).
 */
export const CLERK_PUBLISHABLE_KEY: string =
  import.meta.env.WXT_CLERK_PUBLISHABLE_KEY ||
  "pk_live_Y2xlcmsuYm9va21hcmstYWkuY2xvdWQk";

/**
 * Origin whose Clerk session the extension mirrors (syncHost pattern): the
 * user signs in on the web app; the extension reads that session via the
 * cookies permission. Defaults to the production web origin; for local dev,
 * override to `http://localhost` (cookies are not port-scoped, so plain
 * localhost covers the dev web app on :3000). Requires a matching
 * host_permissions entry.
 */
export const CLERK_SYNC_HOST: string =
  import.meta.env.WXT_CLERK_SYNC_HOST || "https://bookmark-ai.cloud";
