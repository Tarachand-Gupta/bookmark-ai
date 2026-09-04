import SwiftUI

/// History ▸ the popover under the toolbar button: a search field, then the
/// conversations grouped by day (Today / Yesterday / Earlier) with the open
/// one tinted. Rows open on click, carry a hover ⋯ menu and a right-click
/// menu (Open / Delete…), and the keyboard works: ↑/↓ moves, ↩ opens, ⌫
/// asks to delete, Esc closes. Every delete confirms first.
struct ChatHistoryPopover: View {
    @Environment(AppEnvironment.self) private var appEnvironment
    @Binding var isPresented: Bool
    /// Off for previews: the seeded list must not be replaced by a live fetch.
    var loadsOnAppear = true
    /// Previews only: render this row as if hovered (shows its ⋯ menu).
    var forcedHoverId: String?

    @State private var keyboardSelection: String?
    @State private var pendingDelete: ChatConversation?
    @FocusState private var searchFocused: Bool

    static let size = CGSize(width: 360, height: 460)

    var body: some View {
        @Bindable var chat = appEnvironment.chat
        let sections = ChatHistoryGrouping.sections(chat.visibleConversations)

        VStack(spacing: 0) {
            searchField(query: $chat.historyQuery)
            Divider()
            content(chat: chat, sections: sections)
        }
        .frame(width: Self.size.width, height: Self.size.height)
        .task {
            if loadsOnAppear { await chat.refreshConversations() }
        }
        .onAppear {
            keyboardSelection = chat.conversationId
            searchFocused = true
        }
        .onKeyPress(.upArrow) { move(-1, in: sections); return .handled }
        .onKeyPress(.downArrow) { move(1, in: sections); return .handled }
        .onKeyPress(.return) { openKeyboardSelection(); return .handled }
        .onKeyPress(.escape) { isPresented = false; return .handled }
        .onKeyPress(.delete) {
            // Only when the search field has nothing to delete itself.
            guard chat.historyQuery.isEmpty, let id = keyboardSelection,
                  let conversation = chat.visibleConversations.first(where: { $0.id == id })
            else { return .ignored }
            pendingDelete = conversation
            return .handled
        }
        .onExitCommand { isPresented = false }
        .confirmationDialog(
            "Delete “\(pendingDelete?.title ?? "")”?",
            isPresented: Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } }),
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { conversation in
            Button("Delete", role: .destructive) { delete(conversation) }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("This conversation and its messages will be removed. This can't be undone.")
        }
    }

    // MARK: - Search

    private func searchField(query: Binding<String>) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)
            TextField("Search conversations", text: query)
                .textFieldStyle(.plain)
                .focused($searchFocused)
                .onSubmit { openKeyboardSelection() }
                .onChange(of: query.wrappedValue) {
                    appEnvironment.chat.commitHistorySearch()
                    keyboardSelection = nil
                }
            if !query.wrappedValue.isEmpty {
                Button {
                    query.wrappedValue = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .pointingHandCursor()
                .help("Clear")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
    }

    // MARK: - List

    @ViewBuilder
    private func content(chat: ChatModel, sections: [ChatHistoryGrouping.Section]) -> some View {
        if chat.isLoadingConversations, !chat.hasLoadedConversations {
            placeholder {
                ProgressView().controlSize(.small)
                Text("Loading conversations…")
            }
        } else if let error = chat.conversationsError, chat.conversations.isEmpty {
            placeholder {
                Image(systemName: "exclamationmark.triangle")
                Text(error)
                    .multilineTextAlignment(.center)
                Button("Try Again") { Task { await chat.refreshConversations() } }
                    .controlSize(.small)
                    .pointingHandCursor()
            }
        } else if chat.conversations.isEmpty {
            placeholder {
                Image(systemName: "clock.arrow.circlepath")
                    .font(.system(size: 26, weight: .regular))
                    .symbolRenderingMode(.hierarchical)
                Text("No conversations yet")
                    .font(.callout)
                    .fontWeight(.medium)
                    .foregroundStyle(.primary)
                Text("Ask something below to start one.")
            }
        } else if sections.isEmpty {
            placeholder {
                Image(systemName: "magnifyingglass")
                Text("No matches for “\(chat.historyQuery)”")
            }
        } else {
            let now = Date()
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 2) {
                        ForEach(sections) { section in
                            Text(section.title)
                                .font(.caption)
                                .fontWeight(.semibold)
                                .foregroundStyle(.secondary)
                                .padding(.horizontal, 12)
                                .padding(.top, 10)
                                .padding(.bottom, 3)
                            ForEach(section.conversations) { conversation in
                                HistoryRow(
                                    conversation: conversation,
                                    timeText: ChatHistoryGrouping.relativeTime(ISO8601.date(from: conversation.updatedAt), now: now),
                                    isCurrent: conversation.id == chat.conversationId,
                                    isKeyboardSelected: conversation.id == keyboardSelection,
                                    forceHover: conversation.id == forcedHoverId,
                                    onOpen: { open(conversation) },
                                    onDelete: { pendingDelete = conversation }
                                )
                                .id(conversation.id)
                                .padding(.horizontal, 6)
                            }
                        }
                    }
                    .padding(.bottom, 8)
                }
                .onChange(of: keyboardSelection) { _, id in
                    if let id { withAnimation(.easeOut(duration: 0.12)) { proxy.scrollTo(id, anchor: .center) } }
                }
            }
        }
    }

    private func placeholder<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(spacing: 8) {
            content()
        }
        .font(.callout)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(20)
    }

    // MARK: - Actions

    private func move(_ delta: Int, in sections: [ChatHistoryGrouping.Section]) {
        let ids = sections.flatMap { $0.conversations.map(\.id) }
        guard !ids.isEmpty else { return }
        guard let current = keyboardSelection, let index = ids.firstIndex(of: current) else {
            keyboardSelection = delta > 0 ? ids.first : ids.last
            return
        }
        keyboardSelection = ids[min(max(index + delta, 0), ids.count - 1)]
    }

    private func openKeyboardSelection() {
        guard isPresented, let id = keyboardSelection,
              let conversation = appEnvironment.chat.visibleConversations.first(where: { $0.id == id })
        else { return }
        open(conversation)
    }

    private func open(_ conversation: ChatConversation) {
        isPresented = false
        Task { await appEnvironment.chat.open(conversation) }
    }

    private func delete(_ conversation: ChatConversation) {
        pendingDelete = nil
        if keyboardSelection == conversation.id { keyboardSelection = nil }
        Task { await appEnvironment.chat.deleteConversation(conversation) }
    }
}

/// One conversation: title (one line) over its relative time; the open one
/// sits on a tint, the keyboard-selected one gets a tint border, hover shows
/// the ⋯ menu. The whole row is the click target.
private struct HistoryRow: View {
    let conversation: ChatConversation
    let timeText: String
    let isCurrent: Bool
    let isKeyboardSelected: Bool
    let forceHover: Bool
    let onOpen: () -> Void
    let onDelete: () -> Void

    @State private var isHovering = false

    private var isHighlighted: Bool { isHovering || forceHover }
    private var showsMenu: Bool { isHighlighted || isKeyboardSelected }

    private var title: String { conversation.title.isEmpty ? "New chat" : conversation.title }

    var body: some View {
        HStack(spacing: 8) {
            // The text is the accessible "button" for the row: label = title +
            // time, press = open. The ⋯ menu stays its OWN element — combining
            // it into the row made the row report as a menu button.
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(timeText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(timeText.isEmpty ? title : "\(title), \(timeText)")
            .accessibilityAddTraits(isCurrent ? [.isButton, .isSelected] : .isButton)
            .accessibilityAction { onOpen() }
            .accessibilityHint("Opens the conversation")
            Spacer(minLength: 6)
            if showsMenu {
                Menu {
                    rowActions
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .pointingHandCursor()
                .help("More actions")
                .accessibilityLabel("More actions")
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .contentShape(Rectangle())
        .background(
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .fill(isCurrent ? AnyShapeStyle(.tint.opacity(0.16)) : (isHighlighted ? .hoverFill : AnyShapeStyle(.clear)))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .strokeBorder(.tint.opacity(isKeyboardSelected ? 0.7 : 0), lineWidth: 1)
        )
        .onTapGesture(perform: onOpen)
        .onHover { isHovering = $0 }
        .pointingHandCursor()
        .contextMenu { rowActions }
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var rowActions: some View {
        Button("Open", action: onOpen)
        Divider()
        Button("Delete…", role: .destructive, action: onDelete)
    }
}
