import { z } from "zod";

/**
 * The MCP (Model Context Protocol) server surface: `POST /api/mcp` exposes a
 * fixed set of tools to external agents, authenticated with long-lived `bkmcp_`
 * bearer tokens that the user mints in Settings.
 */

/** Every tool the MCP server can expose. The per-user config is an allowlist
 * drawn from this set; anything outside it is rejected at write time so a stale
 * client can't persist an unknown name (and NULL/absent = all of these). */
export const MCP_TOOL_NAMES = [
  "search_bookmarks",
  "save_bookmark",
  "list_bookmarks",
  "get_library_overview",
] as const;
export const mcpToolNameSchema = z.enum(MCP_TOOL_NAMES);
export type McpToolName = z.infer<typeof mcpToolNameSchema>;

/**
 * Parse a stored `user_settings.mcp_tools_json` value into an allowlist. The ONE
 * implementation of this rule, shared by the MCP endpoint and the settings API:
 * null (never configured) or anything malformed → null, meaning ALL tools are
 * enabled; otherwise the stored names filtered against MCP_TOOL_NAMES, so a name
 * we no longer ship can't be resurrected by an old row.
 */
export function parseMcpToolAllowlist(json: string | null): McpToolName[] | null {
  if (json == null) return null;
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) return null;
    return MCP_TOOL_NAMES.filter((name) => parsed.includes(name));
  } catch {
    return null;
  }
}

/** One registered token as the management API reports it. The token VALUE is
 * returned exactly once, by the mint call — never here. `hint` is the only
 * fragment that persists: `bkmcp_xxxxx…xxxxx` (first/last 5 chars of the token
 * body, see apps/web/lib/server/mcp-token.ts `mcpTokenHint`), which identifies
 * WHICH token a row is without being usable as one. It is null for tokens minted
 * before tenant migration v11 added the column — the UI renders nothing then,
 * and no backfill is possible because the value was never stored. */
export const mcpTokenSchema = z.object({
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  hint: z.string().nullable(),
});
export type McpToken = z.infer<typeof mcpTokenSchema>;

export const listMcpTokensResponseSchema = z.object({ tokens: z.array(mcpTokenSchema) });
export type ListMcpTokensResponse = z.infer<typeof listMcpTokensResponseSchema>;

/** POST /api/mcp/tokens body — a human label for the client this token is for. */
export const createMcpTokenSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60),
});
export type CreateMcpTokenInput = z.infer<typeof createMcpTokenSchema>;

/** POST /api/mcp/tokens response — `token` is the ONLY time the secret value is
 * ever transmitted; it is not recoverable afterwards. */
export const createMcpTokenResponseSchema = z.object({
  token: z.string(),
  id: z.string(),
  name: z.string(),
  createdAt: z.string(),
});
export type CreateMcpTokenResponse = z.infer<typeof createMcpTokenResponseSchema>;
