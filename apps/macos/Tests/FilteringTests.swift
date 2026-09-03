import XCTest
@testable import BookmarkAI

/// The on-device search/sort logic behind the Sessions and Live Tabs fields.
final class FilteringTests: XCTestCase {

    // MARK: - TermFilter (mirrored in web + mobile live search — keep in sync)

    func testEveryTermMustMatchSomewhere() {
        let hay = "SwiftUI | Apple Developer Documentation https://developer.apple.com/documentation/swiftui"
        XCTAssertTrue(TermFilter.matches(hay, query: "swiftui apple"))
        XCTAssertTrue(TermFilter.matches(hay, query: "DEVELOPER.apple"))
        XCTAssertTrue(TermFilter.matches(hay, query: "  swiftui   docs...".replacingOccurrences(of: "docs...", with: "documentation")))
        XCTAssertFalse(TermFilter.matches(hay, query: "swiftui android"))
    }

    func testEmptyOrWhitespaceQueryMatchesEverything() {
        XCTAssertTrue(TermFilter.matches("anything", query: ""))
        XCTAssertTrue(TermFilter.matches("anything", query: "   "))
    }

    // MARK: - Sessions filtering (SessionsModel.filter is pure for exactly this)

    private func session(_ id: String, name: String, tabs: [SessionTab]) -> Session {
        Session(
            id: id, name: name, tabs: tabs, tabCount: tabs.count, description: nil,
            browser: "chrome", device: "laptop", os: nil,
            savedAt: "2026-08-25T00:00:00.000Z", createdAt: "2026-08-25T00:00:00.000Z"
        )
    }

    func testSessionMatchesByBuriedTabUrl() {
        let sessions = [
            session("a", name: "Research", tabs: [
                SessionTab(url: "https://www.gladia.io", title: "Gladia"),
                SessionTab(url: "https://www.netflix.com", title: "Netflix"),
            ]),
            session("b", name: "Chip design", tabs: [
                SessionTab(url: "https://www.google.com", title: "Google"),
            ]),
        ]
        let visible = SessionsModel.filter(sessions, query: "netflix", sort: .newestFirst)
        XCTAssertEqual(visible.map(\.id), ["a"])
        XCTAssertEqual(SessionsModel.filter(sessions, query: "", sort: .mostTabs).map(\.id), ["a", "b"])
    }

    // MARK: - Save-live-as-session payload

    /// The `POST /api/sessions` body must match the Zod schema: nil optionals
    /// OMITTED (`.optional()` rejects null), tabs carrying their window id.
    func testCreateSessionBodyOmitsNilOptionals() throws {
        struct Body: Encodable {
            let name: String
            let tabs: [SessionTab]
            let browser: String?
            let device: String?
        }
        let body = Body(
            name: "MacBook — Window 1",
            tabs: [SessionTab(url: "https://a.example", title: nil, favIconUrl: nil, windowId: 7)],
            browser: "chrome", device: nil
        )
        let json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(body)) as! [String: Any]
        XCTAssertEqual(json["name"] as? String, "MacBook — Window 1")
        XCTAssertEqual(json["browser"] as? String, "chrome")
        XCTAssertNil(json["device"], "nil optionals must be omitted, not null")
        let tab = (json["tabs"] as! [[String: Any]])[0]
        XCTAssertEqual(tab["windowId"] as? Int, 7)
        XCTAssertNil(tab["title"], "nil optionals must be omitted, not null")
    }

    // MARK: - Device folding

    func testInactiveThresholdIsFifteenMinutes() {
        var device = LiveDevice(
            deviceId: "d", label: "l", browser: "chrome", device: "laptop", os: nil,
            windows: [], tabCount: 0, hiddenTabCount: 0,
            lastSeenAt: "2026-08-29T00:00:00.000Z", lastSeenAgeSeconds: 899
        )
        XCTAssertFalse(device.isInactive)
        device.lastSeenAgeSeconds = 900
        XCTAssertTrue(device.isInactive)
    }
}
