import Foundation
import UniformTypeIdentifiers

/// SKILL.md (agentskills.io) ⇄ skill fields — the client-side mirror of
/// `parseSkillMarkdown` / `serializeSkillMarkdown` in `packages/types/src/skills.ts`,
/// so an imported file opens the editor PREFILLED for review before anything
/// is posted (the server parses again on `POST /api/skills/import`).
enum SkillMarkdown {

    struct Parsed: Equatable, Sendable {
        var name: String
        var description: String
        var instructions: String
    }

    enum ParseError: Error, Equatable, LocalizedError {
        case empty
        case missingName
        case missingDescription
        case missingInstructions

        var errorDescription: String? {
            switch self {
            case .empty:
                "The file is empty."
            case .missingName:
                "No skill name found — add `name:` to the frontmatter or start with a `# Heading`."
            case .missingDescription:
                "No description found — add `description:` to the frontmatter or a first paragraph under the heading."
            case .missingInstructions:
                "No instructions found — the markdown body is empty."
            }
        }
    }

    /// Frontmatter first (`---` fenced `name:` / `description:`); whatever it
    /// doesn't supply falls back to the body: the first `# Heading` is the
    /// name, the first paragraph the description, the rest the instructions.
    /// Lines consumed as metadata never leak into the instructions.
    static func parse(_ raw: String) -> Result<Parsed, ParseError> {
        var text = raw
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
        if text.hasPrefix("\u{FEFF}") { text.removeFirst() }
        guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return .failure(.empty)
        }

        var name: String?
        var description: String?
        var lines = text.components(separatedBy: "\n")

        if let frontmatter = splitFrontmatter(lines) {
            name = frontmatter.fields["name"]
            description = frontmatter.fields["description"]
            lines = frontmatter.body
        }

        if name == nil || description == nil {
            dropLeadingBlanks(&lines)
            if let first = lines.first, let heading = headingText(first) {
                if name == nil { name = heading }
                lines.removeFirst()
                dropLeadingBlanks(&lines)
            }
            if description == nil {
                var paragraph: [String] = []
                while let first = lines.first, !first.trimmingCharacters(in: .whitespaces).isEmpty {
                    paragraph.append(first.trimmingCharacters(in: .whitespaces))
                    lines.removeFirst()
                }
                if !paragraph.isEmpty { description = paragraph.joined(separator: " ") }
            }
        }

        let instructions = lines.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        guard let name = name?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else {
            return .failure(.missingName)
        }
        guard let description = description?.trimmingCharacters(in: .whitespacesAndNewlines),
              !description.isEmpty
        else {
            return .failure(.missingDescription)
        }
        guard !instructions.isEmpty else { return .failure(.missingInstructions) }
        return .success(Parsed(name: name, description: description, instructions: instructions))
    }

    /// The canonical file shape — what "Export" would write and what the
    /// server's `serializeSkillMarkdown` produces.
    static func serialize(name: String, description: String, instructions: String) -> String {
        """
        ---
        name: \(yaml(name))
        description: \(yaml(description))
        ---

        \(instructions.trimmingCharacters(in: .whitespacesAndNewlines))

        """
    }

    // MARK: - Pieces

    private struct Frontmatter {
        var fields: [String: String]
        var body: [String]
    }

    /// A `---` fence on the first non-blank line, closed by another `---` (or
    /// `...`). Anything unclosed is not frontmatter and is read as body.
    private static func splitFrontmatter(_ input: [String]) -> Frontmatter? {
        var lines = input
        dropLeadingBlanks(&lines)
        guard let first = lines.first, isFence(first) else { return nil }
        guard let close = lines.dropFirst().firstIndex(where: { isFence($0) || $0.trimmingCharacters(in: .whitespaces) == "..." })
        else { return nil }

        var fields: [String: String] = [:]
        for line in lines[1..<close] {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if trimmed.isEmpty || trimmed.hasPrefix("#") { continue }
            guard let colon = trimmed.firstIndex(of: ":") else { continue }
            let key = trimmed[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let value = unquote(trimmed[trimmed.index(after: colon)...].trimmingCharacters(in: .whitespaces))
            if !value.isEmpty { fields[key] = value }
        }
        return Frontmatter(fields: fields, body: Array(lines[(close + 1)...]))
    }

    private static func isFence(_ line: String) -> Bool {
        line.trimmingCharacters(in: .whitespaces) == "---"
    }

    private static func dropLeadingBlanks(_ lines: inout [String]) {
        while let first = lines.first, first.trimmingCharacters(in: .whitespaces).isEmpty {
            lines.removeFirst()
        }
    }

    /// `# Title` … `###### Title` (closing hashes are decoration).
    private static func headingText(_ line: String) -> String? {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        guard trimmed.hasPrefix("#") else { return nil }
        let hashes = trimmed.prefix(while: { $0 == "#" })
        guard hashes.count <= 6 else { return nil }
        let rest = trimmed.dropFirst(hashes.count)
        guard rest.first == " " || rest.first == "\t" else { return nil }
        var title = rest.trimmingCharacters(in: .whitespaces)
        while title.hasSuffix("#") { title.removeLast() }
        title = title.trimmingCharacters(in: .whitespaces)
        return title.isEmpty ? nil : title
    }

    /// YAML scalars as people actually write them: bare, "double" (with
    /// `\"` / `\\` escapes), or 'single' (with `''`).
    private static func unquote(_ value: String) -> String {
        guard value.count >= 2, let first = value.first, let last = value.last else { return value }
        let inner = String(value.dropFirst().dropLast())
        if first == "\"", last == "\"" {
            return inner
                .replacingOccurrences(of: "\\\"", with: "\"")
                .replacingOccurrences(of: "\\\\", with: "\\")
        }
        if first == "'", last == "'" {
            return inner.replacingOccurrences(of: "''", with: "'")
        }
        return value
    }

    private static func yaml(_ value: String) -> String {
        let special = ":#\"'\n\\"
        let leading = "-?[]{}!&*|>%@`"
        let needsQuotes = value.isEmpty
            || value != value.trimmingCharacters(in: .whitespaces)
            || value.contains(where: { special.contains($0) })
            || value.first.map({ leading.contains($0) }) == true
        guard needsQuotes else { return value }
        let escaped = value
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "\"", with: "\\\"")
            .replacingOccurrences(of: "\n", with: " ")
        return "\"\(escaped)\""
    }
}

/// Reading a SKILL.md / .txt picked in the open panel or dropped on the list:
/// type + size gate, sandbox scope, decoding, then `SkillMarkdown.parse`.
enum SkillImport {
    static let maxBytes = 256 * 1024
    static let allowedExtensions: Set<String> = ["md", "markdown", "txt", "text"]

    /// `.md` resolves to Markdown on macOS, `.txt` to plain text.
    static var contentTypes: [UTType] {
        var types: [UTType] = [.plainText, .text]
        if let markdown = UTType(filenameExtension: "md") { types.insert(markdown, at: 0) }
        return types
    }

    enum ReadError: Error, Equatable, LocalizedError {
        case unsupportedType(String)
        case tooLarge
        case unreadable

        var errorDescription: String? {
            switch self {
            case .unsupportedType(let ext):
                "Only .md and .txt files can be imported\(ext.isEmpty ? "" : " (this is a .\(ext)")\(ext.isEmpty ? "." : ").")"
            case .tooLarge:
                "The file is too large (max 256 KB)."
            case .unreadable:
                "The file couldn't be read as text."
            }
        }
    }

    static func read(_ url: URL) -> Result<SkillMarkdown.Parsed, Error> {
        let ext = url.pathExtension.lowercased()
        guard allowedExtensions.contains(ext) else { return .failure(ReadError.unsupportedType(ext)) }
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return .failure(ReadError.unreadable) }
        guard data.count <= maxBytes else { return .failure(ReadError.tooLarge) }
        guard let text = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .isoLatin1) else {
            return .failure(ReadError.unreadable)
        }
        return SkillMarkdown.parse(text).mapError { $0 as Error }
    }
}
