import Foundation

/// What the sidebar can select. Codable + Hashable so it works as a `List`
/// selection value and can later be persisted with `@SceneStorage`.
enum SidebarItem: Hashable, Codable, Identifiable, Sendable {
    case allBookmarks
    case chat
    case sessions
    case liveTabs
    case category(String)
    case tag(String)

    var id: String {
        switch self {
        case .allBookmarks: "all"
        case .chat: "chat"
        case .sessions: "sessions"
        case .liveTabs: "live"
        case .category(let name): "category:\(name)"
        case .tag(let name): "tag:\(name)"
        }
    }

    /// The window title for this selection.
    var title: String {
        switch self {
        case .allBookmarks: "All Bookmarks"
        case .chat: "Ask AI"
        case .sessions: "Sessions"
        case .liveTabs: "Live Tabs"
        // Categories arrive already display-cased from the server ("AI & ML",
        // "Docs & Reference"). Do NOT `.capitalized` them — that would render
        // "AI & ML" as "Ai & Ml".
        case .category(let name): name
        case .tag(let name): "#\(name)"
        }
    }

    var symbolName: String {
        switch self {
        case .allBookmarks: "bookmark"
        case .chat: "sparkles"
        case .sessions: "rectangle.stack"
        case .liveTabs: "dot.radiowaves.left.and.right"
        case .category: "folder"
        case .tag: "number"
        }
    }

    /// True for the selections whose detail is the bookmark library (and whose
    /// change should reload it). The feature views manage their own data.
    var isLibraryFilter: Bool {
        switch self {
        case .allBookmarks, .category, .tag: true
        case .chat, .sessions, .liveTabs: false
        }
    }

    /// Query parameters this selection maps to on `GET /api/bookmarks`.
    var categoryFilter: String? {
        if case .category(let name) = self { return name }
        return nil
    }

    var tagFilter: String? {
        if case .tag(let name) = self { return name }
        return nil
    }
}
