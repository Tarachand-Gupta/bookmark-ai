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
