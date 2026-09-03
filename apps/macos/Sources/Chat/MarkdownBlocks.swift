import Foundation

/// Block-level markdown for the chat transcript. `AttributedString`'s inline
/// parser can't do tables, fenced code, headings, or list structure — the agent
/// emits all four — so this splits a message into blocks first and leaves only
/// the *inline* spans (links, bold, code) to Foundation.
///
/// Deliberately small: line-based, no HTML, no reference links, no setext
/// headings — matched to what the chat agent actually produces.
enum MarkdownBlock: Equatable {
    struct ListItem: Equatable {
        /// Nesting level, 0-based (2 spaces of indent per level).
        var depth: Int
        /// The ordered-list number; nil = bullet.
        var ordinal: Int?
        var text: String
    }

    case paragraph(String)
    case heading(level: Int, text: String)
    case list(items: [ListItem])
    case code(language: String?, code: String)
    case table(header: [String], rows: [[String]])
    case quote(String)
    case rule

    // MARK: - Parsing

    static func parse(_ markdown: String) -> [MarkdownBlock] {
        var blocks: [MarkdownBlock] = []
        var paragraph: [String] = []

        func flushParagraph() {
            guard !paragraph.isEmpty else { return }
            blocks.append(.paragraph(paragraph.joined(separator: "\n")))
            paragraph = []
        }

        let lines = markdown.components(separatedBy: "\n")
        var i = 0

        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            // Fenced code — runs to the closing fence, or the end of the text
            // (an unclosed fence mid-stream still renders as code, so a block
            // being streamed in doesn't flicker through a literal ``` state).
            if trimmed.hasPrefix("```") {
                flushParagraph()
                let language = String(trimmed.dropFirst(3)).trimmingCharacters(in: .whitespaces)
                var code: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix("```") {
                    code.append(lines[i])
                    i += 1
                }
                i += 1 // past the closing fence (no-op at end of input)
                blocks.append(.code(language: language.isEmpty ? nil : language, code: code.joined(separator: "\n")))
                continue
            }

            if trimmed.isEmpty {
                flushParagraph()
                i += 1
                continue
            }

            // Table: a pipe row whose NEXT line is the |---|---| separator.
            if trimmed.hasPrefix("|"), i + 1 < lines.count,
               isTableSeparator(lines[i + 1].trimmingCharacters(in: .whitespaces)) {
                flushParagraph()
                let header = tableCells(trimmed)
                i += 2
                var rows: [[String]] = []
                while i < lines.count {
                    let rowLine = lines[i].trimmingCharacters(in: .whitespaces)
                    guard rowLine.hasPrefix("|") else { break }
                    rows.append(pad(tableCells(rowLine), to: header.count))
                    i += 1
                }
                blocks.append(.table(header: header, rows: rows))
                continue
            }

            if let heading = parseHeading(trimmed) {
                flushParagraph()
                blocks.append(heading)
                i += 1
                continue
            }

            if isRule(trimmed) {
                flushParagraph()
                blocks.append(.rule)
                i += 1
                continue
            }

            if trimmed.hasPrefix(">") {
                flushParagraph()
                var quote: [String] = []
                while i < lines.count {
                    let inner = lines[i].trimmingCharacters(in: .whitespaces)
                    guard inner.hasPrefix(">") else { break }
                    quote.append(String(inner.dropFirst()).trimmingCharacters(in: .whitespaces))
                    i += 1
                }
                blocks.append(.quote(quote.joined(separator: "\n")))
                continue
            }

            if let item = parseListItem(line) {
                flushParagraph()
                var items = [item]
                i += 1
                while i < lines.count, let next = parseListItem(lines[i]) {
                    items.append(next)
                    i += 1
                }
                blocks.append(.list(items: items))
                continue
            }

            paragraph.append(line)
            i += 1
        }

        flushParagraph()
        return blocks
    }

    // MARK: - Line classifiers

    /// `|---|:---:|--:|` — only pipes, dashes, colons, and spaces, with at
    /// least one dash.
    static func isTableSeparator(_ trimmed: String) -> Bool {
        guard trimmed.hasPrefix("|") || trimmed.hasPrefix(":") || trimmed.hasPrefix("-") else { return false }
        guard trimmed.contains("-") else { return false }
        return trimmed.allSatisfy { "|-: ".contains($0) }
    }

    static func tableCells(_ trimmed: String) -> [String] {
        var body = Substring(trimmed)
        if body.hasPrefix("|") { body = body.dropFirst() }
        if body.hasSuffix("|") { body = body.dropLast() }
        return body.split(separator: "|", omittingEmptySubsequences: false)
            .map { $0.trimmingCharacters(in: .whitespaces) }
    }

    private static func pad(_ cells: [String], to count: Int) -> [String] {
        if cells.count >= count { return Array(cells.prefix(count)) }
        return cells + Array(repeating: "", count: count - cells.count)
    }

    private static func parseHeading(_ trimmed: String) -> MarkdownBlock? {
        guard trimmed.hasPrefix("#") else { return nil }
        let hashes = trimmed.prefix(while: { $0 == "#" })
        guard hashes.count <= 6 else { return nil }
        let rest = trimmed.dropFirst(hashes.count)
        guard rest.hasPrefix(" ") else { return nil }
        return .heading(level: hashes.count, text: rest.trimmingCharacters(in: .whitespaces))
    }

    private static func isRule(_ trimmed: String) -> Bool {
        guard trimmed.count >= 3 else { return false }
        return trimmed.allSatisfy { $0 == "-" } || trimmed.allSatisfy { $0 == "*" } || trimmed.allSatisfy { $0 == "_" }
    }

    private static func parseListItem(_ line: String) -> ListItem? {
        let indent = line.prefix(while: { $0 == " " }).count
        let rest = line.drop(while: { $0 == " " })

        for marker in ["- ", "* ", "+ "] where rest.hasPrefix(marker) {
            return ListItem(depth: min(indent / 2, 3), ordinal: nil, text: String(rest.dropFirst(2)))
        }

        // "12. text" / "12) text"
        let digits = rest.prefix(while: \.isNumber)
        guard !digits.isEmpty, digits.count <= 4, let ordinal = Int(digits) else { return nil }
        let afterDigits = rest.dropFirst(digits.count)
        guard afterDigits.hasPrefix(". ") || afterDigits.hasPrefix(") ") else { return nil }
        return ListItem(depth: min(indent / 2, 3), ordinal: ordinal, text: String(afterDigits.dropFirst(2)))
    }
}
