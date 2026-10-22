import AppKit
import SwiftUI
import XCTest
@testable import BookmarkAI

@MainActor
final class ReleaseWorkspaceRenderTests: XCTestCase {
    private func environment() -> AppEnvironment {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("R1-render-\(UUID().uuidString)")
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [ReleaseOrganizationTests.Stub.self]
        ReleaseOrganizationTests.Stub.handler = { request in
            switch request.url?.path {
            case "/api/chat/conversations": return (200, Data(#"{"conversations":[]}"#.utf8))
            case "/api/account": return (200, Data(#"{"plan":"free"}"#.utf8))
            case "/api/settings": return (200, Data(#"{"settings":{"provider":"google","apiKeySet":false}}"#.utf8))
            default: return (404, Data(#"{"error":"Fixture endpoint"}"#.utf8))
            }
        }
        let app = AppEnvironment(preferences: SignedOutResetTests.makeDefaults(target: .cloud), session: URLSession(configuration: config), cache: LibraryCache(directory: directory))
        app.auth.seed(status: .signedIn, account: AccountInfo(signedIn: true, accountId: "render-fixture", name: "Fixture account", email: "reader@fixture.test"))
        app.auth.mintOverride = { _ in .token("header.\(Data(#"{"sub":"render-fixture"}"#.utf8).base64EncodedString()).signature") }
        app.organization.bind(accountId: "render-fixture")
        app.organization.restoreMetadata(OrganizationResponse(capabilities: OrganizationCapabilities(organization: 1, undoDays: 7, context: 1, handoff: 1, maxOperationItems: 500, maxSelectionItems: 10000), folders: [OrganizationFolder(id: "research", name: "Research", parentId: nil, path: "Research", count: 3, directCount: 3, fieldVersions: [:])], categories: [OrganizationLabel(id: "design", name: "Design", count: 3)], tags: [OrganizationLabel(id: "swift", name: "swift", count: 2)]))
        let rows = (0..<9).map { index in Bookmark(id: "fixture-\(index)", url: "https://fixture.test/\(index)", domain: "fixture.test", title: ["Designing useful library workflows", "A guide to native Mac interaction", "Research notes for the week"][index % 3], description: "A saved reference with a clear purpose and useful context.", og: OpenGraph(), source: BookmarkSource(browser: "safari", device: "desktop", savedAt: "2026-10-16T00:00:00Z"), category: "Design", tags: ["swift"], createdAt: "2026-10-16T00:00:00Z", embedded: false, folderId: "research", categoryId: "design", readingState: .unread, fieldVersions: [:]) }
        app.library.seed(meta: MetaResponse(categories: [Facet(name: "Design", count: 9)], browsers: [], devices: [], days: [], tags: [Facet(name: "swift", count: 9)], total: 9), bookmarks: rows)
        return app
    }
    private func inputs(_ view: NSView) -> [ComposerNSTextView] { (view as? ComposerNSTextView).map { [$0] } ?? view.subviews.flatMap(inputs) }
    private func settle(_ host: NSView) async throws {
        host.layoutSubtreeIfNeeded()
        try await Task.sleep(for: .milliseconds(100))
        host.layoutSubtreeIfNeeded()
    }
    func testOneNativeInputSurvivesOpenResizeAndMarkedText() async throws {
        let app = environment()
        let host = NSHostingView(rootView: ReleaseWorkspaceView { LibraryBrowserView() }.environment(app))
        host.frame = NSRect(x: 0, y: 0, width: 1100, height: 700)
        try await settle(host)
        let original = try XCTUnwrap(inputs(host).first)
        XCTAssertEqual(inputs(host).count, 1)
        original.setMarkedText("にほん", selectedRange: NSRange(location: 3, length: 0), replacementRange: NSRange(location: NSNotFound, length: 0))
        XCTAssertTrue(original.hasMarkedText())
        app.chat.show()
        try await settle(host)
        XCTAssertTrue(inputs(host).first === original)
        XCTAssertTrue(original.hasMarkedText())
        host.frame.size.width = 540
        try await settle(host)
        XCTAssertEqual(inputs(host).count, 1)
        XCTAssertTrue(inputs(host).first === original)
        XCTAssertTrue(original.hasMarkedText())
        XCTAssertEqual(original.string, "にほん")
        original.unmarkText()
        app.chat.isPresented = false
        host.frame.size.width = 1100
        try await settle(host)
        XCTAssertTrue(inputs(host).first === original)
        XCTAssertEqual(original.string, "にほん")
    }
    func testRenderReleaseWorkspaceAndEditor() async throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["RENDER_PREVIEWS"] == "1", "Opt-in fixture screenshots")
        let app = environment()
        for (width, expanded, name) in [(1100.0, false, "compact-row"), (1100.0, true, "wide-chat"), (540.0, true, "narrow-chat")] {
            app.chat.isPresented = expanded
            let host = NSHostingView(rootView: ReleaseWorkspaceView { LibraryBrowserView() }.environment(app))
            host.frame = NSRect(x: 0, y: 0, width: width, height: 700)
            try await settle(host)
            try capture(host, name: name)
        }
        let bookmark = try XCTUnwrap(app.library.visibleBookmarks.first)
        let editor = NSHostingView(rootView: BookmarkEditorView(bookmark: bookmark).environment(app))
        editor.frame = NSRect(x: 0, y: 0, width: 460, height: 700)
        try await settle(editor); try capture(editor, name: "bookmark-editor")
        let settings = NSHostingView(rootView: PlanSettingsTab().environment(app))
        settings.frame = NSRect(x: 0, y: 0, width: 620, height: 480)
        try await settle(settings); try capture(settings, name: "plan-usage")
    }
    private func capture(_ host: NSView, name: String) throws {
        let rep = try XCTUnwrap(host.bitmapImageRepForCachingDisplay(in: host.bounds))
        host.cacheDisplay(in: host.bounds, to: rep)
        let data = try XCTUnwrap(rep.representation(using: .png, properties: [:]))
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("r1-mac-\(name).png")
        try data.write(to: url); print("R1-PREVIEW-> \(url.path)")
    }
}
