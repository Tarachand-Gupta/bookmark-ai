import SwiftUI

/// One transcript entry. User turns are trailing-aligned tinted bubbles (with
/// their attachments above the text); assistant turns render leading-aligned
/// as a sequence of parts — reasoning disclosures, tool rows, and markdown
/// text blocks, in the order they happened.
struct ChatMessageView: View {
    let message: ChatMessage
    /// Seconds per reasoning part (by ordinal), known for turns streamed here.
    var reasoningDurations: [Int: TimeInterval] = [:]
    /// Server advisories for this reply (own-key fallback, key without a model).
    var notes: [ChatReplyNote] = []

    var body: some View {
        if message.role == "user" {
            userBubble
        } else {
            assistantParts
        }
    }

    private var userBubble: some View {
        let files = message.fileParts
        let text = message.plainText
        return HStack {
            Spacer(minLength: 60)
            VStack(alignment: .trailing, spacing: 8) {
                if !files.isEmpty {
                    ChatAttachmentsRow(files: files, alignment: .trailing)
                }
                if !text.isEmpty {
                    Text(text)
                        .textSelection(.enabled)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(.tint.opacity(0.16), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
            }
        }
    }

    private struct IndexedPart: Identifiable {
        let id: Int
        let view: ChatPartView
        /// Position among this message's reasoning parts (durations key).
        let reasoningOrdinal: Int?
    }

    private var indexedParts: [IndexedPart] {
        var ordinal = 0
        return message.partViews.enumerated().map { offset, view in
            if case .reasoning = view {
                defer { ordinal += 1 }
                return IndexedPart(id: offset, view: view, reasoningOrdinal: ordinal)
            }
            return IndexedPart(id: offset, view: view, reasoningOrdinal: nil)
        }
    }

    private var assistantParts: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(indexedParts) { part in
                switch part.view {
                case .text(let text):
                    if !text.isEmpty {
                        MarkdownText(text: text)
                    }
                case .reasoning(let text, let streaming):
                    ReasoningDisclosure(
                        text: text,
                        streaming: streaming,
                        durationSeconds: part.reasoningOrdinal.flatMap { reasoningDurations[$0] }
                    )
                    .zIndex(1)
                case .tool(let call):
                    // Interactive rows sit above the text blocks for hit-testing
                    // — a table/code block sibling must never take their clicks.
                    ChatToolRow(call: call)
                        .zIndex(1)
                case .file(let file):
                    ChatAttachmentsRow(files: [file])
                }
            }
            ForEach(notes, id: \.self) { note in
                ChatReplyNoteView(note: note)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Block-aware markdown: tables, fenced code, headings, lists, quotes, and
/// rules render as real structure (`MarkdownBlock.parse`); inline spans
/// (links, bold, code) go through `AttributedString` per block. Links are
/// clickable and all text is selectable.
struct MarkdownText: View {
    let text: String

    var body: some View {
        let blocks = MarkdownBlock.parse(text)
        VStack(alignment: .leading, spacing: 10) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                MarkdownBlockView(block: block)
            }
        }
    }
}

/// Inline-only markdown (what `AttributedString` is actually good at).
struct InlineMarkdown: View {
    let text: String

    var body: some View {
        Text(Self.attributed(text))
            .textSelection(.enabled)
            .tint(.accentColor)
    }

    static func attributed(_ text: String) -> AttributedString {
        (try? AttributedString(
            markdown: text,
            options: AttributedString.MarkdownParsingOptions(
                interpretedSyntax: .inlineOnlyPreservingWhitespace
            )
        )) ?? AttributedString(text)
    }
}

private struct MarkdownBlockView: View {
    let block: MarkdownBlock

    var body: some View {
        switch block {
        case .paragraph(let text):
            InlineMarkdown(text: text)

        case .heading(let level, let text):
            InlineMarkdown(text: text)
                .font(headingFont(level))
                .padding(.top, 2)

        case .list(let items):
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    HStack(alignment: .firstTextBaseline, spacing: 7) {
                        Text(item.ordinal.map { "\($0)." } ?? "•")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .frame(minWidth: 14, alignment: .trailing)
                        InlineMarkdown(text: item.text)
                    }
                    .padding(.leading, CGFloat(item.depth) * 18)
                }
            }

        case .code(let language, let code):
            MarkdownCodeBlock(language: language, code: code)

        case .table(let header, let rows):
            MarkdownTable(header: header, rows: rows)

        case .quote(let text):
            HStack(alignment: .top, spacing: 10) {
                RoundedRectangle(cornerRadius: 1.5)
                    .fill(.tint.opacity(0.5))
                    .frame(width: 3)
                InlineMarkdown(text: text)
                    .foregroundStyle(.secondary)
            }
            .fixedSize(horizontal: false, vertical: true)

        case .rule:
            Divider().padding(.vertical, 2)
        }
    }

    private func headingFont(_ level: Int) -> Font {
        switch level {
        case 1: .title2.weight(.semibold)
        case 2: .title3.weight(.semibold)
        case 3: .headline
        default: .subheadline.weight(.semibold)
        }
    }
}

/// Fenced code: monospaced on its own surface, language tag in the corner,
/// copy button on hover.
private struct MarkdownCodeBlock: View {
    let language: String?
    let code: String

    @State private var isHovering = false
    @State private var didCopy = false

    var body: some View {
        ScrollView(.horizontal) {
            Text(code)
                .font(.system(.callout, design: .monospaced))
                .textSelection(.enabled)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        // Flat near-solid fill (not a Material — live per-block blur lags
        // scrolling): code must stay legible over any wallpaper.
        .background(.cardFill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(.separator.opacity(0.6), lineWidth: 1)
        )
        .overlay(alignment: .topTrailing) {
            HStack(spacing: 6) {
                if let language, !isHovering, !didCopy {
                    Text(language)
                        .font(.caption2)
                        .foregroundStyle(.tertiary)
                }
                if isHovering || didCopy {
                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(code, forType: .string)
                        didCopy = true
                        Task {
                            try? await Task.sleep(for: .seconds(1.5))
                            didCopy = false
                        }
                    } label: {
                        Label(didCopy ? "Copied" : "Copy", systemImage: didCopy ? "checkmark" : "doc.on.doc")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .pointingHandCursor()
                    .help("Copy code")
                }
            }
            .padding(6)
        }
        .onHover { isHovering = $0 }
    }
}

/// A markdown table as a real `Grid`: header row on its own fill, hairline row
/// separators, zebra striping. No sideways scrolling — `Grid` shares the
/// column's width and cells wrap (capped at ~360pt each), the way a chat
/// transcript should read.
private struct MarkdownTable: View {
    let header: [String]
    let rows: [[String]]

    var body: some View {
        Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
            GridRow {
                ForEach(Array(header.enumerated()), id: \.offset) { _, cell in
                    InlineMarkdown(text: cell)
                        .font(.callout.weight(.semibold))
                        .modifier(TableCellPadding())
                }
            }
            .background(.quaternary.opacity(0.5))

            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                Divider().gridCellUnsizedAxes(.horizontal)
                GridRow {
                    ForEach(Array(row.enumerated()), id: \.offset) { _, cell in
                        InlineMarkdown(text: cell)
                            .font(.callout)
                            .modifier(TableCellPadding())
                    }
                }
                .background(index.isMultiple(of: 2) ? AnyShapeStyle(.clear) : AnyShapeStyle(.quinary.opacity(0.5)))
            }
        }
        .background(.cardFill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .fixedSize(horizontal: false, vertical: true)
        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(.separator.opacity(0.8), lineWidth: 1)
        )
    }

    private struct TableCellPadding: ViewModifier {
        func body(content: Content) -> some View {
            content
                .frame(maxWidth: 360, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .frame(maxHeight: .infinity, alignment: .top)
        }
    }
}

