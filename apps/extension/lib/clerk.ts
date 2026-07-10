/**
 * Clerk config for the extension. Only PUBLIC values live here — the secret
 * key must never ship in an extension bundle.
 *
 * The publishable key is public by design (the web app serves it to every
 * visitor), so a baked-in default keeps fresh clones building with auth
 * working. Override either value in `apps/extension/.env` (see .env.example).
 */
export const CLERK_PUBLISHABLE_KEY: string =
  import.meta.env.WXT_CLERK_PUBLISHABLE_KEY ||
  "pk_test_ZGFybGluZy1iYWJvb24tMTMuY2xlcmsuYWNjb3VudHMuZGV2JA";

/**
 * Origin whose Clerk session the extension mirrors (syncHost pattern): the
 * user signs in on the web app; the extension reads that session via the
 * cookies permission. Cookies are not port-scoped, so plain localhost covers
 * the dev web app on :3000. Requires a matching host_permissions entry.
 */
export const CLERK_SYNC_HOST: string =
  import.meta.env.WXT_CLERK_SYNC_HOST || "http://localhost";
