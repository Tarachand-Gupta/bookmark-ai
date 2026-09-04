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

    private(set) var messages: [ChatMessage] = []
    private(set) var conversationId: String?
    private(set) var conversations: [ChatConversation] = []
    /// History popover: the raw search text, the debounced result (STORED, not
    /// recomputed per keystroke), and the list's load state.
    var historyQuery = ""
    private(set) var visibleConversations: [ChatConversation] = []
    private(set) var isLoadingConversations = false
    private(set) var hasLoadedConversations = false
    private(set) var conversationsError: String?
    private var historySearchTask: Task<Void, Never>?
    private(set) var isStreaming = false
    private(set) var errorMessage: String?
    var draft = ""

    /// Files waiting in the composer, already validated/downscaled.
    private(set) var attachments: [PendingAttachment] = []
    /// The most recent attachment rejection, shown under the composer.
    private(set) var attachmentError: String?
    private var pastedImageCount = 0

    /// Seconds each reasoning part took, keyed by assistant message id → the
    /// part's ordinal among that message's reasoning parts. Survives the
    /// post-turn re-sync so "Thought for 4 s" doesn't degrade to "Thoughts".
    private(set) var reasoningDurations: [String: [Int: TimeInterval]] = [:]
    /// Advisories the server attached to a reply (own-key fallback, key without
    /// a model), keyed by assistant message id — rendered under that reply.
    private(set) var replyNotes: [String: [ChatReplyNote]] = [:]

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
    private(set) var failedTurn: FailedTurn?
    static let emptyReplyCopy = "The AI returned no reply."

    #if DEBUG
    /// Tests: a fixture stream instead of `POST /api/chat`.
    var turnStarter: ((ChatMessage, String?) async throws -> ChatStreamHandle)?
    #endif

    private let api: ApiClient
    private var streamTask: Task<Void, Never>?

    init(api: ApiClient) {
        self.api = api
    }

    var canSend: Bool {
        let hasText = !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        return (hasText || !attachments.isEmpty) && !isStreaming
    }

    /// Sum of the base64 payload the pending files would add to the message.
    var attachmentsEncodedBytes: Int {
        attachments.reduce(0) { $0 + $1.encodedByteCount }
    }

    // MARK: - Sending

    func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard canSend else { return }
        let userMessage = ChatMessage.user(text: text, files: attachments.map(\.filePart))
        draft = ""
        attachments = []
        attachmentError = nil
        errorMessage = nil
        failedTurn = nil
        messages.append(userMessage)

        isStreaming = true
        streamTask = Task {
            await runTurn(sending: userMessage)
            isStreaming = false
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
        let userMessage = ChatMessage(id: UUID().uuidString, role: "user", parts: original.parts)
        messages.append(userMessage)

        isStreaming = true
        streamTask = Task {
            await runTurn(sending: userMessage)
            isStreaming = false
        }
    }

    /// Cancel the in-flight turn. What already streamed stays visible; the
    /// server keeps whatever it managed to persist.
    func stop() {
        streamTask?.cancel()
        streamTask = nil
        isStreaming = false
    }

    private func runTurn(sending userMessage: ChatMessage) async {
        var streamedAssistantId: String?
        var notes: [ChatReplyNote] = []

        do {
            let handle: ChatStreamHandle
            #if DEBUG
            if let turnStarter {
                handle = try await turnStarter(userMessage, conversationId)
            } else {
                handle = try await api.startChatTurn(message: userMessage, conversationId: conversationId)
            }
            #else
            handle = try await api.startChatTurn(message: userMessage, conversationId: conversationId)
            #endif
            if conversationId == nil { conversationId = handle.conversationId }
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
                messages.append(ChatMessage(id: assistantId, role: "assistant", parts: []))
                streamedAssistantId = assistantId
                assistantIndex = messages.count - 1
                return assistantIndex!
            }

            func updatePart(_ index: Int, _ partIndex: Int, _ mutate: (inout [String: JSONValue]) -> Void) {
                guard case .object(var part) = messages[index].parts[partIndex] else { return }
                mutate(&part)
                messages[index].parts[partIndex] = .object(part)
            }

            /// Text starting means the model is done thinking for now — close
            /// any reasoning part still marked streaming (the disclosure
            /// collapses on that state change).
            func finishStreamingReasoning(at index: Int) {
                for (id, partIndex) in reasoningIndex {
                    guard case .object(let part) = messages[index].parts[partIndex],
                          part["state"]?.stringValue == "streaming" else { continue }
                    updatePart(index, partIndex) { $0["state"] = .string("done") }
                    recordReasoningDuration(id: id, started: reasoningStartedAt, ordinal: reasoningOrdinal)
                }
            }

            func recordReasoningDuration(id: String, started: [String: Date], ordinal: [String: Int]) {
                guard let assistantId = streamedAssistantId, let start = started[id],
                      let ordinal = ordinal[id] else { return }
                reasoningDurations[assistantId, default: [:]][ordinal] = Date().timeIntervalSince(start)
            }

            for try await chunk in handle.chunks {
                if Task.isCancelled { break }
                switch chunk {
                case .start(let messageId):
                    _ = ensureAssistant(id: messageId)

                case .textStart(let id):
                    let index = ensureAssistant(id: nil)
                    finishStreamingReasoning(at: index)
                    messages[index].parts.append(.object(["type": .string("text"), "text": .string("")]))
                    textIndex[id] = messages[index].parts.count - 1

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
                    messages[index].parts.append(.object([
                        "type": .string("reasoning"),
                        "text": .string(""),
                        "state": .string("streaming"),
                    ]))
                    reasoningIndex[id] = messages[index].parts.count - 1
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
                    messages[index].parts.append(.object([
                        "type": .string("tool-\(name)"),
                        "toolCallId": .string(callId),
                        "state": .string("input-streaming"),
                    ]))
                    toolIndex[callId] = messages[index].parts.count - 1

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
                        messages[index].parts.append(.object([:]))
                        partIndex = messages[index].parts.count - 1
                        toolIndex[callId] = partIndex
                    }
                    var part: [String: JSONValue] = [
                        "type": .string("tool-\(name)"),
                        "toolCallId": .string(callId),
                        "state": .string("input-available"),
                    ]
                    if let input { part["input"] = input }
                    messages[index].parts[partIndex] = .object(part)

                case .toolOutputAvailable(let callId, let output):
                    let index = ensureAssistant(id: nil)
                    guard let partIndex = toolIndex[callId] else { break }
                    updatePart(index, partIndex) { part in
                        part["state"] = .string("output-available")
                        if let output { part["output"] = output }
                    }
                    // A skill the agent just created/installed must show up in
                    // the Skills sheet without a manual reload.
                    if let type = messages[index].parts[partIndex]["type"]?.stringValue,
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
                    messages[index].parts.append(.object([
                        "type": .string("file"),
                        "url": .string(url),
                        "mediaType": .string(mediaType),
                    ]))

                case .error(let text):
                    errorMessage = text

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
            if let index = assistantIndex, !messages[index].hasVisibleContent {
                messages.remove(at: index)
                streamedAssistantId = nil
                hollow = true
            } else {
                hollow = assistantIndex == nil
            }
            if hollow {
                failedTurn = FailedTurn(userMessageId: userMessage.id, message: errorMessage ?? Self.emptyReplyCopy)
                errorMessage = nil
            }
        } catch is CancellationError {
            // Stopped by the user — keep the partial message.
        } catch {
            if let apiError = error as? ApiError {
                errorMessage = apiError.errorDescription
            } else if !(error is CancellationError) {
                errorMessage = error.localizedDescription
            }
        }

        if !notes.isEmpty, let streamedAssistantId {
            replyNotes[streamedAssistantId] = notes
        }

        // Re-sync from the server's persisted copy — the authoritative shape for
        // the next turn. Best effort: on failure the local build stands.
        if let conversationId {
            if let detail = try? await api.conversation(id: conversationId) {
                // A hollow assistant message the server persisted is never
                // worth a bubble — the failure row under the prompt says it.
                messages = detail.messages.filter { $0.role != "assistant" || $0.hasVisibleContent }
                reconcileTurnMetadata(streamedAssistantId: streamedAssistantId)
            }
            await refreshConversations()
        }
    }

    #if DEBUG
    /// Tests: run one turn end to end against `turnStarter`.
    func runTurnForTesting(_ message: ChatMessage) async {
        await runTurn(sending: message)
    }
    #endif

    /// The persisted assistant message normally keeps the streamed id (the
    /// `start` chunk's `messageId`). If the server chose another, move the
    /// per-turn metadata onto the last assistant message so nothing is lost.
    private func reconcileTurnMetadata(streamedAssistantId: String?) {
        guard let streamedAssistantId,
              !messages.contains(where: { $0.id == streamedAssistantId }),
              let persisted = messages.last(where: { $0.role == "assistant" })
        else { return }
        if let durations = reasoningDurations.removeValue(forKey: streamedAssistantId) {
            reasoningDurations[persisted.id] = durations
        }
        if let notes = replyNotes.removeValue(forKey: streamedAssistantId) {
            replyNotes[persisted.id] = notes
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
    }

    // MARK: - History

    func refreshConversations() async {
        isLoadingConversations = true
        defer { isLoadingConversations = false }
        do {
            conversations = try await api.listConversations().conversations
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
        guard !isStreaming else { stop(); return await open(conversation) }
        errorMessage = nil
        failedTurn = nil
        do {
            let detail = try await api.conversation(id: conversation.id)
            conversationId = detail.conversation.id
            messages = detail.messages.filter { $0.role != "assistant" || $0.hasVisibleContent }
        } catch {
            errorMessage = (error as? ApiError)?.errorDescription ?? error.localizedDescription
        }
    }

    func newConversation() {
        stop()
        conversationId = nil
        messages = []
        errorMessage = nil
        failedTurn = nil
        attachments = []
        attachmentError = nil
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

    func reset() {
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
