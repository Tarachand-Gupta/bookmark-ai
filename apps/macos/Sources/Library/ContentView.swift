import SwiftUI

/// The window's root. Behind an open gate (`AppEnvironment.gate == .ready`) it
/// is a two-column `NavigationSplitView`: on macOS the sidebar column gets the
/// system's translucent material automatically, and `.windowToolbarStyle(.unified)`
/// (set on the scene) lets it meet the title bar. While the gate is closed the
/// WHOLE window is replaced — no sidebar, no toolbar — by the sign-in screen
/// (Clerk said there is no session) or the connecting screen (it hasn't
/// answered yet), so nothing from a previous account can be on screen.
///
/// The detail column routes on the sidebar selection: library filters share the
/// browse UI (grid/list, search); the feature views (Ask AI, Sessions, Live
/// Tabs) each bring their own toolbar and data story.
struct ContentView: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    @State private var columnVisibility: NavigationSplitViewVisibility = .all

    var body: some View {
        @Bindable var auth = appEnvironment.auth

        Group {
            switch appEnvironment.gate {
            case .ready:
                NavigationSplitView(columnVisibility: $columnVisibility) {
                    SidebarView()
                        .navigationSplitViewColumnWidth(min: 200, ideal: 250, max: 340)
                } detail: {
                    featureView
                }
            case .connecting:
                ConnectingView()
            case .signedOut:
                SignedOutView()
            }
        }
        // Attached at the root so Sign In… works from every gate state.
        .sheet(isPresented: $auth.isPresentingSignIn) {
            SignInSheet()
        }
    }

    @ViewBuilder
    private var featureView: some View {
        switch appEnvironment.library.selection {
        case .chat:
            ChatView()
        case .sessions:
            SessionsView()
        case .liveTabs:
            LiveTabsView()
        case .allBookmarks, .category, .tag:
            LibraryDetailView()
        }
    }
}

/// The bookmark-browsing detail: grid/list host plus the search field, the
/// layout toggle, and refresh. Kept as its own view so `.searchable` (and its
/// debounce) exist only while a library filter is selected — the feature views
/// have no search field to show.
private struct LibraryDetailView: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    var body: some View {
        // `@Bindable` is what lets `.searchable` write back into the @Observable
        // model's `searchText` — `@Binding` cannot reach into an @Observable.
        @Bindable var library = appEnvironment.library
        @Bindable var preferences = appEnvironment.preferences

        LibraryBrowserView()
            .navigationTitle(library.selection.title)
            .navigationSubtitle(library.subtitle)
            .searchable(
                text: $library.searchText,
                placement: .toolbar,
                prompt: "Search bookmarks"
            )
            // Debounce: `.task(id:)` cancels and restarts on every keystroke, so
            // the sleep only completes once typing pauses.
            .task(id: library.searchText) {
                let query = library.searchText
                if !query.isEmpty {
                    try? await Task.sleep(for: .milliseconds(280))
                    guard !Task.isCancelled else { return }
                }
                await library.search(query)
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    // Browser/device facets + clear — the icon fills while any
                    // filter is active so the state is visible at a glance.
                    Menu {
                        Picker("Browser", selection: $library.browserFilter) {
                            Text("Any Browser").tag(String?.none)
                            Divider()
                            ForEach(library.meta.browsers) { facet in
                                Text("\(facet.name.capitalized)  (\(facet.count))")
                                    .tag(String?.some(facet.name))
                            }
                        }
                        .pickerStyle(.inline)

                        Picker("Device", selection: $library.deviceFilter) {
                            Text("Any Device").tag(String?.none)
                            Divider()
                            ForEach(library.meta.devices) { facet in
                                Text("\(facet.name.capitalized)  (\(facet.count))")
                                    .tag(String?.some(facet.name))
                            }
                        }
                        .pickerStyle(.inline)

                        if library.hasActiveFilters {
                            Divider()
                            Button("Clear Filters") { library.clearFilters() }
                        }
                    } label: {
                        Label(
                            "Filter",
                            systemImage: library.hasActiveFilters
                                ? "line.3.horizontal.decrease.circle.fill"
                                : "line.3.horizontal.decrease.circle"
                        )
                    }
                    .help("Filter by browser or device")
                }

                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Picker("Sort", selection: $library.sort) {
                            ForEach(LibrarySort.allCases) { order in
                                Text(order.title).tag(order)
                            }
                        }
                        .pickerStyle(.inline)
                    } label: {
                        Label("Sort", systemImage: "arrow.up.arrow.down")
                    }
                    .help("Sort the library")
                }

                ToolbarItem(placement: .primaryAction) {
                    Picker("Layout", selection: $preferences.libraryLayout) {
                        ForEach(LibraryLayout.allCases) { layout in
                            Label(layout.title, systemImage: layout.symbolName)
                                .tag(layout)
                        }
                    }
                    .pickerStyle(.segmented)
                    .help("View as grid (⌘1) or list (⌘2)")
                }

                ToolbarItem(placement: .primaryAction) {
                    Button {
                        Task { await appEnvironment.loadEverything() }
                    } label: {
                        Label("Refresh", systemImage: "arrow.clockwise")
                    }
                    .help("Refresh the library (⌘R)")
                    .disabled(appEnvironment.library.isLoading)
                }
            }
    }
}
