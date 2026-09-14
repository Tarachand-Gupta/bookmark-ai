import XCTest
@testable import BookmarkAI

/// The cold-start path (Tara's spec): the window renders LAST SESSION'S data
/// from the disk cache immediately, a small pill rides the background refresh,
/// and the refresh reconciles results into the same observable models without
/// tearing anything down. Also the dock-reopen decision (Bug 2).
@MainActor
final class ColdStartTests: XCTestCase {

    override func setUp() {
        super.setUp()
        AppDelegate.reopenNewWindow = nil
    }

    override func tearDown() {
        AppDelegate.reopenNewWindow = nil
        super.tearDown()
    }

    // MARK: - Fixtures

    private func makeBookmark(id: String, title: String = "Example") -> Bookmark {
        Bookmark(
            id: id, url: "https://example.com/\(id)", domain: "example.com",
            title: title, description: nil,
            og: OpenGraph(title: nil, description: nil, image: nil, siteName: nil, type: nil, url: nil, favicon: nil),
            source: BookmarkSource(browser: "chrome", device: "laptop", deviceName: "Mac", os: "macOS", savedAt: "2026-08-11T10:15:30Z"),
            category: "general", tags: [], createdAt: "2026-08-11T10:15:30Z", embedded: false
        )
    }

    private func makeSession(id: String) -> Session {
        Session(
            id: id, name: "Session \(id)", tabs: [], tabCount: 0, description: nil,
            browser: "chrome", device: "laptop", os: "macOS",
            savedAt: "2026-08-11T10:15:30Z", createdAt: "2026-08-11T10:15:30Z"
        )
    }

    private func makeCacheState(
        target: String = ServerTarget.cloud.rawValue,
        bookmarks: [Bookmark],
        sessions: [Session] = [],
        categories: [Facet] = [],
        tags: [Facet] = []
    ) -> LibraryCacheState {
        LibraryCacheState(
            serverTarget: target,
            bookmarks: bookmarks,
            total: bookmarks.count,
            meta: MetaResponse(
                categories: categories, browsers: [], devices: [], days: [], tags: tags,
                total: bookmarks.count
            ),
            sessions: sessions
        )
    }

    /// A throwaway cache directory per test — never Tara's real snapshot (the
    /// test host IS the app).
    private func makeCache() -> LibraryCache {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("ColdStartTests-\(UUID().uuidString)", isDirectory: true)
        return LibraryCache(directory: directory)
    }

    // MARK: - Cache round-trip

    func testCacheWriteReadRoundTrip() {
        let cache = makeCache()
        let state = makeCacheState(
            bookmarks: [makeBookmark(id: "b1"), makeBookmark(id: "b2")],
            categories: [Facet(name: "general", count: 2)]
        )

        XCTAssertNil(cache.read(), "an empty cache reads nil — the first-run path")
        cache.write(state)
        let readBack = cache.read()

        XCTAssertEqual(readBack?.serverTarget, state.serverTarget)
        XCTAssertEqual(readBack?.bookmarks.map(\.id), ["b1", "b2"])
        XCTAssertEqual(readBack?.total, 2)
        XCTAssertEqual(readBack?.meta.categories.first?.name, "general")
    }

    func testCacheDeleteDropsTheSnapshot() {
        let cache = makeCache()
        cache.write(makeCacheState(bookmarks: [makeBookmark(id: "b1")]))
        XCTAssertNotNil(cache.read())
        cache.delete()
        XCTAssertNil(cache.read())
    }

    // MARK: - Hydration

    func testHydrateAppliesSnapshotForThisTarget() {
        let model = LibraryModel(api: ApiClient(target: .cloud))
        let applied = model.hydrateFromCache(
            makeCacheState(bookmarks: [makeBookmark(id: "b1")]),
            serverTarget: ServerTarget.cloud.rawValue
        )

        XCTAssertTrue(applied)
        XCTAssertEqual(model.bookmarks.map(\.id), ["b1"])
        XCTAssertEqual(model.total, 1)
        XCTAssertTrue(model.showingCachedLibrary, "hydrated content is cache-backed until the refresh settles")
    }

    func testHydrateDropsAnotherTargetsSnapshot() {
        let model = LibraryModel(api: ApiClient(target: .cloud))
        let applied = model.hydrateFromCache(
            makeCacheState(target: ServerTarget.local.rawValue, bookmarks: [makeBookmark(id: "b1")]),
            serverTarget: ServerTarget.cloud.rawValue
        )

        XCTAssertFalse(applied, "a Local snapshot must never render on Cloud")
        XCTAssertTrue(model.bookmarks.isEmpty)
        XCTAssertFalse(model.showingCachedLibrary)
    }

    func testHydrateRejectsAnEmptySnapshot() {
        let model = LibraryModel(api: ApiClient(target: .cloud))
        // Truly empty: no rows, no facets — a real first-run snapshot.
        XCTAssertFalse(model.hydrateFromCache(makeCacheState(bookmarks: []), serverTarget: "cloud"))
        XCTAssertFalse(model.hydrateFromCache(nil, serverTarget: "cloud"))
        XCTAssertFalse(model.showingCachedLibrary)
    }

    // MARK: - Reconcile: stale cache + fresh refresh

    func testReconcileKeepsIdentityAppendsNewDropsRemoved() async {
        let cache = makeCache()
        let env = AppEnvironment(
            preferences: SignedOutResetTests.makeDefaults(target: .cloud),
            session: Self.stubbedSession { _ in (404, Data("{}".utf8)) },
            cache: cache
        )
        env.hydrateFromCache(
            makeCacheState(bookmarks: [makeBookmark(id: "kept-old"), makeBookmark(id: "removed")])
        )

        // The server still carries "kept-old" (updated), added "fresh", and no
        // longer carries "removed".
        let fetched = [makeBookmark(id: "fresh"), makeBookmark(id: "kept-old", title: "Renamed")]
        env.library.reconcileForTesting(rows: fetched)

        XCTAssertEqual(env.library.bookmarks.map(\.id), ["fresh", "kept-old"], "new first (newest-first), removed gone")
        XCTAssertEqual(env.library.bookmarks.last?.title, "Renamed", "surviving rows update in place")
    }

    func testRefreshFailureKeepsCachedRowsOnScreen() async {
        // The API never answers: /api/bookmarks and /api/meta 500.
        let env = AppEnvironment(
            preferences: SignedOutResetTests.makeDefaults(target: .cloud),
            session: Self.stubbedSession { _ in (500, Data("{}".utf8)) },
            cache: makeCache()
        )
        env.hydrateFromCache(
            makeCacheState(bookmarks: [makeBookmark(id: "b1")], sessions: [makeSession(id: "s1")])
        )

        await env.loadEverything()

        XCTAssertEqual(env.library.bookmarks.map(\.id), ["b1"], "a failed refresh must not blank the window")
        XCTAssertEqual(env.sessions.sessions.map(\.id), ["s1"])
        XCTAssertFalse(env.library.showingCachedLibrary, "the refresh has settled — the pill goes away")
        XCTAssertFalse(env.isSyncing)
    }

    // MARK: - Pill state

    func testPillShowsWhileSyncingAndHidesAfterTheRefreshSettles() async {
        let env = AppEnvironment(
            preferences: SignedOutResetTests.makeDefaults(target: .cloud),
            session: Self.stubbedSession { request in
                request.url?.path == "/api/bookmarks"
                    ? (200, Data(#"{"bookmarks":[],"total":0}"#.utf8))
                    : (200, Data(#"{"categories":[],"browsers":[],"devices":[],"days":[],"tags":[],"total":0}"#.utf8))
            },
            cache: makeCache()
        )
        env.hydrateFromCache(
            makeCacheState(bookmarks: [makeBookmark(id: "b1")])
        )

        XCTAssertTrue(env.isSyncing, "hydrated cache arms the pill from launch")

        await env.loadEverything()

        XCTAssertFalse(env.isSyncing, "the settled refresh hides the pill")
        XCTAssertFalse(env.library.showingCachedLibrary)
    }

    func testNoCacheNoPill() {
        let env = AppEnvironment(
            preferences: SignedOutResetTests.makeDefaults(target: .cloud),
            session: Self.stubbedSession { _ in (404, Data("{}".utf8)) },
            cache: makeCache()
        )
        XCTAssertFalse(env.isSyncing, "a true first run keeps the current loading behavior")
        XCTAssertEqual(env.gate, .connecting)
    }

    // MARK: - Auth: cache keeps the gate open while Clerk is quiet

    func testCachedContentOpensTheGateWhileAuthIsUnknown() {
        let env = AppEnvironment(
            preferences: SignedOutResetTests.makeDefaults(target: .cloud),
            session: Self.stubbedSession { _ in (404, Data("{}".utf8)) },
            cache: makeCache()
        )
        env.hydrateFromCache(
            makeCacheState(bookmarks: [makeBookmark(id: "b1")])
        )
        XCTAssertEqual(env.auth.status, .unknown, "the restore hasn't answered yet")

        XCTAssertEqual(env.gate, .ready, "cached content renders instead of the connecting spinner")
        XCTAssertTrue(env.canUseData)
    }

    func testDefinitiveSignOutStillFlushesCachedContent() {
        let env = AppEnvironment(
            preferences: SignedOutResetTests.makeDefaults(target: .cloud),
            session: Self.stubbedSession { _ in (404, Data("{}".utf8)) },
            cache: makeCache()
        )
        env.hydrateFromCache(
            makeCacheState(bookmarks: [makeBookmark(id: "b1")])
        )
        XCTAssertEqual(env.gate, .ready)

        // Clerk answers "no session" — definitive, cache or no cache.
        env.auth.mintOverride = { _ in .noSession }
        let expectation = self.expectation(description: "restore")
        Task { @MainActor in
            await env.auth.restore(requiresAuth: true)
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 5)

        XCTAssertEqual(env.auth.status, .signedOut)
        XCTAssertEqual(env.gate, .signedOut, "a real sign-out still lands on the sign-in screen")
        XCTAssertTrue(env.library.bookmarks.isEmpty)
    }

    // MARK: - Write-through

    func testLoadEverythingWritesTheSnapshotThrough() async throws {
        let cache = makeCache()
        let env = AppEnvironment(
            preferences: SignedOutResetTests.makeDefaults(target: .cloud),
            session: Self.stubbedSession { request in
                switch request.url?.path {
                case "/api/bookmarks":
                    (200, Data(#"{"bookmarks":[\#(Self.fixtureJSON(id: "b1"))],"total":1}"#.utf8))
                case "/api/me":
                    (200, Data(#"{"signedIn":true,"name":"Tara","email":"t@x.io"}"#.utf8))
                case "/api/app/releases":
                    (200, Data(#"{"releases":{}}"#.utf8))
                default:
                    (200, Data(#"{"categories":[],"browsers":[],"devices":[],"days":[],"tags":[],"total":1}"#.utf8))
                }
            },
            cache: cache
        )
        // A stubbed mint — never the real webview (the test host shares the
        // app's WKWebsiteDataStore, and a live mint would hit the cloud).
        env.auth.mintOverride = { _ in .token("jwt-cold") }
        env.sessions.seed(sessions: [makeSession(id: "s1")])
        env.auth.seed(status: .signedIn, account: AccountInfo(signedIn: true, name: "Tara", email: "t@x.io"))

        await env.loadEverything()

        let snapshot = cache.read()
        XCTAssertEqual(snapshot?.serverTarget, ServerTarget.cloud.rawValue)
        XCTAssertEqual(snapshot?.bookmarks.map(\.id), ["b1"])
        XCTAssertEqual(snapshot?.sessions.map(\.id), ["s1"], "the Sessions page persists with the library")
    }

    /// The snapshot is the UNFILTERED All-Bookmarks state: a refresh that lands
    /// while a filter is active (⌘R on a filtered view, a filter change) must
    /// not write the filtered slice over it.
    func testSnapshotKeepsTheUnfilteredListWhenAFilteredRefreshLands() async throws {
        let env = AppEnvironment(
            preferences: SignedOutResetTests.makeDefaults(target: .cloud),
            session: Self.stubbedSession { request in
                switch request.url?.path {
                case "/api/bookmarks":
                    // Filtered: one row. Unfiltered: two.
                    let filtered = request.url?.query?.contains("browser=chrome") == true
                    let rows = filtered ? [Self.fixtureJSON(id: "b1")] : [Self.fixtureJSON(id: "b1"), Self.fixtureJSON(id: "b2")]
                    return (200, Data(#"{"bookmarks":[\#(rows.joined(separator: ","))],"total":\#(rows.count)}"#.utf8))
                case "/api/app/releases":
                    return (200, Data(#"{"releases":{}}"#.utf8))
                default:
                    return (200, Data(#"{"categories":[],"browsers":[],"devices":[],"days":[],"tags":[],"total":2}"#.utf8))
                }
            },
            cache: makeCache()
        )
        env.auth.mintOverride = { _ in .token("jwt-cold") }
        env.auth.seed(status: .signedIn)

        await env.library.refresh() // unfiltered: [b1, b2]
        env.library.browserFilter = "chrome" // didSet fires its own (fire-and-forget) refresh…
        // …let it land before the awaited one supersedes it, so the state under
        // the final assert is deterministic.
        for _ in 0..<100 where env.library.bookmarks.map(\.id) != ["b1"] {
            try await Task.sleep(for: .milliseconds(10))
        }
        await env.library.refresh() // awaited filtered refresh: [b1]

        XCTAssertEqual(env.library.bookmarks.map(\.id), ["b1"], "the filtered view shows the filtered rows")

        // The snapshot (what persistSnapshot would write) keeps the unfiltered list.
        let state = env.library.cacheState(serverTarget: ServerTarget.cloud.rawValue, sessions: [])
        XCTAssertEqual(state.bookmarks.map(\.id), ["b1", "b2"], "the snapshot keeps the unfiltered list")
        XCTAssertEqual(state.total, 2)
    }

    func testSignOutDeletesTheSnapshot() {
        let cache = makeCache()
        let env = AppEnvironment(
            preferences: SignedOutResetTests.makeDefaults(target: .cloud),
            session: Self.stubbedSession { _ in (404, Data("{}".utf8)) },
            cache: cache
        )
        env.hydrateFromCache(makeCacheState(bookmarks: [makeBookmark(id: "b1")]))
        cache.write(env.library.cacheState(serverTarget: ServerTarget.cloud.rawValue, sessions: []))
        XCTAssertNotNil(cache.read())

        env.handleSignedOut()

        XCTAssertNil(cache.read(), "the snapshot is account data — a sign-out wipes it")
        XCTAssertFalse(env.isSyncing)
    }

    // MARK: - Reopen (Bug 2)

    func testReopenIgnoresPhantomVisibleWindowsAfterAClose() {
        // 2026-09-14 regression: after the red button destroys the main
        // window, hidden/zero-size helper windows can still make macOS pass
        // hasVisibleWindows=true. Trusting the flag returned true ("nothing
        // to do") and dock clicks did nothing. With no captured window the
        // answer must stay false no matter what the flag says, so AppKit
        // recreates the group's window.
        XCTAssertFalse(AppDelegate.reopen(hasVisibleWindows: true, window: nil))
    }

    func testReopenWithTheSceneBridgeOpensAFreshWindow() {
        // With the bridge present (the real app after first paint), a dead
        // captured window means the delegate opens a new window itself and
        // reports the event handled.
        AppDelegate.reopenNewWindow = { }
        XCTAssertTrue(AppDelegate.reopen(hasVisibleWindows: true, window: nil))
        AppDelegate.reopenNewWindow = nil
    }

    func testReopenWithoutWindowsReturnsFalseSoAppKitRecreatesIt() {
        // The scene's openWindow bridge is nil in unit tests (and on first
        // launch before the content view exists): reopen must say NOT handled
        // so AppKit's default handling can show SOMETHING. With a live bridge
        // (the real app after first paint) the answer is true because the
        // delegate opened a fresh window itself.
        XCTAssertFalse(AppDelegate.reopen(hasVisibleWindows: false, window: nil))
    }

    // MARK: - Plumbing

    private static func fixtureJSON(id: String) -> String {
        #"{"id":"\#(id)","url":"https://example.com/\#(id)","domain":"example.com","title":"Example","og":{"title":null,"description":null,"image":null,"siteName":null,"type":null,"url":null,"favicon":null},"source":{"browser":"chrome","device":"laptop","deviceName":"Mac","os":"macOS","savedAt":"2026-08-11T10:15:30Z"},"category":"general","tags":[],"createdAt":"2026-08-11T10:15:30Z","embedded":false}"#
    }

    private static func stubbedSession(
        handler: @escaping (URLRequest) -> (Int, Data)
    ) -> URLSession {
        ApiClientAuthTests.StubURLProtocol.handler = handler
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ApiClientAuthTests.StubURLProtocol.self]
        return URLSession(configuration: configuration)
    }
}
