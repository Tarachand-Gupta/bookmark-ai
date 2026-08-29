import Foundation
import Observation

/// How the detail column lays bookmarks out. Grid is the default — it's the
/// browsing view; the list is the scanning view.
enum LibraryLayout: String, CaseIterable, Identifiable, Sendable {
    case grid
    case list

    var id: String { rawValue }

    var title: String {
        switch self {
        case .grid: "Grid"
        case .list: "List"
        }
    }

    var symbolName: String {
        switch self {
        case .grid: "square.grid.2x2"
        case .list: "list.bullet"
        }
    }
}

/// User-facing settings, backed by `UserDefaults`.
///
/// Deliberately tiny — which server to talk to, and how the library is laid out.
/// The server defaults to `.local` so a `pnpm dev` session is the zero-config
/// path, matching how every other client in this repo behaves in development.
@MainActor
@Observable
final class Preferences {

    private enum Key {
        static let serverTarget = "serverTarget"
        static let libraryLayout = "libraryLayout"
    }

    var serverTarget: ServerTarget {
        didSet {
            guard serverTarget != oldValue else { return }
            defaults.set(serverTarget.rawValue, forKey: Key.serverTarget)
        }
    }

    var libraryLayout: LibraryLayout {
        didSet {
            guard libraryLayout != oldValue else { return }
            defaults.set(libraryLayout.rawValue, forKey: Key.libraryLayout)
        }
    }

    private let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let storedTarget = defaults.string(forKey: Key.serverTarget)
        self.serverTarget = storedTarget.flatMap(ServerTarget.init(rawValue:)) ?? .local
        let storedLayout = defaults.string(forKey: Key.libraryLayout)
        self.libraryLayout = storedLayout.flatMap(LibraryLayout.init(rawValue:)) ?? .grid
    }
}
