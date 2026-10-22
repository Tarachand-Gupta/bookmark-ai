import AppKit
import SwiftUI

/// Saved sessions as expanding cards: the header row toggles the tab list open
/// INSIDE the same card, so a snapshot reads as one object. Hovering raises the
/// card, the header shows the pointing hand and the action cluster (Open All +
/// an overflow menu with the full set: Rename, Summarize, Copy Links, Delete).
struct SessionsView: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    var body: some View {
        @Bindable var model = appEnvironment.sessions

        ScrollView {
            LazyVStack(spacing: 10) {
                ForEach(model.visibleSessions) { session in
                    SessionCard(session: session)
                }
            }
            .padding(ContentColumn.padding)
            .frame(maxWidth: ContentColumn.maxWidth)
            .frame(maxWidth: .infinity)
        }
        .background(VisualEffectBackground().ignoresSafeArea())
        .overlay { statusOverlay }
        .navigationTitle("Sessions")
        .navigationSubtitle(subtitle)
        .searchable(text: $model.query, placement: .toolbar, prompt: "Search sessions and tabs")
        // Debounce: `.task(id:)` restarts on every keystroke, so the filter only
        // runs once typing pauses — same pattern as the library search.
        .task(id: model.query) {
            if !model.query.isEmpty {
                try? await Task.sleep(for: .milliseconds(200))
                guard !Task.isCancelled else { return }
            }
            appEnvironment.sessions.commitSearch()
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Picker("Sort", selection: $model.sort) {
                        ForEach(SessionsSort.allCases) { order in
                            Text(order.title).tag(order)
                        }
                    }
                    .pickerStyle(.inline)
                } label: {
                    Label("Sort", systemImage: "arrow.up.arrow.down")
                }
                .help("Sort sessions")
            }

            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await appEnvironment.sessions.load() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .help("Refresh sessions")
                .disabled(model.isLoading)
            }
        }
        .task { await appEnvironment.sessions.load() }
    }

    private var subtitle: String {
        let count = appEnvironment.sessions.sessions.count
        guard appEnvironment.sessions.loaded else { return "" }
        return "\(count) session\(count == 1 ? "" : "s")"
    }

    @ViewBuilder
    private var statusOverlay: some View {
        let model = appEnvironment.sessions

        if let message = model.errorMessage {
            ContentUnavailableView {
                Label("Couldn't Load Sessions", systemImage: "exclamationmark.triangle")
            } description: {
                VStack(spacing: 6) {
                    Text(message)
                    if let hint = model.errorHint {
                        Text(hint).foregroundStyle(.secondary)
                    }
                }
            } actions: {
                Button("Try Again") {
                    Task { await appEnvironment.sessions.load() }
                }
                .buttonStyle(.borderedProminent)
            }
        } else if model.visibleSessions.isEmpty {
            if model.isLoading || !model.loaded {
                ProgressView()
                    .controlSize(.large)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if model.isSearching {
                ContentUnavailableView.search(text: model.appliedQuery)
            } else {
                ContentUnavailableView(
                    "No Saved Sessions",
                    systemImage: "rectangle.stack",
                    description: Text("Save your open tabs from the browser extension and the snapshot will show up here.")
                )
            }
        }
    }
}

/// One saved session: header + tab rows, all inside one surface. Same reading
/// pattern as a live window card: a 3-tab preview by default, "Show all N
/// tabs" to unfold, header/chevron to fold back to the preview.
private struct SessionCard: View {
    @Environment(AppEnvironment.self) private var appEnvironment
    @Environment(\.openURL) private var openURL

    let session: Session

    /// Tabs visible while the card is folded to its preview.
    private static let previewTabCount = 3

    @State private var isExpanded = false
    @State private var isHoveringCard = false
    @State private var isRenaming = false
    @State private var renameDraft = ""

    /// While a search is active, the MATCHING tabs surface (all of them) with
    /// "Show all N tabs" to unfold the rest — the same behavior as Live Tabs
    /// (Tara: a Netflix tab buried at position 20 must be visible, not the
    /// first-3 preview). A session matched only by name/summary keeps its
    /// normal preview.
    private var visibleTabs: [IdentifiedTab] {
        if !isExpanded, appEnvironment.sessions.isSearching {
            let matched = identifiedTabs.filter { appEnvironment.sessions.matches($0.tab) }
            if !matched.isEmpty { return matched }
        }
        return isExpanded ? identifiedTabs : Array(identifiedTabs.prefix(Self.previewTabCount))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header

            let tabs = visibleTabs
            if !tabs.isEmpty {
                Divider()
                    .padding(.horizontal, 12)

                VStack(spacing: 1) {
                    ForEach(tabs) { entry in
                        SessionTabRow(tab: entry.tab)
                    }

                    if !isExpanded, session.tabs.count > tabs.count {
                        Button {
                            withAnimation(.easeOut(duration: 0.16)) { isExpanded = true }
                        } label: {
                            HStack(spacing: 5) {
                                Image(systemName: "ellipsis")
                                    .font(.system(size: 9, weight: .semibold))
                                Text("Show all \(session.tabs.count) tabs")
                                Spacer(minLength: 0)
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .hoverHighlight()
                        .pointingHandCursor()
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
            }
        }
        .surfaceCard(radius: 12, hovering: isHoveringCard)
        .onHover { isHoveringCard = $0 }
        .contextMenu { actionEntries }
        .alert("Rename Session", isPresented: $isRenaming) {
            TextField("Name", text: $renameDraft)
            Button("Rename") {
                Task { await appEnvironment.sessions.rename(session, to: renameDraft) }
            }
            Button("Cancel", role: .cancel) {}
        }
        .animation(.easeOut(duration: 0.16), value: isExpanded)
    }

    // MARK: - Header

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            Image(systemName: "rectangle.stack")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.tint)
                .frame(width: 36, height: 36)
                .background(.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(session.name)
                        .font(.body)
                        .fontWeight(.semibold)
                        .lineLimit(1)
                    if appEnvironment.sessions.summarizingId == session.id {
                        ProgressView().controlSize(.mini)
                    }
                }

                if let description = session.description, !description.isEmpty {
                    Text(description)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }

                HStack(spacing: 6) {
                    Text("\(session.tabCount) tab\(session.tabCount == 1 ? "" : "s")")
                        .foregroundStyle(.secondary)
                    if session.browser != "other" {
                        Text("·").foregroundStyle(.tertiary)
                        Text(session.browser.capitalized).foregroundStyle(.tertiary)
                    }
                    if let savedAt = session.savedAtDate {
                        Text("·").foregroundStyle(.tertiary)
                        Text(savedAt, format: .relative(presentation: .named))
                            .foregroundStyle(.tertiary)
                    }
                }
                .font(.caption)
                .lineLimit(1)
            }

            Spacer(minLength: 8)

            // Action cluster: appears on hover so the resting card stays calm.
            if isHoveringCard {
                HStack(spacing: 6) {
                    if !session.openableTabs.isEmpty {
                        Button {
                            openAll()
                        } label: {
                            Label("Open All", systemImage: "arrow.up.forward.app")
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .pointingHandCursor()
                        .help("Open every tab in the browser")
                    }

                    Menu {
                        actionEntries
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .menuStyle(.borderlessButton)
                    .menuIndicator(.hidden)
                    .fixedSize()
                    .pointingHandCursor()
                    .help("More actions")
                }
                .transition(.opacity)
            }

            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.tertiary)
                .rotationEffect(.degrees(isExpanded ? 90 : 0))
        }
        .padding(12)
        // No header-specific hover fill: stacked on the card's own hover it
        // read "way too dark" (Tara) — the expand cursor and chevron carry
        // the affordance now.
        .contentShape(Rectangle())
        .verticalExpandCursor()
        .onTapGesture { withAnimation(.easeOut(duration: 0.16)) { isExpanded.toggle() } }
        .help(isExpanded ? "Fold back to a preview" : "Show every tab in this session")
    }

    /// One list of actions, used by both the hover menu and the context menu —
    /// the two can never drift apart.
    @ViewBuilder
    private var actionEntries: some View {
        Button("Open All Tabs") { openAll() }
            .disabled(session.openableTabs.isEmpty)
        Button("Copy All Links") { copyAllLinks() }
            .disabled(session.openableTabs.isEmpty)
        Divider()
        Button("Rename…") {
            renameDraft = session.name
            isRenaming = true
        }
        Button("Summarize with AI") {
            Task { await appEnvironment.sessions.summarize(session) }
        }
        .disabled(appEnvironment.sessions.summarizingId != nil)
        Divider()
        Button("Delete", role: .destructive) {
            Task { await appEnvironment.sessions.delete(session) }
        }
    }

    private struct IdentifiedTab: Identifiable {
        let id: String
        let tab: SessionTab
    }

    private var identifiedTabs: [IdentifiedTab] {
        session.tabs.enumerated().map { offset, tab in
            IdentifiedTab(id: "\(session.id):\(offset)", tab: tab)
        }
    }

    private func openAll() {
        for tab in session.openableTabs {
            if let url = tab.openableURL { openURL(url) }
        }
    }

    private func copyAllLinks() {
        let links = session.openableTabs.map(\.url).joined(separator: "\n")
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(links, forType: .string)
    }
}

/// One tab inside an expanded session. Only http(s) is clickable; anything else
/// (chrome://, about:…) renders as plain text — same rule as the web app.
private struct SessionTabRow: View {
    @Environment(\.openURL) private var openURL

    let tab: SessionTab

    var body: some View {
        HStack(spacing: 9) {
            RemoteImage(url: tab.faviconURL) {
                Image(systemName: "globe")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
            }
            .frame(width: 16, height: 16)
            .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))

            Text(tab.displayTitle)
                .font(.callout)
                .lineLimit(1)

            if let host = tab.openableURL?.host() {
                Text(host)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .contentShape(Rectangle())
        .hoverHighlight()
        .pointingHandCursor()
        .onTapGesture {
            if let url = tab.openableURL { openURL(url) }
        }
        .contextMenu {
            if let url = tab.openableURL {
                Button("Open in Browser") { openURL(url) }
                Button("Copy Link") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(tab.url, forType: .string)
                }
            }
        }
        .help(tab.url)
    }
}
