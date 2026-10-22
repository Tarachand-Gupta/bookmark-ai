import XCTest
@testable import BookmarkAI

@MainActor
final class DurableWorkspaceTests: XCTestCase {
    private func snapshot(origin: String = ServerTarget.cloud.baseURL.absoluteString, account: String = "account-a") -> LibraryCacheState {
        let bookmark = Bookmark(id: "cached-bookmark", url: "https://fixture.test/a", domain: "fixture.test", title: "Months-old useful link", og: OpenGraph(), source: BookmarkSource(browser: "other", device: "desktop", savedAt: "2026-01-01T00:00:00Z"), category: "Research", tags: ["design"], createdAt: "2026-01-01T00:00:00Z", embedded: false)
        return LibraryCacheState(serverTarget: "cloud", bookmarks: [bookmark], total: 1, meta: MetaResponse(categories: [Facet(name: "Research", count: 1)], browsers: [], devices: [], days: [], tags: [], total: 1), sessions: [], accountId: account, origin: origin, savedAt: "2026-01-01T00:00:00Z", account: AccountInfo(signedIn: true, accountId: account, name: "Fixture reader", email: "reader@fixture.test"), planId: "free", aiUsage: AiUsage(usedTokens: 1000, limitTokens: 2000000, resetsAt: "2026-10-19T00:00:00Z"))
    }
    private func environment(_ state: LibraryCacheState) -> (AppEnvironment, LibraryCache, URL) {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let cache = LibraryCache(directory: directory); cache.write(state)
        let configuration = URLSessionConfiguration.ephemeral; configuration.protocolClasses = [ReleaseOrganizationTests.Stub.self]
        ReleaseOrganizationTests.Stub.requests = []
        ReleaseOrganizationTests.Stub.handler = { _ in (503, Data(#"{"error":"Offline fixture"}"#.utf8)) }
        return (AppEnvironment(preferences: SignedOutResetTests.makeDefaults(target: .cloud), session: URLSession(configuration: configuration), cache: cache), cache, directory)
    }
    func testLongAbsenceColdLaunchShowsCachedReaderImmediatelyWithoutAuthenticating() {
        let (env, _, directory) = environment(snapshot()); defer { try? FileManager.default.removeItem(at: directory) }
        XCTAssertEqual(env.gate, .ready)
        XCTAssertFalse(env.canUseData)
        XCTAssertEqual(env.auth.status, .unknown)
        XCTAssertEqual(env.library.visibleBookmarks.first?.title, "Months-old useful link")
        XCTAssertEqual(env.displayAccount?.name, "Fixture reader")
        XCTAssertEqual(env.settings.plan?.id, "free")
        XCTAssertEqual(env.settings.aiUsage?.usedCredits, 1)
        XCTAssertTrue(env.library.isReadOnly)
        XCTAssertTrue(ReleaseOrganizationTests.Stub.requests.isEmpty)
        XCTAssertNotNil(env.lastUpdated)
    }
    func testExpiredSessionKeepsReaderButExplicitLogoutSynchronouslyPurgesIt() async {
        let (env, cache, directory) = environment(snapshot()); defer { try? FileManager.default.removeItem(at: directory) }
        env.auth.seed(status: .signedOut)
        env.handleSignedOut()
        XCTAssertEqual(env.gate, .ready)
        XCTAssertFalse(env.canUseData)
        XCTAssertEqual(env.library.visibleBookmarks.count, 1)
        XCTAssertNotNil(cache.read())
        env.clearPrivateData()
        XCTAssertTrue(env.library.bookmarks.isEmpty)
        XCTAssertNil(env.displayAccount)
        XCTAssertNil(env.settings.plan)
        XCTAssertNil(cache.read())
        XCTAssertEqual(env.gate, .signedOut)
    }
    func testWrongOriginNeverHydratesAndConfirmedDifferentAccountHidesOldReader() {
        let (wrong, _, wrongDir) = environment(snapshot(origin: "https://another.fixture.test")); defer { try? FileManager.default.removeItem(at: wrongDir) }
        XCTAssertTrue(wrong.library.bookmarks.isEmpty)
        XCTAssertFalse(wrong.isCachedReader)
        let (env, _, directory) = environment(snapshot()); defer { try? FileManager.default.removeItem(at: directory) }
        env.auth.seed(status: .signedIn, account: AccountInfo(signedIn: true, accountId: "account-b", name: "Other fixture", email: nil))
        XCTAssertEqual(env.gate, .connecting)
        XCTAssertFalse(env.canUseData)
        XCTAssertFalse(env.isCachedReader)
    }
    func testFailedRefreshRetainsRowsProfilePlanAndOriginalTimestamp() async {
        let (env, cache, directory) = environment(snapshot()); defer { try? FileManager.default.removeItem(at: directory) }
        env.auth.seed(status: .signedIn, account: AccountInfo(signedIn: true, accountId: "account-a", name: "Fixture reader", email: nil))
        env.auth.mintOverride = { _ in .token("header.\(Data(#"{"sub":"account-a"}"#.utf8).base64EncodedString()).signature") }
        await env.loadEverything()
        XCTAssertEqual(env.gate, .ready)
        XCTAssertEqual(env.library.visibleBookmarks.count, 1)
        XCTAssertEqual(env.settings.plan?.id, "free")
        XCTAssertEqual(cache.read()?.savedAt, "2026-01-01T00:00:00Z")
        XCTAssertEqual(env.cacheStatus, "Offline · showing saved library")
    }
    func testCachedFilteringDoesNotDispatchNetworkRequests() async {
        let (env, _, directory) = environment(snapshot()); defer { try? FileManager.default.removeItem(at: directory) }
        await env.library.select(.category("Research"))
        env.library.searchText = "useful"
        await env.library.search("useful")
        XCTAssertEqual(env.library.visibleBookmarks.count, 1)
        await env.library.select(.category("Other"))
        XCTAssertTrue(env.library.visibleBookmarks.isEmpty)
        XCTAssertTrue(ReleaseOrganizationTests.Stub.requests.isEmpty)
    }
    func testRejectedFreshTokenPurgesCachedAdmission() {
        let (env, cache, directory) = environment(snapshot()); defer { try? FileManager.default.removeItem(at: directory) }
        env.auth.seed(status: .signedIn, account: AccountInfo(signedIn: true, accountId: "account-a", name: nil, email: nil))
        env.auth.handleUnauthorized()
        XCTAssertEqual(env.gate, .signedOut)
        XCTAssertFalse(env.canUseData)
        XCTAssertTrue(env.library.bookmarks.isEmpty)
        XCTAssertNil(cache.read())
    }
    func testRequiredVerificationPurgesCachedAdmission() {
        let (env, cache, directory) = environment(snapshot()); defer { try? FileManager.default.removeItem(at: directory) }
        env.auth.requireNativeVerification()
        XCTAssertTrue(env.auth.needsMFA)
        XCTAssertEqual(env.gate, .signedOut)
        XCTAssertNil(cache.read())
    }
    func testExplicitLogoutClosesGateBeforeRemoteSignOutReturns() async {
        let (env, cache, directory) = environment(snapshot()); defer { try? FileManager.default.removeItem(at: directory) }
        env.auth.seed(status: .signedIn, account: AccountInfo(signedIn: true, accountId: "account-a", name: nil, email: nil))
        env.auth.webSignOutOverride = {
            XCTAssertEqual(env.auth.status, .signedOut)
            XCTAssertEqual(env.gate, .signedOut)
            XCTAssertFalse(env.canUseData)
            XCTAssertNil(cache.read())
            try? await Task.sleep(for: .milliseconds(10))
        }
        await env.signOut()
        XCTAssertEqual(env.auth.status, .signedOut)
    }

}
