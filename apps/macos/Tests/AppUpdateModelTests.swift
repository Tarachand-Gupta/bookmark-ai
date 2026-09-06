import XCTest
@testable import BookmarkAI

/// The banner rules from contract §12, driven through `fetchOverride`, a
/// throwaway defaults suite and a controllable clock: newer ⇒ banner; same/
/// older/absent/failed ⇒ none; Later snoozes THAT version for 24 h and
/// survives a relaunch; unsupported can't be snoozed.
final class AppUpdateModelTests: XCTestCase {

    private var suiteName = ""
    private var defaults: UserDefaults!
    private var clock = Date(timeIntervalSince1970: 1_800_000_000)

    override func setUp() {
        super.setUp()
        suiteName = "AppUpdateModelTests-\(UUID().uuidString)"
        defaults = UserDefaults(suiteName: suiteName)!
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: suiteName)
        super.tearDown()
    }

    private func release(
        _ version: String, build: String? = "9", minSupported: String? = nil, notes: String? = "Faster search"
    ) -> AppRelease {
        AppRelease(
            platform: "macos", version: version, build: build, minSupportedVersion: minSupported,
            downloadUrl: "https://github.com/Tarachand-Gupta/bookmark-ai/releases",
            releaseNotes: notes, publishedAt: "2026-09-06T23:21:37.879Z", updatedAt: "2026-09-06T23:21:37.879Z"
        )
    }

    /// A model running 0.1.0 (1) that "fetches" the given record.
    @MainActor
    private func makeModel(serving record: AppRelease?, failing: Bool = false) -> AppUpdateModel {
        let model = AppUpdateModel(
            api: ApiClient(target: .local),
            current: VersionRef(version: "0.1.0", build: "1"),
            defaults: defaults,
            now: { [unowned self] in self.clock }
        )
        model.fetchOverride = {
            if failing { throw ApiError.network("offline") }
            return AppReleasesResponse(releases: .init(macos: record, ios: nil, android: nil))
        }
        return model
    }

    @MainActor
    func testNewerReleaseShowsADismissibleBanner() async throws {
        let model = makeModel(serving: release("9.9.9"))
        XCTAssertNil(model.banner, "nothing before the first answer")

        await model.refresh()

        let banner = try XCTUnwrap(model.banner)
        XCTAssertEqual(banner.version, "9.9.9")
        XCTAssertEqual(banner.notes, "Faster search")
        XCTAssertEqual(banner.downloadURL.absoluteString, "https://github.com/Tarachand-Gupta/bookmark-ai/releases")
        XCTAssertFalse(banner.isBlocking)
        XCTAssertEqual(model.state, .updateAvailable)
    }

    @MainActor
    func testSameOlderAbsentOrFailedShowNothing() async {
        let same = makeModel(serving: release("0.1.0", build: "1"))
        await same.refresh()
        XCTAssertNil(same.banner, "same version")

        let older = makeModel(serving: release("0.0.9"))
        await older.refresh()
        XCTAssertNil(older.banner, "older version")

        let absent = makeModel(serving: nil)
        await absent.refresh()
        XCTAssertNil(absent.banner, "no record")

        let failed = makeModel(serving: release("9.9.9"), failing: true)
        await failed.refresh()
        XCTAssertNil(failed.banner, "a failed request never conjures a banner")
        XCTAssertEqual(failed.state, .current)
    }

    @MainActor
    func testFailureKeepsThePreviousAnswer() async {
        let model = makeModel(serving: release("9.9.9"))
        await model.refresh()
        XCTAssertNotNil(model.banner)

        model.fetchOverride = { throw ApiError.network("offline") }
        await model.refresh()
        XCTAssertNotNil(model.banner, "a later blip does not hide a banner already earned")
    }

    @MainActor
    func testLaterSnoozesForTwentyFourHoursAndSurvivesRelaunch() async {
        let model = makeModel(serving: release("9.9.9"))
        await model.refresh()
        XCTAssertNotNil(model.banner)

        model.snooze()
        XCTAssertNil(model.banner, "hidden right after Later")
        XCTAssertNotNil(defaults.object(forKey: AppUpdateModel.snoozeKey("9.9.9")), "persisted")

        // "Relaunch": a fresh model on the same defaults, same clock.
        let relaunched = makeModel(serving: release("9.9.9"))
        await relaunched.refresh()
        XCTAssertNil(relaunched.banner, "still hidden after a relaunch")

        clock = clock.addingTimeInterval(23 * 3600)
        XCTAssertNil(relaunched.banner, "23 h later: still snoozed")

        clock = clock.addingTimeInterval(2 * 3600)
        XCTAssertNotNil(relaunched.banner, "25 h later: back")
    }

    @MainActor
    func testSnoozeIsPerVersion() async {
        let model = makeModel(serving: release("9.9.9"))
        await model.refresh()
        model.snooze()
        XCTAssertNil(model.banner)

        // A newer release lands while 9.9.9 is snoozed.
        model.fetchOverride = { AppReleasesResponse(releases: .init(macos: self.release("9.9.10"), ios: nil, android: nil)) }
        await model.refresh()
        XCTAssertEqual(model.banner?.version, "9.9.10", "a different version is not covered by the old snooze")
    }

    @MainActor
    func testUnsupportedIsBlockingAndCannotBeSnoozed() async throws {
        let model = makeModel(serving: release("9.9.9", minSupported: "9.0.0"))
        await model.refresh()

        let banner = try XCTUnwrap(model.banner)
        XCTAssertTrue(banner.isBlocking)
        XCTAssertEqual(model.state, .unsupported)

        model.snooze()
        XCTAssertNotNil(model.banner, "Later is a no-op for a blocking banner")
        XCTAssertNil(defaults.object(forKey: AppUpdateModel.snoozeKey("9.9.9")))
    }

    @MainActor
    func testStartFetchesAndStopEndsPolling() async throws {
        let model = makeModel(serving: release("9.9.9"))
        XCTAssertFalse(model.isPolling)

        model.start()
        model.start() // idempotent
        XCTAssertTrue(model.isPolling)
        for _ in 0..<200 where model.banner == nil {
            try await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertNotNil(model.banner, "start() fetches immediately")

        model.stop()
        XCTAssertFalse(model.isPolling)
        XCTAssertEqual(AppUpdateModel.pollInterval, .seconds(6 * 3600))
        XCTAssertEqual(AppUpdateModel.snoozeInterval, 24 * 3600)
    }

    func testFirstLineOfNotesDropsBulletsAndBlankLines() {
        XCTAssertEqual(AppUpdateModel.firstLine("Faster search"), "Faster search")
        XCTAssertEqual(AppUpdateModel.firstLine("\n\n- Fixed sign-out\n- More"), "Fixed sign-out")
        XCTAssertEqual(AppUpdateModel.firstLine("## What's new\nStuff"), "What's new")
        XCTAssertNil(AppUpdateModel.firstLine(nil))
        XCTAssertNil(AppUpdateModel.firstLine("   \n  "))
    }
}
