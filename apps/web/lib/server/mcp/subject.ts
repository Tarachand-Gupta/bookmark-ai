/**
 * The `sub` an MCP token is bound to, and the `user_settings` key its tool config
 * lives under. Normally the Clerk user id; `"local"` in the open/self-host modes
 * (no Clerk user), which mirrors the `settingsKey()` sentinel that
 * app/api/settings/route.ts uses so a single-user install shares ONE settings row
 * across every surface.
 */
export const MCP_LOCAL_SUBJECT = "local";

export function mcpSubject(userId: string | null): string {
  return userId ?? MCP_LOCAL_SUBJECT;
}

/** True when this subject is a real Clerk user (and so can own a tenant DB). The
 * open-mode sentinel never routes to a tenant — it uses the shared/local DB. */
export function isClerkSubject(subject: string): boolean {
  return subject !== MCP_LOCAL_SUBJECT;
}
