import Foundation

/// One tab within a saved session. `url` is deliberately a plain string — a
/// snapshot legitimately contains browser-internal pages (chrome://, about:…),
/// and only http(s) URLs are ever rendered as openable (see `openableURL`).
struct SessionTab: Codable, Hashable, Sendable {
    var url: String
    var title: String?
    var favIconUrl: String?
    var windowId: Int?
}

/// A saved browser-tab snapshot, mirroring `sessionSchema` in `packages/types`.
struct Session: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var name: String
    var tabs: [SessionTab]
    var tabCount: Int
    /// AI's 1–2 sentence read of what the tab group was about; null until the
    /// post-save summarizer has run (or when no AI key is configured).
    var description: String?
    var browser: String
    var device: String
    var os: String?
    var savedAt: String
    var createdAt: String
}

/// `GET /api/sessions`.
struct ListSessionsResponse: Codable, Sendable {
    var sessions: [Session]
}

extension SessionTab {
    /// Only http(s) may open — everything else (chrome://, about:, extension
    /// pages) renders as text. Mirrors the render-layer rule in the web app.
    var openableURL: URL? {
        guard let url = URL(string: url), let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https"
        else { return nil }
        return url
    }

    var displayTitle: String {
        if let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return title }
        return url
    }

    /// Best favicon: the captured one, else the tab origin's conventional path.
    var faviconURL: URL? {
        if let favIconUrl, let url = URL(string: favIconUrl), url.scheme != nil { return url }
        guard let host = openableURL?.host() else { return nil }
        return URL(string: "https://\(host)/favicon.ico")
    }
}

extension Session {
    var savedAtDate: Date? { ISO8601.date(from: savedAt) }

    /// The tabs a "Open All" may actually open.
    var openableTabs: [SessionTab] { tabs.filter { $0.openableURL != nil } }
}
