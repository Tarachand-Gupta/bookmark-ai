import XCTest
@testable import BookmarkAI

/// Signing out must never leave the previous account's data anywhere: every
/// model empties through the ONE flush (`AppEnvironment.handleSignedOut`), and
/// the definitive auth transitions drive it.
final class SignedOutResetTests: XCTestCase {

    /// An environment on the CLOUD target with its own throwaway defaults —
    /// the test host is the real app, so `.standard` is Tara's actual settings.
    @MainActor
    static func makeCloudEnvironment() -> AppEnvironment {
        let defaults = UserDefaults(suiteName: "SignedOutResetTests-\(UUID().uuidString)")!
        let preferences = Preferences(defaults: defaults)
        preferences.serverTarget = .cloud
        return AppEnvironment(preferences: preferences)
    }

    @MainActor
    static func seedEverything(_ env: AppEnvironment) throws {
        env.library.seed(meta: MetaResponse(
            categories: [Facet(name: "Development", count: 8), Facet(name: "Design", count: 2)],
            browsers: [], devices: [], days: [],
            tags: [Facet(name: "swift", count: 3)],
            total: 73
        ))
        env.sessions.seed(sessions: [])
        env.live.seed(devices: [])
        env.chat.seed(messages: [ChatMessage.user(text: "What did I save this week?", files: [])])
        env.chat.seedHistory(
            [ChatConversation(id: "c1", title: "t", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:00:00.000Z")],
            current: "c1", query: "week"
        )
        env.chat.draft = "unsent draft"
        env.skills.seed([Skill(id: "s1", name: "Skill", description: "d", instructions: "i", enabled: true, createdAt: "", updatedAt: "")])
        env.mcpTokens.seed(tokens: [McpToken(id: "t1", name: "n", createdAt: "2026-09-04T00:00:00.000Z", lastUsedAt: nil, revokedAt: nil, hint: nil)])
        let settings = try ApiClient.decoder.decode(
            UserSettings.self,
            from: Data(#"{"provider":"google","apiKeySet":true,"apiKeyLast4":"0000","aiMode":"own","ownKeyReady":true}"#.utf8)
        )
        env.settings.seed(settings, plan: .free)
        env.auth.seed(status: .signedIn, account: AccountInfo(signedIn: true, name: "Tara Gupta", email: "tara@purecode.ai"))
        env.requestedSettingsTab = .account
        env.isPresentingTour = true
    }

    @MainActor
    static func assertEverythingEmpty(_ env: AppEnvironment, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertTrue(env.library.bookmarks.isEmpty, "bookmarks", file: file, line: line)
        XCTAssertEqual(env.library.meta.total, 0, "meta total", file: file, line: line)
        XCTAssertTrue(env.library.meta.categories.isEmpty && env.library.meta.tags.isEmpty, "facets", file: file, line: line)
        XCTAssertNil(env.library.searchResults, "search results", file: file, line: line)
        XCTAssertEqual(env.library.selection, .allBookmarks, "selection", file: file, line: line)
        XCTAssertTrue(env.sessions.sessions.isEmpty, "sessions", file: file, line: line)
        XCTAssertFalse(env.sessions.loaded, "sessions.loaded", file: file, line: line)
        XCTAssertTrue(env.live.devices.isEmpty, "live devices", file: file, line: line)
        XCTAssertFalse(env.live.enabled, "live.enabled", file: file, line: line)
        XCTAssertTrue(env.chat.messages.isEmpty, "transcript", file: file, line: line)
        XCTAssertTrue(env.chat.conversations.isEmpty && env.chat.visibleConversations.isEmpty, "history", file: file, line: line)
        XCTAssertEqual(env.chat.historyQuery, "", "history search", file: file, line: line)
        XCTAssertNil(env.chat.conversationId, "current conversation", file: file, line: line)
        XCTAssertEqual(env.chat.draft, "", "draft", file: file, line: line)
        XCTAssertTrue(env.chat.attachments.isEmpty, "attachments", file: file, line: line)
        XCTAssertTrue(env.skills.skills.isEmpty, "skills", file: file, line: line)
        XCTAssertTrue(env.mcpTokens.tokens.isEmpty, "mcp tokens", file: file, line: line)
        XCTAssertNil(env.mcpTokens.fresh, "fresh token", file: file, line: line)
        XCTAssertNil(env.settings.settings, "settings", file: file, line: line)
        XCTAssertNil(env.settings.plan, "plan card", file: file, line: line)
        XCTAssertNil(env.health, "health", file: file, line: line)
        XCTAssertNil(env.requestedSettingsTab, "requested settings tab", file: file, line: line)
        XCTAssertFalse(env.isPresentingTour, "tour", file: file, line: line)
    }

    @MainActor
    func testHandleSignedOutEmptiesEveryModel() throws {
        let env = Self.makeCloudEnvironment()
        try Self.seedEverything(env)
        XCTAssertEqual(env.library.meta.total, 73)
        XCTAssertNotNil(env.settings.plan)

        env.handleSignedOut()
        Self.assertEverythingEmpty(env)
    }

    /// The wiring: a 401 that survived the forced re-mint is a definitive
    /// sign-out — status, identity, and every model go together, and the
    /// window gate closes.
    @MainActor
    func testUnauthorizedAfterRetryFlushesThroughAuth() throws {
        let env = Self.makeCloudEnvironment()
        try Self.seedEverything(env)
        XCTAssertEqual(env.auth.status, .signedIn)
        XCTAssertEqual(env.auth.account?.displayName, "Tara Gupta")
        XCTAssertEqual(env.gate, .ready)

        env.auth.handleUnauthorized()

        XCTAssertEqual(env.auth.status, .signedOut)
        XCTAssertNil(env.auth.account)
        XCTAssertEqual(env.auth.lastError, "The server rejected the session. Sign in again.")
        XCTAssertEqual(env.gate, .signedOut)
        XCTAssertFalse(env.canUseData)
        Self.assertEverythingEmpty(env)

        // Already signed out: a second 401 is a no-op, not a second flush/error.
        env.auth.lastError = nil
        env.auth.handleUnauthorized()
        XCTAssertNil(env.auth.lastError)
    }

    // NB: explicit `AppEnvironment.signOut()` is deliberately NOT exercised
    // here — it wipes `WKWebsiteDataStore.default()`, and the test host shares
    // the real app's sandbox container, so it would sign Tara out for real.
}
