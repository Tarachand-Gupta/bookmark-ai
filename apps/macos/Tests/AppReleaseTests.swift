import XCTest
@testable import BookmarkAI

/// The version arithmetic must match `packages/types/src/releases.ts` exactly —
/// the server's admin form and every native client decide "newer" with it.
final class AppReleaseTests: XCTestCase {

    private func release(
        _ version: String, build: String? = nil, minSupported: String? = nil
    ) -> AppRelease {
        AppRelease(
            platform: "macos", version: version, build: build, minSupportedVersion: minSupported,
            downloadUrl: "https://github.com/Tarachand-Gupta/bookmark-ai/releases",
            releaseNotes: nil, publishedAt: "2026-09-06T23:21:37.879Z", updatedAt: "2026-09-06T23:21:37.879Z"
        )
    }

    // MARK: - segments

    func testSegmentsAreNumericAndLenient() {
        XCTAssertEqual(AppVersioning.segments("1.2.3"), [1, 2, 3])
        XCTAssertEqual(AppVersioning.segments("v1.2.3"), [1, 2, 3], "leading v is stripped")
        XCTAssertEqual(AppVersioning.segments(" 0.10.0 "), [0, 10, 0])
        XCTAssertEqual(AppVersioning.segments("1.2.3-beta"), [1, 2, 3], "parseInt reads the digit prefix")
        XCTAssertEqual(AppVersioning.segments("1.beta.3"), [1, 0, 3], "non-numeric → 0")
        XCTAssertEqual(AppVersioning.segments("1..2"), [1, 0, 2], "empty segment is kept as 0")
        XCTAssertEqual(AppVersioning.segments("1.-2.3"), [1, 0, 3], "negatives → 0")
        XCTAssertEqual(AppVersioning.segments("42"), [42])
    }

    // MARK: - compareVersions

    func testCompareVersionsIsNumericNotLexical() {
        XCTAssertEqual(AppVersioning.compareVersions("0.10.0", "0.9.0"), 1)
        XCTAssertEqual(AppVersioning.compareVersions("0.9.0", "0.10.0"), -1)
        XCTAssertEqual(AppVersioning.compareVersions("1.2.3", "1.2.4"), -1)
        XCTAssertEqual(AppVersioning.compareVersions("2.0.0", "1.99.99"), 1)
    }

    func testMissingComponentsReadAsZero() {
        XCTAssertEqual(AppVersioning.compareVersions("1.2", "1.2.0"), 0)
        XCTAssertEqual(AppVersioning.compareVersions("1.2.0.0", "1.2"), 0)
        XCTAssertEqual(AppVersioning.compareVersions("1.2.0.1", "1.2"), 1)
        XCTAssertEqual(AppVersioning.compareVersions("v1.2.3", "1.2.3"), 0)
        XCTAssertEqual(AppVersioning.compareVersions("1.2.3-beta", "1.2.3"), 0, "prereleases are not modelled")
    }

    func testBuildBreaksTiesOnlyWhenBothSidesHaveOne() {
        let base = "1.0.0"
        XCTAssertEqual(
            AppVersioning.compareVersions(VersionRef(version: base, build: "9"), VersionRef(version: base, build: "10")),
            -1, "numeric, not lexical (9 < 10)"
        )
        XCTAssertEqual(
            AppVersioning.compareVersions(VersionRef(version: base, build: "1.0.3"), VersionRef(version: base, build: "1.0.10")),
            -1, "dotted builds compare segment-wise"
        )
        XCTAssertEqual(
            AppVersioning.compareVersions(VersionRef(version: base, build: "2"), VersionRef(version: base, build: "2")), 0
        )
        XCTAssertEqual(
            AppVersioning.compareVersions(VersionRef(version: base, build: nil), VersionRef(version: base, build: "99")),
            0, "a missing build never breaks a tie"
        )
        XCTAssertEqual(
            AppVersioning.compareVersions(VersionRef(version: base, build: "99"), VersionRef(version: base, build: nil)), 0
        )
        XCTAssertEqual(
            AppVersioning.compareVersions(VersionRef(version: base, build: nil), VersionRef(version: base, build: nil)), 0
        )
    }

    func testVersionWinsOverBuild() {
        XCTAssertEqual(
            AppVersioning.compareVersions(VersionRef(version: "1.0.0", build: "99"), VersionRef(version: "1.0.1", build: "1")),
            -1
        )
    }

    // MARK: - updateState

    func testNoRecordIsCurrent() {
        XCTAssertEqual(AppVersioning.updateState(current: VersionRef(version: "0.1.0", build: "1"), release: nil), .current)
    }

    func testNewerReleaseIsUpdateAvailable() {
        let current = VersionRef(version: "0.1.0", build: "1")
        XCTAssertEqual(AppVersioning.updateState(current: current, release: release("9.9.9", build: "9")), .updateAvailable)
        XCTAssertEqual(AppVersioning.updateState(current: current, release: release("0.1.1")), .updateAvailable)
        XCTAssertEqual(
            AppVersioning.updateState(current: current, release: release("0.1.0", build: "2")),
            .updateAvailable, "same version, newer build"
        )
    }

    func testSameOrOlderReleaseIsCurrent() {
        let current = VersionRef(version: "0.1.0", build: "1")
        XCTAssertEqual(AppVersioning.updateState(current: current, release: release("0.1.0", build: "1")), .current)
        XCTAssertEqual(AppVersioning.updateState(current: current, release: release("0.1.0")), .current, "no build on the record ⇒ no tie-break")
        XCTAssertEqual(AppVersioning.updateState(current: current, release: release("0.0.9", build: "50")), .current)
        XCTAssertEqual(
            AppVersioning.updateState(current: VersionRef(version: "1.0.0"), release: release("0.9.0")),
            .current, "running ahead of the record (a dev build) is current"
        )
    }

    func testBelowMinimumIsUnsupportedRegardlessOfBuild() {
        let current = VersionRef(version: "0.1.0", build: "1")
        XCTAssertEqual(
            AppVersioning.updateState(current: current, release: release("9.9.9", build: "9", minSupported: "9.0.0")),
            .unsupported
        )
        XCTAssertEqual(
            AppVersioning.updateState(current: current, release: release("9.9.9", minSupported: "0.1.0")),
            .updateAvailable, "at the minimum is still supported"
        )
        XCTAssertEqual(
            AppVersioning.updateState(current: current, release: release("9.9.9", minSupported: "")),
            .updateAvailable, "an empty minimum is 'unset', like the TS truthiness check"
        )
    }

    // MARK: - Decoding

    func testDecodesTheLiveShape() throws {
        let json = Data("""
        {"releases":{"macos":{"platform":"macos","version":"9.9.9","build":"9","minSupportedVersion":null,"downloadUrl":"https://github.com/Tarachand-Gupta/bookmark-ai/releases","releaseNotes":"Faster search","publishedAt":"2026-09-06T23:21:37.879Z","updatedAt":"2026-09-06T23:21:37.879Z"}}}
        """.utf8)
        let response = try ApiClient.decoder.decode(AppReleasesResponse.self, from: json)
        let macos = try XCTUnwrap(response.releases.macos)
        XCTAssertEqual(macos.version, "9.9.9")
        XCTAssertEqual(macos.build, "9")
        XCTAssertNil(macos.minSupportedVersion)
        XCTAssertEqual(macos.releaseNotes, "Faster search")
        XCTAssertNil(response.releases.ios)
        XCTAssertNil(response.releases.android)
    }

    func testDecodesTheEmptyShape() throws {
        let response = try ApiClient.decoder.decode(AppReleasesResponse.self, from: Data(#"{"releases":{}}"#.utf8))
        XCTAssertNil(response.releases.macos)
        XCTAssertEqual(AppVersioning.updateState(current: VersionRef(version: "0.1.0"), release: response.releases.macos), .current)
    }

    func testBundleVersionReadsInfoPlist() {
        // The app's Info.plist carries MARKETING_VERSION / CURRENT_PROJECT_VERSION.
        let current = AppUpdateModel.bundleVersion(Bundle(for: AppEnvironment.self))
        XCTAssertFalse(current.version.isEmpty)
        XCTAssertNotEqual(current.version, "0.0.0")
        XCTAssertNotNil(current.build)
    }
}
