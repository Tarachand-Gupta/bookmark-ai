import AppKit
import SwiftUI

/// Both surfaces and the composer stay in the same hierarchy at every width.
/// Presentation changes only their geometry; NSTextView never transfers its text,
/// marked range, insertion point or Undo manager to a second input.
struct ReleaseWorkspaceView<Content: View>: View {
    @Environment(AppEnvironment.self) private var app
    @State private var composerHeight: CGFloat = 92
    @ViewBuilder let content: () -> Content
    private var blocking: Bool {
        let organization = app.organization
        return !app.canUseData || organization.showAdd || organization.showBulk || organization.showManager || organization.showHistory || organization.editing != nil || app.isPresentingTour
    }
    var body: some View {
        @Bindable var org = app.organization
        GeometryReader { geometry in
            let open = app.chat.isPresented
            let wide = geometry.size.width >= 850
            let pane: CGFloat = wide ? min(480, geometry.size.width * 0.48) : geometry.size.width
            ZStack(alignment: .bottomTrailing) {
                content()
                    .safeAreaInset(edge: .bottom, spacing: 0) { Color.clear.frame(height: open || blocking ? 0 : composerHeight + 12) }
                    .safeAreaInset(edge: .top, spacing: 0) { libraryControls }
                    .frame(width: wide && open ? geometry.size.width - pane : geometry.size.width, height: geometry.size.height)
                    .opacity(open && !wide ? 0 : 1)
                    .allowsHitTesting(!open || wide)
                    .accessibilityHidden(open && !wide)
                    .frame(maxWidth: .infinity, alignment: .leading)
                ChatView(includeComposer: false)
                    .padding(.bottom, composerHeight + 12)
                    .frame(width: pane, height: geometry.size.height)
                    .background(.background)
                    .overlay(alignment: .leading) { if wide { Divider() } }
                    .opacity(open ? 1 : 0)
                    .allowsHitTesting(open)
                    .accessibilityHidden(!open)
                VStack(alignment: .leading, spacing: 8) {
                    if open { contextControls }
                    ChatComposerBox(onActivate: { app.chat.show() }, autoFocus: false)
                }
                .padding(12)
                .frame(width: open ? pane : min(700, geometry.size.width))
                .background(GeometryReader { proxy in Color.clear.preference(key: ComposerHeightKey.self, value: proxy.size.height) })
                .opacity(blocking ? 0 : 1)
                .allowsHitTesting(!blocking)
                .accessibilityHidden(blocking)
            }
        }
        .onPreferenceChange(ComposerHeightKey.self) { composerHeight = $0 }
        .inspector(isPresented: Binding(get: { org.editing != nil }, set: { if !$0 { org.editing = nil } })) {
            if let bookmark = org.editing { BookmarkEditorView(bookmark: bookmark).id(bookmark.id).inspectorColumnWidth(min: 380, ideal: 430, max: 520) }
        }
        .confirmationDialog("Discard unsaved bookmark changes?", isPresented: $org.showDiscardEditor) {
            Button("Discard changes", role: .destructive) { org.discardEditor() }
            Button("Keep editing", role: .cancel) { org.keepEditor(); app.chat.isPresented = false }
        }
        .onChange(of: app.chat.isPresented) { _, open in if open { org.editing = nil } }
        .onChange(of: org.editing?.id) { _, id in if id != nil { app.chat.isPresented = false } }
        .sheet(isPresented: $org.showManager) { OrganizationManagerView() }
        .sheet(isPresented: $org.showHistory) { RecentChangesView() }
        .sheet(isPresented: $org.showAdd) { AddBookmarkView() }
        .sheet(isPresented: $org.showBulk) { if let frozen = org.frozenSelection { BulkOrganizationView(selection: frozen) } }
        .toolbar { ToolbarItem(placement: .primaryAction) { actionsMenu } }
    }
    @ViewBuilder private var libraryControls: some View {
        let library = app.library
        VStack(spacing: 0) {
            if let status = app.cacheStatus {
                HStack {
                    Label(status, systemImage: "wifi.slash").font(.caption)
                    if let updated = app.lastUpdated { Text("Updated \(updated.formatted(.relative(presentation: .named)))").font(.caption).foregroundStyle(.secondary) }
                    Spacer()
                    Button("Retry") { Task { await app.retryConnection() } }
                    if app.auth.status == .signedOut { Button("Sign in") { app.auth.beginSignIn() } }
                    Button("Sign out") { Task { await app.signOut() } }
                }.padding(9).background(.bar)
            }
            if library.selection.isLibraryFilter {
                if app.organization.data != nil {
                    if !library.selectedIDs.isEmpty && app.canUseData {
                        HStack {
                            Text("\(library.selectedIDs.count) selected").font(.callout.weight(.medium)).accessibilityLabel("\(library.selectedIDs.count) bookmarks selected")
                            Button("Edit selected…") { Task { await reviewSelected() } }
                            Button("Ask AI") { app.chat.show(context: library.proposedChatContext) }.disabled(library.selectedIDs.count > 1000)
                            if library.selectedIDs.count > 1000 { Text("Choose up to 1,000 for AI context.").font(.caption) }
                            Spacer()
                            Button("Clear") { library.selectedIDs = [] }
                        }.padding(10).background(.bar)
                    }
                }
            }
            if let notice = app.organization.notice {
                HStack {
                    Text(notice).lineLimit(3).font(.caption)
                    Spacer()
                    if let undo = app.organization.latestUndo { Button("Undo") { Task { await app.organization.undo(undo) } }.disabled(app.organization.isBusy) }
                    Button("Recent changes") { app.organization.showHistory = true }
                    Button { app.organization.notice = nil } label: { Image(systemName: "xmark") }.help("Dismiss result")
                }.padding(10).background(.bar)
            }
            if let error = app.organization.error {
                HStack { Text(error).font(.caption).foregroundStyle(.red); Spacer(); Button("Review") { app.organization.showHistory = true }; Button { app.organization.error = nil } label: { Image(systemName: "xmark") } }.padding(10)
            }
        }
    }
    private var contextControls: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Label(app.chat.context.displayTitle, systemImage: "scope").font(.caption)
                Spacer()
                if app.chat.context.type != "library" { Button("Use library") { app.chat.proposedContext = .library }.font(.caption) }
                if app.library.proposedChatContext != app.chat.context && app.library.proposedChatContext.type != "library" {
                    Button("Use current selection") { app.chat.show(context: app.library.proposedChatContext) }.font(.caption)
                }
            }
            if let proposed = app.chat.proposedContext {
                HStack { Text("Switch context to \(proposed.displayTitle)?").font(.caption); Button("Switch") { app.chat.acceptProposedContext() }; Button("Keep current") { app.chat.proposedContext = nil } }
            }
            if !app.chat.missingAttachments.isEmpty {
                Text("Reattach after reopening: \(app.chat.missingAttachments.joined(separator: ", ")). File bytes are not stored in drafts.").font(.caption).foregroundStyle(.secondary)
                Button("Continue without missing files") { app.chat.removeMissingAttachments() }.font(.caption)
            }
            Text("Find, compare, and ask about these sources. Use the library controls to change organization.").font(.caption2).foregroundStyle(.secondary)
        }
    }
    private var actionsMenu: some View {
        Menu {
            Button("Save a link…") { app.organization.showAdd = true }
            if app.organization.available {
                Divider()
                Button("Categories & tags…") { app.organization.showManager = true }
                Button("Recent changes…") { app.organization.showHistory = true }
                if app.library.selection.isLibraryFilter {
                    Button("Select all visible") { app.library.selectedIDs = Set(app.library.visibleBookmarks.map(\.id)) }
                    Button(app.library.isShowingSearchResults ? "Select top ranked results…" : "Select all matching bookmarks…") { Task { await selectAll() } }
                    Button("Edit selected…") { Task { await reviewSelected() } }.disabled(app.library.selectedIDs.isEmpty)
                }
            }
        } label: { Label("Library actions", systemImage: "plus.circle") }.disabled(!app.canUseData)
    }
    private func reviewSelected() async {
        if await app.organization.freeze(["bookmarkIds": .array(app.library.selectedIDs.sorted().map(JSONValue.string))]) != nil { app.organization.showBulk = true }
    }
    private func selectAll() async {
        var filters = app.library.organizationFilters
        let body: [String: JSONValue]
        if app.library.isShowingSearchResults { filters["q"] = .string(app.library.searchText); filters["mode"] = .string("hybrid"); body = ["search": .object(filters)] }
        else { body = ["query": .object(filters)] }
        if let selection = await app.organization.freeze(body) { app.library.selectedIDs = Set(selection.bookmarkIds); app.organization.showBulk = true }
    }
}
private struct ComposerHeightKey: PreferenceKey {
    static var defaultValue: CGFloat = 92
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
