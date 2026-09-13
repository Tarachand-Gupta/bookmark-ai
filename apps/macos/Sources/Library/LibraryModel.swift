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
    /// True while the rows on screen came from the last session's disk cache
    /// and a network refresh is still in flight — the "syncing" pill's state.
    /// Flips false the moment the refresh settles (answers or fails).
    private(set) var isSyncingFromCache = false

    /// The last UNFILTERED All-Bookmarks list the server returned — what the
    /// disk snapshot persists, so a ⌘R pressed on a filtered view never writes
    /// the filtered slice over it. Nil until the first unfiltered refresh of
    /// the session lands; `cacheState` then falls back to the live rows.
    private var unfilteredBookmarks: [Bookmark]?
    private var unfilteredTotal: Int?

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
    /// While the screen still shows cached rows (`isSyncingFromCache`), a refresh
    /// must not raise the full-window loading state — the pill is the loading UI
    /// for that path.
    func refresh() async {
        loadTask?.cancel()
        let task = Task { @MainActor in
            await self.performRefresh()
        }
        loadTask = task
        await task.value
    }

    /// True when the visible content is cached data awaiting its first network
    /// refresh — the pill's condition, checked by the view.
    var showingCachedLibrary: Bool { isSyncingFromCache }

    private func performRefresh() async {
        let fromCache = isSyncingFromCache
        if fromCache {
            // The window already shows last session's library: keep it on
            // screen and let the pill carry the progress. Never flash the
            // whole-window spinner over rendered content.
            isLoading = false
        } else {
            isLoading = true
        }
        defer {
            isLoading = false
            // The pill rides exactly one background refresh: from launch until
            // the network answers (or gives up). Later refreshes (⌘R, a filter
            // change) have live rows on screen and don't re-arm it.
            isSyncingFromCache = false
        }
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
            // The snapshot persists the UNFILTERED All-Bookmarks state (what
            // the app always opens on) — capture it while the answer IS that
            // state, so a ⌘R pressed on a filtered view can never replace the
            // disk snapshot with the filtered slice.
            if selection == .allBookmarks && browserFilter == nil && deviceFilter == nil {
                unfilteredBookmarks = fetchedList.bookmarks
                unfilteredTotal = fetchedList.total
            }
            reconcile(rows: fetchedList.bookmarks)
            total = fetchedList.total
        } catch is CancellationError {
            return
        } catch {
            guard !Task.isCancelled else { return }
            // From cache or not, the error surfaces the same way: the overlay
            // only replaces an EMPTY list, so rows already on screen (cached
            // or live) stay there under the message.
            present(error)
        }
    }

    /// Swap in the freshly fetched rows WITHOUT tearing down the collection:
    /// bookmarks that survive keep their identity (same ids → same rows, so
    /// SwiftUI's lazy grid/list keeps its scroll position and cell state), new
    /// ones appear at the front (the API returns newest-first), removed ones
    /// disappear. Identical content is a no-op, so an unchanged library never
    /// re-renders at all.
    private func reconcile(rows fetched: [Bookmark]) {
        guard fetched != bookmarks else { return }
        // 1. Cached rows the server still carries, in their cached order —
        //    updated in place from the fetched copy.
        var fetchedById = Dictionary(uniqueKeysWithValues: fetched.map { ($0.id, $0) })
        var surviving: [Bookmark] = []
        surviving.reserveCapacity(min(fetched.count, bookmarks.count))
        for cached in bookmarks {
            if let updated = fetchedById.removeValue(forKey: cached.id) {
                surviving.append(updated)
            }
        }
        // 2. Everything else is new — at the FRONT, in the API's own order
        //    (newest-first), matching where the server would have put them.
        //    (`fetchedById` now maps only fetched rows the cache didn't have.)
        let fresh = fetched.filter { fetchedById[$0.id] != nil }
        bookmarks = fresh + surviving
    }

    /// Tests: the same in-place merge the refresh performs, without a server.
    func reconcileForTesting(rows fetched: [Bookmark]) {
        reconcile(rows: fetched)
    }

    /// Hydrate from the last session's disk snapshot BEFORE any network work,
    /// so the window's first paint shows real content. Returns whether a
    /// snapshot was applied (drives the pill). A snapshot from another server
    /// target is dropped, not shown.
    @discardableResult
    func hydrateFromCache(_ state: LibraryCacheState?, serverTarget: String) -> Bool {
        guard let state, state.serverTarget == serverTarget else { return false }
        guard !state.bookmarks.isEmpty || state.total > 0 || !state.meta.categories.isEmpty || !state.meta.tags.isEmpty
        else { return false }
        meta = state.meta
        bookmarks = state.bookmarks
        total = state.total
        isSyncingFromCache = true
        return true
    }

    /// The state worth persisting — the last UNFILTERED All-Bookmarks answer
    /// (the state the app always opens on), falling back to the live rows when
    /// no unfiltered refresh has happened yet this session (e.g. straight after
    /// a hydrate). `target` stamps the snapshot so a Local snapshot is never
    /// shown on Cloud; `sessions` fills in the Sessions page's part.
    func cacheState(serverTarget target: String, sessions: [Session]) -> LibraryCacheState {
        LibraryCacheState(
            serverTarget: target,
            bookmarks: unfilteredBookmarks ?? bookmarks,
            total: unfilteredTotal ?? total,
            meta: meta,
            sessions: sessions
        )
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
        isSyncingFromCache = false
        unfilteredBookmarks = nil
        unfilteredTotal = nil
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
