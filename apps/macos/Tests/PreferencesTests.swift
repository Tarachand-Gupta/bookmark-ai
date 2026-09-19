import XCTest
@testable import BookmarkAI

/// The layout preference must survive relaunch and default sensibly — a wrong
/// default or a non-persisting didSet would both pass the compiler silently.
final class PreferencesTests: XCTestCase {

    @MainActor
    func testServerTargetDefaultsToCloud() {
        let suiteName = "PreferencesTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        XCTAssertEqual(Preferences(defaults: defaults).serverTarget, .cloud)
        XCTAssertNil(defaults.string(forKey: "serverTarget"), "a default is not an explicit choice")
    }

    @MainActor
    func testStoredLocalSurvivesMigrationAndCloudPersists() {
        let suiteName = "PreferencesTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        defaults.set(ServerTarget.local.rawValue, forKey: "serverTarget")
        XCTAssertEqual(Preferences(defaults: defaults).serverTarget, .local)

        let preferences = Preferences(defaults: defaults)
        preferences.serverTarget = .cloud
        XCTAssertEqual(Preferences(defaults: defaults).serverTarget, .cloud)

        let cloudPreferences = Preferences(defaults: defaults)
        cloudPreferences.serverTarget = .local
        XCTAssertEqual(Preferences(defaults: defaults).serverTarget, .local)
    }

    @MainActor
    func testUnknownStoredTargetFallsBackToCloudWithoutOverwritingIt() {
        let suiteName = "PreferencesTests-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suiteName)!
        defer { defaults.removePersistentDomain(forName: suiteName) }

        defaults.set("staging", forKey: "serverTarget")
        XCTAssertEqual(Preferences(defaults: defaults).serverTarget, .cloud)
        XCTAssertEqual(defaults.string(forKey: "serverTarget"), "staging")
    }

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
