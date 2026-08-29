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
/// home for an app's actions.
struct LibraryCommands: Commands {
    let appEnvironment: AppEnvironment

    private func goTo(_ item: SidebarItem) {
        Task { await appEnvironment.library.select(item) }
    }

    var body: some Commands {
        CommandMenu("Library") {
            Button("Refresh") {
                Task { await appEnvironment.loadEverything() }
            }
            .keyboardShortcut("r", modifiers: .command)

            Divider()

            // An inline Picker renders as check-marked menu items, so the menu
            // always shows which layout is active.
            Picker("View", selection: Binding(
                get: { appEnvironment.preferences.libraryLayout },
                set: { appEnvironment.preferences.libraryLayout = $0 }
            )) {
                Text("as Grid")
                    .tag(LibraryLayout.grid)
                    .keyboardShortcut("1", modifiers: .command)
                Text("as List")
                    .tag(LibraryLayout.list)
                    .keyboardShortcut("2", modifiers: .command)
            }
            .pickerStyle(.inline)

            Divider()

            // Navigation — every sidebar destination is reachable by keyboard.
            Button("Ask AI") { goTo(.chat) }
                .keyboardShortcut("a", modifiers: [.command, .shift])
            Button("Sessions") { goTo(.sessions) }
                .keyboardShortcut("s", modifiers: [.command, .shift])
            Button("Live Tabs") { goTo(.liveTabs) }
                .keyboardShortcut("l", modifiers: [.command, .shift])

            Divider()

            Button("Open Web App") {
                NSWorkspace.shared.open(appEnvironment.preferences.serverTarget.baseURL)
            }
            .keyboardShortcut("o", modifiers: [.command, .shift])
        }
    }
}
