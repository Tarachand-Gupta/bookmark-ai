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

/// What a message part renders as. Computed from the raw JSON on demand —
/// unknown part types simply don't render, so new server-side part kinds can
/// never crash an already-shipped build.
enum ChatPartView: Hashable {
    case text(String)
    /// `running` = the tool call has no output yet (only during streaming).
    case tool(name: String, running: Bool)
}

extension ChatMessage {
    static func user(text: String) -> ChatMessage {
        ChatMessage(
            id: UUID().uuidString,
            role: "user",
            parts: [.object(["type": .string("text"), "text": .string(text)])]
        )
    }

    /// The renderable projection of `parts`, in order. Adjacent constraints:
    /// `step-start` separators and unknown kinds are dropped; empty text parts
    /// (a `text-start` whose deltas haven't arrived) are kept so the streaming
    /// cursor has an anchor.
    var partViews: [ChatPartView] {
        parts.compactMap { part in
            guard let type = part["type"]?.stringValue else { return nil }
            if type == "text" {
                return .text(part["text"]?.stringValue ?? "")
            }
            if type == "dynamic-tool", let name = part["toolName"]?.stringValue {
                return .tool(name: name, running: part["state"]?.stringValue != "output-available")
            }
            if type.hasPrefix("tool-") {
                let name = String(type.dropFirst("tool-".count))
                return .tool(name: name, running: part["state"]?.stringValue != "output-available")
            }
            return nil
        }
    }

    /// All text content joined — used for accessibility and copy.
    var plainText: String {
        partViews.compactMap { if case .text(let text) = $0 { text } else { nil } }
            .joined(separator: "\n")
    }
}

/// Human copy for the agent's tools — present ("Searching…") while running,
/// past once output landed. Unknown tools fall back to their raw name so a new
/// server-side tool still reads sensibly.
enum ChatToolCopy {
    static func label(for name: String, running: Bool) -> String {
        switch name {
        case "searchBookmarks": running ? "Searching bookmarks…" : "Searched bookmarks"
        case "queryDatabase": running ? "Querying the library…" : "Queried the library"
        case "listSessions": running ? "Reading saved sessions…" : "Read saved sessions"
        case "listLiveTabs": running ? "Checking live tabs…" : "Checked live tabs"
        case "webSearch": running ? "Searching the web…" : "Searched the web"
        case "fetchUrl": running ? "Reading a page…" : "Read a page"
        default: running ? "Running \(name)…" : name
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
        default: "wrench.and.screwdriver"
        }
    }
}
