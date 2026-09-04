import AppKit
import Foundation
import ImageIO
import UniformTypeIdentifiers

// ── Rules ────────────────────────────────────────────────────────────────────

/// Mirror of `CHAT_ATTACHMENT_RULES` in `packages/types/src/chat.ts` — the
/// single source of truth for what Ask AI accepts. Every client enforces these
/// before sending; the server re-enforces (415 / 413). Copy is VERBATIM from the
/// contract so the products say the same thing.
enum ChatAttachmentRules {
    static let maxFiles = 5

    static let imageMediaTypes: Set<String> = ["image/png", "image/jpeg", "image/webp", "image/gif"]
    /// What the picker may accept from disk.
    static let imageMaxSourceBytes = 10 * 1024 * 1024
    /// Clients MUST downscale to this longest edge.
    static let imageMaxEdgePx = 1568
    /// After downscale/re-encode; else reject.
    static let imageMaxEncodedBytes = 2 * 1024 * 1024

    static let documentMediaTypes: Set<String> = [
        "text/plain", "text/markdown", "text/csv", "text/html", "application/json",
    ]
    static let documentMaxBytes = 1 * 1024 * 1024

    static let pdfMediaTypes: Set<String> = ["application/pdf"]
    static let pdfMaxBytes = 3 * 1024 * 1024

    /// Sum of base64 payload per message (Vercel's body cap is 4.5 MB).
    static let maxTotalEncodedBytes = 4 * 1024 * 1024

    /// Extension wins over the OS-reported MIME (`.md` is famously misreported).
    static let extensionToMediaType: [String: String] = [
        ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
        ".webp": "image/webp", ".gif": "image/gif", ".md": "text/markdown",
        ".markdown": "text/markdown", ".txt": "text/plain", ".csv": "text/csv",
        ".html": "text/html", ".htm": "text/html", ".json": "application/json",
        ".pdf": "application/pdf",
    ]

    /// Explicitly refused even when the OS reports a text MIME for them.
    static let rejectedExtensions: Set<String> = [
        ".js", ".ts", ".jsx", ".tsx", ".py", ".sh", ".rb", ".go", ".rs", ".java", ".c", ".cpp",
        ".h", ".swift", ".php", ".css", ".xml", ".yaml", ".yml", ".svg",
    ]

    static let rejectionCopy =
        "Only images, PDFs and text documents (.md, .txt, .csv, .json, .html) can be attached. Code and media files aren't allowed — paste the text instead."
    static let imageTooLargeCopy = "Image is too large after compression (max 2 MB)."
    static let totalTooLargeCopy = "Attachments exceed 4 MB per message."
    static let tooManyFilesCopy = "You can attach up to 5 files per message."

    /// The allowed content types for `NSOpenPanel` — derived from the media-type
    /// sets so the picker and the classifier can't disagree.
    static var allowedContentTypes: [UTType] {
        var types: [UTType] = [.png, .jpeg, .webP, .gif, .plainText, .commaSeparatedText, .html, .json, .pdf]
        if let markdown = UTType(filenameExtension: "md") { types.append(markdown) }
        if let markdown = UTType("net.daringfireball.markdown") { types.append(markdown) }
        return types
    }

    /// Base64 grows bytes to `ceil(n / 3) * 4`.
    static func base64Length(of byteCount: Int) -> Int {
        (byteCount + 2) / 3 * 4
    }

    /// `classifyAttachment(filename, reportedMediaType)` — extension first, MIME
    /// fallback, everything else rejected with the contract's copy.
    static func classify(filename: String, reportedMediaType: String?) -> AttachmentClassification {
        let ext = (filename as NSString).pathExtension.lowercased()
        let dotted = ext.isEmpty ? "" : "." + ext
        if rejectedExtensions.contains(dotted) { return .rejected(reason: rejectionCopy) }
        if let mapped = extensionToMediaType[dotted], let accepted = accepted(mediaType: mapped) {
            return accepted
        }
        // A known media/archive/executable/code extension is refused even when
        // the reported MIME says "text/plain" — the name is the stronger signal.
        if !ext.isEmpty, let type = UTType(filenameExtension: ext), Self.isForbidden(type) {
            return .rejected(reason: rejectionCopy)
        }
        if let reported = reportedMediaType?
            .split(separator: ";").first
            .map({ $0.trimmingCharacters(in: .whitespaces).lowercased() }),
           let accepted = accepted(mediaType: reported) {
            return accepted
        }
        return .rejected(reason: rejectionCopy)
    }

    /// Video/audio, archives, executables (incl. app bundles), source code, and
    /// scripts — the contract's explicit "reject everything else" families.
    private static func isForbidden(_ type: UTType) -> Bool {
        [UTType.audiovisualContent, .archive, .executable, .sourceCode, .script, .svg]
            .contains { type.conforms(to: $0) }
    }

    private static func accepted(mediaType: String) -> AttachmentClassification? {
        if imageMediaTypes.contains(mediaType) { return .accepted(kind: .image, mediaType: mediaType) }
        if documentMediaTypes.contains(mediaType) { return .accepted(kind: .document, mediaType: mediaType) }
        if pdfMediaTypes.contains(mediaType) { return .accepted(kind: .pdf, mediaType: mediaType) }
        return nil
    }

    static func maxSourceBytes(for kind: AttachmentKind) -> Int {
        switch kind {
        case .image: imageMaxSourceBytes
        case .document: documentMaxBytes
        case .pdf: pdfMaxBytes
        }
    }
}

enum AttachmentKind: String, Hashable, Sendable {
    case image, document, pdf
}

enum AttachmentClassification: Equatable {
    case accepted(kind: AttachmentKind, mediaType: String)
    case rejected(reason: String)
}

// ── Pending attachment ───────────────────────────────────────────────────────

/// A file sitting in the composer, already validated and (for images)
/// downscaled + re-encoded — `data` is EXACTLY what goes on the wire.
struct PendingAttachment: Identifiable, Hashable {
    let id: UUID
    let filename: String
    let mediaType: String
    let kind: AttachmentKind
    let data: Data
    /// Images only — the pill/thumbnail rendition, decoded once.
    let thumbnail: NSImage?

    var byteCount: Int { data.count }
    var encodedByteCount: Int { ChatAttachmentRules.base64Length(of: data.count) }
    var dataURL: String { "data:\(mediaType);base64,\(data.base64EncodedString())" }

    /// The AI SDK `file` UI part for the user message.
    var filePart: JSONValue {
        ChatMessage.filePart(mediaType: mediaType, filename: filename, dataURL: dataURL)
    }
}

enum AttachmentError: LocalizedError, Equatable {
    case rejected(String)
    case tooLarge(String)
    case unreadable(filename: String)
    case tooManyFiles
    case totalTooLarge

    var errorDescription: String? {
        switch self {
        case .rejected(let copy): copy
        case .tooLarge(let copy): copy
        case .unreadable(let filename): "Couldn't read “\(filename)”."
        case .tooManyFiles: ChatAttachmentRules.tooManyFilesCopy
        case .totalTooLarge: ChatAttachmentRules.totalTooLargeCopy
        }
    }
}

// ── Preparation ──────────────────────────────────────────────────────────────

/// Turns raw bytes into a `PendingAttachment`: classify, cap, and for images
/// downscale to ≤1568 px on the longest edge and re-encode (JPEG 0.85, PNG
/// kept when the image actually has transparent pixels, GIF passed through).
enum AttachmentPreparer {

    /// Read a file the user picked, dropped, or pasted. Security-scoped access
    /// is balanced here; the size is checked BEFORE the bytes are read so a
    /// stray 2 GB drop never gets loaded into memory.
    static func load(url: URL) throws -> PendingAttachment {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        let values = try? url.resourceValues(forKeys: [.contentTypeKey, .fileSizeKey, .isDirectoryKey])
        if values?.isDirectory == true { throw AttachmentError.rejected(ChatAttachmentRules.rejectionCopy) }
        let filename = url.lastPathComponent
        let reported = values?.contentType?.preferredMIMEType

        guard case .accepted(let kind, _) = ChatAttachmentRules.classify(filename: filename, reportedMediaType: reported) else {
            throw AttachmentError.rejected(ChatAttachmentRules.rejectionCopy)
        }
        if let size = values?.fileSize, size > ChatAttachmentRules.maxSourceBytes(for: kind) {
            throw AttachmentError.tooLarge(tooLargeCopy(for: kind))
        }
        guard let data = try? Data(contentsOf: url) else {
            throw AttachmentError.unreadable(filename: filename)
        }
        return try prepare(data: data, filename: filename, reportedMediaType: reported)
    }

    /// The core: bytes + name (+ optional reported MIME) → a wire-ready attachment.
    static func prepare(data: Data, filename: String, reportedMediaType: String?) throws -> PendingAttachment {
        guard case .accepted(let kind, let mediaType) = ChatAttachmentRules.classify(
            filename: filename, reportedMediaType: reportedMediaType
        ) else {
            throw AttachmentError.rejected(ChatAttachmentRules.rejectionCopy)
        }
        if data.count > ChatAttachmentRules.maxSourceBytes(for: kind) {
            throw AttachmentError.tooLarge(tooLargeCopy(for: kind))
        }

        switch kind {
        case .image:
            let encoded = try encodeImage(data, mediaType: mediaType)
            return PendingAttachment(
                id: UUID(), filename: renamed(filename, for: encoded.mediaType), mediaType: encoded.mediaType, kind: .image,
                data: encoded.data, thumbnail: NSImage(data: encoded.data)
            )
        case .document, .pdf:
            return PendingAttachment(
                id: UUID(), filename: filename, mediaType: mediaType, kind: kind, data: data, thumbnail: nil
            )
        }
    }

    /// The name must agree with what was actually encoded: a pasted PNG that
    /// came out as JPEG is "Pasted image.jpg", so filename, `mediaType`, and
    /// the data URL never disagree.
    static func renamed(_ filename: String, for mediaType: String) -> String {
        let ext: String
        switch mediaType {
        case "image/jpeg": ext = "jpg"
        case "image/png": ext = "png"
        case "image/gif": ext = "gif"
        case "image/webp": ext = "webp"
        default: return filename
        }
        let base = (filename as NSString).deletingPathExtension
        return base.isEmpty ? filename : "\(base).\(ext)"
    }

    static func tooLargeCopy(for kind: AttachmentKind) -> String {
        switch kind {
        case .image: "Image is too large (max 10 MB)."
        case .document: "Document is too large (max 1 MB)."
        case .pdf: "PDF is too large (max 3 MB)."
        }
    }

    struct EncodedImage: Equatable {
        var data: Data
        var mediaType: String
        var pixelSize: CGSize
    }

    /// Downscale + re-encode. GIF passes through unchanged (re-encoding would
    /// drop the animation) as long as it fits the 2 MB cap.
    static func encodeImage(_ source: Data, mediaType: String) throws -> EncodedImage {
        if mediaType == "image/gif" {
            guard source.count <= ChatAttachmentRules.imageMaxEncodedBytes else {
                throw AttachmentError.tooLarge(ChatAttachmentRules.imageTooLargeCopy)
            }
            let size = NSImage(data: source)?.size ?? .zero
            return EncodedImage(data: source, mediaType: "image/gif", pixelSize: size)
        }
        guard let encoded = downscaledEncoding(
            source, maxEdge: ChatAttachmentRules.imageMaxEdgePx, jpegQuality: 0.85
        ) else {
            throw AttachmentError.rejected(ChatAttachmentRules.rejectionCopy)
        }
        guard encoded.data.count <= ChatAttachmentRules.imageMaxEncodedBytes else {
            throw AttachmentError.tooLarge(ChatAttachmentRules.imageTooLargeCopy)
        }
        return encoded
    }

    /// ImageIO does the resample (respecting EXIF orientation); the result is
    /// redrawn into a known RGBA8 buffer so the alpha scan is layout-safe. PNG
    /// only when at least one pixel is actually translucent — an opaque PNG
    /// screenshot becomes a much smaller JPEG.
    static func downscaledEncoding(_ source: Data, maxEdge: Int, jpegQuality: CGFloat) -> EncodedImage? {
        guard let imageSource = CGImageSourceCreateWithData(source as CFData, nil) else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxEdge,
        ]
        guard let scaled = CGImageSourceCreateThumbnailAtIndex(imageSource, 0, options as CFDictionary) else {
            return nil
        }

        let width = scaled.width
        let height = scaled.height
        guard width > 0, height > 0,
              let context = CGContext(
                data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                space: CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB(),
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
              )
        else { return nil }
        context.draw(scaled, in: CGRect(x: 0, y: 0, width: width, height: height))

        let transparent = hasTranslucentPixels(context)
        guard let redrawn = context.makeImage() else { return nil }
        let rep = NSBitmapImageRep(cgImage: redrawn)
        let pixelSize = CGSize(width: width, height: height)

        if transparent {
            guard let png = rep.representation(using: .png, properties: [:]) else { return nil }
            return EncodedImage(data: png, mediaType: "image/png", pixelSize: pixelSize)
        }
        guard let jpeg = rep.representation(using: .jpeg, properties: [.compressionFactor: jpegQuality]) else {
            return nil
        }
        return EncodedImage(data: jpeg, mediaType: "image/jpeg", pixelSize: pixelSize)
    }

    /// Any alpha byte below 255 in the RGBA8 buffer. Stride-sampled rows keep it
    /// to a few milliseconds even at 1568² — a false "opaque" on a sparse
    /// transparent image only costs a JPEG's black background, never a failure.
    private static func hasTranslucentPixels(_ context: CGContext) -> Bool {
        let alphaInfo = context.alphaInfo
        guard alphaInfo != .none, alphaInfo != .noneSkipFirst, alphaInfo != .noneSkipLast,
              let base = context.data
        else { return false }
        let bytesPerRow = context.bytesPerRow
        let width = context.width
        let height = context.height
        let pointer = base.assumingMemoryBound(to: UInt8.self)
        let rowStride = max(1, height / 512)
        var y = 0
        while y < height {
            let row = pointer + y * bytesPerRow
            var x = 0
            while x < width {
                if row[x * 4 + 3] < 255 { return true }
                x += 1
            }
            y += rowStride
        }
        return false
    }
}

// ── Pasteboard / drag payloads ───────────────────────────────────────────────

/// What a paste or drop carries for the composer: file URLs first (Finder,
/// most apps), else raw image data (screenshots, browser "Copy Image") when
/// there is no plain text to paste instead.
enum AttachmentPasteboard {
    enum Payload: Equatable {
        case files([URL])
        case image(Data, mediaType: String)
    }

    static func payload(from pasteboard: NSPasteboard) -> Payload? {
        if let urls = pasteboard.readObjects(
            forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]
        ) as? [URL], !urls.isEmpty {
            return .files(urls)
        }
        // Plain text wins over an incidental image rendition (a spreadsheet
        // selection carries both); screenshots and copied web images carry none.
        let hasText = !(pasteboard.string(forType: .string)?.isEmpty ?? true)
        if hasText { return nil }
        if let png = pasteboard.data(forType: .png) { return .image(png, mediaType: "image/png") }
        if let tiff = pasteboard.data(forType: .tiff),
           let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) {
            return .image(png, mediaType: "image/png")
        }
        return nil
    }

    static func hasPayload(_ pasteboard: NSPasteboard) -> Bool {
        payload(from: pasteboard) != nil
    }
}

/// Human-readable byte counts for pills ("184 KB", "1.2 MB").
enum ByteCountText {
    private static let formatter: ByteCountFormatter = {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        formatter.allowedUnits = [.useKB, .useMB]
        return formatter
    }()

    static func string(_ bytes: Int) -> String {
        formatter.string(fromByteCount: Int64(bytes))
    }
}
