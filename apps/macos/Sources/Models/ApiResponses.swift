import Foundation

/// `GET /api/bookmarks` → `{bookmarks, total}`.
struct ListBookmarksResponse: Codable, Sendable {
    var bookmarks: [Bookmark]
    var total: Int
}

/// One `{name, count}` facet row from `/api/meta`.
struct Facet: Codable, Hashable, Sendable, Identifiable {
    var name: String
    var count: Int
    var id: String { name }
}

/// One `{day, count}` row from `/api/meta` (`day` is `YYYY-MM-DD`).
struct DayFacet: Codable, Hashable, Sendable, Identifiable {
    var day: String
    var count: Int
    var id: String { day }
}

/// `GET /api/meta` → sidebar facets + the tag rail.
struct MetaResponse: Codable, Sendable {
    var categories: [Facet]
    var browsers: [Facet]
    var devices: [Facet]
    var days: [DayFacet]
    var tags: [Facet]
    var total: Int

    static let empty = MetaResponse(
        categories: [], browsers: [], devices: [], days: [], tags: [], total: 0
    )
}

/// One `/api/search` hit. `exact` is hybrid-mode only: true when the keyword
/// (full-text) list found it, which is how clients section "matches" vs "related".
struct SearchResult: Codable, Sendable, Identifiable {
    var bookmark: Bookmark
    var score: Double
    var exact: Bool?
    var id: String { bookmark.id }
}

/// `GET /api/search`. `sessionResults` is deliberately NOT decoded in Phase 1 —
/// unknown keys are ignored, so adding it later is a purely additive change.
struct SearchResponse: Codable, Sendable {
    var mode: String
    var results: [SearchResult]
    /// Set when an AI/hybrid search silently fell back to full-text (no API key).
    var fallback: Bool?
    var offset: Int?
    var hasMore: Bool?
}

/// `GET /api/health` → liveness plus whether Gemini is configured.
struct HealthResponse: Codable, Sendable {
    var ok: Bool
    var ai: Bool
}

/// `GET /api/me` → the signed-in identity for the sidebar's account footer.
/// In open modes (keyless self-host / `DEV_OPEN_API=1`) the server reports
/// `signedIn: true` with null name/email — there is no Clerk user to look up.
struct AccountInfo: Codable, Sendable, Equatable {
    var signedIn: Bool
    var name: String?
    var email: String?

    /// What to show in the footer: real name → email → a generic local label.
    var displayName: String {
        if let name, !name.isEmpty { return name }
        if let email, !email.isEmpty { return email }
        return "Local account"
    }

    /// Secondary line — only when it adds information beyond `displayName`.
    var displayDetail: String? {
        guard let email, !email.isEmpty, email != displayName else { return nil }
        return email
    }
}

/// Search modes the API accepts. `hybrid` (RRF blend of FTS + vector) is what
/// the web grid and mobile use, and what this app's toolbar field uses.
enum SearchMode: String, Codable, CaseIterable, Sendable {
    case text
    case ai
    case hybrid
}

/// The free-tier weekly AI meter (`settings.aiUsage`). TOKENS on the wire; the
/// UI shows credits at 1,000 tokens each — see `AiCreditsCard`. Metering is
/// WEEKLY (resets Monday 00:00 UTC); copy built from this must never say monthly.
struct AiUsage: Codable, Hashable, Sendable {
    var usedTokens: Double
    var limitTokens: Double
    var resetsAt: String

    var usedCredits: Int { Int((usedTokens / 1000).rounded()) }
    var limitCredits: Int { Int((limitTokens / 1000).rounded()) }
    var percentUsed: Double {
        guard limitTokens > 0 else { return 0 }
        return min(100, usedTokens / limitTokens * 100)
    }
    var exhausted: Bool { usedTokens >= limitTokens && limitTokens > 0 }
}

/// `GET/PUT /api/settings` → `{settings}` — mirrors `userSettingsSchema` in
/// `packages/types`. The API never returns the stored key, only `apiKeySet` +
/// `apiKeyLast4` for a "Saved (••••1234)" hint. Fields this app doesn't render
/// yet still decode so the Settings form can round-trip without data loss.
struct UserSettings: Codable, Sendable {
    var provider: String
    var baseUrl: String?
    var model: String?
    var apiKeySet: Bool
    var apiKeyLast4: String?
    var liveServerUrl: String?
    var nativeSyncEnabled: Bool?
    var nativeSyncFull: Bool?
    /// null = never configured = every tool enabled (see `McpTool`).
    var mcpTools: [String]?
    var aiUsage: AiUsage?
}

struct SettingsResponse: Codable, Sendable {
    var settings: UserSettings
}

/// `PUT /api/settings` body. Synthesized Codable uses `encodeIfPresent`, which
/// is EXACTLY the server's contract: absent = keep, `""` = clear (apiKey and
/// liveServerUrl), any other string = set. `mcpTools` is always sent as a full
/// array when present (an all-names array behaves like the server's null =
/// "all tools", so explicit-null encoding is never needed).
struct UpdateSettingsBody: Codable, Sendable {
    var provider: String?
    var apiKey: String?
    var baseUrl: String?
    var model: String?
    var liveServerUrl: String?
    var nativeSyncEnabled: Bool?
    var nativeSyncFull: Bool?
    var mcpTools: [String]?
}

/// Every tool `POST /api/mcp` can expose — mirror of `MCP_TOOL_NAMES` in
/// `packages/types/src/mcp.ts`. The per-user config is an allowlist from this
/// set; a stored `mcpTools` of null/absent means ALL of these are enabled.
enum McpTool: String, CaseIterable, Identifiable, Sendable {
    case searchBookmarks = "search_bookmarks"
    case saveBookmark = "save_bookmark"
    case listBookmarks = "list_bookmarks"
    case getLibraryOverview = "get_library_overview"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .searchBookmarks: "Search bookmarks"
        case .saveBookmark: "Save a bookmark"
        case .listBookmarks: "List bookmarks"
        case .getLibraryOverview: "Library overview"
        }
    }

    var detail: String {
        switch self {
        case .searchBookmarks: "Full-text, semantic, or hybrid search over the library"
        case .saveBookmark: "Let a connected agent save new bookmarks"
        case .listBookmarks: "Browse/filter the raw bookmark list"
        case .getLibraryOverview: "Counts and facets (categories, tags, devices)"
        }
    }
}

/// `POST /api/settings/ai/models` — validate a key by listing that provider's
/// models. `apiKey` may be omitted to reuse the stored one.
struct AiModel: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var label: String
}

struct ListModelsResponse: Codable, Sendable {
    var models: [AiModel]
}

/// `PATCH /api/sessions/:id` and `POST /api/sessions/:id/ai-name` both return
/// the updated session (the ai-name route adds `name`/`description` echoes this
/// app doesn't need — unknown keys are ignored).
struct SessionEnvelope: Codable, Sendable {
    var session: Session
}
