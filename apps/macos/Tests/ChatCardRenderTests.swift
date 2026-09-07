import SwiftUI
import XCTest
@testable import BookmarkAI

/// Visual harness for the chat's tool cards, not a test: renders each card
/// from REAL tool output (Tests/Fixtures/tool-*.json — captured from the dev
/// server's chat route, the live server's snapshot paged by the tool's own
/// paginator, and a real search over the demo library) to PNGs in light and
/// dark, as an `NSHostingView` capture. Opt-in like `RenderPreviewTests`:
///   RENDER_PREVIEWS=1 xcodebuild … test -only-testing:BookmarkAITests/ChatCardRenderTests
/// Paths are printed as `PREVIEW-> …`.
///
/// The fixtures are also decoded by the ALWAYS-ON test below, so the Swift
/// models are pinned to the server's real bytes, not just to hand-written JSON.
final class ChatCardRenderTests: XCTestCase {

    private func fixture(_ name: String) throws -> JSONValue {
        let url = try XCTUnwrap(
            Bundle(for: Self.self).url(forResource: name, withExtension: "json"),
            "missing fixture \(name).json"
        )
        return try ApiClient.decoder.decode(JSONValue.self, from: Data(contentsOf: url))
    }

    private func call(_ name: String, output: JSONValue, input: JSONValue? = nil) -> ChatToolCall {
        ChatToolCall(name: name, callId: "fixture-\(name)", state: .outputAvailable, input: input, output: output, errorText: nil)
    }

    // MARK: - Real server output decodes

    func testRealToolOutputsDecodeIntoTheCardModels() throws {
        let live = try XCTUnwrap(call("listLiveTabs", output: try fixture("tool-live-tabs")).liveTabsOutput)
        XCTAssertEqual(live.enabled, true)
        XCTAssertEqual(live.page?.total, 31)
        // The live server orders devices by recency, so match by label.
        let mac = try XCTUnwrap(live.deviceList.first { $0.label == "Tara's MacBook Pro" })
        let phone = try XCTUnwrap(live.deviceList.first { $0.label == "iPhone 16" })
        XCTAssertEqual(mac.windowList.map { $0.tabList.count }, [13, 10])
        XCTAssertEqual(mac.hiddenTabCount, 3)
        XCTAssertEqual(phone.windowList.map { $0.tabList.count }, [8])
        let flat = ChatLiveCardLogic.flatten(live.deviceList)
        XCTAssertEqual(flat.count, 31)
        XCTAssertEqual(Set(ChatLiveCardLogic.regroup(flat).map(\.loadedTabCount)), [23, 8])

        let filtered = try XCTUnwrap(call("listLiveTabs", output: try fixture("tool-live-tabs-filtered")).liveTabsOutput)
        XCTAssertEqual(filtered.query, "digitalocean")
        XCTAssertEqual(filtered.page?.total, 1)
        XCTAssertEqual(filtered.deviceList[0].matchingTabCount, 1)
        XCTAssertEqual(filtered.deviceList[0].windowList[0].windowTabCount, 13, "a partial group keeps its full count")

        let page1 = try XCTUnwrap(call("listLiveTabs", output: try fixture("tool-live-tabs-page1")).liveTabsOutput)
        XCTAssertEqual(page1.page, ToolPageMeta(total: 31, offset: 0, limit: 20, hasMore: true, nextOffset: 20))
        XCTAssertEqual(ChatLiveCardLogic.flatten(page1.deviceList).count, 20)

        let sql = try XCTUnwrap(call("queryDatabase", output: try fixture("tool-sql")).sqlOutput)
        XCTAssertEqual(sql.columns, ["id", "title", "url", "category"])
        XCTAssertEqual(sql.rows?.count, 39)
        XCTAssertEqual(sql.page?.total, 39)
        XCTAssertNotNil(sql.sql)

        let sessions = try XCTUnwrap(call("listSessions", output: try fixture("tool-sessions")).sessionsOutput)
        XCTAssertEqual(sessions.hits.count, 4)
        XCTAssertEqual(sessions.hits.map(\.tabCount), [3, 5, 4, 1])

        let search = try XCTUnwrap(call("searchBookmarks", output: try fixture("tool-search")).searchOutput)
        XCTAssertFalse(search.hits.isEmpty)
        XCTAssertNil(search.page?.total)
    }

    // MARK: - Renders

    @MainActor
    func testRenderCardPreviews() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["RENDER_PREVIEWS"] == "1",
            "visual harness — set RENDER_PREVIEWS=1 to produce the PNGs"
        )
        let environment = AppEnvironment(preferences: Preferences(defaults: UserDefaults(suiteName: "chat-card-render-\(UUID().uuidString)")!))

        let live = call("listLiveTabs", output: try fixture("tool-live-tabs"))
        let livePaged = call("listLiveTabs", output: try fixture("tool-live-tabs-page1"))
        let liveFiltered = call("listLiveTabs", output: try fixture("tool-live-tabs-filtered"), input: .object(["query": .string("digitalocean")]))
        let sql = call("queryDatabase", output: try fixture("tool-sql"), input: .object(["sql": .string("SELECT id, title, url, category FROM bookmarks ORDER BY saved_at DESC")]))
        let sessions = call("listSessions", output: try fixture("tool-sessions"))
        let search = call("searchBookmarks", output: try fixture("tool-search"), input: .object(["query": .string("design"), "mode": .string("hybrid")]))

        for (appearance, suffix) in [(NSAppearance.Name.aqua, "light"), (.darkAqua, "dark")] {
            try render(ChatToolRow(call: live), appearance: appearance, name: "mac-live-tabs-card-\(suffix)")
            try render(ChatToolRow(call: livePaged), appearance: appearance, name: "mac-live-tabs-paged-\(suffix)")
            try render(ChatToolRow(call: liveFiltered), appearance: appearance, name: "mac-live-tabs-tool-filtered-\(suffix)")
            // The card's own filter box, pre-filled: what the user sees after typing.
            try render(ChatLiveTabsCard(output: live.liveTabsOutput!, initialFilter: "rust").frame(width: 640), appearance: appearance, name: "mac-live-tabs-card-filtered-\(suffix)")
            try render(ChatToolRow(call: sql), appearance: appearance, name: "mac-sql-card-\(suffix)")
            try render(ChatToolRow(call: sessions), appearance: appearance, name: "mac-sessions-card-\(suffix)")
            try render(ChatToolRow(call: search), appearance: appearance, name: "mac-bookmarks-card-\(suffix)")
        }

        // Keep the environment alive across the renders (the cards read it lazily).
        withExtendedLifetime(environment) {}

        @MainActor
        func render(_ view: some View, appearance: NSAppearance.Name, name: String) throws {
            let wrapped = view
                .environment(environment)
                .padding(16)
                .frame(width: 720, alignment: .leading)
                .background(Color(nsColor: .windowBackgroundColor))
            let host = NSHostingView(rootView: AnyView(wrapped))
            host.appearance = NSAppearance(named: appearance)
            host.frame = NSRect(x: 0, y: 0, width: 720, height: 10)
            host.layoutSubtreeIfNeeded()
            let fitted = max(host.fittingSize.height, 10)
            host.frame = NSRect(origin: .zero, size: NSSize(width: 720, height: fitted))
            host.layoutSubtreeIfNeeded()
            guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
                return XCTFail("no bitmap rep for \(name)")
            }
            host.cacheDisplay(in: host.bounds, to: rep)
            guard let png = rep.representation(using: .png, properties: [:]) else {
                return XCTFail("render failed for \(name)")
            }
            let out = FileManager.default.temporaryDirectory.appendingPathComponent("\(name).png")
            try png.write(to: out)
            print("PREVIEW-> \(out.path)")
        }
    }
}
