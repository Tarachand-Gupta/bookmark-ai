import Foundation

// ── JSON passthrough ─────────────────────────────────────────────────────────

/// Arbitrary JSON, kept losslessly. Chat message `parts` are the AI SDK's own
/// shapes (text, tool calls with provider metadata like Gemini's
/// `thoughtSignature`) — the server stores them verbatim and needs them back
/// verbatim on the next turn, so this app never maps them into typed structs it
/// would have to keep in sync. Rendering works off small projections instead
/// (see `ChatPartView`).
enum JSONValue: Codable, Hashable, Sendable {
    case null
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Int.self) {
            self = .int(value)
        } else if let value = try? container.decode(Double.self) {
            self = .double(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([JSONValue].self) {
            self = .array(value)
        } else if let value = try? container.decode([String: JSONValue].self) {
            self = .object(value)
        } else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON value")
        }
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null: try container.encodeNil()
        case .bool(let value): try container.encode(value)
        case .int(let value): try container.encode(value)
        case .double(let value): try container.encode(value)
        case .string(let value): try container.encode(value)
        case .array(let value): try container.encode(value)
        case .object(let value): try container.encode(value)
        }
    }

    subscript(key: String) -> JSONValue? {
        if case .object(let dict) = self { return dict[key] }
        return nil
    }

    var stringValue: String? {
        if case .string(let value) = self { return value }
        return nil
    }

    var intValue: Int? {
        switch self {
        case .int(let value): return value
        case .double(let value): return Int(value)
        default: return nil
        }
    }

    var arrayValue: [JSONValue]? {
        if case .array(let value) = self { return value }
        return nil
    }

    /// Pretty JSON for the tool-row disclosure. Sorted keys keep the output
    /// stable between renders; `nil` only for the impossible encode failure.
    var prettyPrinted: String? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(self) else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

// ── Chat wire/storage types ──────────────────────────────────────────────────

/// A UIMessage as the API stores and accepts it: `{id, role, parts}` with the
/// parts passed through untyped. One shape serves the transcript UI, the
/// conversation-detail response, AND the request body of the next turn.
struct ChatMessage: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var role: String
    var parts: [JSONValue]
}

/// `GET /api/chat/conversations` row.
struct ChatConversation: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var title: String
    var createdAt: String
    var updatedAt: String
}

struct ChatConversationsResponse: Codable, Sendable {
    var conversations: [ChatConversation]
}

/// `GET /api/chat/conversations/:id`.
struct ChatConversationDetailResponse: Codable, Sendable {
    var conversation: ChatConversation
    var messages: [ChatMessage]
}

// ── Rendering projection ─────────────────────────────────────────────────────

/// One `tool-<name>` / `dynamic-tool` part, projected for the tool row. The
/// four AI SDK states map to spinner (input-streaming, input-available),
/// check (output-available), and the red state (output-error + `errorText`).
struct ChatToolCall: Hashable {
    enum State: String, Hashable {
        case inputStreaming = "input-streaming"
        case inputAvailable = "input-available"
        case outputAvailable = "output-available"
        case outputError = "output-error"
    }

    var name: String
    var callId: String
    var state: State
    var input: JSONValue?
    var output: JSONValue?
    var errorText: String?

    var isRunning: Bool { state == .inputStreaming || state == .inputAvailable }
    var isError: Bool { state == .outputError }

    /// Tools return `{error}` as a soft failure (the agent recovers); render it
    /// like an error, without pretending the call itself failed.
    var softError: String? { output?["error"]?.stringValue }

    /// The red state, whichever way it arrived: an `output-error` chunk, or —
    /// the server's actual vocabulary for EVERY failing tool, `useSkill`
    /// included — an `output-available` whose object carries a string `error`.
    var isFailure: Bool { isError || softError != nil }

    /// What to show in red under the row.
    var failureText: String? { errorText ?? softError }

    /// `createSkill` / `installSkill` answer `{skill: {id, name, description}}`
    /// — the disclosure shows those two lines instead of raw JSON.
    var skillSummary: ChatSkillSummary? {
        guard name == "createSkill" || name == "installSkill", !isFailure,
              let skill = output?["skill"], let title = skill["name"]?.stringValue
        else { return nil }
        return ChatSkillSummary(name: title, description: skill["description"]?.stringValue ?? "")
    }
}

/// The skill a chat tool just created or installed.
struct ChatSkillSummary: Hashable {
    let name: String
    let description: String
}

/// A `file` UI part — an attachment on a user message (or, rarely, a model
/// output). `url` is a `data:` URL for anything this app sent.
struct ChatFilePart: Hashable {
    var mediaType: String
    var filename: String?
    var url: String

    var isImage: Bool { mediaType.hasPrefix("image/") }
    var isPDF: Bool { mediaType == "application/pdf" }

    var displayName: String {
        if let filename, !filename.isEmpty { return filename }
        return isImage ? "Image" : isPDF ? "Document.pdf" : "Document"
    }

    /// The decoded bytes of a `data:` URL; nil for remote URLs or bad base64.
    var data: Data? {
        guard url.hasPrefix("data:"), let comma = url.firstIndex(of: ",") else { return nil }
        let header = url[url.index(url.startIndex, offsetBy: 5)..<comma]
        guard header.hasSuffix(";base64") else { return nil }
        return Data(base64Encoded: String(url[url.index(after: comma)...]))
    }
}

/// What a message part renders as. Computed from the raw JSON on demand —
/// unknown part types (`step-start`, `source-url`, …) simply don't render, so
/// new server-side part kinds can never crash an already-shipped build.
enum ChatPartView: Hashable {
    case text(String)
    /// `streaming` = the reasoning part hasn't ended yet (only during a turn).
    case reasoning(text: String, streaming: Bool)
    case tool(ChatToolCall)
    case file(ChatFilePart)
}

extension ChatMessage {
    static func user(text: String, files: [JSONValue] = []) -> ChatMessage {
        var parts: [JSONValue] = files
        if !text.isEmpty || files.isEmpty {
            parts.append(.object(["type": .string("text"), "text": .string(text)]))
        }
        return ChatMessage(id: UUID().uuidString, role: "user", parts: parts)
    }

    /// A `file` UI part exactly as the AI SDK expects it on a user message.
    static func filePart(mediaType: String, filename: String, dataURL: String) -> JSONValue {
        .object([
            "type": .string("file"),
            "mediaType": .string(mediaType),
            "filename": .string(filename),
            "url": .string(dataURL),
        ])
    }

    /// The renderable projection of `parts`, in order. `step-start` separators
    /// and unknown kinds are dropped; empty text parts (a `text-start` whose
    /// deltas haven't arrived) are kept so the streaming cursor has an anchor.
    var partViews: [ChatPartView] {
        parts.compactMap { part in
            guard let type = part["type"]?.stringValue else { return nil }
            switch type {
            case "text":
                return .text(part["text"]?.stringValue ?? "")
            case "reasoning":
                return .reasoning(
                    text: part["text"]?.stringValue ?? "",
                    streaming: part["state"]?.stringValue == "streaming"
                )
            case "file":
                guard let url = part["url"]?.stringValue else { return nil }
                return .file(ChatFilePart(
                    mediaType: part["mediaType"]?.stringValue ?? "application/octet-stream",
                    filename: part["filename"]?.stringValue,
                    url: url
                ))
            case "dynamic-tool":
                guard let name = part["toolName"]?.stringValue else { return nil }
                return .tool(Self.toolCall(named: name, from: part))
            default:
                if type.hasPrefix("tool-") {
                    return .tool(Self.toolCall(named: String(type.dropFirst("tool-".count)), from: part))
                }
                return nil
            }
        }
    }

    private static func toolCall(named name: String, from part: JSONValue) -> ChatToolCall {
        ChatToolCall(
            name: name,
            callId: part["toolCallId"]?.stringValue ?? "",
            state: ChatToolCall.State(rawValue: part["state"]?.stringValue ?? "") ?? .inputAvailable,
            input: part["input"],
            output: part["output"],
            errorText: part["errorText"]?.stringValue
        )
    }

    /// All text content joined — used for accessibility and copy.
    var plainText: String {
        partViews.compactMap { if case .text(let text) = $0 { text } else { nil } }
            .joined(separator: "\n")
    }

    /// The attachments on this message, in order.
    var fileParts: [ChatFilePart] {
        partViews.compactMap { if case .file(let file) = $0 { file } else { nil } }
    }

    /// True while a streaming turn has produced nothing renderable yet — the
    /// window where the "Thinking" placeholder is the only honest thing to show.
    var hasVisibleContent: Bool {
        partViews.contains { view in
            switch view {
            case .text(let text): !text.isEmpty
            case .reasoning(let text, _): !text.isEmpty
            case .tool, .file: true
            }
        }
    }
}

/// Human copy for the agent's tools — present tense while running, a result
/// count once output landed (the contract's per-tool wording). Unknown tools
/// fall back to their raw name so a new server-side tool still reads sensibly.
enum ChatToolCopy {
    static func label(for call: ChatToolCall) -> String {
        if call.isError { return "\(subject(for: call.name)) failed" }
        if call.isRunning { return runningLabel(for: call) }
        if call.softError != nil { return "\(subject(for: call.name)) failed" }
        return doneLabel(for: call)
    }

    static func runningLabel(for call: ChatToolCall) -> String {
        let input = call.input
        switch call.name {
        case "searchBookmarks":
            if let query = input?["query"]?.stringValue, !query.isEmpty {
                return "Searching bookmarks for “\(query)”"
            }
            return "Searching bookmarks"
        case "queryDatabase": return "Querying your library"
        case "listSessions": return "Listing saved sessions"
        case "listLiveTabs": return "Checking live tabs"
        case "webSearch":
            if let query = input?["query"]?.stringValue, !query.isEmpty {
                return "Searching the web for “\(query)”"
            }
            return "Searching the web"
        case "fetchUrl":
            if let host = input?["url"]?.stringValue.flatMap({ URL(string: $0)?.host() }) {
                return "Reading \(host)"
            }
            return "Reading a page"
        case "useSkill":
            if let name = input?["name"]?.stringValue, !name.isEmpty {
                return "Loading skill “\(name)”"
            }
            return "Loading a skill"
        case "createSkill":
            if let name = input?["name"]?.stringValue, !name.isEmpty {
                return "Creating skill “\(name)”"
            }
            return "Creating a skill"
        case "installSkill":
            if let host = input?["url"]?.stringValue.flatMap({ URL(string: $0)?.host() }) {
                return "Installing skill from \(host)"
            }
            return "Installing a skill"
        default: return "Running \(call.name)"
        }
    }

    static func doneLabel(for call: ChatToolCall) -> String {
        let output = call.output
        switch call.name {
        case "searchBookmarks":
            let count = output?["results"]?.arrayValue?.count ?? 0
            return "Found \(count) bookmark\(count == 1 ? "" : "s")"
        case "queryDatabase":
            let count = output?["rowCount"]?.intValue ?? output?["rows"]?.arrayValue?.count ?? 0
            return "\(count) row\(count == 1 ? "" : "s")"
        case "listSessions":
            let count = output?["sessions"]?.arrayValue?.count ?? output?["total"]?.intValue ?? 0
            return "\(count) session\(count == 1 ? "" : "s")"
        case "listLiveTabs":
            if output?["enabled"] == .bool(false) { return "Live sharing is off" }
            let devices = output?["devices"]?.arrayValue ?? []
            let tabs = devices.reduce(0) { $0 + ($1["tabCount"]?.intValue ?? 0) }
            return "\(tabs) tab\(tabs == 1 ? "" : "s") on \(devices.count) device\(devices.count == 1 ? "" : "s")"
        case "webSearch":
            let count = output?["sources"]?.arrayValue?.count ?? output?["results"]?.arrayValue?.count ?? 0
            return "\(count) source\(count == 1 ? "" : "s")"
        case "fetchUrl":
            if let title = output?["title"]?.stringValue, !title.isEmpty { return "Read \(title)" }
            return "Read the page"
        case "useSkill":
            let name = output?["name"]?.stringValue ?? call.input?["name"]?.stringValue ?? "skill"
            return "Using skill “\(name)”"
        case "createSkill":
            let name = output?["skill"]?["name"]?.stringValue ?? call.input?["name"]?.stringValue ?? "skill"
            return "Created skill “\(name)”"
        case "installSkill":
            let name = output?["skill"]?["name"]?.stringValue ?? "skill"
            return "Installed skill “\(name)”"
        default: return call.name
        }
    }

    /// Noun phrase for the failure label ("Bookmark search failed").
    static func subject(for name: String) -> String {
        switch name {
        case "searchBookmarks": "Bookmark search"
        case "queryDatabase": "Library query"
        case "listSessions": "Session list"
        case "listLiveTabs": "Live tabs check"
        case "webSearch": "Web search"
        case "fetchUrl": "Page read"
        case "useSkill": "Skill"
        case "createSkill": "Skill creation"
        case "installSkill": "Skill install"
        default: name
        }
    }

    static func symbol(for name: String) -> String {
        switch name {
        case "searchBookmarks": "magnifyingglass"
        case "queryDatabase": "tablecells"
        case "listSessions": "rectangle.stack"
        case "listLiveTabs": "dot.radiowaves.left.and.right"
        case "webSearch": "globe"
        case "fetchUrl": "doc.text"
        case "useSkill": "sparkles.rectangle.stack"
        case "createSkill": "square.and.pencil"
        case "installSkill": "square.and.arrow.down"
        default: "wrench.and.screwdriver"
        }
    }
}
