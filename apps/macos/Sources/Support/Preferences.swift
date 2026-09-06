import AppKit
import Foundation
import Observation

/// Light / Dark / System, applied app-wide via `NSApp.appearance`.
enum AppearanceMode: String, CaseIterable, Identifiable, Sendable {
    case system
    case light
    case dark

    var id: String { rawValue }

    var title: String {
        switch self {
        case .system: "System"
        case .light: "Light"
        case .dark: "Dark"
        }
    }

    /// nil = follow the system setting.
    var nsAppearance: NSAppearance? {
        switch self {
        case .system: nil
        case .light: NSAppearance(named: .aqua)
        case .dark: NSAppearance(named: .darkAqua)
        }
    }
}

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
        static let appearance = "appearanceMode"
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

    var appearance: AppearanceMode {
        didSet {
            guard appearance != oldValue else { return }
            defaults.set(appearance.rawValue, forKey: Key.appearance)
            applyAppearance()
        }
    }

    /// Pushes the chosen mode onto the whole app. Also called once at launch.
    func applyAppearance() {
        NSApp.appearance = appearance.nsAppearance
    }

    /// Internal so the other UserDefaults-backed models (`AppUpdateModel`'s
    /// snooze) share the same store — the app's, or a test's throwaway suite.
    let defaults: UserDefaults

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        let storedTarget = defaults.string(forKey: Key.serverTarget)
        self.serverTarget = storedTarget.flatMap(ServerTarget.init(rawValue:)) ?? .local
        let storedLayout = defaults.string(forKey: Key.libraryLayout)
        self.libraryLayout = storedLayout.flatMap(LibraryLayout.init(rawValue:)) ?? .grid
        let storedAppearance = defaults.string(forKey: Key.appearance)
        self.appearance = storedAppearance.flatMap(AppearanceMode.init(rawValue:)) ?? .system
    }
}
