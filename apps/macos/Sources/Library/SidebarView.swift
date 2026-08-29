import SwiftUI

/// The translucent source list: branding up top, All Bookmarks + the feature
/// destinations, the category facets with their counts, the top tags — then
/// Tour / MCP / Settings and the account footer at the bottom, like the web.
struct SidebarView: View {
    @Environment(AppEnvironment.self) private var appEnvironment
    @Environment(\.openSettings) private var openSettings

    /// Long facet lists fold after this many rows — the sidebar is navigation,
    /// not the full taxonomy.
    private static let facetLimit = 5

    @State private var showAllCategories = false
    @State private var showAllTags = false

    var body: some View {
        let library = appEnvironment.library

        VStack(spacing: 0) {
            brandingHeader

            List(selection: selectionBinding) {
                Section {
                    row(for: .allBookmarks, count: library.meta.total)
                    plainRow(for: .liveTabs)
                    plainRow(for: .sessions)
                    plainRow(for: .chat)
                }

                if !library.meta.categories.isEmpty {
                    Section("Categories") {
                        ForEach(visibleFacets(library.meta.categories, showAll: showAllCategories)) { facet in
                            row(for: .category(facet.name), count: facet.count)
                        }
                        showMoreRow(
                            total: library.meta.categories.count,
                            showAll: $showAllCategories
                        )
                    }
                }

                if !library.meta.tags.isEmpty {
                    Section("Tags") {
                        ForEach(visibleFacets(library.meta.tags, showAll: showAllTags)) { facet in
                            row(for: .tag(facet.name), count: facet.count)
                        }
                        showMoreRow(
                            total: library.meta.tags.count,
                            showAll: $showAllTags
                        )
                    }
                }
            }
            // `.sidebar` is already the default inside a NavigationSplitView
            // sidebar on macOS; stated explicitly so the material is not lost if
            // this view is ever hosted somewhere else.
            .listStyle(.sidebar)

            footerNav
            Divider()
            AccountFooter()
        }
        .sheet(isPresented: Binding(
            get: { appEnvironment.isPresentingTour },
            set: { appEnvironment.isPresentingTour = $0 }
        )) {
            TourSheet()
        }
    }

    /// The product identity, above the source list — the app icon (the real
    /// asset-catalog one, via AppKit) and the name.
    private var brandingHeader: some View {
        HStack(spacing: 8) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .frame(width: 26, height: 26)
            Text("Bookmark AI")
                .font(.system(size: 14, weight: .semibold))
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.top, 4)
        .padding(.bottom, 8)
    }

    /// Tour · MCP · Settings — the same three rows the web sidebar keeps at its
    /// bottom edge. MCP opens Settings directly on its tab.
    private var footerNav: some View {
        VStack(spacing: 1) {
            SidebarFooterRow(title: "Tour", symbol: "graduationcap") {
                appEnvironment.isPresentingTour = true
            }
            SidebarFooterRow(title: "MCP", symbol: "powerplug") {
                appEnvironment.requestedSettingsTab = .mcp
                openSettings()
            }
            SidebarFooterRow(title: "Settings", symbol: "gearshape") {
                appEnvironment.requestedSettingsTab = nil
                openSettings()
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
    }

    /// Selection is routed through the model so a change triggers a reload.
    private var selectionBinding: Binding<SidebarItem?> {
        Binding(
            get: { appEnvironment.library.selection },
            set: { newValue in
                guard let newValue else { return }
                Task { await appEnvironment.library.select(newValue) }
            }
        )
    }

    private func row(for item: SidebarItem, count: Int) -> some View {
        Label(item.title, systemImage: item.symbolName)
            .badge(count)
            .tag(item)
    }

    /// A feature row: no count badge — its data lives outside the library meta.
    private func plainRow(for item: SidebarItem) -> some View {
        Label(item.title, systemImage: item.symbolName)
            .tag(item)
    }

    private func visibleFacets(_ facets: [Facet], showAll: Bool) -> [Facet] {
        showAll ? facets : Array(facets.prefix(Self.facetLimit))
    }

    /// "Show N More…" / "Show Less" under a folded facet section. Renders
    /// nothing while the section fits inside the limit.
    @ViewBuilder
    private func showMoreRow(total: Int, showAll: Binding<Bool>) -> some View {
        if total > Self.facetLimit {
            Button {
                withAnimation(.easeOut(duration: 0.15)) { showAll.wrappedValue.toggle() }
            } label: {
                Label(
                    showAll.wrappedValue ? "Show Less" : "Show \(total - Self.facetLimit) More…",
                    systemImage: showAll.wrappedValue ? "chevron.up" : "chevron.down"
                )
                .foregroundStyle(.secondary)
                .font(.system(size: 12))
            }
            .buttonStyle(.plain)
            .pointingHandCursor()
        }
    }
}

/// One bottom-of-sidebar action row (Tour/MCP/Settings): quiet at rest,
/// sidebar-row highlight + pointing hand on hover.
private struct SidebarFooterRow: View {
    let title: String
    let symbol: String
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: symbol)
                    .frame(width: 18)
                Text(title)
                Spacer(minLength: 0)
            }
            .font(.system(size: 13))
            .foregroundStyle(isHovering ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
            .padding(.horizontal, 7)
            .padding(.vertical, 5)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(isHovering ? AnyShapeStyle(.quaternary) : AnyShapeStyle(.clear))
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .pointingHandCursor()
    }
}
