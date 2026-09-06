import Foundation

/// One chunk of the AI SDK's UI-message SSE stream (`toUIMessageStreamResponse`).
/// Wire format verified against the live endpoint: every event is a single
/// `data: {json}` line with a `type` discriminator, terminated by `data: [DONE]`.
/// Unknown types decode to `.other` — the protocol grows (sources, step
/// markers) and an already-shipped build must ignore, not fail.
enum ChatStreamChunk: Equatable, Sendable {
    case start(messageId: String?)
    case textStart(id: String)
    case textDelta(id: String, delta: String)
    case textEnd(id: String)
    /// `sendReasoning: true` streams the model's thoughts as their own part.
    case reasoningStart(id: String)
    case reasoningDelta(id: String, delta: String)
    case reasoningEnd(id: String)
    case toolInputStart(toolCallId: String, toolName: String)
    /// The tool's JSON input arriving token by token (`inputTextDelta`).
    case toolInputDelta(toolCallId: String, inputTextDelta: String)
    case toolInputAvailable(toolCallId: String, toolName: String, input: JSONValue?)
    case toolOutputAvailable(toolCallId: String, output: JSONValue?)
    /// The tool itself threw — the red state, with the message to show.
    case toolOutputError(toolCallId: String, errorText: String)
    /// A file the model produced (rare; e.g. an image). `url` is usually `data:`.
    case file(url: String, mediaType: String)
    case error(String)
    case finish
    case done
    case other(type: String)

    /// Parse one SSE line. Returns nil for blanks, comments, and non-`data:`
    /// fields (this stream uses no `event:`/`id:` fields).
    static func parse(line: String) -> ChatStreamChunk? {
        guard line.hasPrefix("data:") else { return nil }
        let payload = line.dropFirst("data:".count).trimmingCharacters(in: .whitespaces)
        if payload.isEmpty { return nil }
        if payload == "[DONE]" { return .done }
        guard let data = payload.data(using: .utf8),
              let json = try? JSONDecoder().decode(JSONValue.self, from: data),
              let type = json["type"]?.stringValue
        else { return nil }

        switch type {
        case "start":
            return .start(messageId: json["messageId"]?.stringValue)
        case "text-start":
            return .textStart(id: json["id"]?.stringValue ?? "")
        case "text-delta":
            return .textDelta(id: json["id"]?.stringValue ?? "", delta: json["delta"]?.stringValue ?? "")
        case "text-end":
            return .textEnd(id: json["id"]?.stringValue ?? "")
        case "reasoning-start":
            return .reasoningStart(id: json["id"]?.stringValue ?? "")
        case "reasoning-delta":
            return .reasoningDelta(id: json["id"]?.stringValue ?? "", delta: json["delta"]?.stringValue ?? "")
        case "reasoning-end":
            return .reasoningEnd(id: json["id"]?.stringValue ?? "")
        case "tool-input-start":
            guard let callId = json["toolCallId"]?.stringValue else { return .other(type: type) }
            return .toolInputStart(toolCallId: callId, toolName: json["toolName"]?.stringValue ?? "")
        case "tool-input-delta":
            guard let callId = json["toolCallId"]?.stringValue else { return .other(type: type) }
            return .toolInputDelta(toolCallId: callId, inputTextDelta: json["inputTextDelta"]?.stringValue ?? "")
        case "tool-input-available":
            guard let callId = json["toolCallId"]?.stringValue else { return .other(type: type) }
            return .toolInputAvailable(
                toolCallId: callId,
                toolName: json["toolName"]?.stringValue ?? "",
                input: json["input"]
            )
        case "tool-output-available":
            guard let callId = json["toolCallId"]?.stringValue else { return .other(type: type) }
            return .toolOutputAvailable(toolCallId: callId, output: json["output"])
        case "tool-output-error":
            guard let callId = json["toolCallId"]?.stringValue else { return .other(type: type) }
            return .toolOutputError(
                toolCallId: callId,
                errorText: json["errorText"]?.stringValue ?? "The tool failed."
            )
        case "file":
            guard let url = json["url"]?.stringValue else { return .other(type: type) }
            return .file(url: url, mediaType: json["mediaType"]?.stringValue ?? "application/octet-stream")
        case "error":
            return .error(json["errorText"]?.stringValue ?? "The model returned an error.")
        case "finish":
            return .finish
        default:
            return .other(type: type)
        }
    }
}

/// A started chat turn: the conversation id the server chose (from the
/// `x-conversation-id` header), which key answered (`x-ai-source`:
/// `included | own | own-fallback`), an optional advisory (`x-ai-note`, e.g.
/// `own-key-incomplete`), plus the chunk stream to consume.
struct ChatStreamHandle {
    let conversationId: String?
    let aiSource: String?
    let aiNote: String?
    let chunks: AsyncThrowingStream<ChatStreamChunk, Error>

    /// The one-line notes to show under this turn's reply.
    var replyNotes: [ChatReplyNote] {
        var notes: [ChatReplyNote] = []
        if aiSource == "own-fallback" { notes.append(.ownKeyFallback) }
        if aiNote == "own-key-incomplete" { notes.append(.ownKeyIncomplete) }
        return notes
    }
}

/// Advisories the chat route attaches to a reply via headers.
enum ChatReplyNote: Hashable, Sendable {
    /// `X-Ai-Source: own-fallback` — the free meter ran out, the stored key answered.
    case ownKeyFallback
    /// `X-Ai-Note: own-key-incomplete` — own mode, but the key has no model yet.
    case ownKeyIncomplete

    var text: String {
        switch self {
        case .ownKeyFallback: "Free credits are used up this week — running on your own key. Resets Monday."
        case .ownKeyIncomplete: "Your key needs a model — pick one in Settings → AI. This reply ran on the included free AI."
        }
    }

    var symbolName: String {
        switch self {
        case .ownKeyFallback: "key.horizontal"
        case .ownKeyIncomplete: "exclamationmark.triangle"
        }
    }
}

/// `POST /api/chat` body. History lives on the server: the FIRST turn sends
/// `messages: [user]` (the server creates the conversation), every later turn
/// sends only `message` + `conversationId` and the server loads the stored
/// transcript itself — request bodies stay small even with attachments.
/// `timezone` lets the prompt say what "today" means for this user.
struct ChatTurnBody: Encodable, Equatable {
    var messages: [ChatMessage]?
    var message: ChatMessage?
    var conversationId: String?
    var timezone: String

    static func make(message: ChatMessage, conversationId: String?, timezone: String) -> ChatTurnBody {
        if let conversationId {
            return ChatTurnBody(messages: nil, message: message, conversationId: conversationId, timezone: timezone)
        }
        return ChatTurnBody(messages: [message], message: nil, conversationId: nil, timezone: timezone)
    }
}

extension ApiClient {

    /// `POST /api/chat` — start a streaming agent turn for ONE new user message
    /// (see `ChatTurnBody`). One manual 401 retry with a forced token re-mint,
    /// mirroring `send()`'s policy — the shared path can't be reused because
    /// this response is consumed as a byte stream, not a body.
    func startChatTurn(
        message: ChatMessage,
        conversationId: String?
    ) async throws -> ChatStreamHandle {
        try await startChatTurn(message: message, conversationId: conversationId, allowRetry: true)
    }

    private func startChatTurn(
        message: ChatMessage,
        conversationId: String?,
        allowRetry: Bool
    ) async throws -> ChatStreamHandle {
        guard let url = Self.makeURL(base: target.baseURL, path: "/api/chat", query: []) else {
            throw ApiError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        // An agent turn runs up to ~50s server-side (tool calls included); the
        // default 20s request timeout would kill it between deltas.
        request.timeoutInterval = 90

        let body = ChatTurnBody.make(
            message: message, conversationId: conversationId, timezone: TimeZone.current.identifier
        )
        request.httpBody = try JSONEncoder().encode(body)

        if target.requiresAuth, let tokenProvider {
            // Same rule as `ApiClient.send`: never POST bare to the cloud.
            guard let token = await tokenProvider(!allowRetry) else { throw ApiError.noToken }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        let bytes: URLSession.AsyncBytes
        let response: URLResponse
        do {
            (bytes, response) = try await session.bytes(for: request)
        } catch let error as URLError {
            throw ApiError.network(Self.describe(error))
        } catch {
            throw ApiError.network(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw ApiError.network("The server sent a response the app couldn't interpret.")
        }

        guard (200..<300).contains(http.statusCode) else {
            // Drain (bounded) so the error body is readable, then map it.
            var data = Data()
            for try await byte in bytes {
                data.append(byte)
                if data.count > 16_384 { break }
            }
            let body = try? Self.decoder.decode(ErrorBody.self, from: data)
            let apiError = ApiError.fromResponse(status: http.statusCode, body: body)
            if case .unauthorized = apiError, target.requiresAuth, tokenProvider != nil {
                if allowRetry {
                    return try await startChatTurn(message: message, conversationId: conversationId, allowRetry: false)
                }
                onUnauthorized?()
            }
            throw Self.chatError(status: http.statusCode, body: body, fallback: apiError)
        }

        let newConversationId = http.value(forHTTPHeaderField: "x-conversation-id")
        let aiSource = http.value(forHTTPHeaderField: "x-ai-source")
        let aiNote = http.value(forHTTPHeaderField: "x-ai-note")

        let chunks = AsyncThrowingStream<ChatStreamChunk, Error> { continuation in
            let task = Task {
                do {
                    for try await line in bytes.lines {
                        if Task.isCancelled { break }
                        guard let chunk = ChatStreamChunk.parse(line: line) else { continue }
                        if case .done = chunk {
                            continuation.finish()
                            return
                        }
                        continuation.yield(chunk)
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }

        return ChatStreamHandle(conversationId: newConversationId, aiSource: aiSource, aiNote: aiNote, chunks: chunks)
    }

    /// The chat route's own error vocabulary, turned into sentences a person can
    /// act on. Pure so it is unit-testable.
    nonisolated static func chatError(status: Int, body: ErrorBody?, fallback: ApiError) -> ApiError {
        switch (status, body?.error) {
        case (402, _):
            return .server(
                status: 402,
                message: "The free AI allowance for this week is used up. Add your own API key in Settings → AI to keep chatting."
            )
        case (415, "attachment-type-not-allowed"):
            return .server(status: 415, message: ChatAttachmentRules.rejectionCopy)
        case (413, "attachments-too-large"):
            return .server(status: 413, message: ChatAttachmentRules.totalTooLargeCopy)
        case (400, "too-many-attachments"):
            return .server(status: 400, message: ChatAttachmentRules.tooManyFilesCopy)
        case (400, "attachment-url-not-allowed"):
            return .server(status: 400, message: "Attachments must be embedded files, not links. Attach the file itself instead.")
        case (404, "conversation-not-found"):
            return .server(status: 404, message: "This conversation no longer exists on the server. Start a new chat.")
        default:
            return fallback
        }
    }
}
