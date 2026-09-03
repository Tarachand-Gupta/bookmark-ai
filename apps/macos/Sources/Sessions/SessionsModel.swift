import Foundation
import Observation

/// How the sessions list is ordered. Client-side; newest first is the API's
/// own order.
enum SessionsSort: String, CaseIterable, Identifiable, Sendable {
    case newestFirst
    case oldestFirst
    case nameAZ
    case mostTabs

    var id: String { rawValue }

    var title: String {
        switch self {
        case .newestFirst: "Newest First"
        case .oldestFirst: "Oldest First"
        case .nameAZ: "Name (A–Z)"
        case .mostTabs: "Most Tabs"
        }
    }
}

/// The Sessions view's state: the saved snapshots, load status, search/sort,
/// and mutations.
@MainActor
@Observable
final class SessionsModel {

    private(set) var sessions: [Session] = [] {
        didSet { applyFilter() }
    }

    /// The searchable field's LIVE draft. Filtering runs against `appliedQuery`
    /// only — the view debounces keystrokes into `commitSearch()`, so typing
    /// never re-filters (and never re-renders the whole card list) per key.
    var query = ""

    /// The query the visible list was actually built from.
    private(set) var appliedQuery = ""

    var sort: SessionsSort = .newestFirst {
        didSet { applyFilter() }
    }

    /// Stored, not computed: recomputed only when its inputs change, instead of
    /// on every view pass — the computed version made typing visibly lag.
    private(set) var visibleSessions: [Session] = []

    var isSearching: Bool {
        !appliedQuery.trimmingCharacters(in: .whitespaces).isEmpty
    }

    /// Debounced landing point for the searchable draft.
    func commitSearch() {
        guard appliedQuery != query else { return }
        appliedQuery = query
        applyFilter()
    }

    /// Whether one tab matches the applied query — the cards use this to
    /// surface matching tabs (same rule Live Tabs applies).
    func matches(_ tab: SessionTab) -> Bool {
        TermFilter.matches("\(tab.title ?? "") \(tab.url)", query: appliedQuery)
    }

    private func applyFilter() {
        visibleSessions = Self.filter(sessions, query: appliedQuery, sort: sort)
    }

    /// Pure so the tests can pin it: term-match over name + AI summary + tab
    /// titles/URLs (the server's session-search targets), then client sort.
    nonisolated static func filter(_ sessions: [Session], query: String, sort: SessionsSort) -> [Session] {
        let filtered = query.trimmingCharacters(in: .whitespaces).isEmpty
            ? sessions
            : sessions.filter { session in
                let haystack = ([session.name, session.description ?? ""]
                    + session.tabs.flatMap { [$0.title ?? "", $0.url] })
                    .joined(separator: " ")
                return TermFilter.matches(haystack, query: query)
            }
        switch sort {
        case .newestFirst: return filtered
        case .oldestFirst: return filtered.reversed()
        case .nameAZ:
            return filtered.sorted {
                $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
            }
        case .mostTabs: return filtered.sorted { $0.tabCount > $1.tabCount }
        }
    }
    private(set) var isLoading = false
    private(set) var errorMessage: String?
    private(set) var errorHint: String?
    /// At least one successful load — distinguishes "empty" from "not asked yet".
    private(set) var loaded = false

    private let api: ApiClient
    private var loadTask: Task<Void, Never>?

    init(api: ApiClient) {
        self.api = api
    }

    func load() async {
        loadTask?.cancel()
        let task = Task { @MainActor in
            self.isLoading = true
            defer { self.isLoading = false }
            self.errorMessage = nil
            self.errorHint = nil
            do {
                let response = try await self.api.listSessions()
                guard !Task.isCancelled else { return }
                self.sessions = response.sessions
                self.loaded = true
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                self.present(error)
            }
        }
        loadTask = task
        await task.value
    }

    func delete(_ session: Session) async {
        do {
            try await api.deleteSession(id: session.id)
            sessions.removeAll { $0.id == session.id }
        } catch {
            present(error)
        }
    }

    func rename(_ session: Session, to name: String) async {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed != session.name else { return }
        do {
            let updated = try await api.renameSession(id: session.id, name: trimmed)
            replace(updated)
        } catch {
            present(error)
        }
    }

    /// AI retitle + description. Tracked per-session so the card can show its
    /// own spinner without freezing the rest of the list.
    private(set) var summarizingId: String?

    func summarize(_ session: Session) async {
        summarizingId = session.id
        defer { summarizingId = nil }
        do {
            let updated = try await api.summarizeSession(id: session.id)
            replace(updated)
        } catch {
            present(error)
        }
    }

    private func replace(_ session: Session) {
        if let index = sessions.firstIndex(where: { $0.id == session.id }) {
            sessions[index] = session
        }
    }

    func reset() {
        loadTask?.cancel()
        query = ""
        appliedQuery = ""
        sort = .newestFirst
        sessions = []
        loaded = false
        isLoading = false
        errorMessage = nil
        errorHint = nil
    }

    private func present(_ error: Error) {
        if let apiError = error as? ApiError {
            errorMessage = apiError.errorDescription
            errorHint = apiError.recoveryHint
        } else {
            errorMessage = error.localizedDescription
            errorHint = nil
        }
    }
}
