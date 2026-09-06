import Foundation
import Observation

/// How the browse list is ordered. Sorting is client-side (the API returns
/// newest-first) and applies to BROWSING only — search results stay in
/// relevance order, which is their whole point.
enum LibrarySort: String, CaseIterable, Identifiable, Sendable {
    case newestFirst
    case oldestFirst
    case titleAZ

    var id: String { rawValue }

    var title: String {
        switch self {
        case .newestFirst: "Newest First"
        case .oldestFirst: "Oldest First"
        case .titleAZ: "Title (A–Z)"
        }
    }
}

/// The library's view state: the current filter, the rows it produced, the
/// facets that populate the sidebar, and any in-flight search.
///
/// Reads go through `ApiClient`; this type owns cancellation and error
/// presentation so the views stay declarative.
@MainActor
@Observable
final class LibraryModel {

    // Content
    private(set) var bookmarks: [Bookmark] = []
    private(set) var total = 0
    private(set) var meta = MetaResponse.empty

    // Search — `searchText` is bound by `.searchable`, so it must be settable.
    var searchText = ""
    private(set) var searchResults: [SearchResult]?
    /// True when an AI/hybrid search silently degraded to full-text server-side.
    private(set) var searchFellBack = false

    // Selection
    var selection: SidebarItem = .allBookmarks

    // Filters + sort. Browser/device are orthogonal to the sidebar selection
    // (same facets the web sidebar offers); setting either reloads.
    var browserFilter: String? {
        didSet { if browserFilter != oldValue { Task { await refresh() } } }
    }
    var deviceFilter: String? {
        didSet { if deviceFilter != oldValue { Task { await refresh() } } }
    }
    var sort: LibrarySort = .newestFirst

    var hasActiveFilters: Bool { browserFilter != nil || deviceFilter != nil }

    func clearFilters() {
        // Each didSet fires a refresh; the second cancels the first via
        // `loadTask` so only one request survives.
        browserFilter = nil
        deviceFilter = nil
    }

    // Status
    private(set) var isLoading = false
    private(set) var isSearching = false
    private(set) var errorMessage: String?
    private(set) var errorHint: String?

    private let api: ApiClient
    private var loadTask: Task<Void, Never>?
    private var searchTask: Task<Void, Never>?

    init(api: ApiClient) {
        self.api = api
    }

    /// What the list should actually show: search results when a query is active
    /// (in relevance order — never re-sorted), otherwise the filtered library in
    /// the chosen sort order.
    var visibleBookmarks: [Bookmark] {
        if let searchResults { return searchResults.map(\.bookmark) }
        switch sort {
        case .newestFirst:
            return bookmarks // the API's own order
        case .oldestFirst:
            return bookmarks.reversed()
        case .titleAZ:
            return bookmarks.sorted {
                $0.displayTitle.localizedCaseInsensitiveCompare($1.displayTitle) == .orderedAscending
            }
        }
    }

    var isShowingSearchResults: Bool { searchResults != nil }

    var subtitle: String {
        if isShowingSearchResults {
            let count = searchResults?.count ?? 0
            return "\(count) result\(count == 1 ? "" : "s") for “\(searchText)”"
        }
        return "\(total) bookmark\(total == 1 ? "" : "s")"
    }

    // MARK: - Loading

    /// Reload the facets and the current filter's rows. Cancels any in-flight load.
    func refresh() async {
        loadTask?.cancel()
        let task = Task { @MainActor in
            await self.performRefresh()
        }
        loadTask = task
        await task.value
    }

    private func performRefresh() async {
        isLoading = true
        defer { isLoading = false }
        clearError()

        // The facets and the list are independent reads — fetch them together so
        // a refresh costs one round-trip's latency, not two.
        async let metaResult = api.meta()
        async let listResult = api.listBookmarks(
            category: selection.categoryFilter,
            tag: selection.tagFilter,
            browser: browserFilter,
            device: deviceFilter,
            limit: 200
        )

        do {
            let (fetchedMeta, fetchedList) = try await (metaResult, listResult)
            guard !Task.isCancelled else { return }
            meta = fetchedMeta
            bookmarks = fetchedList.bookmarks
            total = fetchedList.total
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            present(error)
        }
    }

    /// Change the sidebar selection. For library filters this reloads and clears
    /// any active search (a search is global — mixing it with a facet filter
    /// would misrepresent both). The feature views (chat, sessions, live) own
    /// their own data, so selecting them only moves the selection.
    func select(_ item: SidebarItem) async {
        guard item != selection else { return }
        selection = item
        guard item.isLibraryFilter else { return }
        searchText = ""
        searchResults = nil
        await refresh()
    }

    // MARK: - Search

    /// Run a hybrid search, or clear results when the query is empty.
    /// Callers debounce (the view uses `.task(id:)`); this only cancels overlap.
    func search(_ query: String) async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        searchTask?.cancel()

        guard !trimmed.isEmpty else {
            searchResults = nil
            searchFellBack = false
            isSearching = false
            clearError()
            return
        }

        let task = Task { @MainActor in
            self.isSearching = true
            defer { self.isSearching = false }
            self.clearError()
            do {
                // hybrid = RRF blend of full-text and vector, same as the web grid
                // and mobile. 40 is under the server's max of 50.
                let response = try await self.api.search(query: trimmed, mode: .hybrid, limit: 40)
                guard !Task.isCancelled else { return }
                self.searchResults = response.results
                self.searchFellBack = response.fallback ?? false
            } catch is CancellationError {
                return
            } catch {
                guard !Task.isCancelled else { return }
                self.present(error)
            }
        }
        searchTask = task
        await task.value
    }

    // MARK: - Mutations

    func delete(_ bookmark: Bookmark) async {
        do {
            try await api.deleteBookmark(id: bookmark.id)
            bookmarks.removeAll { $0.id == bookmark.id }
            searchResults?.removeAll { $0.bookmark.id == bookmark.id }
            total = max(0, total - 1)
        } catch {
            present(error)
        }
    }

    #if DEBUG
    /// Tests/previews: facets, totals and rows without a server.
    func seed(meta: MetaResponse, bookmarks: [Bookmark] = []) {
        self.meta = meta
        self.bookmarks = bookmarks
        total = meta.total
    }
    #endif

    /// Drop everything and reload — used when the server target changes and on
    /// every sign-out, so no row from the old backend or account can survive.
    func reset() {
        loadTask?.cancel()
        searchTask?.cancel()
        bookmarks = []
        searchResults = nil
        total = 0
        meta = .empty
        searchText = ""
        selection = .allBookmarks
        clearError()
    }

    // MARK: - Errors

    private func present(_ error: Error) {
        if let apiError = error as? ApiError {
            errorMessage = apiError.errorDescription
            errorHint = apiError.recoveryHint
        } else {
            errorMessage = error.localizedDescription
            errorHint = nil
        }
    }

    private func clearError() {
        errorMessage = nil
        errorHint = nil
    }
}
