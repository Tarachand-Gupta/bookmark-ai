import SwiftUI

/// Ask AI. The composer is ALWAYS docked to the bottom (Tara's call — same as
/// the web app's sidebar chat); what changes is the space above it: the empty
/// state fills it with the title, example prompts, and the free-credits card,
/// a conversation fills it with the transcript.
struct ChatView: View {
    @Environment(AppEnvironment.self) private var appEnvironment
    @State private var isPresentingHistory = false

    var body: some View {
        @Bindable var model = appEnvironment.chat

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
            // Order = left to right: ⋯ (the home for chat-wide items), History, New.
            ToolbarItem(placement: .primaryAction) { moreMenu }
            ToolbarItem(placement: .primaryAction) { historyButton }
            ToolbarItem(placement: .primaryAction) {
                Button {
                    appEnvironment.chat.newConversation()
                } label: {
                    Label("New Chat", systemImage: "square.and.pencil")
                }
                .help("Start a new conversation")
            }
        }
        .sheet(isPresented: $model.isPresentingSkills) {
            SkillsSheet()
                .environment(appEnvironment)
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
        let chat = appEnvironment.chat
        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(chat.messages) { message in
                    ChatMessageView(
                        message: message,
                        reasoningDurations: chat.reasoningDurations[message.id] ?? [:],
                        notes: chat.replyNotes[message.id] ?? []
                    )
                    // The turn that came back empty: say so, right under it.
                    if let failed = chat.failedTurn, failed.userMessageId == message.id {
                        ChatTurnFailureView(message: failed.message) { chat.retryFailedTurn() }
                    }
                }
                // The instant placeholder: from the moment the user sends until
                // the first renderable chunk lands.
                if chat.isStreaming, streamHasNoVisibleReply {
                    ThinkingIndicator()
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
    /// the window where the Thinking placeholder is the only honest thing to show.
    private var streamHasNoVisibleReply: Bool {
        guard let last = appEnvironment.chat.messages.last else { return true }
        if last.role != "assistant" { return true }
        return !last.hasVisibleContent
    }

    /// Chat-wide items that aren't about the current transcript. Kept a real
    /// menu (not a lone button) — it is the home for whatever comes next.
    private var moreMenu: some View {
        Menu {
            Button {
                appEnvironment.chat.isPresentingSkills = true
            } label: {
                Label("Skills…", systemImage: "sparkles.rectangle.stack")
            }
        } label: {
            Label("More", systemImage: "ellipsis.circle")
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
        .help("Skills and more")
    }

    /// History: a popover hanging under the button — search, day groups, row
    /// actions, keyboard (see `ChatHistoryPopover`). Not a menu: a flat menu
    /// of titles with a Delete submenu was rejected.
    private var historyButton: some View {
        Button {
            isPresentingHistory.toggle()
        } label: {
            Label("History", systemImage: "clock.arrow.circlepath")
        }
        .help("Previous conversations")
        .popover(isPresented: $isPresentingHistory, arrowEdge: .bottom) {
            ChatHistoryPopover(isPresented: $isPresentingHistory)
                .environment(appEnvironment)
        }
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

