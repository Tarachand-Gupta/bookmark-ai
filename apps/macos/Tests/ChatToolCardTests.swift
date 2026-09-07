import XCTest
@testable import BookmarkAI

/// The chat's interactive tool cards: decoding the four list tools' outputs
/// from the untyped transcript parts, and the folding / filtering / regrouping
/// / client-side paging they share with the web and mobile cards. Mirrors
/// `apps/web/lib/chat-tool-cards.test.ts` — the same cases, so the Swift port
/// can't drift from `packages/types/src/chat-tool-cards.ts`.
final class ChatToolCardTests: XCTestCase {

    private func json(_ text: String) throws -> JSONValue {
        try ApiClient.decoder.decode(JSONValue.self, from: Data(text.utf8))
    }

    private func call(_ name: String, state: ChatToolCall.State = .outputAvailable, input: String? = nil, output: String?) throws -> ChatToolCall {
        ChatToolCall(
            name: name, callId: "c1", state: state,
            input: try input.map(json), output: try output.map(json), errorText: nil
        )
    }

    // MARK: - Decoding

    func testSearchOutputDecodes() throws {
        let tool = try call("searchBookmarks", output: #"""
        {"query":"rust","mode":"hybrid","fallback":false,
         "results":[{"id":"b1","title":"Tokio","url":"https://tokio.rs","category":"Dev","tags":["rust","async"],"day":"2026-09-01","score":0.83}],
         "page":{"total":null,"offset":0,"limit":50,"hasMore":true,"nextOffset":50}}
        """#)
        let output = try XCTUnwrap(tool.searchOutput)
        XCTAssertEqual(output.query, "rust")
        XCTAssertEqual(output.hits.count, 1)
        XCTAssertEqual(output.hits[0].tagList, ["rust", "async"])
        XCTAssertEqual(output.hits[0].score, 0.83)
        XCTAssertNil(output.page?.total)
        XCTAssertEqual(output.page?.nextOffset, 50)
        XCTAssertTrue(output.page?.hasMore == true)
    }

    func testSqlOutputDecodesMixedCellsAndKeepsSqlWhileRunning() throws {
        let done = try call("queryDatabase", input: #"{"sql":"SELECT category, COUNT(*) n FROM bookmarks GROUP BY 1"}"#, output: #"""
        {"sql":"SELECT category, COUNT(*) n FROM bookmarks GROUP BY 1","columns":["category","n","ratio","meta"],
         "rows":[["Dev",12,0.5,{"a":1}],["News",null,2.0,[1,2]]],"rowCount":2,"truncated":true,
         "page":{"total":2,"offset":0,"limit":50,"hasMore":false,"nextOffset":null}}
        """#)
        let output = try XCTUnwrap(done.sqlOutput)
        XCTAssertEqual(output.columns, ["category", "n", "ratio", "meta"])
        XCTAssertEqual(output.rows?.count, 2)
        XCTAssertEqual(output.truncated, true)
        XCTAssertEqual(output.page?.total, 2)
        let row = try XCTUnwrap(output.rows?[0])
        XCTAssertEqual(row.map(ChatCardText.cellText), ["Dev", "12", "0.5", #"{"a":1}"#])
        let second = try XCTUnwrap(output.rows?[1])
        XCTAssertEqual(second.map(ChatCardText.cellText), ["News", "", "2", "[1,2]"])

        // While streaming there is no output, but the SQL from the input shows.
        let running = try call("queryDatabase", state: .inputAvailable, input: #"{"sql":"SELECT 1"}"#, output: nil)
        XCTAssertEqual(running.sqlText, "SELECT 1")
        XCTAssertNil(running.sqlOutput)

        // A soft failure keeps the SQL and hides the table.
        let failed = try call("queryDatabase", input: #"{"sql":"SELECT nope"}"#, output: #"{"error":"no such column"}"#)
        XCTAssertEqual(failed.sqlText, "SELECT nope")
        XCTAssertNil(failed.sqlOutput)
    }

    func testSessionsOutputDecodesLegacyAndPagedShapes() throws {
        let paged = try call("listSessions", output: #"""
        {"query":null,"sessions":[{"id":"s1","name":"Japan","description":null,"tabCount":20,"browser":"safari","savedAt":"2026-09-01T00:00:00Z",
          "tabs":[{"title":"Kyoto","url":"https://kyoto.jp"}]}],
         "page":{"total":1,"offset":0,"limit":50,"hasMore":false,"nextOffset":null}}
        """#)
        let output = try XCTUnwrap(paged.sessionsOutput)
        XCTAssertNil(output.query)
        XCTAssertEqual(output.hits[0].tabList.map(\.displayTitle), ["Kyoto"])
        XCTAssertEqual(output.hits[0].tabCount, 20)

        let legacy = try call("listSessions", output: #"{"sessions":[],"total":0}"#)
        XCTAssertEqual(legacy.sessionsOutput?.total, 0)
        XCTAssertNil(legacy.sessionsOutput?.page)
    }

    func testLiveTabsOutputDecodesEveryShape() throws {
        let devices = try call("listLiveTabs", output: #"""
        {"enabled":true,"query":"ocean",
         "devices":[{"label":"MacBook","browser":"chrome","lastSeenAgeSeconds":5,"tabCount":23,"matchingTabCount":1,"hiddenTabCount":3,
           "windows":[{"windowId":1,"name":"Work","index":1,"windowTabCount":13,"tabs":[{"title":"DO","url":"https://digitalocean.com","favIconUrl":null}]}]}],
         "page":{"total":1,"offset":0,"limit":50,"hasMore":false,"nextOffset":null}}
        """#)
        let output = try XCTUnwrap(devices.liveTabsOutput)
        XCTAssertEqual(output.query, "ocean")
        XCTAssertEqual(output.deviceList[0].windowList[0].displayName(fallbackIndex: 9), "Work")
        XCTAssertEqual(output.deviceList[0].windowList[0].windowTabCount, 13)
        XCTAssertNil(output.deviceList[0].windowList[0].tabList[0].favIconUrl)

        let off = try call("listLiveTabs", output: #"{"enabled":false,"query":null,"devices":[],"page":{"total":0,"offset":0,"limit":50,"hasMore":false,"nextOffset":null}}"#)
        XCTAssertEqual(off.liveTabsOutput?.enabled, false)
        XCTAssertFalse(off.isFailure)

        let error = try call("listLiveTabs", output: #"{"error":"live tabs unavailable: the live server did not respond"}"#)
        XCTAssertTrue(error.isFailure)
        XCTAssertNotNil(error.liveTabsOutput?.error)

        // Unnamed windows fall back to their display index.
        XCTAssertEqual(LiveWindowHit(windowId: 4, name: "  ", index: 2, windowTabCount: nil, tabs: nil).displayName(fallbackIndex: 7), "Window 2")
        XCTAssertEqual(LiveWindowHit(windowId: nil, name: nil, index: nil, windowTabCount: nil, tabs: nil).displayName(fallbackIndex: 7), "Window 7")
    }

    func testOtherToolsNeverProduceACard() throws {
        let web = try call("webSearch", output: #"{"results":[]}"#)
        XCTAssertNil(web.searchOutput)
        XCTAssertNil(web.sqlOutput)
        XCTAssertNil(web.sessionsOutput)
        XCTAssertNil(web.liveTabsOutput)
        XCTAssertNil(web.sqlText)
    }

    // MARK: - Folding

    func testFoldCollapsesPastTheThresholdAndRevealsInChunks() {
        XCTAssertEqual(ChatCardFold.state(total: 4, shown: 10), .init(visibleCount: 4, hidden: 0, expanded: false, nextChunk: 0))
        XCTAssertEqual(ChatCardFold.state(total: 92, shown: 10), .init(visibleCount: 10, hidden: 82, expanded: false, nextChunk: 25))
        XCTAssertEqual(ChatCardFold.nextShown(total: 92, shown: 10), 35)
        XCTAssertEqual(ChatCardFold.state(total: 92, shown: 35), .init(visibleCount: 35, hidden: 57, expanded: true, nextChunk: 25))
        XCTAssertEqual(ChatCardFold.nextShown(total: 92, shown: 85), 92)
        XCTAssertEqual(ChatCardFold.state(total: 92, shown: 92).hidden, 0)
        // Everything showing → the next click snaps back to the collapsed size.
        XCTAssertEqual(ChatCardFold.nextShown(total: 92, shown: 92), 10)
        XCTAssertEqual(ChatCardFold.state(total: 0, shown: 10), .init(visibleCount: 0, hidden: 0, expanded: false, nextChunk: 0))
    }

    func testShowMoreLabels() {
        XCTAssertEqual(ChatCardFold.showMoreLabel(hidden: 82, nextChunk: 25, noun: "tab"), "Show 25 more (82 left)")
        XCTAssertEqual(ChatCardFold.showMoreLabel(hidden: 7, nextChunk: 25, noun: "tab"), "Show 7 more tabs")
        XCTAssertEqual(ChatCardFold.showMoreLabel(hidden: 1, nextChunk: 25, noun: "row"), "Show 1 more row")
        XCTAssertEqual(ChatCardFold.showMoreLabel(hidden: 0, nextChunk: 0, noun: "row"), "Show less")
        XCTAssertEqual(ChatCardFold.showMoreLabel(hidden: 5, nextChunk: nil, noun: "result"), "Show 5 more results")
    }

    // MARK: - Text helpers

    func testMatchesIsTrimmedCaseInsensitiveSubstring() {
        XCTAssertTrue(ChatCardText.matches("  sqlite ", "Turso — SQLite"))
        XCTAssertTrue(ChatCardText.matches("", "anything"))
        XCTAssertTrue(ChatCardText.matches(nil, "anything"))
        XCTAssertTrue(ChatCardText.matches("ocean", "Deploy", "https://digitalocean.com"))
        XCTAssertFalse(ChatCardText.matches("x", nil, nil))
        XCTAssertFalse(ChatCardText.matches("zzz", "Next.js Docs"))
    }

    func testHostAndOpenableURL() {
        XCTAssertEqual(ChatCardText.host(of: "https://www.example.com/a/b?c"), "example.com")
        XCTAssertEqual(ChatCardText.host(of: "not a url"), "not a url")
        XCTAssertEqual(ChatCardText.openableURL("https://a.b/c")?.absoluteString, "https://a.b/c")
        XCTAssertNil(ChatCardText.openableURL("javascript:alert(1)"))
        XCTAssertNil(ChatCardText.openableURL("chrome://settings"))
        XCTAssertEqual(ChatCardText.faviconURL(favIconUrl: "https://nextjs.org/favicon.ico", pageURL: "https://nextjs.org/docs")?.absoluteString, "https://nextjs.org/favicon.ico")
        XCTAssertEqual(ChatCardText.faviconURL(favIconUrl: "data:image/png;base64,AAAA", pageURL: "https://zod.dev/")?.absoluteString, "https://zod.dev/favicon.ico")
        XCTAssertNil(ChatCardText.faviconURL(favIconUrl: nil, pageURL: "chrome://newtab"))
        XCTAssertEqual(ChatCardText.plural(1, "tab"), "1 tab")
        XCTAssertEqual(ChatCardText.plural(12, "tab"), "12 tabs")
    }

    // MARK: - Page meta

    func testPageSliceRangeAndFooterRules() {
        let items = Array(0..<92)
        let first = ToolPageMeta.slice(items, offset: 0, limit: 50)
        XCTAssertEqual(first.items.count, 50)
        XCTAssertEqual(first.page, ToolPageMeta(total: 92, offset: 0, limit: 50, hasMore: true, nextOffset: 50))
        let second = ToolPageMeta.slice(items, offset: 50, limit: 50)
        XCTAssertEqual(second.items.first, 50)
        XCTAssertEqual(second.items.count, 42)
        XCTAssertEqual(second.page, ToolPageMeta(total: 92, offset: 50, limit: 50, hasMore: false, nextOffset: nil))
        XCTAssertTrue(ToolPageMeta.slice(items, offset: 500, limit: 50).items.isEmpty)
        // The page size is clamped to the tool contract's maximum.
        XCTAssertEqual(ToolPageMeta.slice(items, offset: 0, limit: 900).page.limit, 50)

        XCTAssertEqual(second.page.rangeDescription(firstOffset: 0, shown: 92), "1–92 of 92")
        XCTAssertEqual(first.page.rangeDescription(firstOffset: 50, shown: 50), "51–100 of 92")
        XCTAssertEqual(ToolPageMeta(total: nil, offset: 0, limit: 50, hasMore: true, nextOffset: 50).rangeDescription(firstOffset: 0, shown: 50), "1–50")
        XCTAssertEqual(first.page.rangeDescription(firstOffset: 0, shown: 0), "no rows")

        let whole = ToolPageMeta(total: 8, offset: 0, limit: 50, hasMore: false, nextOffset: nil)
        XCTAssertFalse(whole.footerVisible(firstOffset: 0, error: nil))
        XCTAssertTrue(first.page.footerVisible(firstOffset: 0, error: nil))
        XCTAssertTrue(whole.footerVisible(firstOffset: 50, error: nil))
        XCTAssertTrue(whole.footerVisible(firstOffset: 0, error: "boom"))
    }

    // MARK: - Live tabs: flatten ↔ regroup ↔ page

    private var devices: [LiveDeviceHit] {
        [
            LiveDeviceHit(label: "MacBook", browser: "chrome", lastSeenAgeSeconds: 5, tabCount: 23, matchingTabCount: nil, hiddenTabCount: 3, windows: [
                LiveWindowHit(windowId: 1, name: "Work", index: 1, windowTabCount: 13, tabs: [.init(title: "A", url: "https://a.dev"), .init(title: "B", url: "https://b.dev")]),
                LiveWindowHit(windowId: 2, name: nil, index: 2, windowTabCount: 10, tabs: [.init(title: "C", url: "https://c.dev")]),
            ]),
            LiveDeviceHit(label: "iPhone", browser: "safari", lastSeenAgeSeconds: 700, tabCount: 8, matchingTabCount: nil, hiddenTabCount: 0, windows: [
                LiveWindowHit(windowId: 1, name: nil, index: 1, windowTabCount: 8, tabs: [.init(title: "D", url: "https://d.dev")]),
            ]),
        ]
    }

    func testFlattenAndRegroupRoundTripInOrderKeepingFullCounts() {
        let flat = ChatLiveCardLogic.flatten(devices)
        XCTAssertEqual(flat.map(\.tab.title), ["A", "B", "C", "D"])
        XCTAssertEqual(flat[0].windowId, 1)
        XCTAssertEqual(flat[0].windowName, "Work")
        XCTAssertEqual(flat[0].windowTabCount, 13)

        let grouped = ChatLiveCardLogic.regroup(flat)
        XCTAssertEqual(grouped.map(\.device.label), ["MacBook", "iPhone"])
        XCTAssertEqual(grouped[0].loadedTabCount, 3)
        XCTAssertEqual(grouped[0].device.tabCount, 23)
        XCTAssertEqual(grouped[0].windows.map { $0.tabList.count }, [2, 1])
        XCTAssertEqual(grouped[0].windows[0].windowTabCount, 13)
        XCTAssertEqual(grouped[0].windows[0].name, "Work")
    }

    func testRegroupOfAFilteredSubsetInventsNoEmptyGroups() {
        let flat = ChatLiveCardLogic.flatten(devices).filter { $0.tab.title != "A" && $0.tab.title != "B" }
        let grouped = ChatLiveCardLogic.regroup(flat)
        XCTAssertEqual(grouped[0].windows.map(\.windowId), [2])
        XCTAssertEqual(grouped[0].loadedTabCount, 1)
    }

    func testRegroupKeysWindowsByIdFallingBackToIndex() {
        var phone = devices[1]
        phone.windows = [
            LiveWindowHit(windowId: nil, name: nil, index: 1, windowTabCount: nil, tabs: [.init(title: "x", url: "u")]),
            LiveWindowHit(windowId: nil, name: nil, index: 2, windowTabCount: nil, tabs: [.init(title: "y", url: "v")]),
        ]
        XCTAssertEqual(ChatLiveCardLogic.regroup(ChatLiveCardLogic.flatten([phone]))[0].windows.count, 2)
    }

    func testLiveSnapshotPagingFiltersWithTheToolQueryAndKeepsWindowCounts() throws {
        let snapshot = try ApiClient.decoder.decode(ListLiveResponse.self, from: Data(#"""
        {"enabled":true,"ttlHours":24,"devices":[{"deviceId":"d1","label":"MacBook","browser":"chrome","device":"laptop","tabCount":4,"hiddenTabCount":1,
          "lastSeenAt":"2026-09-07T00:00:00Z","lastSeenAgeSeconds":3,
          "windows":[{"windowId":7,"name":"Work","tabs":[{"title":"Next.js Docs","url":"https://nextjs.org/docs","favIconUrl":"https://nextjs.org/favicon.ico"},{"url":"https://digitalocean.com/tutorials"}]},
                     {"windowId":8,"tabs":[{"title":"Turso","url":"https://turso.tech"},{"title":"Zig","url":"https://ziglang.org"}]}]}]}
        """#.utf8))

        let all = ChatLiveCardLogic.page(snapshot: snapshot, query: nil, offset: 0, limit: 50)
        XCTAssertEqual(all.rows.map(\.tab.title), ["Next.js Docs", "", "Turso", "Zig"])
        XCTAssertEqual(all.page, ToolPageMeta(total: 4, offset: 0, limit: 50, hasMore: false, nextOffset: nil))
        XCTAssertEqual(all.rows[0].windowId, 7)
        XCTAssertEqual(all.rows[0].windowName, "Work")
        XCTAssertEqual(all.rows[0].windowIndex, 1)
        XCTAssertEqual(all.rows[0].windowTabCount, 2)
        XCTAssertEqual(all.rows[0].tab.favIconUrl, "https://nextjs.org/favicon.ico")
        XCTAssertNil(all.rows[1].tab.favIconUrl)
        XCTAssertEqual(all.rows[0].device.hiddenTabCount, 1)

        let second = ChatLiveCardLogic.page(snapshot: snapshot, query: nil, offset: 2, limit: 2)
        XCTAssertEqual(second.rows.map(\.tab.title), ["Turso", "Zig"])
        XCTAssertEqual(second.page, ToolPageMeta(total: 4, offset: 2, limit: 2, hasMore: false, nextOffset: nil))

        let filtered = ChatLiveCardLogic.page(snapshot: snapshot, query: "ocean", offset: 0, limit: 50)
        XCTAssertEqual(filtered.rows.count, 1)
        XCTAssertTrue(filtered.rows[0].tab.url.contains("digitalocean"))
    }

    // MARK: - Sessions pager

    private func session(_ id: String, name: String, description: String? = nil, tabs: [SessionTab], browser: String = "chrome") -> Session {
        Session(
            id: id, name: name, tabs: tabs, tabCount: tabs.count, description: description,
            browser: browser, device: "laptop", os: nil,
            savedAt: "2026-09-01T00:00:00.000Z", createdAt: "2026-09-01T00:00:00.000Z"
        )
    }

    func testSessionsPagerFiltersLikeTheToolAndClipsTabs() {
        let all = [
            session("s1", name: "Japan trip", description: "Kyoto and Osaka", tabs: (0..<20).map { SessionTab(url: "https://t\($0).jp", title: "T\($0)") }, browser: "safari"),
            session("s2", name: "Rust reading", tabs: [SessionTab(url: "https://tokio.rs", title: "Tokio"), SessionTab(url: "https://doc.rust-lang.org", title: nil)]),
            session("s3", name: "Misc", tabs: [SessionTab(url: "https://digitalocean.com", title: "DigitalOcean")], browser: "firefox"),
        ]
        XCTAssertEqual(ChatSessionsCardLogic.filter(all, query: "osaka").map(\.id), ["s1"])
        XCTAssertEqual(ChatSessionsCardLogic.filter(all, query: "rust-lang").map(\.id), ["s2"])
        XCTAssertEqual(ChatSessionsCardLogic.filter(all, query: "").map(\.id), ["s1", "s2", "s3"])

        let page = ChatSessionsCardLogic.page(all, query: nil, offset: 0, limit: 50)
        XCTAssertEqual(page.rows[0].tabList.count, 15)
        XCTAssertEqual(page.rows[0].tabCount, 20)
        XCTAssertEqual(page.rows[1].tabList[1], SessionTabHit(title: "", url: "https://doc.rust-lang.org"))
        XCTAssertNil(page.rows[1].description)
        XCTAssertEqual(page.page, ToolPageMeta(total: 3, offset: 0, limit: 50, hasMore: false, nextOffset: nil))

        let sliced = ChatSessionsCardLogic.page(all, query: nil, offset: 1, limit: 1)
        XCTAssertEqual(sliced.rows.map(\.id), ["s2"])
        XCTAssertEqual(sliced.page, ToolPageMeta(total: 3, offset: 1, limit: 1, hasMore: true, nextOffset: 2))
    }

    // MARK: - Bookmarks pager

    func testSearchPageMapsHitsAndLetsHasMoreDriveTheNextPage() throws {
        let response = try ApiClient.decoder.decode(SearchResponse.self, from: Data(#"""
        {"mode":"hybrid","offset":50,"hasMore":true,"results":[{"score":0.9,"bookmark":{"id":"b1","url":"https://t.dev","domain":"t.dev","title":"T","og":{},
          "source":{"browser":"chrome","device":"laptop","savedAt":"2026-09-07T10:00:00.000Z"},"category":"Dev","tags":["a","b"],"createdAt":"2026-09-07T10:00:00.000Z","embedded":true}}]}
        """#.utf8))
        let page = ChatBookmarksCardLogic.page(response, offset: 50, limit: 50)
        XCTAssertEqual(page.rows, [BookmarkHit(id: "b1", title: "T", url: "https://t.dev", category: "Dev", tags: ["a", "b"], day: "2026-09-07", score: 0.9)])
        XCTAssertEqual(page.page, ToolPageMeta(total: nil, offset: 50, limit: 50, hasMore: true, nextOffset: 100))

        var last = response
        last.hasMore = nil
        XCTAssertNil(ChatBookmarksCardLogic.page(last, offset: 0, limit: 50).page.nextOffset)
    }

    // MARK: - Pager

    @MainActor
    func testPagerAccumulatesRowsAndStopsAtTheEnd() async {
        let pager = ChatCardPager(rows: [1, 2], page: ToolPageMeta(total: 4, offset: 0, limit: 2, hasMore: true, nextOffset: 2))
        XCTAssertTrue(pager.canLoadMore)
        await pager.loadMore { offset, limit in
            XCTAssertEqual(offset, 2)
            XCTAssertEqual(limit, 2)
            return ([3, 4], ToolPageMeta(total: 4, offset: 2, limit: 2, hasMore: false, nextOffset: nil))
        }
        XCTAssertEqual(pager.rows, [1, 2, 3, 4])
        XCTAssertFalse(pager.canLoadMore)
        XCTAssertEqual(pager.firstOffset, 0)
        XCTAssertNil(pager.error)

        // At the end, a load is a no-op — the fetch is never called.
        await pager.loadMore { _, _ in
            XCTFail("must not fetch past the last page")
            return ([], ToolPageMeta(total: 4, offset: 4, limit: 2, hasMore: false, nextOffset: nil))
        }
        XCTAssertEqual(pager.rows.count, 4)
    }

    @MainActor
    func testPagerSurfacesAFailedLoadAndKeepsItsRows() async {
        let pager = ChatCardPager(rows: ["a"], page: ToolPageMeta(total: nil, offset: 0, limit: 50, hasMore: true, nextOffset: 50))
        await pager.loadMore { _, _ in throw ApiError.network("offline") }
        XCTAssertEqual(pager.rows, ["a"])
        XCTAssertEqual(pager.error, ApiError.network("offline").errorDescription)
        XCTAssertTrue(pager.canLoadMore, "the page is unchanged, so the button stays")
    }

    // MARK: - Local sign-in affordance

    func testLocalTargetStaysOpenUnlessTheEnvironmentAsksForSignIn() {
        // The test host never sets BOOKMARKAI_LOCAL_AUTH, so Local is the open target…
        XCTAssertFalse(ServerTarget.local.requiresAuth)
        XCTAssertEqual(ServerTarget.local.authOrigin, ServerTarget.cloud.baseURL)
        // …and Cloud always signs in against itself.
        XCTAssertTrue(ServerTarget.cloud.requiresAuth)
        XCTAssertEqual(ServerTarget.cloud.authOrigin, ServerTarget.cloud.baseURL)
    }
}
