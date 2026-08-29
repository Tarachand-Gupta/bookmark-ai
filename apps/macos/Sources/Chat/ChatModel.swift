import Foundation
import Observation

/// The Ask AI conversation state: the transcript, the in-flight stream, and the
/// stored-conversation history.
///
/// Transcript strategy: while a turn streams, the assistant message is built
/// locally from the chunks (so the UI updates token by token). Once the turn
/// finishes, the transcript is REPLACED by the server's persisted copy — the
/// server stores parts verbatim including provider metadata (Gemini's
/// `thoughtSignature`), and re-sending that exact shape on the next turn is what
/// keeps multi-turn tool use coherent. The local build is only ever a preview.
@MainActor
@Observable
final class ChatModel {

    private(set) var messages: [ChatMessage] = []
    private(set) var conversationId: String?
    private(set) var conversations: [ChatConversation] = []
    private(set) var isStreaming = false
    private(set) var errorMessage: String?
    var draft = ""

    private let api: ApiClient
    private var streamTask: Task<Void, Never>?

    init(api: ApiClient) {
        self.api = api
    }

    var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !isStreaming
    }

    // MARK: - Sending

    func send() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isStreaming else { return }
        draft = ""
        errorMessage = nil
        messages.append(.user(text: text))

        isStreaming = true
        streamTask = Task {
            await runTurn()
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

    private func runTurn() async {
        do {
            let handle = try await api.startChatTurn(messages: messages, conversationId: conversationId)
            if conversationId == nil { conversationId = handle.conversationId }

            var assistantIndex: Int?
            // Stream-part bookkeeping: text ids / toolCallIds → part index in
            // the assistant message being assembled.
            var textIndex: [String: Int] = [:]
            var toolIndex: [String: Int] = [:]

            func ensureAssistant(id: String?) -> Int {
                if let assistantIndex { return assistantIndex }
                messages.append(ChatMessage(id: id ?? UUID().uuidString, role: "assistant", parts: []))
                assistantIndex = messages.count - 1
                return assistantIndex!
            }

            for try await chunk in handle.chunks {
                if Task.isCancelled { break }
                switch chunk {
                case .start(let messageId):
                    _ = ensureAssistant(id: messageId)

                case .textStart(let id):
                    let index = ensureAssistant(id: nil)
                    messages[index].parts.append(.object(["type": .string("text"), "text": .string("")]))
                    textIndex[id] = messages[index].parts.count - 1

                case .textDelta(let id, let delta):
                    let index = ensureAssistant(id: nil)
                    guard let partIndex = textIndex[id],
                          case .object(var part) = messages[index].parts[partIndex]
                    else { break }
                    part["text"] = .string((part["text"]?.stringValue ?? "") + delta)
                    messages[index].parts[partIndex] = .object(part)

                case .textEnd:
                    break

                case .toolInputStart(let callId, let name):
                    let index = ensureAssistant(id: nil)
                    messages[index].parts.append(.object([
                        "type": .string("tool-\(name)"),
                        "toolCallId": .string(callId),
                        "state": .string("input-streaming"),
                    ]))
                    toolIndex[callId] = messages[index].parts.count - 1

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
                    guard let partIndex = toolIndex[callId],
                          case .object(var part) = messages[index].parts[partIndex]
                    else { break }
                    part["state"] = .string("output-available")
                    if let output { part["output"] = output }
                    messages[index].parts[partIndex] = .object(part)

                case .error(let text):
                    errorMessage = text

                case .finish, .done, .other:
                    break
                }
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

        // Re-sync from the server's persisted copy — the authoritative shape for
        // the next turn's re-send. Best effort: on failure the local build stands.
        if let conversationId {
            if let detail = try? await api.conversation(id: conversationId) {
                messages = detail.messages
            }
            await refreshConversations()
        }
    }

    // MARK: - History

    func refreshConversations() async {
        if let response = try? await api.listConversations() {
            conversations = response.conversations
        }
    }

    func open(_ conversation: ChatConversation) async {
        guard !isStreaming else { stop(); return await open(conversation) }
        errorMessage = nil
        do {
            let detail = try await api.conversation(id: conversation.id)
            conversationId = detail.conversation.id
            messages = detail.messages
        } catch {
            errorMessage = (error as? ApiError)?.errorDescription ?? error.localizedDescription
        }
    }

    func newConversation() {
        stop()
        conversationId = nil
        messages = []
        errorMessage = nil
    }

    func deleteConversation(_ conversation: ChatConversation) async {
        do {
            try await api.deleteConversation(id: conversation.id)
            conversations.removeAll { $0.id == conversation.id }
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
        draft = ""
        errorMessage = nil
    }
}
