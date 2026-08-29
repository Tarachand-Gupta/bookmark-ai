import SwiftUI

/// One transcript entry. User turns are trailing-aligned tinted bubbles;
/// assistant turns render leading-aligned as a sequence of parts — markdown
/// text blocks interleaved with tool-activity chips, in the order they happened.
struct ChatMessageView: View {
    let message: ChatMessage

    var body: some View {
        if message.role == "user" {
            HStack {
                Spacer(minLength: 60)
                Text(message.plainText)
                    .textSelection(.enabled)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.tint.opacity(0.16), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        } else {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(message.partViews.enumerated()), id: \.offset) { _, part in
                    switch part {
                    case .text(let text):
                        if !text.isEmpty {
                            MarkdownText(text: text)
                        }
                    case .tool(let name, let running):
                        ChatToolChip(name: name, running: running)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Inline-markdown rendering (links, bold, code spans) via `AttributedString`.
/// Block constructs (tables, fenced code) fall back to their literal text —
/// a documented v1 gap, not a crash. Links are clickable and the text selectable.
struct MarkdownText: View {
    let text: String

    var body: some View {
        Text(attributed)
            .textSelection(.enabled)
            .tint(.accentColor)
    }

    private var attributed: AttributedString {
        (try? AttributedString(
            markdown: Self.preprocess(text),
            options: AttributedString.MarkdownParsingOptions(
                interpretedSyntax: .inlineOnlyPreservingWhitespace
            )
        )) ?? AttributedString(text)
    }

    /// The inline-only parser keeps list markers as literal text, so `* item`
    /// would render with a raw asterisk. Swap leading markers for real bullets;
    /// everything else passes through untouched.
    static func preprocess(_ text: String) -> String {
        text.split(separator: "\n", omittingEmptySubsequences: false)
            .map { line -> String in
                let leading = line.prefix(while: { $0 == " " })
                let rest = line.dropFirst(leading.count)
                if rest.hasPrefix("* ") || rest.hasPrefix("- ") {
                    return "\(leading)•  \(rest.dropFirst(2))"
                }
                return String(line)
            }
            .joined(separator: "\n")
    }
}

/// The agent's visible working: one capsule per tool call, spinner while the
/// output hasn't landed. Reads as activity, not as content.
struct ChatToolChip: View {
    let name: String
    let running: Bool

    var body: some View {
        HStack(spacing: 6) {
            if running {
                ProgressView()
                    .controlSize(.mini)
            } else {
                Image(systemName: ChatToolCopy.symbol(for: name))
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.secondary)
            }
            Text(ChatToolCopy.label(for: name, running: running))
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 4)
        .background(.quinary, in: Capsule())
        .overlay(Capsule().strokeBorder(.separator.opacity(0.6), lineWidth: 1))
    }
}
