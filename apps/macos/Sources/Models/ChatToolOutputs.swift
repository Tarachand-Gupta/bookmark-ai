import Foundation

// ── Chat tool outputs ────────────────────────────────────────────────────────
//
// The list-shaped tools of the Ask AI agent (`searchBookmarks`, `queryDatabase`,
// `listSessions`, `listLiveTabs`) each return ONE PAGE plus a `page` object —
// the contract in docs/features/chat-tool-paging.md, shared with the web and
// mobile cards through `packages/types/src/chat-tool-cards.ts`. These are the
// Swift mirrors of those shapes. Every field the server could omit (older
// stored turns, a newer server) is optional, so a transcript from any era
// decodes; the cards read through the lenient accessors below.

/// Where a page sits in the whole result — the tail of every list tool output.
struct ToolPageMeta: Codable, Hashable, Sendable {
    /// Full count, or nil when the source can't cheaply know (ranked search).
    var total: Int?
    var offset: Int
    var limit: Int
    var hasMore: Bool
    /// The `offset` that fetches the next page; nil at the end.
    var nextOffset: Int?

    /// Rows per page, and the maximum a tool call may ask for (`TOOL_PAGE_LIMIT`).
    static let pageLimit = 50
}

// MARK: searchBookmarks

struct BookmarkHit: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var title: String?
    var url: String
    var category: String?
    var tags: [String]?
    /// `YYYY-MM-DD` of the save.
    var day: String?
    var score: Double?

    var displayTitle: String {
        if let title, !title.trimmingCharacters(in: .whitespaces).isEmpty { return title }
        return url
    }
    var tagList: [String] { tags ?? [] }
}

struct SearchToolOutput: Codable, Hashable, Sendable {
    /// Echoed so the card's "Load more" can re-run the same search.
    var query: String?
    var mode: String?
    var fallback: Bool?
    var results: [BookmarkHit]?
    var page: ToolPageMeta?

    var hits: [BookmarkHit] { results ?? [] }
}

// MARK: queryDatabase

struct SqlToolOutput: Codable, Hashable, Sendable {
    /// Echoed so the card's "Load more" can re-run the same SELECT.
    var sql: String?
    var columns: [String]?
    var rows: [[JSONValue]]?
    var rowCount: Int?
    /// A long cell was clipped server-side.
    var truncated: Bool?
    var error: String?
    var page: ToolPageMeta?
}

/// `POST /api/query` — the SQL card's "Load more" (no recount: `page.total` is null).
struct ChatQueryPageResponse: Codable, Sendable {
    var columns: [String]
    var rows: [[JSONValue]]
    var rowCount: Int?
    var truncated: Bool?
    var page: ToolPageMeta
}

// MARK: listSessions

struct SessionTabHit: Codable, Hashable, Sendable {
    var title: String?
    var url: String

    var displayTitle: String {
        if let title, !title.trimmingCharacters(in: .whitespaces).isEmpty { return title }
        return url
    }
}

struct SessionHit: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var name: String
    var description: String?
    var tabCount: Int?
    var browser: String?
    var savedAt: String?
    /// At most 15 per session on the wire; `tabCount` is the real size.
    var tabs: [SessionTabHit]?

    var tabList: [SessionTabHit] { tabs ?? [] }
}

struct SessionsToolOutput: Codable, Hashable, Sendable {
    var query: String?
    var sessions: [SessionHit]?
    var page: ToolPageMeta?
    /// Legacy field from turns stored before paging shipped.
    var total: Int?

    var hits: [SessionHit] { sessions ?? [] }
}

// MARK: listLiveTabs

/// One live tab as the tool compacts it (favicon kept for the CARD only).
struct LiveTabHit: Codable, Hashable, Sendable {
    var title: String?
    var url: String
    var favIconUrl: String?

    var displayTitle: String {
        if let title, !title.trimmingCharacters(in: .whitespaces).isEmpty { return title }
        return url
    }
}

/// One open window on a device. `index` is the 1-based display order; `windowId`
/// is the browser's own id (display grouping only, never a key).
struct LiveWindowHit: Codable, Hashable, Sendable {
    var windowId: Int?
    var name: String?
    var index: Int?
    /// Tabs this window has in total — a paged group still says "12 of 34".
    var windowTabCount: Int?
    var tabs: [LiveTabHit]?

    var tabList: [LiveTabHit] { tabs ?? [] }

    func displayName(fallbackIndex: Int) -> String {
        if let name, !name.trimmingCharacters(in: .whitespaces).isEmpty { return name }
        return "Window \(index ?? fallbackIndex)"
    }
}

struct LiveDeviceHit: Codable, Hashable, Sendable {
    var label: String
    var browser: String?
    var lastSeenAgeSeconds: Int?
    /// Tabs open on this device in total (ignores the filter and the page).
    var tabCount: Int?
    /// Tabs on this device matching the tool's `query` (ignores the page).
    var matchingTabCount: Int?
    /// Tabs this device is NOT sharing, per its live-sharing rules.
    var hiddenTabCount: Int?
    var windows: [LiveWindowHit]?

    var windowList: [LiveWindowHit] { windows ?? [] }
}

/// `{enabled:false}` = sharing off, `{error}` = unavailable, else the devices.
struct LiveTabsToolOutput: Codable, Hashable, Sendable {
    var enabled: Bool?
    var error: String?
    var query: String?
    var devices: [LiveDeviceHit]?
    var page: ToolPageMeta?

    var deviceList: [LiveDeviceHit] { devices ?? [] }
}

// MARK: - Decoding from the untyped part

extension JSONValue {
    /// Re-encode this JSON and decode it as `T`. The transcript keeps tool
    /// output untyped (it must round-trip to the server verbatim), so the cards
    /// project it on demand; a shape this build can't read yields nil, never a
    /// crash.
    func decoded<T: Decodable>(_ type: T.Type) -> T? {
        guard let data = try? JSONEncoder().encode(self) else { return nil }
        return try? ApiClient.decoder.decode(T.self, from: data)
    }
}

extension ChatToolCall {
    /// Output landed and the tool considers it a success — the only state a
    /// list card renders from (the `{error}` shape is the row's business).
    var hasSettledOutput: Bool { state == .outputAvailable && output != nil && !isFailure }

    var searchOutput: SearchToolOutput? {
        guard name == "searchBookmarks", hasSettledOutput else { return nil }
        return output?.decoded(SearchToolOutput.self)
    }

    var sqlOutput: SqlToolOutput? {
        guard name == "queryDatabase", hasSettledOutput else { return nil }
        return output?.decoded(SqlToolOutput.self)
    }

    /// The SQL the tool ran — readable while it streams and when it fails.
    var sqlText: String? {
        guard name == "queryDatabase" else { return nil }
        let text = input?["sql"]?.stringValue ?? output?["sql"]?.stringValue
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return text
    }

    var sessionsOutput: SessionsToolOutput? {
        guard name == "listSessions", hasSettledOutput else { return nil }
        return output?.decoded(SessionsToolOutput.self)
    }

    /// Live tabs render from ANY settled output: `{enabled:false}` is a card
    /// note, not a failure.
    var liveTabsOutput: LiveTabsToolOutput? {
        guard name == "listLiveTabs", state == .outputAvailable, let output else { return nil }
        return output.decoded(LiveTabsToolOutput.self)
    }
}
