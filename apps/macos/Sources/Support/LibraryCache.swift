import Foundation

/// The library data the app shows at rest — one JSON snapshot per server
/// target, written through on every successful refresh and read once at
/// startup so the window can render LAST SESSION'S data before the first
/// network round-trip. No schema ceremony: one file, atomic writes,
/// last-write-wins; a write simply replaces it.
struct LibraryCacheState: Codable, Sendable {
    /// Which backend the snapshot came from (`ServerTarget.rawValue`). A
    /// snapshot for the other target is never shown — it is dropped.
    var serverTarget: String
    /// The unfiltered All-Bookmarks list (`selection == .allBookmarks`, no
    /// filters, no search) — the state the app always starts in.
    var bookmarks: [Bookmark]
    var total: Int
    var meta: MetaResponse
    var sessions: [Session]
}

/// Reads and writes the snapshot. The location follows the app's other
/// durable storage: `Application Support/<bundle id>/cache/library.json`
/// (inside the sandbox container). `directory` is injectable so tests use a
/// throwaway folder instead of Tara's real cache.
@MainActor
final class LibraryCache {

    /// The app's real cache directory. Only the app target uses this — the
    /// unit-test host IS the app, so tests always pass their own `directory`.
    static let shared = LibraryCache()

    private let fileURL: URL

    init(directory: URL? = nil) {
        let base = directory ?? {
            let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
                ?? FileManager.default.temporaryDirectory
            let bundleID = Bundle.main.bundleIdentifier ?? "BookmarkAI"
            return support.appendingPathComponent(bundleID, isDirectory: true)
                .appendingPathComponent("cache", isDirectory: true)
        }()
        self.fileURL = base.appendingPathComponent("library.json")
        // Created once; every write lands in the same file, so the cache is
        // size-bounded by construction (a bookmark list + facets + sessions).
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    }

    /// The snapshot, or nil when there is none (true first run) or it can't be
    /// decoded (corrupt, or an older app shaped it differently) — a nil read
    /// degrades to the first-run loading path, never to an error.
    func read() -> LibraryCacheState? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return try? JSONDecoder().decode(LibraryCacheState.self, from: data)
    }

    /// Replace the snapshot. Atomic, so a crash mid-write can't leave a
    /// half-written file behind.
    func write(_ state: LibraryCacheState) {
        guard let data = try? JSONEncoder().encode(state) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    /// Drop the snapshot — on sign-out (it is account data), on a server-target
    /// switch, and when a read finds a snapshot for the other target.
    func delete() {
        try? FileManager.default.removeItem(at: fileURL)
    }
}
