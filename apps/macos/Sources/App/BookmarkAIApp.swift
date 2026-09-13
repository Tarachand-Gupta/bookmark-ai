import SwiftUI

@main
struct BookmarkAIApp: App {

    /// The dock-reopen handler (Bug 2): with the window closed (red button)
    /// the app keeps running, and macOS asks the delegate whether clicking the
    /// Dock icon should reopen a window. SwiftUI's WindowGroup alone answers
    /// nothing there — the window stayed shut until quit+relaunch.
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    /// The whole object graph, built once and shared by every scene.
    @State private var appEnvironment = AppEnvironment()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(appEnvironment)
                .frame(minWidth: 760, minHeight: 480)
                // NSApp isn't up during App.init, so the persisted Light/Dark/
                // System choice lands here, before first paint.
                .onAppear { appEnvironment.preferences.applyAppearance() }
                .task { await appEnvironment.start() }
                // Remember THE MAIN window so a later dock click can bring it
                // back with its state. The reader anchors in this scene's
                // hierarchy only — the Settings window (its own scene) never
                // touches it, so ⌘, can't hijack the reopen target the way an
                // app-wide didBecomeKey listener would.
                .background(MainWindowReader { AppDelegate.mainWindow = $0 })
        }
        .defaultSize(width: 1120, height: 760)
        // Title and toolbar share one bar, so the sidebar's material runs
        // straight up into the title bar — the standard modern Mac app look.
        .windowToolbarStyle(.unified)
        .commands {
            // Phase 1 is a single-window app: a second window would just mirror
            // this one's state, so File ▸ New Window is removed rather than
            // shipped broken.
            CommandGroup(replacing: .newItem) {}
            SidebarCommands()
            LibraryCommands(appEnvironment: appEnvironment)
        }

        Settings {
            SettingsView()
                .environment(appEnvironment)
        }
    }
}

/// The app delegate owns exactly one job: `applicationShouldHandleReopen`.
/// Closing the main window leaves the app RUNNING (the Dock dot stays); a
/// dock click with no visible window must bring the SAME window back, with
/// its previous state — SwiftUI's WindowGroup does not do this on its own.
/// The window itself is captured from inside the WindowGroup's hierarchy by
/// `MainWindowReader` below, never from an app-wide notification (which the
/// Settings window's activation would also fire).
final class AppDelegate: NSObject, NSApplicationDelegate {

    /// The main window, captured by `MainWindowReader`. Static so the reopen
    /// decision helper can be exercised by unit tests without NSApp.
    static weak var mainWindow: NSWindow?

    func applicationShouldHandleReopen(_ application: NSApplication, hasVisibleWindows: Bool) -> Bool {
        Self.reopen(hasVisibleWindows: hasVisibleWindows, window: Self.mainWindow)
    }

    /// The pure decision `applicationShouldHandleReopen` delegates to —
    /// unit-tested. Returns whether macOS's default handling suffices: yes
    /// when a window is already visible, and yes after we've re-shown the
    /// captured main window (returning true stops the framework from
    /// creating an extra one). With no captured window yet (dock click in
    /// the instant before first paint) there is nothing to re-show; true
    /// keeps the framework's own handling.
    static func reopen(hasVisibleWindows: Bool, window: NSWindow?) -> Bool {
        guard !hasVisibleWindows else { return true }
        if let window {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
        return true
    }
}

/// Anchors an invisible view in the main window's hierarchy and reports that
/// window once it exists — the one way to know WHICH window this scene owns
/// without betting on SwiftUI's private window identifiers. Lives only in the
/// `WindowGroup`'s content: the Settings scene renders `SettingsView`, never
/// this reader, so it can never overwrite the reopen target.
private struct MainWindowReader: NSViewRepresentable {
    let onWindow: (NSWindow) -> Void

    func makeNSView(context: Context) -> MainWindowAnchorView {
        let view = MainWindowAnchorView()
        view.onWindow = onWindow
        return view
    }

    func updateNSView(_ nsView: MainWindowAnchorView, context: Context) {
        nsView.onWindow = onWindow
    }

    /// Reports its host window the moment AppKit attaches it (and again on
    /// re-attach, e.g. when the closed window is brought back — idempotent).
    final class MainWindowAnchorView: NSView {
        var onWindow: ((NSWindow) -> Void)?

        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            if let window { onWindow?(window) }
        }
    }
}

/// Menu-bar entries for the library. Every toolbar action has a menu equivalent
/// with a shortcut — on macOS the menu bar, not the toolbar, is the canonical
/// home for an app's actions. Everything that needs account data is disabled
/// while the gate is closed (signed out / connecting on Cloud); only Open Web
/// App stays live.
struct LibraryCommands: Commands {
    let appEnvironment: AppEnvironment

    private func goTo(_ item: SidebarItem) {
        Task { await appEnvironment.library.select(item) }
    }

    var body: some Commands {
        let canUseData = appEnvironment.canUseData

        CommandMenu("Library") {
            Button("Refresh") {
                Task { await appEnvironment.loadEverything() }
            }
            .keyboardShortcut("r", modifiers: .command)
            .disabled(!canUseData)

            Divider()

            // Check-marked menu items for the layout. Toggles rather than an
            // inline Picker: a Picker's items ignore `.disabled` (only its
            // header greys out), and these must go quiet with the rest while
            // the gate is closed.
            Text("View")
            ForEach(LibraryLayout.allCases) { layout in
                Toggle(
                    "as \(layout.title)",
                    isOn: Binding(
                        get: { appEnvironment.preferences.libraryLayout == layout },
                        set: { if $0 { appEnvironment.preferences.libraryLayout = layout } }
                    )
                )
                .keyboardShortcut(layout == .grid ? "1" : "2", modifiers: .command)
                .disabled(!canUseData)
            }

            Divider()

            // Navigation — every sidebar destination is reachable by keyboard.
            Button("Ask AI") { goTo(.chat) }
                .keyboardShortcut("a", modifiers: [.command, .shift])
                .disabled(!canUseData)
            Button("Sessions") { goTo(.sessions) }
                .keyboardShortcut("s", modifiers: [.command, .shift])
                .disabled(!canUseData)
            Button("Live Tabs") { goTo(.liveTabs) }
                .keyboardShortcut("l", modifiers: [.command, .shift])
                .disabled(!canUseData)

            Divider()

            Button("Open Web App") {
                NSWorkspace.shared.open(appEnvironment.preferences.serverTarget.baseURL)
            }
            .keyboardShortcut("o", modifiers: [.command, .shift])
        }
    }
}
