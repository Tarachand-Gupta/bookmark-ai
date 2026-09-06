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

    // MARK: - Harness

    /// Render a view into a PNG at `width` (height = fitting size unless given),
    /// in the named appearance, and print its path as `PREVIEW-> …`.
    @MainActor
    private func render(_ view: some View, width: CGFloat, height: CGFloat? = nil, appearance: NSAppearance.Name, name: String) throws {
        let host = NSHostingView(rootView: AnyView(view))
        host.appearance = NSAppearance(named: appearance)
        host.frame = NSRect(x: 0, y: 0, width: width, height: height ?? 10)
        host.layoutSubtreeIfNeeded()
        let fitted = height ?? max(host.fittingSize.height, 10)
        host.frame = NSRect(origin: .zero, size: NSSize(width: width, height: fitted))
        host.layoutSubtreeIfNeeded()
        guard let rep = host.bitmapImageRepForCachingDisplay(in: host.bounds) else {
            return XCTFail("no bitmap rep for \(name)")
        }
        host.cacheDisplay(in: host.bounds, to: rep)
        guard let png = rep.representation(using: .png, properties: [:]) else {
            return XCTFail("render failed for \(name)")
        }
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("\(name).png")
        try png.write(to: out)
        print("PREVIEW-> \(out.path)")
    }

    private static let appearances: [(NSAppearance.Name, String)] = [(.aqua, "light"), (.darkAqua, "dark")]

    /// A small opaque PNG built at runtime, so previews need no fixture files.
    private func samplePNG(width: Int, height: Int) throws -> Data {
        let rep = try XCTUnwrap(NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4,
            hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        ))
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        NSGradient(colors: [NSColor.systemTeal, NSColor.systemIndigo])?
            .draw(in: NSRect(x: 0, y: 0, width: width, height: height), angle: 35)
        NSColor.white.withAlphaComponent(0.85).setFill()
        NSRect(x: width / 6, y: height / 4, width: width * 2 / 3, height: height / 2).fill()
        NSGraphicsContext.restoreGraphicsState()
        return try XCTUnwrap(rep.representation(using: .png, properties: [:]))
    }

    // MARK: - Chat: reasoning, tool states, attachments, placeholder

    @MainActor
    func testRenderChatTurnPreview() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["RENDER_PREVIEWS"] == "1",
            "visual harness — set RENDER_PREVIEWS=1 to produce the PNG"
        )
        let png = try samplePNG(width: 640, height: 400)
        let image = ChatMessage.filePart(
            mediaType: "image/png", filename: "dashboard.png",
            dataURL: "data:image/png;base64,\(png.base64EncodedString())"
        )
        let pdf = ChatMessage.filePart(
            mediaType: "application/pdf", filename: "q3-report.pdf",
            dataURL: "data:application/pdf;base64,\(Data(repeating: 0x25, count: 24_000).base64EncodedString())"
        )
        let user = ChatMessage.user(text: "Which of my bookmarks relate to this dashboard and the report?", files: [image, pdf])

        func tool(_ name: String, _ id: String, _ state: String, input: [String: JSONValue]? = nil, output: JSONValue? = nil, errorText: String? = nil) -> JSONValue {
            var part: [String: JSONValue] = ["type": .string("tool-\(name)"), "toolCallId": .string(id), "state": .string(state)]
            if let input { part["input"] = .object(input) }
            if let output { part["output"] = output }
            if let errorText { part["errorText"] = .string(errorText) }
            return .object(part)
        }
        let assistant = ChatMessage(id: "a1", role: "assistant", parts: [
            .object(["type": .string("reasoning"), "state": .string("done"),
                     "text": .string("The user attached a dashboard screenshot and a PDF. I should search the library for analytics and reporting bookmarks, then read the report.")]),
            tool("useSkill", "t0", "output-available", input: ["name": .string("Research brief")],
                 output: .object(["name": .string("Research brief"), "instructions": .string("…")])),
            tool("searchBookmarks", "t1", "output-available", input: ["query": .string("analytics dashboard"), "mode": .string("hybrid")],
                 output: .object(["results": .array([.null, .null, .null, .null, .null, .null])])),
            tool("queryDatabase", "t2", "input-available", input: ["sql": .string("SELECT category, COUNT(*) FROM bookmarks GROUP BY category")]),
            tool("fetchUrl", "t3", "output-error", input: ["url": .string("https://reports.example.com/q3")], errorText: "fetch failed: 403 Forbidden"),
            tool("listLiveTabs", "t4", "output-available", output: .object(["enabled": .bool(false), "devices": .array([])])),
            tool("createSkill", "t6", "output-available", input: ["name": .string("Link triage")],
                 output: .object(["skill": .object([
                    "id": .string("s1"), "name": .string("Link triage"),
                    "description": .string("Sort a batch of recent bookmarks into keep / read later / archive"),
                 ])])),
            .object(["type": .string("text"), "text": .string("Here's what I found so far — **6 bookmarks** mention analytics dashboards, and live sharing is off so I can't see your open tabs.")]),
        ])
        let streaming = ChatMessage(id: "a2", role: "assistant", parts: [
            .object(["type": .string("reasoning"), "state": .string("streaming"),
                     "text": .string("Comparing the report's Q3 figures with the dashboard…")]),
            tool("webSearch", "t5", "input-streaming", input: ["query": .string("q3 2026 saas benchmarks")]),
        ])

        // A turn whose reply mixes tool rows with a markdown table and a code
        // block — the rows must stay their own hit targets (S3).
        let tableTurn = ChatMessage(id: "a3", role: "assistant", parts: [
            tool("queryDatabase", "t7", "output-available", input: ["sql": .string("SELECT category, COUNT(*) FROM bookmarks GROUP BY category")],
                 output: .object(["rowCount": .int(3)])),
            .object(["type": .string("text"), "text": .string("""
            Here are the counts per category:

            | Category | Count |
            | --- | --- |
            | Development | 8 |
            | Design | 2 |
            | Music | 1 |

            ```sql
            SELECT category, COUNT(*) FROM bookmarks GROUP BY category
            ```
            """)]),
            tool("searchBookmarks", "t8", "output-available", input: ["query": .string("design")],
                 output: .object(["results": .array([.null, .null])])),
        ])

        for (appearance, suffix) in Self.appearances {
            let view = VStack(alignment: .leading, spacing: 16) {
                ChatMessageView(message: user)
                ChatMessageView(message: assistant, reasoningDurations: [0: 4.2], notes: [.ownKeyFallback, .ownKeyIncomplete])
                ChatMessageView(message: tableTurn)
                ChatMessageView(message: streaming)
                ThinkingIndicator()
            }
            .padding(16)
            .frame(width: 720, alignment: .leading)
            .background(Color(nsColor: .windowBackgroundColor))
            .tint(.blue)
            try render(view, width: 720, appearance: appearance, name: "chat-turn-\(suffix)")

            // S2: the turn that came back empty.
            let failed = VStack(alignment: .leading, spacing: 16) {
                ChatMessageView(message: ChatMessage.user(text: "Summarise what I saved this week.", files: []))
                ChatTurnFailureView(message: ChatModel.emptyReplyCopy) {}
            }
            .padding(16)
            .frame(width: 720, alignment: .leading)
            .background(Color(nsColor: .windowBackgroundColor))
            .tint(.blue)
            try render(failed, width: 720, appearance: appearance, name: "chat-empty-reply-\(suffix)")
        }
    }

    @MainActor
    func testRenderComposerPreview() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["RENDER_PREVIEWS"] == "1",
            "visual harness — set RENDER_PREVIEWS=1 to produce the PNG"
        )
        let environment = AppEnvironment()
        environment.chat.addAttachment(data: try samplePNG(width: 300, height: 200), filename: "dashboard.png", reportedMediaType: "image/png")
        environment.chat.addAttachment(data: Data(repeating: 0x25, count: 180_000), filename: "q3-report.pdf", reportedMediaType: nil)
        environment.chat.addAttachment(data: Data("# Notes\n- one".utf8), filename: "notes.md", reportedMediaType: "text/plain")
        environment.chat.addAttachment(data: Data("x".utf8), filename: "script.py", reportedMediaType: "text/plain")
        environment.chat.draft = "Summarise the report against the dashboard"

        for (appearance, suffix) in Self.appearances {
            let view = ChatComposerBox()
                .environment(environment)
                .padding(16)
                .frame(width: 720)
                .background(Color(nsColor: .windowBackgroundColor))
                .tint(.blue)
            try render(view, width: 720, appearance: appearance, name: "composer-\(suffix)")
        }
    }

    // MARK: - Auth gate: signed out, connecting, identity

    /// A cloud/local environment on a throwaway defaults suite (the test host
    /// is the real app — never touch its `.standard` target).
    @MainActor
    private func gateEnvironment(target: ServerTarget) -> AppEnvironment {
        let defaults = UserDefaults(suiteName: "RenderPreview-\(UUID().uuidString)")!
        let preferences = Preferences(defaults: defaults)
        preferences.serverTarget = target
        return AppEnvironment(preferences: preferences)
    }

    @MainActor
    func testRenderAuthGatePreviews() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["RENDER_PREVIEWS"] == "1",
            "visual harness — set RENDER_PREVIEWS=1 to produce the PNG"
        )
        let tara = AccountInfo(signedIn: true, name: "Tara Gupta", email: "tara@purecode.ai")
        let emailOnly = AccountInfo(signedIn: true, name: nil, email: "tara@purecode.ai")
        let settings = UserSettings(
            provider: "google", baseUrl: nil, model: nil, apiKeySet: false, apiKeyLast4: nil,
            aiMode: "included", liveServerUrl: nil, nativeSyncEnabled: true, nativeSyncFull: false,
            mcpTools: nil, aiUsage: AiUsage(usedTokens: 412_000, limitTokens: 1_000_000, resetsAt: "2026-09-07T00:00:00.000Z")
        )
        let window = Color(nsColor: .windowBackgroundColor)
        let sidebar = Color(nsColor: .underPageBackgroundColor)

        for (appearance, suffix) in Self.appearances {
            // The whole main window while signed out — no sidebar, no toolbar.
            let signedOut = gateEnvironment(target: .cloud)
            signedOut.auth.seed(status: .signedOut)
            try render(SignedOutView().environment(signedOut).background(window),
                       width: 960, height: 600, appearance: appearance, name: "auth-signed-out-\(suffix)")
            let failed = gateEnvironment(target: .cloud)
            failed.auth.seed(status: .signedOut)
            failed.auth.lastError = "The server rejected the session. Sign in again."
            try render(SignedOutView().environment(failed).background(window),
                       width: 960, height: 600, appearance: appearance, name: "auth-signed-out-error-\(suffix)")
            // ⌘, while signed out: the panel, not the tabs.
            try render(SettingsGatePanel().environment(signedOut).background(window),
                       width: 500, appearance: appearance, name: "auth-settings-signed-out-\(suffix)")

            // Connecting (launch / retrying) and the stalled variant with Retry.
            let connecting = gateEnvironment(target: .cloud)
            connecting.auth.seed(status: .unreachable)
            try render(ConnectingView().environment(connecting).background(window),
                       width: 960, height: 600, appearance: appearance, name: "auth-connecting-\(suffix)")
            let stalled = gateEnvironment(target: .cloud)
            stalled.auth.seed(status: .unreachable, stalled: true)
            try render(ConnectingView().environment(stalled).background(window),
                       width: 960, height: 600, appearance: appearance, name: "auth-connecting-stalled-\(suffix)")
            try render(SettingsGatePanel().environment(stalled).background(window),
                       width: 500, appearance: appearance, name: "auth-settings-stalled-\(suffix)")

            // Identity: sidebar footer (name + email / email only / local) and
            // Settings ▸ Account with the identity row above Sign Out.
            let signedIn = gateEnvironment(target: .cloud)
            signedIn.auth.seed(status: .signedIn, account: tara)
            signedIn.settings.seed(settings, plan: .free)
            try render(AccountFooter().environment(signedIn).frame(width: 250).background(sidebar),
                       width: 250, appearance: appearance, name: "auth-footer-\(suffix)")
            let byEmail = gateEnvironment(target: .cloud)
            byEmail.auth.seed(status: .signedIn, account: emailOnly)
            try render(AccountFooter().environment(byEmail).frame(width: 250).background(sidebar),
                       width: 250, appearance: appearance, name: "auth-footer-email-only-\(suffix)")
            let local = gateEnvironment(target: .local)
            local.auth.seed(status: .signedOut, account: AccountInfo(signedIn: true, name: nil, email: nil))
            try render(AccountFooter().environment(local).frame(width: 250).background(sidebar),
                       width: 250, appearance: appearance, name: "auth-footer-local-\(suffix)")
            try render(AccountSettingsTab().environment(signedIn).tint(.blue),
                       width: 500, appearance: appearance, name: "auth-account-tab-\(suffix)")
            let loadingIdentity = gateEnvironment(target: .cloud)
            loadingIdentity.auth.seed(status: .signedIn, account: nil)
            try render(AccountSettingsTab().environment(loadingIdentity).tint(.blue),
                       width: 500, appearance: appearance, name: "auth-account-tab-loading-\(suffix)")
        }
    }

    // MARK: - Update banner (sidebar, above the account footer)

    @MainActor
    func testRenderUpdateBannerPreviews() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["RENDER_PREVIEWS"] == "1",
            "visual harness — set RENDER_PREVIEWS=1 to produce the PNG"
        )
        func release(minSupported: String?) -> AppRelease {
            AppRelease(
                platform: "macos", version: "9.9.9", build: "9", minSupportedVersion: minSupported,
                downloadUrl: "https://github.com/Tarachand-Gupta/bookmark-ai/releases",
                releaseNotes: "Faster search, sign-out fixes, and an update banner.",
                publishedAt: "2026-09-06T23:21:37.879Z", updatedAt: "2026-09-06T23:21:37.879Z"
            )
        }
        let sidebar = Color(nsColor: .underPageBackgroundColor)
        let running = VersionRef(version: "0.1.0", build: "1")

        for (appearance, suffix) in Self.appearances {
            let available = gateEnvironment(target: .local)
            available.updates.seed(release: release(minSupported: nil), current: running)
            try render(
                VStack(spacing: 0) { Divider(); UpdateBanner(); AccountFooter() }
                    .environment(available).frame(width: 250).background(sidebar).tint(.blue),
                width: 250, appearance: appearance, name: "update-banner-available-\(suffix)"
            )

            let blocking = gateEnvironment(target: .local)
            blocking.updates.seed(release: release(minSupported: "9.0.0"), current: running)
            try render(
                VStack(spacing: 0) { Divider(); UpdateBanner(); AccountFooter() }
                    .environment(blocking).frame(width: 250).background(sidebar).tint(.blue),
                width: 250, appearance: appearance, name: "update-banner-blocking-\(suffix)"
            )

            // The WHOLE sidebar at a real window height with a busy library:
            // the List must give the banner its room and the footer must stay
            // on screen (a fixedSize text in the banner once overflowed this).
            for (env, variant) in [(available, "available"), (blocking, "blocking")] {
                env.library.seed(meta: MetaResponse(
                    categories: (1...6).map { Facet(name: "Category \($0)", count: 7 - $0) },
                    browsers: [], devices: [], days: [],
                    tags: (1...24).map { Facet(name: "tag-\($0)", count: 25 - $0) },
                    total: 15
                ))
                try render(
                    SidebarView().environment(env).frame(width: 250, height: 700).background(sidebar).tint(.blue),
                    width: 250, height: 700, appearance: appearance, name: "update-sidebar-\(variant)-\(suffix)"
                )
            }
        }
    }

    // MARK: - History popover

    @MainActor
    func testRenderChatHistoryPreview() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["RENDER_PREVIEWS"] == "1",
            "visual harness — set RENDER_PREVIEWS=1 to produce the PNG"
        )
        let now = Date()
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        func conversation(_ id: String, _ title: String, _ offset: TimeInterval) -> ChatConversation {
            ChatConversation(
                id: id, title: title,
                createdAt: iso.string(from: now.addingTimeInterval(offset - 600)),
                updatedAt: iso.string(from: now.addingTimeInterval(offset))
            )
        }
        let conversations = [
            conversation("c1", "What did I save this week?", -120),
            conversation("c2", "Which of my bookmarks relate to this dashboard and the report?", -3 * 3_600),
            conversation("c3", "Find my bookmarks about design", -26 * 3_600),
            conversation("c4", "Use my Weekly reading digest skill on what I saved this week.", -30 * 3_600),
            conversation("c5", "Summarise the SwiftUI links I saved", -9 * 86_400),
            conversation("c6", "Compare the two pricing pages", -400 * 86_400),
        ]
        let size = ChatHistoryPopover.size

        for (appearance, suffix) in Self.appearances {
            // The list: c2 is the open conversation (tint), c3 renders hovered (⋯ menu).
            let list = AppEnvironment()
            list.chat.seedHistory(conversations, current: "c2")
            try render(
                ChatHistoryPopover(isPresented: .constant(true), loadsOnAppear: false, forcedHoverId: "c3")
                    .environment(list)
                    .background(Color(nsColor: .windowBackgroundColor)),
                width: size.width, height: size.height, appearance: appearance, name: "chat-history-\(suffix)"
            )

            let empty = AppEnvironment()
            empty.chat.seedHistory([])
            try render(
                ChatHistoryPopover(isPresented: .constant(true), loadsOnAppear: false)
                    .environment(empty)
                    .background(Color(nsColor: .windowBackgroundColor)),
                width: size.width, height: size.height, appearance: appearance, name: "chat-history-empty-\(suffix)"
            )

            let noMatch = AppEnvironment()
            noMatch.chat.seedHistory(conversations, current: "c1", query: "zebra")
            try render(
                ChatHistoryPopover(isPresented: .constant(true), loadsOnAppear: false)
                    .environment(noMatch)
                    .background(Color(nsColor: .windowBackgroundColor)),
                width: size.width, height: size.height, appearance: appearance, name: "chat-history-nomatch-\(suffix)"
            )
        }
    }

    // MARK: - Skills sheet

    @MainActor
    func testRenderSkillsSheetPreview() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["RENDER_PREVIEWS"] == "1",
            "visual harness — set RENDER_PREVIEWS=1 to produce the PNG"
        )
        let empty = AppEnvironment()
        empty.skills.seed([])
        let populated = AppEnvironment()
        populated.skills.seed(SkillTemplate.starters.enumerated().map { index, template in
            Skill(id: "s\(index)", name: template.name, description: template.description,
                  instructions: template.instructions, enabled: index != 1,
                  createdAt: "2026-09-03T09:00:00.000Z", updatedAt: "2026-09-03T09:0\(index):00.000Z")
        })
        for (appearance, suffix) in Self.appearances {
            try render(
                SkillsSheet().environment(empty).background(Color(nsColor: .windowBackgroundColor)).tint(.blue),
                width: 780, height: 540, appearance: appearance, name: "skills-empty-\(suffix)"
            )
            try render(
                SkillsSheet().environment(populated).background(Color(nsColor: .windowBackgroundColor)).tint(.blue),
                width: 780, height: 540, appearance: appearance, name: "skills-list-\(suffix)"
            )
        }
    }

    // MARK: - Settings tabs

    @MainActor
    func testRenderSettingsTabsPreview() throws {
        try XCTSkipUnless(
            ProcessInfo.processInfo.environment["RENDER_PREVIEWS"] == "1",
            "visual harness — set RENDER_PREVIEWS=1 to produce the PNG"
        )
        func settings(mode: String?, keySet: Bool) -> UserSettings {
            UserSettings(
                provider: "openai", baseUrl: nil, model: keySet ? "gpt-4o-mini" : nil, apiKeySet: keySet,
                apiKeyLast4: keySet ? "7f2a" : nil, aiMode: mode, liveServerUrl: nil, nativeSyncEnabled: true,
                nativeSyncFull: false, mcpTools: nil,
                aiUsage: AiUsage(usedTokens: 412_000, limitTokens: 1_000_000, resetsAt: "2026-09-07T00:00:00.000Z")
            )
        }
        let included = AppEnvironment()
        included.settings.seed(settings(mode: "included", keySet: true))
        let own = AppEnvironment()
        own.settings.seed(settings(mode: "own", keySet: true))
        let mcp = AppEnvironment()
        mcp.settings.seed(settings(mode: "included", keySet: false))
        mcp.mcpTokens.seed(
            tokens: [
                McpToken(id: "t1", name: "Claude Code on MacBook", createdAt: "2026-09-03T10:00:00.000Z",
                         lastUsedAt: "2026-09-03T10:04:12.000Z", revokedAt: nil, hint: "bkmcp_eyJhb…9xQ2k"),
                McpToken(id: "t2", name: "paging-verify", createdAt: "2026-08-11T14:50:11.000Z",
                         lastUsedAt: "2026-08-11T14:50:25.766Z", revokedAt: "2026-08-11T14:58:18.521Z", hint: "bkmcp_eyJhb…bIbf0"),
            ],
            fresh: CreateMcpTokenResponse(
                token: "bkmcp_eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyXzNHSWhQdDVOYTN0WVJQM1hhUFBVM1BwSTU1ZSIsImlhdCI6MTc1NjkwMDAwMH0.9xQ2k",
                id: "t1", name: "Claude Code on MacBook", createdAt: "2026-09-03T10:00:00.000Z"
            )
        )

        for (appearance, suffix) in Self.appearances {
            try render(AiSettingsTab().environment(included).tint(.blue), width: 500, appearance: appearance, name: "settings-ai-included-\(suffix)")
            try render(AiSettingsTab().environment(own).tint(.blue), width: 500, appearance: appearance, name: "settings-ai-own-\(suffix)")
            try render(McpSettingsTab().environment(mcp).tint(.blue), width: 500, appearance: appearance, name: "settings-mcp-\(suffix)")
            try render(AccountSettingsTab().environment(mcp).tint(.blue), width: 500, appearance: appearance, name: "settings-account-\(suffix)")
        }
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
