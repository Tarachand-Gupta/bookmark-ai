import Foundation

/// `GET /api/app/releases` — the latest shipped version per platform, from the
/// master control-plane DB. Mirrors `packages/types/src/releases.ts`; the
/// version helpers below copy that file's semantics EXACTLY (numeric segments,
/// build tie-break only when both sides carry one), so the server's admin form
/// and every native client agree on what "newer" means.
struct AppRelease: Codable, Equatable, Sendable {
    /// `"macos" | "ios" | "android"` — kept as a string so an unknown platform
    /// added server-side can never fail the whole decode.
    var platform: String
    /// Marketing version, semver `x.y.z`.
    var version: String
    /// CFBundleVersion / buildNumber / versionCode — tie-break, optional.
    var build: String?
    /// Below this the client shows a blocking (non-dismissible) banner.
    var minSupportedVersion: String?
    /// macOS: the releases page.
    var downloadUrl: String
    /// Short markdown, optional.
    var releaseNotes: String?
    var publishedAt: String
    var updatedAt: String
}

/// `{ releases: { macos?, ios?, android? } }` — absent key = no record.
struct AppReleasesResponse: Codable, Equatable, Sendable {
    struct Releases: Codable, Equatable, Sendable {
        var macos: AppRelease?
        var ios: AppRelease?
        var android: AppRelease?
    }

    var releases: Releases
}

/// A version with an optional build — the running bundle, or a release.
struct VersionRef: Equatable, Sendable {
    var version: String
    var build: String?

    init(version: String, build: String? = nil) {
        self.version = version
        self.build = build
    }
}

/// What a running client should do given the platform's release record.
enum UpdateState: Equatable, Sendable {
    /// No record, or the same/newer version is running — no banner.
    case current
    /// A newer version exists — dismissible banner.
    case updateAvailable
    /// The running version is below `minSupportedVersion` — blocking banner.
    case unsupported
}

/// The pure version arithmetic, ported line-for-line from `releases.ts`.
enum AppVersioning {

    /// `"v1.2.3"` / `"1.2"` / `"1.2.3-beta"` → `[1, 2, 3]`; non-numeric segments
    /// count as 0. Follows JS `parseInt(part, 10)`: leading whitespace and a
    /// sign are allowed, digits are read as a prefix (`"3-beta"` → 3), anything
    /// else (or a negative) is 0. Empty segments (`"1..2"`) are kept, as 0.
    static func segments(_ value: String) -> [Int] {
        var trimmed = Substring(value.trimmingCharacters(in: .whitespacesAndNewlines))
        if let first = trimmed.first, first == "v" || first == "V" {
            trimmed = trimmed.dropFirst()
        }
        return trimmed
            .split(separator: ".", omittingEmptySubsequences: false)
            .map { part in
                guard let n = parseInt(part), n >= 0 else { return 0 }
                return n
            }
    }

    /// JS `parseInt(x, 10)`: nil where JS yields NaN.
    private static func parseInt(_ part: Substring) -> Int? {
        var rest = part.drop(while: { $0 == " " || $0 == "\t" || $0 == "\n" || $0 == "\r" })
        var negative = false
        if let sign = rest.first, sign == "+" || sign == "-" {
            negative = sign == "-"
            rest = rest.dropFirst()
        }
        let digits = rest.prefix(while: { $0.isASCII && $0.isWholeNumber })
        guard !digits.isEmpty, let n = Int(digits) else { return nil }
        return negative ? -n : n
    }

    /// Segment-wise, missing components read as 0 (`1.2` == `1.2.0`).
    static func compareSegments(_ a: [Int], _ b: [Int]) -> Int {
        for index in 0..<max(a.count, b.count) {
            let x = index < a.count ? a[index] : 0
            let y = index < b.count ? b[index] : 0
            if x < y { return -1 }
            if x > y { return 1 }
        }
        return 0
    }

    /// -1 when `a` is older, 0 when equal, 1 when newer. Versions compare
    /// numerically; when they are equal and BOTH sides carry a build, the
    /// build breaks the tie (segment-wise for dotted builds). A missing build
    /// on either side never breaks a tie. Prereleases are not modelled.
    static func compareVersions(_ a: VersionRef, _ b: VersionRef) -> Int {
        let byVersion = compareSegments(segments(a.version), segments(b.version))
        if byVersion != 0 { return byVersion }
        guard let ab = a.build, let bb = b.build else { return 0 }
        return compareSegments(segments(ab), segments(bb))
    }

    /// Plain version strings — no builds involved.
    static func compareVersions(_ a: String, _ b: String) -> Int {
        compareVersions(VersionRef(version: a), VersionRef(version: b))
    }

    /// - no record → `.current` (never show a banner without data)
    /// - own version below `minSupportedVersion` → `.unsupported`
    /// - own version+build below the release → `.updateAvailable`
    /// - same or newer → `.current`
    static func updateState(current: VersionRef, release: AppRelease?) -> UpdateState {
        guard let release else { return .current }
        if let minimum = release.minSupportedVersion, !minimum.isEmpty,
           compareVersions(current.version, minimum) < 0 {
            return .unsupported
        }
        let target = VersionRef(version: release.version, build: release.build)
        return compareVersions(current, target) < 0 ? .updateAvailable : .current
    }
}
