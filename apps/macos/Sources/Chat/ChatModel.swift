import AppKit
import Foundation
import Observation
import OSLog

/// The Ask AI conversation state: the transcript, the in-flight stream, the
/// composer's attachments, and the stored-conversation history.
///
/// Transcript strategy: while a turn streams, the assistant message is built
/// locally from the chunks (so the UI updates token by token). Once the turn
/// finishes, the transcript is REPLACED by the server's persisted copy — the
/// server stores parts verbatim including provider metadata (Gemini's
/// `thoughtSignature`), and history lives there: every later turn sends only
/// the new user message plus the conversation id (`ChatTurnBody`).
@MainActor
@Observable
final class ChatModel {

    private(set) var messages: [ChatMessage] {
        get { active.messages }
        set { active.messages = newValue }
    }
    private(set) var conversationId: String? {
        get { active.conversationId }
        set { active.conversationId = newValue }
    }
    private(set) var conversations: [ChatConversation] = []
    /// History popover: the raw search text, the debounced result (STORED, not
    /// recomputed per keystroke), and the list's load state.
    var historyQuery = ""
    private(set) var visibleConversations: [ChatConversation] = []
    private(set) var isLoadingConversations = false
    private(set) var hasLoadedConversations = false
    private(set) var conversationsError: String?
    private var historySearchTask: Task<Void, Never>?
    private(set) var isStreaming: Bool {
        get { active.isStreaming }
        set { active.isStreaming = newValue }
    }
    private(set) var errorMessage: String? {
        get { active.errorMessage }
        set { active.errorMessage = newValue }
    }
    var draft: String {
        get { active.draft }
        set { active.draft = newValue; persistDrafts() }
    }

    /// Files waiting in the composer, already validated/downscaled.
    private(set) var attachments: [PendingAttachment] {
        get { active.attachments }
        set { active.attachments = newValue }
    }
    /// The most recent attachment rejection, shown under the composer.
    private(set) var attachmentError: String? {
        get { active.attachmentError }
        set { active.attachmentError = newValue }
    }
    private var pastedImageCount = 0

    /// Seconds each reasoning part took, keyed by assistant message id → the
    /// part's ordinal among that message's reasoning parts. Survives the
    /// post-turn re-sync so "Thought for 4 s" doesn't degrade to "Thoughts".
    private(set) var reasoningDurations: [String: [Int: TimeInterval]] {
        get { active.reasoningDurations }
        set { active.reasoningDurations = newValue }
    }
    /// Advisories the server attached to a reply (own-key fallback, key without
    /// a model), keyed by assistant message id — rendered under that reply.
    private(set) var replyNotes: [String: [ChatReplyNote]] {
        get { active.replyNotes }
        set { active.replyNotes = newValue }
    }

    /// Drives the ⋯ ▸ Skills… sheet.
    var isPresentingSkills = false

    /// Fired when a tool call changed the skills list (`createSkill` /
    /// `installSkill` succeeded) so the Skills model reloads.
    var onSkillsChanged: (() -> Void)?

    /// A turn that came back with nothing renderable (the server can 200 with
    /// an empty stream): shown as a failure row under that prompt, with Retry.
    struct FailedTurn: Equatable {
        let userMessageId: String
        let message: String
    }
    private(set) var failedTurn: FailedTurn? {
        get { active.failedTurn }
        set { active.failedTurn = newValue }
    }
    static let emptyReplyCopy = "The AI returned no reply."

    #if DEBUG
    /// Tests: a fixture stream instead of `POST /api/chat`.
    var turnStarter: ((ChatMessage, String?) async throws -> ChatStreamHandle)?
    #endif

    private let api: ApiClient
    private var active = ChatThreadState()
    private var threads: [ChatThreadState] = []
    private var scope: OrganizationScope?
    private var generation = UUID()
    var isPresented = false
    var proposedContext: ChatContext?
    var context: ChatContext {
        get { active.context }
        set { active.context = newValue; persistDrafts() }
    }
    var missingAttachments: [String] { active.missingAttachments }
    var localDrafts: [ChatThreadState] { threads.filter { !$0.draft.isEmpty || !$0.attachments.isEmpty || !$0.missingAttachments.isEmpty || $0.isStreaming } }
    var activeDraftId: String { active.id }
    private var streamTask: Task<Void, Never>? {
        get { active.streamTask }
        set { active.streamTask = newValue }
    }
    private let draftDirectory: URL


    init(api: ApiClient, draftDirectory: URL? = nil) {
        self.api = api
        self.draftDirectory = draftDirectory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(Bundle.main.bundleIdentifier ?? "ai.bookmarkai.macos").appendingPathComponent("ChatDrafts")
        threads = [active]
    }

    func bind(scope: OrganizationScope?) {
        guard self.scope != scope else { return }
        reset()
        self.scope = scope
        guard let url = draftURL, let data = try? Data(contentsOf: url),
              let saved = try? JSONDecoder().decode([SavedChatDraft].self, from: data) else { return }
        threads = saved.map { draft in
            let thread = ChatThreadState()
            thread.id = draft.id; thread.conversationId = draft.conversationId
            thread.draft = draft.text; thread.context = draft.context
            thread.missingAttachments = draft.files
            return thread
        }
        if let first = threads.first { active = first } else { threads = [active] }
    }
    private var draftURL: URL? {
        scope.map { draftDirectory.appendingPathComponent($0.storageKey.replacingOccurrences(of: "/", with: "_") + ".json") }
    }
    private func persistDrafts() {
        guard let url = draftURL else { return }
        let saved = threads.map { SavedChatDraft(id: $0.id, conversationId: $0.conversationId, text: $0.draft, context: $0.context, files: $0.attachments.map(\.filename) + $0.missingAttachments) }
        do {
            try FileManager.default.createDirectory(at: draftDirectory, withIntermediateDirectories: true)
            try JSONEncoder().encode(saved).write(to: url, options: .atomic)
        } catch { active.attachmentError = "This draft could not be saved on this Mac. Keep this window open until you send or copy it." }
    }
    func show(context newContext: ChatContext? = nil) {
        isPresented = true
        guard let newContext, newContext != context else { return }
        if !draft.isEmpty || !attachments.isEmpty || !messages.isEmpty { proposedContext = newContext }
        else { context = newContext }
    }
    func acceptProposedContext() {
        if let proposedContext { context = proposedContext }
        proposedContext = nil
    }
    func removeMissingAttachments() { active.missingAttachments = []; persistDrafts() }
    func selectDraft(_ thread: ChatThreadState) { (NSApp.keyWindow?.firstResponder as? NSTextView)?.unmarkText(); active = thread; isPresented = true }


    var canSend: Bool {
        let hasText = !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return (hasText || !attachments.isEmpty) && !isStreaming && active.missingAttachments.isEmpty && context.isSupported && (context.bookmarkIds?.count ?? 0) <= 1000
    }

    /// Sum of the base64 payload the pending files would add to the message.
    var attachmentsEncodedBytes: Int {
        attachments.reduce(0) { $0 + $1.encodedByteCount }
    }

    // MARK: - Sending

    func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canSend else { return }
        var userMessage = ChatMessage.user(text: text, files: attachments.map(\.filePart))
        userMessage.context = context
        let state = active
        let pendingFiles = attachments
        draft = ""
        attachments = []
        attachmentError = nil
        errorMessage = nil
        failedTurn = nil
        messages.append(userMessage)

        isStreaming = true
        persistDrafts()
        streamTask = Task {
            await runTurn(sending: userMessage, state: state)
            state.isStreaming = false
            if state.failedTurn != nil && state.messages.last?.role == "user" && state.draft.isEmpty {
                state.draft = text; state.attachments = pendingFiles
            }
            persistDrafts()
        }
    }

    /// Re-sends the prompt whose turn came back empty — as a fresh message,
    /// since the server may already hold the first copy.
    func retryFailedTurn() {
        guard let failed = failedTurn, !isStreaming,
              let original = messages.first(where: { $0.id == failed.userMessageId })
        else { return }
        failedTurn = nil
        errorMessage = nil
        let state = active
        let userMessage = ChatMessage(id: UUID().uuidString, role: "user", parts: original.parts, context: original.context)
        messages.append(userMessage)

        isStreaming = true
        streamTask = Task {
            await runTurn(sending: userMessage, state: state)
            state.isStreaming = false
        }
    }

    /// Cancel the in-flight turn. What already streamed stays visible; the
    /// server keeps whatever it managed to persist.
    func stop() {
        streamTask?.cancel()
        streamTask = nil
        isStreaming = false
    }

    private func runTurn(sending userMessage: ChatMessage, state: ChatThreadState) async {
        let ticket = generation
        let scope = self.scope
        var streamedAssistantId: String?
        var notes: [ChatReplyNote] = []

        do {
            if let context = userMessage.context, !context.isSupported {
                throw ApiError.network("Choose Whole library or select bookmarks before sending. Your draft was kept.")
            }
            if let scope, let context = userMessage.context, context.type != "library" {
                let encoded = try JSONDecoder().decode(JSONValue.self, from: JSONEncoder().encode(context))
                let resolved: ContextEnvelope = try await api.organizationRequest("/api/composer/context", method: "POST", body: ["context": encoded], scope: scope)
                guard ticket == generation, !Task.isCancelled else { return }
                if let missing = resolved.resolved.unavailable, !missing.isEmpty {
                    let reasons = Set(missing.map(\.reason)).sorted().joined(separator: "; ")
                    throw ApiError.network("\(missing.count) selected sources are unavailable (\(reasons)). Review your context and select the remaining sources before sending.")
                }
            }
            let handle: ChatStreamHandle
            #if DEBUG
            if let turnStarter {
                handle = try await turnStarter(userMessage, state.conversationId)
            } else {
                handle = try await api.startChatTurn(message: userMessage, conversationId: state.conversationId, context: userMessage.context, scope: scope)
            }
            #else
            handle = try await api.startChatTurn(message: userMessage, conversationId: state.conversationId, context: userMessage.context, scope: scope)
            #endif
            guard ticket == generation, !Task.isCancelled else { return }
            if state.conversationId == nil { state.conversationId = handle.conversationId }
            notes = handle.replyNotes

            var assistantIndex: Int?
            // Stream-part bookkeeping: text/reasoning ids and toolCallIds → part
            // index in the assistant message being assembled.
            var textIndex: [String: Int] = [:]
            var reasoningIndex: [String: Int] = [:]
            var reasoningStartedAt: [String: Date] = [:]
            var reasoningOrdinal: [String: Int] = [:]
            var reasoningCount = 0
            var toolIndex: [String: Int] = [:]
            var toolInputText: [String: String] = [:]

            func ensureAssistant(id: String?) -> Int {
                if let assistantIndex { return assistantIndex }
                let assistantId = id ?? UUID().uuidString
                state.messages.append(ChatMessage(id: assistantId, role: "assistant", parts: []))
                streamedAssistantId = assistantId
                assistantIndex = state.messages.count - 1
                return assistantIndex!
            }

            func updatePart(_ index: Int, _ partIndex: Int, _ mutate: (inout [String: JSONValue]) -> Void) {
                guard case .object(var part) = state.messages[index].parts[partIndex] else { return }
                mutate(&part)
                state.messages[index].parts[partIndex] = .object(part)
            }

            /// Text starting means the model is done thinking for now — close
            /// any reasoning part still marked streaming (the disclosure
            /// collapses on that state change).
            func finishStreamingReasoning(at index: Int) {
                for (id, partIndex) in reasoningIndex {
                    guard case .object(let part) = state.messages[index].parts[partIndex],
                          part["state"]?.stringValue == "streaming" else { continue }
                    updatePart(index, partIndex) { $0["state"] = .string("done") }
                    recordReasoningDuration(id: id, started: reasoningStartedAt, ordinal: reasoningOrdinal)
                }
            }

            func recordReasoningDuration(id: String, started: [String: Date], ordinal: [String: Int]) {
                guard let assistantId = streamedAssistantId, let start = started[id],
                      let ordinal = ordinal[id] else { return }
                state.reasoningDurations[assistantId, default: [:]][ordinal] = Date().timeIntervalSince(start)
            }

            for try await chunk in handle.chunks {
                if Task.isCancelled || ticket != generation { break }
                switch chunk {
                case .start(let messageId):
                    _ = ensureAssistant(id: messageId)

                case .textStart(let id):
                    let index = ensureAssistant(id: nil)
                    finishStreamingReasoning(at: index)
                    state.messages[index].parts.append(.object(["type": .string("text"), "text": .string("")]))
                    textIndex[id] = state.messages[index].parts.count - 1

                case .textDelta(let id, let delta):
                    let index = ensureAssistant(id: nil)
                    guard let partIndex = textIndex[id] else { break }
                    updatePart(index, partIndex) { part in
                        part["text"] = .string((part["text"]?.stringValue ?? "") + delta)
                    }

                case .textEnd:
                    break

                case .reasoningStart(let id):
                    let index = ensureAssistant(id: nil)
                    state.messages[index].parts.append(.object([
                        "type": .string("reasoning"),
                        "text": .string(""),
                        "state": .string("streaming"),
                    ]))
                    reasoningIndex[id] = state.messages[index].parts.count - 1
                    reasoningStartedAt[id] = Date()
                    reasoningOrdinal[id] = reasoningCount
                    reasoningCount += 1

                case .reasoningDelta(let id, let delta):
                    let index = ensureAssistant(id: nil)
                    guard let partIndex = reasoningIndex[id] else { break }
                    updatePart(index, partIndex) { part in
                        part["text"] = .string((part["text"]?.stringValue ?? "") + delta)
                    }

                case .reasoningEnd(let id):
                    let index = ensureAssistant(id: nil)
                    guard let partIndex = reasoningIndex[id] else { break }
                    updatePart(index, partIndex) { $0["state"] = .string("done") }
                    recordReasoningDuration(id: id, started: reasoningStartedAt, ordinal: reasoningOrdinal)

                case .toolInputStart(let callId, let name):
                    let index = ensureAssistant(id: nil)
                    state.messages[index].parts.append(.object([
                        "type": .string("tool-\(name)"),
                        "toolCallId": .string(callId),
                        "state": .string("input-streaming"),
                    ]))
                    toolIndex[callId] = state.messages[index].parts.count - 1

                case .toolInputDelta(let callId, let delta):
                    let index = ensureAssistant(id: nil)
                    guard let partIndex = toolIndex[callId] else { break }
                    let accumulated = (toolInputText[callId] ?? "") + delta
                    toolInputText[callId] = accumulated
                    // Show the arguments as soon as they parse; until then the
                    // raw JSON text is still more honest than nothing.
                    let parsed = accumulated.data(using: .utf8)
                        .flatMap { try? JSONDecoder().decode(JSONValue.self, from: $0) }
                    updatePart(index, partIndex) { $0["input"] = parsed ?? .string(accumulated) }

                case .toolInputAvailable(let callId, let name, let input):
                    let index = ensureAssistant(id: nil)
                    let partIndex: Int
                    if let existing = toolIndex[callId] {
                        partIndex = existing
                    } else {
                        state.messages[index].parts.append(.object([:]))
                        partIndex = state.messages[index].parts.count - 1
                        toolIndex[callId] = partIndex
                    }
                    var part: [String: JSONValue] = [
                        "type": .string("tool-\(name)"),
                        "toolCallId": .string(callId),
                        "state": .string("input-available"),
                    ]
                    if let input { part["input"] = input }
                    state.messages[index].parts[partIndex] = .object(part)

                case .toolOutputAvailable(let callId, let output):
                    let index = ensureAssistant(id: nil)
                    guard let partIndex = toolIndex[callId] else { break }
                    updatePart(index, partIndex) { part in
                        part["state"] = .string("output-available")
                        if let output { part["output"] = output }
                    }
                    // A skill the agent just created/installed must show up in
                    // the Skills sheet without a manual reload.
                    if let type = state.messages[index].parts[partIndex]["type"]?.stringValue,
                       type == "tool-createSkill" || type == "tool-installSkill",
                       output?["error"] == nil {
                        onSkillsChanged?()
                    }

                case .toolOutputError(let callId, let errorText):
                    let index = ensureAssistant(id: nil)
                    guard let partIndex = toolIndex[callId] else { break }
                    updatePart(index, partIndex) { part in
                        part["state"] = .string("output-error")
                        part["errorText"] = .string(errorText)
                    }

                case .file(let url, let mediaType):
                    let index = ensureAssistant(id: nil)
                    state.messages[index].parts.append(.object([
                        "type": .string("file"),
                        "url": .string(url),
                        "mediaType": .string(mediaType),
                    ]))

                case .error(let text):
                    state.errorMessage = text

                case .finish, .done, .other:
                    break
                }
            }

            // A turn that ends mid-thought (stop, stream cut) must not leave a
            // shimmering label behind.
            if let index = assistantIndex { finishStreamingReasoning(at: index) }

            // Nothing renderable came back (a 200 with an empty stream, with
            // or without the server's `error` chunk): drop the hollow
            // assistant message and flag the turn under its prompt — the
            // server's wording if it sent one, plus Retry — instead of a bare
            // error bar.
            let hollow: Bool
            if let index = assistantIndex, !state.messages[index].hasVisibleContent {
                state.messages.remove(at: index)
                streamedAssistantId = nil
                hollow = true
            } else {
                hollow = assistantIndex == nil
            }
            if hollow {
                state.failedTurn = FailedTurn(userMessageId: userMessage.id, message: state.errorMessage ?? Self.emptyReplyCopy)
                state.errorMessage = nil
            }
        } catch is CancellationError {
            // Stopped by the user — keep the partial message.
        } catch {
            if ticket == generation { state.failedTurn = FailedTurn(userMessageId: userMessage.id, message: error.localizedDescription) }
            if let apiError = error as? ApiError {
                state.errorMessage = apiError.errorDescription
            } else if !(error is CancellationError) {
                state.errorMessage = error.localizedDescription
            }
        }

        guard ticket == generation else { return }
        if !notes.isEmpty, let streamedAssistantId {
            state.replyNotes[streamedAssistantId] = notes
        }

        // Re-sync from the server's persisted copy — the authoritative shape for
        // the next turn. Best effort: on failure the local build stands.
        if let conversationId = state.conversationId {
            if let detail = try? await api.conversation(id: conversationId) {
                // A hollow assistant message the server persisted is never
                // worth a bubble — the failure row under the prompt says it.
                guard ticket == generation else { return }
                state.messages = detail.messages.filter { $0.role != "assistant" || $0.hasVisibleContent }
                reconcileTurnMetadata(streamedAssistantId: streamedAssistantId, state: state)
            }
            await refreshConversations()
        }
    }

    #if DEBUG
    /// Tests: run one turn end to end against `turnStarter`.
    func runTurnForTesting(_ message: ChatMessage) async {
        await runTurn(sending: message, state: active)
    }
    #endif

    /// The persisted assistant message normally keeps the streamed id (the
    /// `start` chunk's `messageId`). If the server chose another, move the
    /// per-turn metadata onto the last assistant message so nothing is lost.
    private func reconcileTurnMetadata(streamedAssistantId: String?, state: ChatThreadState) {
        guard let streamedAssistantId,
              !state.messages.contains(where: { $0.id == streamedAssistantId }),
              let persisted = state.messages.last(where: { $0.role == "assistant" })
        else { return }
        if let durations = state.reasoningDurations.removeValue(forKey: streamedAssistantId) {
            state.reasoningDurations[persisted.id] = durations
        }
        if let notes = state.replyNotes.removeValue(forKey: streamedAssistantId) {
            state.replyNotes[persisted.id] = notes
        }
    }

    // MARK: - Attachments

    /// Files the user picked, dropped, or pasted (as URLs). Each is validated
    /// and prepared; the first problem is surfaced, the rest still attach.
    func addAttachments(urls: [URL]) {
        var firstProblem: String?
        for url in urls {
            do {
                try admit(try AttachmentPreparer.load(url: url))
            } catch {
                firstProblem = firstProblem ?? error.localizedDescription
                if let attachmentError = error as? AttachmentError,
                   attachmentError == .tooManyFiles || attachmentError == .totalTooLarge {
                    break
                }
            }
        }
        attachmentError = firstProblem
        persistDrafts()
    }

    /// Raw bytes (a pasted screenshot, a dragged web image) — named by kind.
    func addAttachment(data: Data, filename: String, reportedMediaType: String?) {
        do {
            try admit(try AttachmentPreparer.prepare(data: data, filename: filename, reportedMediaType: reportedMediaType))
            attachmentError = nil
        } catch {
            attachmentError = error.localizedDescription
        }
    }

    /// What a ⌘V or a drop delivered. Returns false when there was nothing to
    /// attach (plain text pastes fall through to the text view).
    @discardableResult
    func acceptPasteboard(_ pasteboard: NSPasteboard) -> Bool {
        guard let payload = AttachmentPasteboard.payload(from: pasteboard) else {
            composerLog.debug("acceptPasteboard: no attachable payload")
            return false
        }
        switch payload {
        case .files(let urls):
            composerLog.debug("acceptPasteboard: \(urls.count) file URL(s)")
            addAttachments(urls: urls)
        case .image(let data, let mediaType):
            composerLog.debug("acceptPasteboard: image \(data.count) bytes \(mediaType, privacy: .public)")
            pastedImageCount += 1
            let suffix = pastedImageCount == 1 ? "" : " \(pastedImageCount)"
            addAttachment(data: data, filename: "Pasted image\(suffix).png", reportedMediaType: mediaType)
        }
        let outcome = "now \(attachments.count) attachment(s), error=\(attachmentError ?? "nil")"
        composerLog.debug("acceptPasteboard: \(outcome, privacy: .public)")
        return true
    }

    func removeAttachment(_ id: PendingAttachment.ID) {
        attachments.removeAll { $0.id == id }
        persistDrafts()
        attachmentError = nil
    }

    func clearAttachmentError() {
        attachmentError = nil
    }

    #if DEBUG
    /// Previews/tests: a transcript (plus per-turn metadata) without a server.
    func seed(
        messages: [ChatMessage],
        streaming: Bool = false,
        reasoningDurations: [String: [Int: TimeInterval]] = [:],
        replyNotes: [String: [ChatReplyNote]] = [:]
    ) {
        self.messages = messages
        self.isStreaming = streaming
        self.reasoningDurations = reasoningDurations
        self.replyNotes = replyNotes
    }
    #endif

    /// Per-message limits: at most 5 files, at most 4 MB of base64 in total.
    private func admit(_ attachment: PendingAttachment) throws {
        guard attachments.count < ChatAttachmentRules.maxFiles else { throw AttachmentError.tooManyFiles }
        guard attachmentsEncodedBytes + attachment.encodedByteCount <= ChatAttachmentRules.maxTotalEncodedBytes else {
            throw AttachmentError.totalTooLarge
        }
        attachments.append(attachment)
        active.missingAttachments.removeAll { $0 == attachment.filename }
        persistDrafts()
    }

    // MARK: - History

    func refreshConversations() async {
        let ticket = generation
        isLoadingConversations = true
        defer { isLoadingConversations = false }
        do {
            let rows = try await api.listConversations().conversations
            guard ticket == generation else { return }
            conversations = rows
            conversationsError = nil
        } catch {
            conversationsError = (error as? ApiError)?.errorDescription ?? error.localizedDescription
        }
        hasLoadedConversations = true
        applyHistoryFilter()
    }

    /// Debounced (150 ms): typing in the popover's search field never
    /// re-filters per keystroke; the result lands in `visibleConversations`.
    func commitHistorySearch() {
        historySearchTask?.cancel()
        historySearchTask = Task { [weak self] in
            try? await Task.sleep(for: .milliseconds(150))
            guard !Task.isCancelled, let self else { return }
            self.applyHistoryFilter()
        }
    }

    private func applyHistoryFilter() {
        visibleConversations = Self.filterConversations(conversations, query: historyQuery)
    }

    /// Title match on every whitespace-separated term (the app-wide rule).
    nonisolated static func filterConversations(_ conversations: [ChatConversation], query: String) -> [ChatConversation] {
        let trimmed = query.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return conversations }
        return conversations.filter { TermFilter.matches($0.title, query: trimmed) }
    }

    #if DEBUG
    /// Previews/tests: the history list (and which conversation is open)
    /// without a server.
    func seedHistory(_ conversations: [ChatConversation], current: String? = nil, query: String = "") {
        self.conversations = conversations
        conversationId = current
        historyQuery = query
        hasLoadedConversations = true
        conversationsError = nil
        applyHistoryFilter()
    }
    #endif

    func open(_ conversation: ChatConversation) async {
        (NSApp.keyWindow?.firstResponder as? NSTextView)?.unmarkText()
        if let thread = threads.first(where: { $0.conversationId == conversation.id }) {
            active = thread
            if thread.isStreaming || !thread.messages.isEmpty { return }
        } else {
            let thread = ChatThreadState(); thread.conversationId = conversation.id
            threads.append(thread); active = thread
        }
        let state = active, ticket = generation
        do {
            let detail = try await api.conversation(id: conversation.id)
            guard ticket == generation, !state.isStreaming else { return }
            state.messages = detail.messages.filter { $0.role != "assistant" || $0.hasVisibleContent }
        } catch { if ticket == generation { state.errorMessage = error.localizedDescription } }
    }

    func newConversation() {
        (NSApp.keyWindow?.firstResponder as? NSTextView)?.unmarkText()
        persistDrafts()
        let thread = ChatThreadState()
        threads.append(thread); active = thread
        proposedContext = nil; isPresented = true
        persistDrafts()
    }

    func deleteConversation(_ conversation: ChatConversation) async {
        do {
            try await api.deleteConversation(id: conversation.id)
            conversations.removeAll { $0.id == conversation.id }
            applyHistoryFilter()
            if conversationId == conversation.id { newConversation() }
        } catch {
            errorMessage = (error as? ApiError)?.errorDescription ?? error.localizedDescription
        }
    }

    func clearPrivateDrafts(scope cachedScope: OrganizationScope? = nil) {
        let url = (cachedScope ?? scope).map { draftDirectory.appendingPathComponent($0.storageKey.replacingOccurrences(of: "/", with: "_") + ".json") }
        if let url { try? FileManager.default.removeItem(at: url) }
        scope = nil; reset()
    }

    func reset() {
        persistDrafts()
        generation = UUID()
        for thread in threads { thread.streamTask?.cancel() }
        active = ChatThreadState(); threads = [active]
        scope = nil; isPresented = false; proposedContext = nil
        stop()
        messages = []
        conversationId = nil
        conversations = []
        visibleConversations = []
        historyQuery = ""
        hasLoadedConversations = false
        conversationsError = nil
        draft = ""
        errorMessage = nil
        failedTurn = nil
        attachments = []
        attachmentError = nil
        reasoningDurations = [:]
        replyNotes = [:]
        isPresentingSkills = false
    }
}

@MainActor @Observable
final class ChatThreadState: Identifiable {
    var id = UUID().uuidString
    var messages: [ChatMessage] = []
    var conversationId: String?
    var draft = ""
    var attachments: [PendingAttachment] = []
    var missingAttachments: [String] = []
    var context = ChatContext.library
    var isStreaming = false
    var errorMessage: String?
    var attachmentError: String?
    var failedTurn: ChatModel.FailedTurn?
    var reasoningDurations: [String: [Int: TimeInterval]] = [:]
    var replyNotes: [String: [ChatReplyNote]] = [:]
    var streamTask: Task<Void, Never>?
}
private struct SavedChatDraft: Codable {
    var id: String; var conversationId: String?; var text: String; var context: ChatContext; var files: [String]
}
