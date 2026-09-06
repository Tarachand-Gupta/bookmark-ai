import Foundation
import Observation
import OSLog

/// "Is there a newer Bookmark AI?" — polls `GET /api/app/releases` when the
/// gate opens and every 6 h after, compares the macOS record with the running
/// bundle (`CFBundleShortVersionString` + `CFBundleVersion`), and exposes the
/// one `banner` the sidebar shows. Rules (contract §12): never a banner for an
/// absent record, a failed request, or the same/older version; "Later" snoozes
/// THAT version for 24 h in `UserDefaults`; `unsupported` cannot be snoozed.
@MainActor
@Observable
final class AppUpdateModel {

    /// What the sidebar renders. `isBlocking` = below `minSupportedVersion`.
    struct Banner: Equatable {
        let version: String
        /// First non-empty line of the release notes, sans markdown bullet.
        let notes: String?
        let downloadURL: URL
        let isBlocking: Bool
    }

    static let pollInterval: Duration = .seconds(6 * 3600)
    static let snoozeInterval: TimeInterval = 24 * 3600
    private static let log = Logger(subsystem: "ai.purecode.bookmarkai", category: "updates")

    /// The running app's version + build.
    private(set) var current: VersionRef
    /// The macOS record from the last SUCCESSFUL fetch (a failure keeps it).
    private(set) var release: AppRelease?
    private(set) var state: UpdateState = .current
    /// "Later" for `release.version`, if any — mirrored from defaults so the
    /// view re-evaluates when it changes.
    private(set) var snoozedUntil: Date?

    private let api: ApiClient
    private let defaults: UserDefaults
    private let now: () -> Date
    private var pollTask: Task<Void, Never>?

    #if DEBUG
    /// Tests: stand in for the network.
    var fetchOverride: (() async throws -> AppReleasesResponse)?
    #endif

    init(
        api: ApiClient,
        current: VersionRef? = nil,
        defaults: UserDefaults = .standard,
        now: @escaping () -> Date = Date.init
    ) {
        self.api = api
        self.defaults = defaults
        self.now = now
        self.current = current ?? Self.bundleVersion()
    }

    /// `CFBundleShortVersionString` + `CFBundleVersion` of the running app.
    nonisolated static func bundleVersion(_ bundle: Bundle = .main) -> VersionRef {
        let version = bundle.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
        let build = bundle.object(forInfoDictionaryKey: "CFBundleVersion") as? String
        return VersionRef(version: version, build: (build?.isEmpty ?? true) ? nil : build)
    }

    // MARK: - What to show

    var banner: Banner? {
        guard let release, let url = URL(string: release.downloadUrl) else { return nil }
        switch state {
        case .current:
            return nil
        case .unsupported:
            return Banner(version: release.version, notes: Self.firstLine(release.releaseNotes), downloadURL: url, isBlocking: true)
        case .updateAvailable:
            if let snoozedUntil, snoozedUntil > now() { return nil }
            return Banner(version: release.version, notes: Self.firstLine(release.releaseNotes), downloadURL: url, isBlocking: false)
        }
    }

    /// The first non-empty line, without a leading markdown bullet/heading mark.
    nonisolated static func firstLine(_ notes: String?) -> String? {
        guard let notes else { return nil }
        for raw in notes.split(whereSeparator: \.isNewline) {
            var line = raw.trimmingCharacters(in: .whitespaces)
            while let first = line.first, "-*#•".contains(first) {
                line = String(line.dropFirst()).trimmingCharacters(in: .whitespaces)
            }
            if !line.isEmpty { return line }
        }
        return nil
    }

    // MARK: - Polling

    /// Fetch now and every `pollInterval` after. Idempotent while running.
    func start() {
        guard pollTask == nil else { return }
        pollTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(for: Self.pollInterval)
            }
        }
    }

    func stop() {
        pollTask?.cancel()
        pollTask = nil
    }

    var isPolling: Bool { pollTask != nil }

    /// One fetch. Silent on failure: the previous answer (or none) stands, so a
    /// blip can neither conjure nor hide a banner on its own.
    func refresh() async {
        do {
            let response: AppReleasesResponse
            #if DEBUG
            if let fetchOverride {
                response = try await fetchOverride()
            } else {
                response = try await api.appReleases()
            }
            #else
            response = try await api.appReleases()
            #endif
            guard !Task.isCancelled else { return }
            apply(response.releases.macos)
        } catch {
            Self.log.info("release check failed — keeping previous answer: \(String(describing: error), privacy: .public)")
        }
    }

    private func apply(_ record: AppRelease?) {
        release = record
        state = AppVersioning.updateState(current: current, release: record)
        snoozedUntil = record.flatMap { defaults.object(forKey: Self.snoozeKey($0.version)) as? Date }
        Self.log.info("release check: running \(self.current.version, privacy: .public) (\(self.current.build ?? "-", privacy: .public)), latest \(record?.version ?? "none", privacy: .public) → \(String(describing: self.state), privacy: .public)")
    }

    // MARK: - Later

    /// Hide this version's banner for 24 h. Blocking banners ignore it.
    func snooze() {
        guard let release, state == .updateAvailable else { return }
        let until = now().addingTimeInterval(Self.snoozeInterval)
        defaults.set(until, forKey: Self.snoozeKey(release.version))
        snoozedUntil = until
        Self.log.notice("update \(release.version, privacy: .public) snoozed until \(until, privacy: .public)")
    }

    nonisolated static func snoozeKey(_ version: String) -> String { "appUpdate.snoozedUntil.\(version)" }

    #if DEBUG
    /// Previews/tests: a release (and optionally a running version) without a server.
    func seed(release: AppRelease?, current: VersionRef? = nil) {
        if let current { self.current = current }
        apply(release)
    }
    #endif
}
