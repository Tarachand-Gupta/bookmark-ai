import AppKit
import QuickLook
import SwiftUI

// ── Reasoning ────────────────────────────────────────────────────────────────

/// The model's thoughts, as a disclosure: auto-expanded and shimmering
/// ("Thinking…") while the reasoning part streams, collapsed to "Thought for
/// N s" once it ends or the answer starts. A manual toggle during streaming
/// wins over the automatic behaviour. Persisted parts render collapsed.
struct ReasoningDisclosure: View {
    let text: String
    let streaming: Bool
    /// Seconds the part took; nil for parts loaded from history.
    var durationSeconds: TimeInterval?

    @State private var userChoice: Bool?
    @State private var isHovering = false

    private var isExpanded: Bool { userChoice ?? streaming }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(.easeOut(duration: 0.16)) { userChoice = !isExpanded }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "brain")
                        .font(.system(size: 10, weight: .medium))
                    if streaming {
                        Text("Thinking…").shimmer()
                    } else {
                        Text(title)
                    }
                    Image(systemName: "chevron.right")
                        .font(.system(size: 8.5, weight: .semibold))
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 7)
                .padding(.vertical, 4)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(isHovering ? .hoverFill : AnyShapeStyle(.clear))
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { isHovering = $0 }
            .pointingHandCursor()
            .help(isExpanded ? "Hide the model's reasoning" : "Show the model's reasoning")

            if isExpanded, !text.isEmpty {
                HStack(alignment: .top, spacing: 10) {
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(.quaternary)
                        .frame(width: 3)
                    MarkdownText(text: text)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                .fixedSize(horizontal: false, vertical: true)
                .padding(.leading, 7)
                .transition(.opacity)
            }
        }
    }

    private var title: String {
        if let durationSeconds {
            return "Thought for \(max(1, Int(durationSeconds.rounded()))) s"
        }
        return "Thoughts"
    }
}

// ── Tool calls ───────────────────────────────────────────────────────────────

/// One tool call as a row: spinner while running, check when done, red when
/// the tool errored (`errorText` shown). Clicking toggles a disclosure with the
/// input arguments and a compact output summary.
struct ChatToolRow: View {
    let call: ChatToolCall

    @State private var isExpanded = false
    @State private var isHovering = false

    private var isFailure: Bool { call.isFailure }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.16)) { isExpanded.toggle() }
            } label: {
                HStack(spacing: 8) {
                    statusIcon
                        .frame(width: 14, height: 14)
                    Image(systemName: ChatToolCopy.symbol(for: call.name))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(.secondary)
                        .frame(width: 14)
                    Text(ChatToolCopy.label(for: call))
                        .font(.caption)
                        .foregroundStyle(isFailure ? AnyShapeStyle(.red) : AnyShapeStyle(.secondary))
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: 8)
                    Image(systemName: "chevron.right")
                        .font(.system(size: 8.5, weight: .semibold))
                        .foregroundStyle(.tertiary)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(isExpanded ? "Hide the call details" : "Show the input and output")

            if isExpanded {
                Divider()
                details
                    .padding(10)
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: 560, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(isHovering ? .cardHoverFill : AnyShapeStyle(.clear))
        )
        .background(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(.cardFill)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .strokeBorder(
                    isFailure ? AnyShapeStyle(.red.opacity(0.45)) : AnyShapeStyle(.separator.opacity(0.7)),
                    lineWidth: 1
                )
        )
        .onHover { isHovering = $0 }
        .pointingHandCursor()
    }

    @ViewBuilder
    private var statusIcon: some View {
        if call.isRunning {
            ProgressView().controlSize(.mini)
        } else if isFailure {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 11))
                .foregroundStyle(.red)
        } else {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
        }
    }

    @ViewBuilder
    private var details: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let failureText = call.failureText {
                Text(failureText)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .textSelection(.enabled)
            }
            if let input = call.input {
                detailBlock("Input", Self.compact(input, limit: 1_200))
            }
            if let summary = call.skillSummary {
                // A created/installed skill reads as name + description, not JSON.
                VStack(alignment: .leading, spacing: 3) {
                    Text(summary.name)
                        .font(.caption)
                        .fontWeight(.medium)
                    if !summary.description.isEmpty {
                        Text(summary.description)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .textSelection(.enabled)
            } else if let output = call.output, !call.isFailure {
                detailBlock("Output", Self.compact(output, limit: 1_200))
            }
            if call.isRunning, call.input == nil {
                Text("Waiting for the tool…")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
    }

    private func detailBlock(_ title: String, _ body: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(title.uppercased())
                .font(.system(size: 9.5, weight: .semibold))
                .kerning(0.4)
                .foregroundStyle(.tertiary)
            Text(body)
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Pretty JSON, cut at `limit` characters — a search result list can run
    /// to tens of kilobytes and this is a summary, not a log viewer.
    static func compact(_ value: JSONValue, limit: Int) -> String {
        let text: String
        if case .string(let raw) = value {
            text = raw
        } else {
            text = value.prettyPrinted ?? String(describing: value)
        }
        guard text.count > limit else { return text }
        return String(text.prefix(limit)) + "\n… (\(text.count - limit) more characters)"
    }
}

// ── Attachments in the transcript ────────────────────────────────────────────

/// Decoded `data:` images, cached per URL so a re-render (every streaming
/// delta re-evaluates the transcript) never re-decodes a megabyte of base64.
enum AttachmentImageCache {
    private static let cache = NSCache<NSString, NSImage>()

    static func image(for file: ChatFilePart) -> NSImage? {
        let key = NSString(string: "\(file.url.count):\(file.url.hashValue)")
        if let cached = cache.object(forKey: key) { return cached }
        guard let data = file.data, let image = NSImage(data: data) else { return nil }
        cache.setObject(image, forKey: key)
        return image
    }

    /// A temp copy for Quick Look — the parts only exist as base64 in memory.
    static func previewURL(for file: ChatFilePart) -> URL? {
        guard let data = file.data else { return nil }
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("ChatAttachments", isDirectory: true)
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let safeName = file.displayName.replacingOccurrences(of: "/", with: "-")
        let url = directory.appendingPathComponent("\(abs(file.url.hashValue))-\(safeName)")
        if !FileManager.default.fileExists(atPath: url.path) {
            try? data.write(to: url)
        }
        return url
    }
}

/// The attachments on one message: image thumbnails (click → Quick Look) and
/// document pills, in the order they were attached.
struct ChatAttachmentsRow: View {
    let files: [ChatFilePart]
    var alignment: HorizontalAlignment = .leading

    @State private var previewURL: URL?

    var body: some View {
        HStack(spacing: 8) {
            ForEach(Array(files.enumerated()), id: \.offset) { _, file in
                if file.isImage, let image = AttachmentImageCache.image(for: file) {
                    AttachmentThumbnail(image: image, name: file.displayName) {
                        previewURL = AttachmentImageCache.previewURL(for: file)
                    }
                } else {
                    DocumentPill(
                        name: file.displayName,
                        mediaType: file.mediaType,
                        byteCount: file.data?.count
                    ) {
                        previewURL = AttachmentImageCache.previewURL(for: file)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: alignment == .trailing ? .trailing : .leading)
        .quickLookPreview($previewURL)
    }
}

/// A rounded image tile; hover lifts it and shows the zoom hint.
struct AttachmentThumbnail: View {
    let image: NSImage
    let name: String
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            Image(nsImage: image)
                .resizable()
                .aspectRatio(contentMode: .fill)
                .frame(width: 132, height: 96)
                .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .strokeBorder(.separator, lineWidth: 1)
                )
                .overlay(alignment: .bottomTrailing) {
                    if isHovering {
                        Image(systemName: "arrow.up.left.and.arrow.down.right")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundStyle(.white)
                            .padding(5)
                            .background(.black.opacity(0.55), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                            .padding(6)
                            .transition(.opacity)
                    }
                }
                .shadow(color: .black.opacity(isHovering ? 0.18 : 0.08), radius: isHovering ? 6 : 2, y: 1)
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .pointingHandCursor()
        .help("Preview \(name)")
        .accessibilityLabel(name)
    }
}

/// A document attachment: type icon, name, size. Click previews with Quick Look.
struct DocumentPill: View {
    let name: String
    let mediaType: String
    var byteCount: Int?
    var action: (() -> Void)?

    @State private var isHovering = false

    var body: some View {
        Button {
            action?()
        } label: {
            HStack(spacing: 8) {
                Image(systemName: AttachmentGlyph.symbol(for: mediaType))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.tint)
                    .frame(width: 28, height: 28)
                    .background(.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                VStack(alignment: .leading, spacing: 1) {
                    Text(name)
                        .font(.caption)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Text(byteCount.map { "\(AttachmentGlyph.kindLabel(for: mediaType)) · \(ByteCountText.string($0))" }
                        ?? AttachmentGlyph.kindLabel(for: mediaType))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: 180, alignment: .leading)
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 6)
            .contentShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
        }
        .buttonStyle(.plain)
        .surfaceCard(radius: 9, hovering: isHovering)
        .onHover { isHovering = $0 }
        .pointingHandCursor()
        .help("Preview \(name)")
    }
}

/// Icon + short type name per attachment media type — shared by composer
/// pills and transcript pills so the two never disagree.
enum AttachmentGlyph {
    static func symbol(for mediaType: String) -> String {
        switch mediaType {
        case "application/pdf": "doc.richtext"
        case "text/csv": "tablecells"
        case "application/json": "curlybraces"
        case "text/html": "chevron.left.forwardslash.chevron.right"
        case "text/markdown": "text.document"
        case let type where type.hasPrefix("image/"): "photo"
        default: "doc.text"
        }
    }

    static func kindLabel(for mediaType: String) -> String {
        switch mediaType {
        case "application/pdf": "PDF"
        case "text/csv": "CSV"
        case "application/json": "JSON"
        case "text/html": "HTML"
        case "text/markdown": "Markdown"
        case "text/plain": "Text"
        case "image/png": "PNG"
        case "image/jpeg": "JPEG"
        case "image/gif": "GIF"
        case "image/webp": "WebP"
        default: mediaType
        }
    }
}

// ── Reply notes ──────────────────────────────────────────────────────────────

/// One line under a reply for a server advisory: the own-key fallback
/// (`X-Ai-Source: own-fallback`) or a key that still needs a model
/// (`X-Ai-Note: own-key-incomplete`).
struct ChatReplyNoteView: View {
    let note: ChatReplyNote

    var body: some View {
        Label {
            Text(note.text)
        } icon: {
            Image(systemName: note.symbolName)
        }
        .font(.caption)
        .foregroundStyle(note == .ownKeyIncomplete ? AnyShapeStyle(.orange) : AnyShapeStyle(.secondary))
        .padding(.top, 2)
    }
}
