import XCTest
@testable import BookmarkAI

/// The layout preference must survive relaunch and default sensibly — a wrong
/// default or a non-persisting didSet would both pass the compiler silently.
final class PreferencesTests: XCTestCase {

    @MainActor
    func testLibraryLayoutDefaultsToGridAndPersists() {
        let suiteName = "PreferencesTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        let preferences = Preferences(defaults: defaults)
        XCTAssertEqual(preferences.libraryLayout, .grid)

        preferences.libraryLayout = .list
        XCTAssertEqual(Preferences(defaults: defaults).libraryLayout, .list)
    }

    @MainActor
    func testUnknownStoredLayoutFallsBackToGrid() {
        let suiteName = "PreferencesTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        defaults.set("mosaic", forKey: "libraryLayout")
        XCTAssertEqual(Preferences(defaults: defaults).libraryLayout, .grid)
    }
}
