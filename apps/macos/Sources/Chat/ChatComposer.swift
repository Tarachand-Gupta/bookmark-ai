import AppKit
import OSLog
import SwiftUI
import UniformTypeIdentifiers

/// Debug-level trail for paste/drop handling (`log stream --predicate
/// 'subsystem == "ai.purecode.bookmarkai"'`); nothing at default level.
let composerLog = Logger(subsystem: "ai.purecode.bookmarkai", category: "composer")

/// The composer: a REAL input container — rounded surface, hairline border,
/// focus tint (drop tint while a file hovers) — with the paperclip and the
/// send/stop button living inside it. ⏎ or ⌘⏎ sends, ⇧⏎ inserts a newline,
/// ⌘V pastes files and images as attachments, files can be dropped anywhere on
/// the box. Pending attachments sit above the text as pills with a remove ×.
struct ChatComposerBox: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    @State private var isFocused = false
    @State private var isDropTargeted = false
    @State private var focusRequest = 0

    var body: some View {
        @Bindable var model = appEnvironment.chat
        let chat = appEnvironment.chat

        VStack(alignment: .leading, spacing: 6) {
            VStack(alignment: .leading, spacing: 8) {
                if !chat.attachments.isEmpty {
                    AttachmentPillsRow(attachments: chat.attachments) { id in
                        chat.removeAttachment(id)
                    }
                }

                HStack(alignment: .bottom, spacing: 8) {
                    attachButton
                        .padding(.bottom, 3)

                    ComposerTextView(
                        text: $model.draft,
                        placeholder: chat.messages.isEmpty
                            ? "Ask about your bookmarks, sessions, or live tabs…"
                            : "Ask a follow-up…",
                        isEnabled: !chat.isStreaming,
                        focusRequest: focusRequest,
                        onSubmit: { chat.send() },
                        onPasteboard: { chat.acceptPasteboard($0) },
                        onDragTargeted: { isDropTargeted = $0 },
                        onFocusChange: { isFocused = $0 }
                    )

                    sendOrStop
                        .padding(.bottom, 1)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(.cardFill)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(borderStyle, lineWidth: isDropTargeted ? 1.5 : 1)
            )
            .overlay {
                if isDropTargeted {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(.tint.opacity(0.06))
                        .allowsHitTesting(false)
                }
            }
            .shadow(color: .black.opacity(0.10), radius: 4, y: 1)
            .onDrop(of: [.fileURL, .image], isTargeted: $isDropTargeted) { providers in
                DropPayload.load(providers) { urls, images in
                    if !urls.isEmpty { chat.addAttachments(urls: urls) }
                    for (index, image) in images.enumerated() {
                        let suffix = images.count == 1 ? "" : " \(index + 1)"
                        chat.addAttachment(
                            data: image.data,
                            filename: "Dropped image\(suffix).\(image.fileExtension)",
                            reportedMediaType: image.mediaType
                        )
                    }
                }
                return true
            }

            if let error = chat.attachmentError {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Image(systemName: "exclamationmark.triangle")
                    Text(error)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Button {
                        chat.clearAttachmentError()
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 9, weight: .semibold))
                    }
                    .buttonStyle(.plain)
                    .pointingHandCursor()
                    .help("Dismiss")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                .padding(.horizontal, 6)
                .transition(.opacity)
            }
        }
        .onAppear { focusRequest += 1 }
        .animation(.easeOut(duration: 0.15), value: chat.attachments.count)
    }

    private var borderStyle: AnyShapeStyle {
        if isDropTargeted { return AnyShapeStyle(.tint.opacity(0.9)) }
        if isFocused { return AnyShapeStyle(.tint.opacity(0.6)) }
        return AnyShapeStyle(.separator)
    }

    private var attachButton: some View {
        let chat = appEnvironment.chat
        let full = chat.attachments.count >= ChatAttachmentRules.maxFiles
        return Button {
            presentOpenPanel()
        } label: {
            Image(systemName: "paperclip")
                .font(.system(size: 15, weight: .medium))
        }
        .buttonStyle(.plain)
        .foregroundStyle(chat.isStreaming || full ? AnyShapeStyle(.tertiary) : AnyShapeStyle(.secondary))
        .disabled(chat.isStreaming || full)
        .pointingHandCursor()
        .help(full
            ? "Up to \(ChatAttachmentRules.maxFiles) files per message"
            : "Attach images, PDFs, or text documents")
    }

    @ViewBuilder
    private var sendOrStop: some View {
        let chat = appEnvironment.chat
        if chat.isStreaming {
            Button {
                chat.stop()
            } label: {
                Image(systemName: "stop.circle.fill")
                    .font(.system(size: 22))
            }
            .buttonStyle(.plain)
            .foregroundStyle(.tint)
            .pointingHandCursor()
            .help("Stop generating")
        } else {
            Button {
                chat.send()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 22))
            }
            .buttonStyle(.plain)
            .foregroundStyle(chat.canSend ? AnyShapeStyle(.tint) : AnyShapeStyle(.tertiary))
            .disabled(!chat.canSend)
            .keyboardShortcut(.return, modifiers: .command)
            .pointingHandCursor()
            .help("Send (⏎ or ⌘⏎)")
        }
    }

    /// The system open panel, restricted to the allowed types — the picker and
    /// the classifier share one list, so nothing pickable is later rejected
    /// for its type (size still can be).
    private func presentOpenPanel() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = ChatAttachmentRules.allowedContentTypes
        panel.allowsMultipleSelection = true
        panel.canChooseDirectories = false
        panel.canChooseFiles = true
        panel.message = "Images, PDFs and text documents (.md, .txt, .csv, .json, .html) — up to \(ChatAttachmentRules.maxFiles) per message."
        panel.prompt = "Attach"
        guard panel.runModal() == .OK else { return }
        appEnvironment.chat.addAttachments(urls: panel.urls)
        focusRequest += 1
    }
}

// ── Pills ────────────────────────────────────────────────────────────────────

/// Pending attachments above the text: thumbnail or type icon, name, size,
/// and a remove ×. Scrolls sideways when five wide pills won't fit.
struct AttachmentPillsRow: View {
    let attachments: [PendingAttachment]
    let onRemove: (PendingAttachment.ID) -> Void

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(attachments) { attachment in
                    AttachmentPill(attachment: attachment) { onRemove(attachment.id) }
                }
            }
            .padding(.vertical, 1)
        }
        .scrollIndicators(.hidden)
    }
}

private struct AttachmentPill: View {
    let attachment: PendingAttachment
    let onRemove: () -> Void

    @State private var isHovering = false

    var body: some View {
        HStack(spacing: 8) {
            if let thumbnail = attachment.thumbnail {
                Image(nsImage: thumbnail)
                    .resizable()
                    .aspectRatio(contentMode: .fill)
                    .frame(width: 34, height: 34)
                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            } else {
                Image(systemName: AttachmentGlyph.symbol(for: attachment.mediaType))
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.tint)
                    .frame(width: 34, height: 34)
                    .background(.tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            }

            VStack(alignment: .leading, spacing: 1) {
                Text(attachment.filename)
                    .font(.caption)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text("\(AttachmentGlyph.kindLabel(for: attachment.mediaType)) · \(ByteCountText.string(attachment.byteCount))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: 170, alignment: .leading)
            // The full name, for when the middle got truncated. Scoped to the
            // text so it doesn't override the remove button's own tooltip.
            .help(attachment.filename)

            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 13))
                    .foregroundStyle(isHovering ? AnyShapeStyle(.secondary) : AnyShapeStyle(.tertiary))
            }
            .buttonStyle(.plain)
            .pointingHandCursor()
            .help("Remove \(attachment.filename)")
            .accessibilityLabel("Remove \(attachment.filename)")
        }
        .padding(.leading, 5)
        .padding(.trailing, 7)
        .padding(.vertical, 5)
        .background(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .fill(isHovering ? .hoverFill : AnyShapeStyle(Color.primary.opacity(0.035)))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .strokeBorder(.separator.opacity(0.7), lineWidth: 1)
        )
        .onHover { isHovering = $0 }
    }
}

// ── Drop payload loading ─────────────────────────────────────────────────────

/// Resolves what SwiftUI's `.onDrop` hands over: file URLs (Finder) and raw
/// image data (a web image dragged out of a browser).
enum DropPayload {
    struct DroppedImage {
        let data: Data
        let mediaType: String
        let fileExtension: String
    }

    private static let imageTypes: [(UTType, String, String)] = [
        (.png, "image/png", "png"),
        (.jpeg, "image/jpeg", "jpg"),
        (.webP, "image/webp", "webp"),
        (.gif, "image/gif", "gif"),
        (.tiff, "image/tiff", "tiff"),
    ]

    static func load(_ providers: [NSItemProvider], completion: @escaping @MainActor ([URL], [DroppedImage]) -> Void) {
        Task {
            var urls: [URL] = []
            var images: [DroppedImage] = []
            for provider in providers {
                if provider.hasItemConformingToTypeIdentifier(UTType.fileURL.identifier) {
                    if let url = await loadFileURL(provider) { urls.append(url) }
                } else if let image = await loadImage(provider) {
                    images.append(image)
                }
            }
            let resolvedURLs = urls
            let resolvedImages = images
            await MainActor.run { completion(resolvedURLs, resolvedImages) }
        }
    }

    private static func loadFileURL(_ provider: NSItemProvider) async -> URL? {
        await withCheckedContinuation { continuation in
            provider.loadDataRepresentation(forTypeIdentifier: UTType.fileURL.identifier) { data, _ in
                guard let data else { return continuation.resume(returning: nil) }
                continuation.resume(returning: URL(dataRepresentation: data, relativeTo: nil))
            }
        }
    }

    private static func loadImage(_ provider: NSItemProvider) async -> DroppedImage? {
        for (type, mediaType, ext) in imageTypes where provider.hasItemConformingToTypeIdentifier(type.identifier) {
            let data: Data? = await withCheckedContinuation { continuation in
                provider.loadDataRepresentation(forTypeIdentifier: type.identifier) { data, _ in
                    continuation.resume(returning: data)
                }
            }
            guard let data else { continue }
            // TIFF isn't an allowed wire type — re-encode it as PNG first.
            if type == .tiff {
                guard let png = NSBitmapImageRep(data: data)?.representation(using: .png, properties: [:]) else { continue }
                return DroppedImage(data: png, mediaType: "image/png", fileExtension: "png")
            }
            return DroppedImage(data: data, mediaType: mediaType, fileExtension: ext)
        }
        return nil
    }
}

// ── The text view ────────────────────────────────────────────────────────────

/// A plain-text `NSTextView` bridged into the composer. Why not `TextField(axis:
/// .vertical)`: a field editor owns ⌘V and drops outright, so images could never
/// become attachments and a dropped file pasted its path as text. This view
/// forwards file/image pastes and drops to the model, submits on ⏎, inserts a
/// newline on ⇧⏎/⌥⏎, draws its own placeholder, and grows from one to six
/// lines before scrolling.
struct ComposerTextView: NSViewRepresentable {
    @Binding var text: String
    var placeholder: String
    var isEnabled: Bool
    /// Bump to move keyboard focus into the field.
    var focusRequest: Int
    var onSubmit: () -> Void
    /// Return true when the pasteboard became attachments (paste or drop).
    var onPasteboard: (NSPasteboard) -> Bool
    var onDragTargeted: (Bool) -> Void
    var onFocusChange: (Bool) -> Void

    static let font = NSFont.preferredFont(forTextStyle: .body)
    static let maxLines = 6
    static let verticalInset: CGFloat = 4

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeNSView(context: Context) -> NSScrollView {
        // TextKit 1 on purpose: the auto-grow measurement reads
        // `layoutManager.usedRect`, and creating the stack explicitly avoids the
        // silent TextKit 2 → 1 fallback (and its one-time console warning).
        let storage = NSTextStorage()
        let layoutManager = NSLayoutManager()
        storage.addLayoutManager(layoutManager)
        let container = NSTextContainer(size: NSSize(width: 0, height: CGFloat.greatestFiniteMagnitude))
        container.widthTracksTextView = true
        container.lineFragmentPadding = 0
        layoutManager.addTextContainer(container)

        let textView = ComposerNSTextView(frame: .zero, textContainer: container)
        textView.delegate = context.coordinator
        textView.isRichText = false
        textView.importsGraphics = false
        textView.allowsUndo = true
        textView.font = Self.font
        textView.textColor = .labelColor
        textView.drawsBackground = false
        textView.textContainerInset = NSSize(width: 0, height: Self.verticalInset)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.minSize = NSSize(width: 0, height: 0)
        textView.maxSize = NSSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude)
        textView.isAutomaticLinkDetectionEnabled = false
        textView.isAutomaticDataDetectionEnabled = false
        textView.usesFontPanel = false
        textView.usesFindPanel = false
        textView.placeholder = placeholder
        textView.string = text

        // Focus and drag callbacks write SwiftUI state. AppKit can flip first
        // responder from inside a layout pass (e.g. `isEditable` toggling while
        // focused), and a state write there re-enters layout — so both are
        // deferred one runloop turn.
        let coordinator = context.coordinator
        textView.onPasteboard = { [weak coordinator] pasteboard in
            coordinator?.parent.onPasteboard(pasteboard) ?? false
        }
        textView.onDragTargeted = { [weak coordinator] targeted in
            DispatchQueue.main.async { coordinator?.parent.onDragTargeted(targeted) }
        }
        textView.onFocusChange = { [weak coordinator] focused in
            DispatchQueue.main.async { coordinator?.parent.onFocusChange(focused) }
        }

        let scrollView = NSScrollView()
        scrollView.documentView = textView
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = true
        scrollView.hasHorizontalScroller = false
        scrollView.autohidesScrollers = true
        scrollView.borderType = .noBorder
        scrollView.verticalScrollElasticity = .none
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let textView = scrollView.documentView as? ComposerNSTextView else { return }
        if textView.string != text {
            textView.string = text
            textView.needsDisplay = true
        }
        textView.isEditable = isEnabled
        textView.alphaValue = isEnabled ? 1 : 0.55
        textView.placeholder = placeholder
        if context.coordinator.lastFocusRequest != focusRequest {
            context.coordinator.lastFocusRequest = focusRequest
            DispatchQueue.main.async {
                textView.window?.makeFirstResponder(textView)
            }
        }
    }

    /// Width: whatever the stack offers — reporting `infinity` for the
    /// infinite probe is what makes the HStack treat the field as the flexible
    /// child and hand it all the room left after the paperclip and send button.
    /// Height: one to six lines of the body font at that width, plus insets.
    ///
    /// Measured on the coordinator's DETACHED TextKit stack, never on the live
    /// text view: mutating the live container here invalidated the text view,
    /// which re-requested layout, which measured again — AppKit's "more Update
    /// Constraints passes than views in the window" assertion (a crash on the
    /// first focus change).
    func sizeThatFits(_ proposal: ProposedViewSize, nsView scrollView: NSScrollView, context: Context) -> CGSize? {
        let coordinator = context.coordinator
        guard let proposedWidth = proposal.width else {
            // Ideal size probe — a sensible default; the stack decides the rest.
            return CGSize(width: 240, height: coordinator.height(for: text, width: 240))
        }
        if proposedWidth == .infinity {
            return CGSize(width: .infinity, height: coordinator.height(for: text, width: 600))
        }
        let width = max(proposedWidth, 0)
        return CGSize(width: width, height: coordinator.height(for: text, width: width))
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: ComposerTextView
        var lastFocusRequest: Int

        /// Measurement-only TextKit stack (see `sizeThatFits`).
        private let measuringStorage = NSTextStorage()
        private let measuringLayout = NSLayoutManager()
        private let measuringContainer = NSTextContainer(size: NSSize(width: 100, height: CGFloat.greatestFiniteMagnitude))

        init(parent: ComposerTextView) {
            self.parent = parent
            self.lastFocusRequest = parent.focusRequest
            super.init()
            measuringStorage.addLayoutManager(measuringLayout)
            measuringLayout.addTextContainer(measuringContainer)
            measuringContainer.lineFragmentPadding = 0
        }

        /// One to six lines of `text` wrapped at `width`, plus the insets.
        func height(for text: String, width: CGFloat) -> CGFloat {
            measuringContainer.containerSize = NSSize(width: max(width, 60), height: CGFloat.greatestFiniteMagnitude)
            measuringStorage.setAttributedString(NSAttributedString(
                string: text.isEmpty ? " " : text,
                attributes: [.font: ComposerTextView.font]
            ))
            measuringLayout.ensureLayout(for: measuringContainer)
            let lineHeight = measuringLayout.defaultLineHeight(for: ComposerTextView.font)
            let used = measuringLayout.usedRect(for: measuringContainer).height
            let clamped = min(max(used, lineHeight), lineHeight * CGFloat(ComposerTextView.maxLines))
            return ceil(clamped + ComposerTextView.verticalInset * 2)
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            if parent.text != textView.string {
                parent.text = textView.string
            }
        }

        /// ⏎ sends; ⇧⏎ inserts a newline (⌥⏎ arrives as
        /// `insertNewlineIgnoringFieldEditor:` and falls through to the default,
        /// which also inserts one).
        func textView(_ textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
            guard commandSelector == #selector(NSResponder.insertNewline(_:)) else { return false }
            if NSApp.currentEvent?.modifierFlags.contains(.shift) == true {
                textView.insertNewlineIgnoringFieldEditor(nil)
                return true
            }
            parent.onSubmit()
            return true
        }
    }
}

/// The AppKit half: placeholder drawing, focus reporting, and the paste/drop
/// interception that turns files and images into attachments.
final class ComposerNSTextView: NSTextView {
    var placeholder = "" {
        didSet { if placeholder != oldValue { needsDisplay = true } }
    }
    var onPasteboard: ((NSPasteboard) -> Bool)?
    var onDragTargeted: ((Bool) -> Void)?
    var onFocusChange: ((Bool) -> Void)?

    /// `hasPayload` reads the pasteboard; cache per change count because
    /// `draggingUpdated` fires continuously while the pointer moves.
    private var payloadCheck: (changeCount: Int, hasPayload: Bool)?

    override var acceptsFirstResponder: Bool { isEditable }

    override func draw(_ dirtyRect: NSRect) {
        super.draw(dirtyRect)
        guard string.isEmpty, !placeholder.isEmpty else { return }
        let attributes: [NSAttributedString.Key: Any] = [
            .font: font ?? ComposerTextView.font,
            .foregroundColor: NSColor.placeholderTextColor,
        ]
        let origin = NSPoint(
            x: textContainerOrigin.x + (textContainer?.lineFragmentPadding ?? 0),
            y: textContainerOrigin.y
        )
        NSAttributedString(string: placeholder, attributes: attributes).draw(at: origin)
    }

    override func didChangeText() {
        super.didChangeText()
        needsDisplay = true
    }

    override func becomeFirstResponder() -> Bool {
        let accepted = super.becomeFirstResponder()
        if accepted { onFocusChange?(true) }
        return accepted
    }

    override func resignFirstResponder() -> Bool {
        let resigned = super.resignFirstResponder()
        if resigned { onFocusChange?(false) }
        return resigned
    }

    // MARK: Paste

    /// A plain-text view validates Edit ▸ Paste against its readable types, so
    /// a pasteboard holding only an image (a screenshot, a browser's Copy
    /// Image) leaves ⌘V disabled and `paste(_:)` is never called. Enable it
    /// whenever the pasteboard carries something the composer can attach.
    override func validateUserInterfaceItem(_ item: any NSValidatedUserInterfaceItem) -> Bool {
        if item.action == #selector(paste(_:)) || item.action == #selector(pasteAsPlainText(_:)),
           AttachmentPasteboard.hasPayload(NSPasteboard.general) {
            return true
        }
        return super.validateUserInterfaceItem(item)
    }

    override func paste(_ sender: Any?) {
        let types = (NSPasteboard.general.types ?? []).map(\.rawValue).joined(separator: ",")
        composerLog.debug("paste: types=\(types, privacy: .public)")
        if onPasteboard?(NSPasteboard.general) == true { return }
        super.paste(sender)
    }

    override func pasteAsPlainText(_ sender: Any?) {
        let types = (NSPasteboard.general.types ?? []).map(\.rawValue).joined(separator: ",")
        composerLog.debug("pasteAsPlainText: types=\(types, privacy: .public)")
        if onPasteboard?(NSPasteboard.general) == true { return }
        super.pasteAsPlainText(sender)
    }

    // MARK: Drop

    private func carriesAttachments(_ info: NSDraggingInfo) -> Bool {
        let pasteboard = info.draggingPasteboard
        if let cached = payloadCheck, cached.changeCount == pasteboard.changeCount {
            return cached.hasPayload
        }
        let result = AttachmentPasteboard.hasPayload(pasteboard)
        payloadCheck = (pasteboard.changeCount, result)
        return result
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        if carriesAttachments(sender) {
            onDragTargeted?(true)
            return .copy
        }
        return super.draggingEntered(sender)
    }

    override func draggingUpdated(_ sender: NSDraggingInfo) -> NSDragOperation {
        if carriesAttachments(sender) { return .copy }
        return super.draggingUpdated(sender)
    }

    override func draggingExited(_ sender: NSDraggingInfo?) {
        onDragTargeted?(false)
        super.draggingExited(sender)
    }

    override func prepareForDragOperation(_ sender: NSDraggingInfo) -> Bool {
        if carriesAttachments(sender) { return true }
        return super.prepareForDragOperation(sender)
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        onDragTargeted?(false)
        if carriesAttachments(sender) {
            return onPasteboard?(sender.draggingPasteboard) ?? false
        }
        return super.performDragOperation(sender)
    }

    override func draggingEnded(_ sender: NSDraggingInfo) {
        onDragTargeted?(false)
        super.draggingEnded(sender)
    }
}
