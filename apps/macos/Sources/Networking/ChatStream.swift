import Foundation

/// One chunk of the AI SDK's UI-message SSE stream (`toUIMessageStreamResponse`).
/// Wire format verified against the live endpoint: every event is a single
/// `data: {json}` line with a `type` discriminator, terminated by `data: [DONE]`.
/// Unknown types decode to `.other` — the protocol grows (reasoning parts,
/// sources) and an already-shipped build must ignore, not fail.
enum ChatStreamChunk: Equatable, Sendable {
    case start(messageId: String?)
    case textStart(id: String)
    case textDelta(id: String, delta: String)
    case textEnd(id: String)
    case toolInputStart(toolCallId: String, toolName: String)
    case toolInputAvailable(toolCallId: String, toolName: String, input: JSONValue?)
    case toolOutputAvailable(toolCallId: String, output: JSONValue?)
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
        case "tool-input-start":
            guard let callId = json["toolCallId"]?.stringValue else { return .other(type: type) }
            return .toolInputStart(toolCallId: callId, toolName: json["toolName"]?.stringValue ?? "")
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
/// `x-conversation-id` header) plus the chunk stream to consume.
struct ChatStreamHandle {
    let conversationId: String?
    let chunks: AsyncThrowingStream<ChatStreamChunk, Error>
}

extension ApiClient {

    /// `POST /api/chat` — start a streaming agent turn. Sends the FULL transcript
    /// (the server converts UIMessages to model messages itself) plus the
    /// conversation id once one exists. One manual 401 retry with a forced token
    /// re-mint, mirroring `send()`'s policy — the shared path can't be reused
    /// because this response is consumed as a byte stream, not a body.
    func startChatTurn(
        messages: [ChatMessage],
        conversationId: String?
    ) async throws -> ChatStreamHandle {
        try await startChatTurn(messages: messages, conversationId: conversationId, allowRetry: true)
    }

    private func startChatTurn(
        messages: [ChatMessage],
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

        struct Body: Encodable {
            let messages: [ChatMessage]
            let conversationId: String?
        }
        request.httpBody = try JSONEncoder().encode(Body(messages: messages, conversationId: conversationId))

        if target.requiresAuth, let tokenProvider {
            if let token = await tokenProvider(!allowRetry) {
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
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
            if case .unauthorized = apiError, allowRetry, target.requiresAuth, tokenProvider != nil {
                return try await startChatTurn(
                    messages: messages, conversationId: conversationId, allowRetry: false
                )
            }
            if http.statusCode == 402 {
                throw ApiError.server(
                    status: 402,
                    message: "The free AI allowance for this week is used up. Add your own API key in the web app's settings to keep chatting."
                )
            }
            throw apiError
        }

        let newConversationId = http.value(forHTTPHeaderField: "x-conversation-id")

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

        return ChatStreamHandle(conversationId: newConversationId, chunks: chunks)
    }
}
