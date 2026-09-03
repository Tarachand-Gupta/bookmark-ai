import SwiftUI

/// Ask AI. The composer is ALWAYS docked to the bottom (Tara's call — same as
/// the web app's sidebar chat); what changes is the space above it: the empty
/// state fills it with the title, example prompts, and the free-credits card,
/// a conversation fills it with the transcript.
struct ChatView: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    var body: some View {
        let model = appEnvironment.chat

        VStack(spacing: 0) {
            if model.messages.isEmpty {
                emptyState
            } else {
                transcript
            }

            if let message = model.errorMessage {
                errorBar(message)
            }

            ChatComposerBox()
                .frame(maxWidth: ContentColumn.maxWidth)
                .padding(.horizontal, ContentColumn.padding)
                .padding(.vertical, 12)
        }
        .frame(maxWidth: .infinity)
        .background(VisualEffectBackground().ignoresSafeArea())
        .navigationTitle("Ask AI")
        .navigationSubtitle("")
        .toolbar {
            ToolbarItem(placement: .primaryAction) { historyMenu }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    appEnvironment.chat.newConversation()
                } label: {
                    Label("New Chat", systemImage: "square.and.pencil")
                }
                .help("Start a new conversation")
            }
        }
        .task {
            await appEnvironment.chat.refreshConversations()
            await appEnvironment.settings.load()
        }
        // Refresh the credits meter when a turn finishes — the server meters
        // usage in its onFinish, so the number is only fresh after streaming.
        .task(id: model.isStreaming) {
            if !model.isStreaming {
                await appEnvironment.settings.load()
            }
        }
    }

    // MARK: - Empty state (above the docked composer)

    private static let suggestions = [
        "What did I save this week?",
        "Find my bookmarks about design",
        "What's open on my other devices right now?",
    ]

    private var emptyState: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer(minLength: 60)

                Image(systemName: "sparkles")
                    .font(.system(size: 32, weight: .regular))
                    .foregroundStyle(.tint)
                Text("Ask your library anything")
                    .font(.title2)
                    .fontWeight(.semibold)
                    .padding(.top, 12)
                Text("Search, count, and cross-reference your bookmarks, saved sessions, and live tabs — or bring in the web.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: 430)
                    .padding(.top, 4)

                VStack(spacing: 7) {
                    ForEach(Self.suggestions, id: \.self) { suggestion in
                        SuggestionPill(text: suggestion) {
                            appEnvironment.chat.draft = suggestion
                            appEnvironment.chat.send()
                        }
                    }
                }
                .frame(maxWidth: 560)
                .padding(.top, 24)

                if let usage = appEnvironment.settings.aiUsage {
                    AiCreditsCard(usage: usage, dim: appEnvironment.settings.hasOwnKey)
                        .frame(maxWidth: 560)
                        .padding(.top, 20)
                }

                Spacer(minLength: 40)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, 24)
        }
    }

    // MARK: - Transcript

    // NOT lazy, deliberately. A bottom-anchored LazyVStack whose items change
    // height on every streaming delta (markdown blocks appear/merge as text
    // arrives) thrashes the lazy placement cache — a captured sample showed the
    // main thread pinned at 99% inside LazySubviewPlacements/LazyHVStack with
    // RSS >1GB (the "give me sample markdown" hang). A chat transcript is small;
    // eager layout is cheap and immune.
    private var transcript: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(appEnvironment.chat.messages) { message in
                    ChatMessageView(message: message)
                }
                if appEnvironment.chat.isStreaming, streamHasNoVisibleReply {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Thinking…")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal, 4)
                }
            }
            .padding(ContentColumn.padding)
            .frame(maxWidth: ContentColumn.maxWidth, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .defaultScrollAnchor(.bottom)
    }

    /// True until the streaming assistant message has anything renderable —
    /// the window where "Thinking…" is the only honest thing to show.
    private var streamHasNoVisibleReply: Bool {
        guard let last = appEnvironment.chat.messages.last else { return true }
        if last.role != "assistant" { return true }
        return last.partViews.isEmpty
    }

    private var historyMenu: some View {
        Menu {
            let conversations = appEnvironment.chat.conversations
            if conversations.isEmpty {
                Text("No conversations yet")
            }
            ForEach(conversations) { conversation in
                Button(conversation.title) {
                    Task { await appEnvironment.chat.open(conversation) }
                }
            }
            if !conversations.isEmpty {
                Divider()
                Menu("Delete") {
                    ForEach(conversations) { conversation in
                        Button(conversation.title, role: .destructive) {
                            Task { await appEnvironment.chat.deleteConversation(conversation) }
                        }
                    }
                }
            }
        } label: {
            Label("History", systemImage: "clock.arrow.circlepath")
        }
        .help("Previous conversations")
    }

    private func errorBar(_ message: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "exclamationmark.triangle")
            Text(message)
                .lineLimit(2)
            Spacer()
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
    }
}

/// One example prompt: a full-width surface row that lights up and shows the
/// pointing hand — a visible invitation, not a dead label.
private struct SuggestionPill: View {
    let text: String
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: "arrow.up.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.tertiary)
                Text(text)
                    .font(.callout)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .buttonStyle(.plain)
        .surfaceCard(radius: 9, hovering: isHovering)
        .onHover { isHovering = $0 }
        .pointingHandCursor()
    }
}

/// The composer: a REAL input container — rounded surface, hairline border,
/// focus tint — with the send/stop button living inside it. ⏎ sends; while
/// streaming the same spot is Stop.
struct ChatComposerBox: View {
    @Environment(AppEnvironment.self) private var appEnvironment
    @FocusState private var isFocused: Bool

    var body: some View {
        @Bindable var model = appEnvironment.chat

        HStack(alignment: .bottom, spacing: 8) {
            TextField(
                appEnvironment.chat.messages.isEmpty
                    ? "Ask about your bookmarks, sessions, or live tabs…"
                    : "Ask a follow-up…",
                text: $model.draft,
                axis: .vertical
            )
            .textFieldStyle(.plain)
            .font(.body)
            .lineLimit(1...6)
            .focused($isFocused)
            .onSubmit { appEnvironment.chat.send() }
            .disabled(appEnvironment.chat.isStreaming)
            .padding(.vertical, 3)

            if appEnvironment.chat.isStreaming {
                Button {
                    appEnvironment.chat.stop()
                } label: {
                    Image(systemName: "stop.circle.fill")
                        .font(.system(size: 22))
                }
                .buttonStyle(.plain)
                .foregroundStyle(.tint)
                .pointingHandCursor()
                .help("Stop generating")
            } else {
                Button {
                    appEnvironment.chat.send()
                } label: {
                    Image(systemName: "arrow.up.circle.fill")
                        .font(.system(size: 22))
                }
                .buttonStyle(.plain)
                .foregroundStyle(appEnvironment.chat.canSend ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
                .disabled(!appEnvironment.chat.canSend)
                .pointingHandCursor()
                .help("Send (⏎)")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.cardFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .strokeBorder(
                    isFocused ? AnyShapeStyle(.tint.opacity(0.6)) : AnyShapeStyle(.separator),
                    lineWidth: 1
                )
        )
        .shadow(color: .black.opacity(0.10), radius: 4, y: 1)
        .onAppear { isFocused = true }
    }
}
