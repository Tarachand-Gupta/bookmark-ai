import SwiftUI

@main
struct BookmarkAIApp: App {

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
