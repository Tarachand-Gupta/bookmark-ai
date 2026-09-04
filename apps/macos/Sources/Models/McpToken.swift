import Foundation

/// One registered MCP token as `GET /api/mcp/tokens` reports it — mirror of
/// `mcpTokenSchema` in `packages/types/src/mcp.ts`. The token VALUE is never
/// here: it is transmitted exactly once, by the mint call (`CreateMcpTokenResponse`).
/// `hint` is `bkmcp_xxxxx…xxxxx` (first/last 5 chars, captured at mint time) so
/// a row can be matched to the credential sitting in some client's config; it
/// is null for tokens minted before the column existed.
struct McpToken: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var name: String
    var createdAt: String
    var lastUsedAt: String?
    var revokedAt: String?
    var hint: String?

    var isRevoked: Bool { revokedAt != nil }
}

struct ListMcpTokensResponse: Codable, Sendable {
    var tokens: [McpToken]
}

/// `POST /api/mcp/tokens` → `201`. `token` is the ONLY time the secret value
/// crosses the wire; nothing stores it and no other route can return it.
struct CreateMcpTokenResponse: Codable, Sendable, Equatable {
    var token: String
    var id: String
    var name: String
    var createdAt: String
}

/// The client-setup snippets Settings ▸ MCP offers — same text as the web's
/// `McpSection`, seeded with the just-minted token when there is one so the
/// user never has to substitute a placeholder that isn't there.
enum McpSnippets {
    static let tokenPlaceholder = "<YOUR_TOKEN>"

    /// `<base>/api/mcp` — the endpoint every client points at.
    static func endpoint(base: URL) -> String {
        base.absoluteString.trimmingSuffix("/") + "/api/mcp"
    }

    /// Claude Code — one command.
    static func claudeCodeCommand(endpoint: String, token: String?) -> String {
        "claude mcp add --transport http bookmark-ai \(endpoint) --header \"Authorization: Bearer \(token ?? tokenPlaceholder)\""
    }

    /// The `mcpServers` block any MCP client's config file accepts.
    static func jsonConfig(endpoint: String, token: String?) -> String {
        """
        {
          "mcpServers": {
            "bookmark-ai": {
              "type": "http",
              "url": "\(endpoint)",
              "headers": {
                "Authorization": "Bearer \(token ?? tokenPlaceholder)"
              }
            }
          }
        }
        """
    }
}

private extension String {
    func trimmingSuffix(_ suffix: String) -> String {
        hasSuffix(suffix) ? String(dropLast(suffix.count)) : self
    }
}
