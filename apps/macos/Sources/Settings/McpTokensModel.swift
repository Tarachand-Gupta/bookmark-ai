import Foundation
import Observation

/// MCP access tokens (`/api/mcp/tokens`) for Settings ▸ MCP: the list, the
/// mint flow with its one-time reveal, and revocation. Clerk-session only on
/// the server — in Local mode the dev server's `DEV_OPEN_API=1` stands in for
/// the session; without it the list call 401s and the tab says so.
@MainActor
@Observable
final class McpTokensModel {

    private(set) var tokens: [McpToken] = []
    private(set) var isLoading = false
    private(set) var hasLoaded = false
    private(set) var loadError: String?

    private(set) var isMinting = false
    /// The just-minted secret, in memory only until the user dismisses it or
    /// revokes THAT token. Seeds the client-setup snippets while present.
    private(set) var fresh: CreateMcpTokenResponse?

    private(set) var revokingId: String?
    /// The row whose Revoke button has been pressed once (inline confirm).
    var confirmingRevokeId: String?
    private(set) var actionError: String?

    private let api: ApiClient

    init(api: ApiClient) {
        self.api = api
    }

    var activeTokens: [McpToken] { tokens.filter { !$0.isRevoked } }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        do {
            tokens = try await api.listMcpTokens().tokens
            loadError = nil
        } catch {
            loadError = Self.describe(error)
        }
        hasLoaded = true
    }

    /// `POST /api/mcp/tokens`. On success the secret lands in `fresh`.
    func mint(name: String) async {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !isMinting else { return }
        isMinting = true
        actionError = nil
        fresh = nil
        defer { isMinting = false }
        do {
            fresh = try await api.createMcpToken(name: trimmed)
            await load()
        } catch {
            actionError = Self.describe(error)
        }
    }

    /// `DELETE /api/mcp/tokens/:id` (404 tolerated by the client).
    func revoke(id: String) async {
        revokingId = id
        actionError = nil
        defer {
            revokingId = nil
            confirmingRevokeId = nil
        }
        do {
            try await api.revokeMcpToken(id: id)
            // The show-once card is that token's secret — a revoked one must not
            // stay on screen (or keep seeding the setup snippets).
            if fresh?.id == id { fresh = nil }
            await load()
        } catch {
            actionError = Self.describe(error)
        }
    }

    func dismissFresh() {
        fresh = nil
    }

    #if DEBUG
    /// Previews/tests: a loaded list (and optionally a just-minted token)
    /// without a server.
    func seed(tokens: [McpToken], fresh: CreateMcpTokenResponse? = nil) {
        self.tokens = tokens
        self.fresh = fresh
        hasLoaded = true
        loadError = nil
    }
    #endif

    func reset() {
        tokens = []
        hasLoaded = false
        loadError = nil
        fresh = nil
        revokingId = nil
        confirmingRevokeId = nil
        actionError = nil
    }

    static func describe(_ error: Error) -> String {
        switch error as? ApiError {
        case .unauthorized, .forbidden:
            return "Token management needs a signed-in session. In Local mode, run the dev server with DEV_OPEN_API=1; in Cloud mode, sign in from Settings ▸ Account."
        case .server(status: 503, let message):
            return message
        default:
            return (error as? ApiError)?.errorDescription ?? error.localizedDescription
        }
    }
}
