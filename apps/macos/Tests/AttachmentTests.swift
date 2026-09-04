import AppKit
import XCTest
@testable import BookmarkAI

/// The attachment pipeline (§4): the classifier (extension first, MIME
/// fallback, explicit code/media rejection), image downscale + re-encode, the
/// size caps with their verbatim copy, and the per-message limits.
final class AttachmentTests: XCTestCase {

    // MARK: - Classifier

    func testExtensionWinsOverReportedMime() {
        // macOS reports .md as text/plain (or nothing) — the extension decides.
        XCTAssertEqual(
            ChatAttachmentRules.classify(filename: "notes.md", reportedMediaType: "text/plain"),
            .accepted(kind: .document, mediaType: "text/markdown")
        )
        XCTAssertEqual(
            ChatAttachmentRules.classify(filename: "Photo.JPG", reportedMediaType: nil),
            .accepted(kind: .image, mediaType: "image/jpeg")
        )
        XCTAssertEqual(
            ChatAttachmentRules.classify(filename: "paper.pdf", reportedMediaType: "application/octet-stream"),
            .accepted(kind: .pdf, mediaType: "application/pdf")
        )
        XCTAssertEqual(
            ChatAttachmentRules.classify(filename: "data.json", reportedMediaType: nil),
            .accepted(kind: .document, mediaType: "application/json")
        )
    }

    func testReportedMimeIsTheFallbackForUnknownExtensions() {
        XCTAssertEqual(
            ChatAttachmentRules.classify(filename: "README", reportedMediaType: "text/plain; charset=utf-8"),
            .accepted(kind: .document, mediaType: "text/plain")
        )
        XCTAssertEqual(
            ChatAttachmentRules.classify(filename: "clipboard", reportedMediaType: "image/webp"),
            .accepted(kind: .image, mediaType: "image/webp")
        )
    }

    func testCodeMediaAndSvgAreRejectedWithTheContractCopy() {
        for name in ["app.js", "types.ts", "view.tsx", "script.py", "run.sh", "main.swift", "style.css", "doc.xml",
                     "config.yaml", "icon.svg", "clip.mp4", "song.mp3", "archive.zip", "tool.exe", "Bookmark.app"] {
            XCTAssertEqual(
                ChatAttachmentRules.classify(filename: name, reportedMediaType: "text/plain"),
                .rejected(reason: ChatAttachmentRules.rejectionCopy),
                name
            )
        }
        XCTAssertEqual(
            ChatAttachmentRules.rejectionCopy,
            "Only images, PDFs and text documents (.md, .txt, .csv, .json, .html) can be attached. Code and media files aren't allowed — paste the text instead."
        )
    }

    func testBase64LengthMatchesEncoder() {
        for count in [0, 1, 2, 3, 4, 100, 1_000_001] {
            let data = Data(count: count)
            XCTAssertEqual(ChatAttachmentRules.base64Length(of: count), data.base64EncodedString().count, "\(count)")
        }
    }

    // MARK: - Images

    private func imageData(width: Int, height: Int, alpha: CGFloat, format: NSBitmapImageRep.FileType, noise: Bool = false) throws -> Data {
        let rep = try XCTUnwrap(NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4,
            hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        ))
        if noise {
            let bytes = try XCTUnwrap(rep.bitmapData)
            var generator = SystemRandomNumberGenerator()
            for index in 0..<(rep.bytesPerRow * height) {
                bytes[index] = UInt8.random(in: 0...255, using: &generator)
            }
        } else {
            NSGraphicsContext.saveGraphicsState()
            NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
            NSColor(calibratedRed: 0.2, green: 0.5, blue: 0.9, alpha: alpha).setFill()
            NSRect(x: 0, y: 0, width: width, height: height).fill()
            NSColor(calibratedRed: 0.9, green: 0.3, blue: 0.2, alpha: alpha).setFill()
            NSRect(x: 0, y: 0, width: width / 2, height: height / 2).fill()
            NSGraphicsContext.restoreGraphicsState()
        }
        return try XCTUnwrap(rep.representation(using: format, properties: [:]))
    }

    private func pixelSize(of data: Data) -> CGSize? {
        guard let rep = NSBitmapImageRep(data: data) else { return nil }
        return CGSize(width: rep.pixelsWide, height: rep.pixelsHigh)
    }

    func testOpaqueImageIsDownscaledToTheLongestEdgeAndBecomesJpeg() throws {
        let source = try imageData(width: 3000, height: 2000, alpha: 1, format: .png)
        let attachment = try AttachmentPreparer.prepare(data: source, filename: "big.png", reportedMediaType: "image/png")
        XCTAssertEqual(attachment.kind, .image)
        XCTAssertEqual(attachment.mediaType, "image/jpeg", "opaque pixels re-encode as JPEG 0.85")
        XCTAssertEqual(pixelSize(of: attachment.data), CGSize(width: 1568, height: 1045))
        XCTAssertLessThanOrEqual(attachment.byteCount, ChatAttachmentRules.imageMaxEncodedBytes)
        XCTAssertNotNil(attachment.thumbnail)
        XCTAssertTrue(attachment.dataURL.hasPrefix("data:image/jpeg;base64,"))
    }

    func testSmallImagesAreNotUpscaled() throws {
        let source = try imageData(width: 400, height: 300, alpha: 1, format: .jpeg)
        let attachment = try AttachmentPreparer.prepare(data: source, filename: "small.jpg", reportedMediaType: nil)
        XCTAssertEqual(pixelSize(of: attachment.data), CGSize(width: 400, height: 300))
    }

    func testTransparentImageStaysPng() throws {
        let source = try imageData(width: 2000, height: 2000, alpha: 0.5, format: .png)
        let attachment = try AttachmentPreparer.prepare(data: source, filename: "logo.png", reportedMediaType: nil)
        XCTAssertEqual(attachment.mediaType, "image/png")
        XCTAssertEqual(pixelSize(of: attachment.data), CGSize(width: 1568, height: 1568))
    }

    func testGifPassesThroughUntouched() throws {
        let source = try imageData(width: 200, height: 100, alpha: 1, format: .gif)
        let attachment = try AttachmentPreparer.prepare(data: source, filename: "anim.gif", reportedMediaType: nil)
        XCTAssertEqual(attachment.mediaType, "image/gif")
        XCTAssertEqual(attachment.data, source)
    }

    func testImageStillOver2MBAfterCompressionIsRejectedWithTheContractCopy() throws {
        // Random RGBA noise doesn't compress and keeps its alpha → PNG ≫ 2 MB.
        let source = try imageData(width: 1200, height: 1200, alpha: 1, format: .png, noise: true)
        XCTAssertLessThan(source.count, ChatAttachmentRules.imageMaxSourceBytes, "fixture must be pickable")
        XCTAssertThrowsError(try AttachmentPreparer.prepare(data: source, filename: "noise.png", reportedMediaType: nil)) { error in
            XCTAssertEqual(error as? AttachmentError, .tooLarge("Image is too large after compression (max 2 MB)."))
        }
    }

    func testSourceCapsPerKind() throws {
        let bigDocument = Data(repeating: 0x61, count: ChatAttachmentRules.documentMaxBytes + 1)
        XCTAssertThrowsError(try AttachmentPreparer.prepare(data: bigDocument, filename: "notes.txt", reportedMediaType: nil)) { error in
            XCTAssertEqual(error as? AttachmentError, .tooLarge("Document is too large (max 1 MB)."))
        }
        let bigPDF = Data(repeating: 0, count: ChatAttachmentRules.pdfMaxBytes + 1)
        XCTAssertThrowsError(try AttachmentPreparer.prepare(data: bigPDF, filename: "paper.pdf", reportedMediaType: nil)) { error in
            XCTAssertEqual(error as? AttachmentError, .tooLarge("PDF is too large (max 3 MB)."))
        }
        let ok = try AttachmentPreparer.prepare(data: Data("# hi".utf8), filename: "notes.md", reportedMediaType: "text/plain")
        XCTAssertEqual(ok.mediaType, "text/markdown")
        XCTAssertEqual(ok.filePart["mediaType"]?.stringValue, "text/markdown")
        XCTAssertEqual(ok.filePart["url"]?.stringValue, "data:text/markdown;base64,\(Data("# hi".utf8).base64EncodedString())")
    }

    // MARK: - Per-message limits (model)

    @MainActor
    func testModelEnforcesFileCountAndTotalPayload() {
        let model = ChatModel(api: ApiClient())
        for index in 0..<ChatAttachmentRules.maxFiles {
            model.addAttachment(data: Data("row\(index)".utf8), filename: "f\(index).csv", reportedMediaType: nil)
        }
        XCTAssertEqual(model.attachments.count, 5)
        XCTAssertNil(model.attachmentError)
        model.addAttachment(data: Data("x".utf8), filename: "sixth.txt", reportedMediaType: nil)
        XCTAssertEqual(model.attachments.count, 5)
        XCTAssertEqual(model.attachmentError, ChatAttachmentRules.tooManyFilesCopy)

        model.removeAttachment(model.attachments[0].id)
        XCTAssertEqual(model.attachments.count, 4)
        XCTAssertNil(model.attachmentError, "a remove clears the stale error")

        // Total base64 cap: 900 KB docs encode to 1.2 MB each; the 4th of them
        // would push the message past 4 MB.
        model.reset()
        let doc = Data(repeating: 0x62, count: 900 * 1024)
        for index in 0..<3 {
            model.addAttachment(data: doc, filename: "d\(index).txt", reportedMediaType: nil)
        }
        XCTAssertEqual(model.attachments.count, 3)
        model.addAttachment(data: doc, filename: "d3.txt", reportedMediaType: nil)
        XCTAssertEqual(model.attachments.count, 3)
        XCTAssertEqual(model.attachmentError, "Attachments exceed 4 MB per message.")
        XCTAssertTrue(model.canSend, "attachments alone are sendable")
    }

    @MainActor
    func testPastedImagesGetNumberedNamesAndTextPastesFallThrough() throws {
        let model = ChatModel(api: ApiClient())
        let pasteboard = NSPasteboard(name: NSPasteboard.Name("attachment-tests"))
        pasteboard.clearContents()
        pasteboard.setData(try imageData(width: 40, height: 40, alpha: 1, format: .png), forType: .png)
        XCTAssertTrue(model.acceptPasteboard(pasteboard))
        XCTAssertTrue(model.acceptPasteboard(pasteboard))
        // An opaque PNG paste is re-encoded as JPEG — the name says what it is.
        XCTAssertEqual(model.attachments.map(\.filename), ["Pasted image.jpg", "Pasted image 2.jpg"])
        XCTAssertEqual(model.attachments.map(\.mediaType), ["image/jpeg", "image/jpeg"])
        XCTAssertTrue(model.attachments[0].dataURL.hasPrefix("data:image/jpeg;base64,"))
        XCTAssertEqual(AttachmentPreparer.renamed("shot.png", for: "image/png"), "shot.png")
        XCTAssertEqual(AttachmentPreparer.renamed("Pasted image 2.png", for: "image/jpeg"), "Pasted image 2.jpg")
        XCTAssertEqual(AttachmentPreparer.renamed("paper.pdf", for: "application/pdf"), "paper.pdf")

        pasteboard.clearContents()
        pasteboard.setString("plain text", forType: .string)
        XCTAssertFalse(model.acceptPasteboard(pasteboard), "text pastes belong to the text view")
        XCTAssertEqual(model.attachments.count, 2)
    }
}
