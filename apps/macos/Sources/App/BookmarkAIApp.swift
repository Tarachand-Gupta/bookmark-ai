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
        // The id lets the dock-reopen path ask for THIS scene by name via
        // the `openWindow` environment action → OpenWindowAction has no
        // no-argument call, so the scene must be addressable.
        WindowGroup(id: "main") {
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
                // Reopen bridge: give the app delegate the scene's openWindow
                // action so a dock click can create a fresh window after the
                // red button destroyed the old one. The delegate is
                // AppKit-side and can't read the SwiftUI environment itself.
                .background(ReopenBridge { AppDelegate.reopenNewWindow = $0 })
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

    /// The scene-registered way to create a fresh main window after the old
    /// one was destroyed by the red close button. Set from the WindowGroup's
    /// content via `ReopenBridge`; nil in unit tests. Returning `false`
    /// from `applicationShouldHandleReopen` does NOT make SwiftUI recreate
    /// the window (disproven empirically 2026-09-14: after close + reopen the
    /// only windows left were SwiftUI's hidden alpha-0 template at
    /// (-30000, 30477) and an off-screen helper — no main window appeared),
    /// so the delegate must call this itself.
    static var reopenNewWindow: (() -> Void)?

    func applicationDidFinishLaunching(_ notification: Notification) {
        #if DEBUG
        // Diagnostics for the dock-reopen path: DEBUG builds log every close
        // and reopen with the full window list, so a repro can be read from
        // the log instead of guessed at.
        NotificationCenter.default.addObserver(
            forName: NSWindow.willCloseNotification, object: nil, queue: .main
        ) { notification in
            guard let window = notification.object as? NSWindow else { return }
            Self.log("willClose \(Self.describe(window))")
        }
        // Autonomous repro hook: BMAI_AUTOTEST_CLOSE=1 closes the main window
        // 10 s after launch so the reopen path can be exercised headlessly —
        // an AppleScript `reopen` then stands in for the dock click.
        if ProcessInfo.processInfo.environment["BMAI_AUTOTEST_CLOSE"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 10) {
                Self.log("autotest closing \(Self.mainWindow.map(Self.describe) ?? "<nil>")")
                Self.mainWindow?.close()
            }
        }
        #endif
    }

    func applicationShouldHandleReopen(_ application: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        #if DEBUG
        Self.log("event flag=\(flag) windows=[\(application.windows.map(Self.describe).joined(separator: ", "))]")
        #endif
        let handled = Self.reopen(hasVisibleWindows: flag, window: Self.mainWindow)
        #if DEBUG
        Self.log("decision handled=\(handled) windowsAfter=[\(application.windows.map(Self.describe).joined(separator: ", "))]")
        #endif
        return handled
    }

    #if DEBUG
    private static func log(_ message: String) {
        FileHandle.standardError.write(Data("[bmai-reopen] \(message)\n".utf8))
    }

    private static func describe(_ window: NSWindow) -> String {
        let title = window.title.isEmpty ? "<untitled>" : window.title
        return "<\(title) visible=\(window.isVisible) mini=\(window.isMiniaturized) key=\(window.isKeyWindow)>\(window == mainWindow ? " [main]" : "")"
    }
    #endif

    /// The pure decision `applicationShouldHandleReopen` delegates to —
    /// unit-tested. Returning true tells AppKit "handled, don't create a
    /// window"; returning false lets AppKit's default handling recreate the
    /// WindowGroup's window. The decision trusts ONLY the captured main
    /// window: a live one → re-show it and return true; a DEAD one
    /// → the delegate opens a fresh window itself via the scene's
    /// openWindow action (returning false does NOT recreate it — empirically
    /// disproven 2026-09-14). The hasVisibleWindows flag is
    /// deliberately ignored: after the red button destroys the main window,
    /// phantom leftovers can still report "visible", which made the flag
    /// branch return true and dock clicks do nothing (bmai-reopen logs,
    /// 2026-09-14).
    static func reopen(hasVisibleWindows: Bool, window: NSWindow?) -> Bool {
        // A live window in ANY state → visible, minimized, or hidden → is
        // the reopen target; only a destroyed one (weak ref nil) needs a
        // fresh window. Minimized (yellow button) is the trap: isVisible
        // is FALSE while the window sits in the Dock, so testing visibility
        // instead of existence made the delegate mistake it for dead and
        // openWindow(id:) clone a SECOND window (found by Tara 2026-09-14:
        // two identical windows, the original still minimized in the Dock).
        if let window {
            if window.isMiniaturized {
                window.deminiaturize(nil)
            }
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return true
        }
        Self.reopenNewWindow?()
        return Self.reopenNewWindow != nil
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


/// A zero-size view whose only job is to hand the scene's `openWindow`
/// action to the app delegate. Environment values reach SwiftUI views,
/// never NSViews — this is the bridge across that boundary.
private struct ReopenBridge: View {
    let onCapture: (@escaping @MainActor () -> Void) -> Void

    var body: some View {
        ReopenBridgeContent(onCapture: onCapture)
    }

    private struct ReopenBridgeContent: View {
        let onCapture: (@escaping @MainActor () -> Void) -> Void
        @Environment(\.openWindow) private var openWindow

        var body: some View {
            Color.clear
                .frame(width: 0, height: 0)
                .onAppear { onCapture { openWindow(id: "main") } }
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
