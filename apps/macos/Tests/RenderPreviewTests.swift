import SwiftUI
import XCTest
@testable import BookmarkAI

/// Visual harness, not a test: renders the chat markdown component to a PNG
/// (real `NSHostingView` capture — `ImageRenderer` skips ScrollView content)
/// so block rendering can be reviewed without driving the live app. Opt-in:
///   RENDER_PREVIEWS=1 xcodebuild … test -only-testing:BookmarkAITests/RenderPreviewTests
/// The PNG path is printed as `PREVIEW-> …` (the sandboxed host can only write
/// inside its container).
final class RenderPreviewTests: XCTestCase {

    @MainActor
    func testRenderMarkdownPreview() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["RENDER_PREVIEWS"] == "1",
            "visual harness — set RENDER_PREVIEWS=1 to produce the PNG"
        )
        let text = """
        Here are the top 5 most recently added bookmarks:

        | Title | URL | Saved At |
        |---|---|---|
        | - YouTube | https://www.youtube.com/watch?v=o0gkdZBtwEg | 2026-08-25 |
        | LLM Visualization | https://bbycroft.net/llm | 2026-08-25 |
        | Sign in - Google Accounts | https://notebook.google.com/notebook/2301b99c-0f0b | 2026-08-25 |
        | 3Blue1Brown | https://www.3blue1brown.com/?topic=neural-networks | 2026-08-25 |

        ## What stands out

        Most of the recent saves are **AI-related**:

        1. Two YouTube videos, likely lectures
        2. An interactive LLM visualization
          - with a full walkthrough mode

        > Tip: ask me to group these into a session.

        ```swift
        let bookmarks = try await api.listBookmarks(limit: 5)
        print(bookmarks.map(\\.title))
        ```
        """

        let view = MarkdownText(text: text)
            .padding(24)
            .frame(width: 720, alignment: .leading)
            .background(Color(red: 0.13, green: 0.13, blue: 0.14))
            .environment(\.colorScheme, .dark)
            .tint(.blue)

        // Real AppKit-backed rendering (ImageRenderer skips ScrollView content).
        let host = NSHostingView(rootView: view)
        host.frame = NSRect(x: 0, y: 0, width: 720, height: 10)
        host.layoutSubtreeIfNeeded()
        let size = host.fittingSize
        host.frame = NSRect(origin: .zero, size: NSSize(width: 720, height: max(size.height, 10)))
        host.appearance = NSAppearance(named: .darkAqua)
        host.layoutSubtreeIfNeeded()
        guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
            return XCTFail("no bitmap rep")
        }
        host.cacheDisplay(in: host.bounds, to: rep)
        guard let png = rep.representation(using: .png, properties: [:])
        else { return XCTFail("render failed") }
        // Sandboxed test host: only the container's tmp is writable.
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("markdown-preview.png")
        try png.write(to: out)
        print("PREVIEW-> \(out.path)")
    }

    /// Card contrast over a busy backdrop — stands in for wallpaper showing
    /// through the vibrant window. Cards must read near-solid (CaskHub rule),
    /// never wash into whatever is behind the glass.
    @MainActor
    func testRenderCardContrastPreview() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["RENDER_PREVIEWS"] == "1",
            "visual harness — set RENDER_PREVIEWS=1 to produce the PNG"
        )

        func sample(_ id: String, _ title: String, _ description: String?) -> Bookmark {
            Bookmark(
                id: id, url: "https://caskhub.app", domain: "caskhub.app", title: title,
                description: description, og: OpenGraph(), source: BookmarkSource(
                    browser: "chrome", device: "laptop", savedAt: "2026-08-25T07:00:00.000Z"),
                category: "Development", tags: ["applications", "toolkit"],
                createdAt: "2026-08-25T07:00:00.000Z", embedded: true
            )
        }

        // Same hierarchy in both appearances: near-solid card, one step
        // brighter than whatever glass is behind it.
        for (appearanceName, suffix, backdrop) in [
            (NSAppearance.Name.aqua, "light", [Color.orange, .purple, .teal, .pink]),
            (NSAppearance.Name.darkAqua, "dark", [Color(white: 0.16), Color(white: 0.10), Color(white: 0.2)]),
        ] {
            let view = ZStack {
                LinearGradient(colors: backdrop, startPoint: .topLeading, endPoint: .bottomTrailing)
                HStack(spacing: 14) {
                    BookmarkCard(bookmark: sample("1", "CaskHub: a native Mac app store", "Browse, install, update, and uninstall thousands of Mac apps from Homebrew."))
                    BookmarkCard(bookmark: sample("2", "LLM Visualization", "A 3D animated visualization of an LLM with a walkthrough."))
                }
                .padding(24)
            }
            .frame(width: 720, height: 260)

            let host = NSHostingView(rootView: view)
            host.frame = NSRect(x: 0, y: 0, width: 720, height: 260)
            host.appearance = NSAppearance(named: appearanceName)
            host.layoutSubtreeIfNeeded()
            guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
                return XCTFail("no bitmap rep")
            }
            host.cacheDisplay(in: host.bounds, to: rep)
            guard let png = rep.representation(using: .png, properties: [:]) else {
                return XCTFail("render failed")
            }
            let out = FileManager.default.temporaryDirectory.appendingPathComponent("card-contrast-\(suffix).png")
            try png.write(to: out)
            print("PREVIEW-> \(out.path)")
        }
    }
}
