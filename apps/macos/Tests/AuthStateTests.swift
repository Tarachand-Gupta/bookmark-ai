import XCTest
@testable import BookmarkAI

/// The auth state machine, driven through `AuthController.mintOverride` (the
/// webview stand-in). These pin the two bugs behind "signed out but the old
/// account's data is still there": a definitive "no session" must FLUSH, and
/// a transient "couldn't reach Clerk" must NEVER read as signed out.
final class AuthStateTests: XCTestCase {

    /// A cloud environment whose `onSessionRestored` is inert, not a network
    /// load (the test host would otherwise call the real cloud).
    @MainActor
    private func makeEnvironment() -> AppEnvironment {
        let env = SignedOutResetTests.makeCloudEnvironment()
        env.auth.onSessionRestored = {}
        return env
    }

    // MARK: - The 45 s refresh loop

    /// The bug Tara hit: the session expired under a days-idle app, the loop
    /// saw "no session", flipped the footer — and 73 bookmarks stayed.
    @MainActor
    func testRefreshTickNoSessionSignsOutAndFlushes() async throws {
        let env = makeEnvironment()
        try SignedOutResetTests.seedEverything(env)
        env.auth.mintOverride = { _ in .noSession }

        await env.auth.refreshTick()

        XCTAssertEqual(env.auth.status, .signedOut)
        XCTAssertNil(env.auth.account)
        XCTAssertEqual(env.gate, .signedOut)
        SignedOutResetTests.assertEverythingEmpty(env)
    }

    /// A transient mint failure mid-session keeps the session AND the data.
    /// No token is handed out, so requests fail locally (`ApiError.noToken`)
    /// instead of going bare and 401-ing into a false sign-out.
    @MainActor
    func testRefreshTickUnavailableKeepsSessionAndData() async throws {
        let env = makeEnvironment()
        try SignedOutResetTests.seedEverything(env)
        var signOuts = 0
        let flush = env.auth.onSignedOut
        env.auth.onSignedOut = { signOuts += 1; flush?() }
        env.auth.mintOverride = { _ in .unavailable }

        await env.auth.refreshTick()
        let token = await env.auth.token(forceRefresh: true)

        XCTAssertNil(token)
        XCTAssertEqual(env.auth.status, .signedIn)
        XCTAssertEqual(env.gate, .ready)
        XCTAssertEqual(env.auth.account?.email, "tara@purecode.ai")
        XCTAssertEqual(env.library.meta.total, 73, "data must survive a Clerk blip")
        XCTAssertEqual(signOuts, 0)
    }

    // MARK: - Silent restore at launch

    @MainActor
    func testRestoreWithSessionSignsInAndCachesToken() async {
        let env = makeEnvironment()
        env.auth.mintOverride = { _ in .token("jwt-1") }

        await env.auth.restore(requiresAuth: true)

        XCTAssertEqual(env.auth.status, .signedIn)
        XCTAssertEqual(env.gate, .ready)
        XCTAssertTrue(env.canUseData)
        let cached = await env.auth.token(forceRefresh: false)
        XCTAssertEqual(cached, "jwt-1")
    }

    @MainActor
    func testRestoreWithNoSessionIsSignedOut() async {
        let env = makeEnvironment()
        var signOuts = 0
        let flush = env.auth.onSignedOut
        env.auth.onSignedOut = { signOuts += 1; flush?() }
        env.auth.mintOverride = { _ in .noSession }

        await env.auth.restore(requiresAuth: true)

        XCTAssertEqual(env.auth.status, .signedOut)
        XCTAssertEqual(env.gate, .signedOut)
        XCTAssertEqual(signOuts, 1)
        XCTAssertFalse(env.auth.restoreStalled)
    }

    /// The second bug: an unreachable Clerk at launch used to collapse into
    /// "Not signed in". It is the CONNECTING gate — never a sign-out, and
    /// nothing is flushed or shown as signed out.
    @MainActor
    func testRestoreUnreachableIsConnectingNotSignedOut() async {
        let env = makeEnvironment()
        var signOuts = 0
        env.auth.onSignedOut = { signOuts += 1 }
        env.auth.mintOverride = { _ in .unavailable }

        await env.auth.restore(requiresAuth: true)

        XCTAssertEqual(env.auth.status, .unreachable)
        XCTAssertTrue(env.auth.isConnecting)
        XCTAssertEqual(env.gate, .connecting)
        XCTAssertFalse(env.canUseData)
        XCTAssertFalse(env.auth.restoreStalled, "stall needs ~60 s, not one failure")
        XCTAssertEqual(signOuts, 0)
    }

    /// Retry from the connecting screen: a session confirmed AFTER the awaited
    /// restore must announce itself (`onSessionRestored`) so data loads —
    /// the earlier draft dropped that notification on the manual path.
    @MainActor
    func testRetryAfterUnreachableSignsInAndNotifies() async throws {
        let env = makeEnvironment()
        var restored = 0
        env.auth.onSessionRestored = { restored += 1 }
        var outcome: MintOutcome = .unavailable
        env.auth.mintOverride = { _ in outcome }
        await env.auth.restore(requiresAuth: true)
        XCTAssertEqual(env.auth.status, .unreachable)

        outcome = .token("jwt-2")
        env.auth.retryRestoreNow()
        for _ in 0..<200 where env.auth.status != .signedIn {
            try await Task.sleep(for: .milliseconds(10))
        }

        XCTAssertEqual(env.auth.status, .signedIn)
        XCTAssertEqual(env.gate, .ready)
        XCTAssertEqual(restored, 1, "the retry must trigger the data load the launch skipped")
        XCTAssertFalse(env.auth.restoreStalled)
    }

    /// Backoff 1 → 2 → 4 → 8 → 15 → 30 s (last repeats) and the "Can't reach"
    /// message after their sum — pinned so a tweak is a deliberate one.
    func testBackoffScheduleAndStallThreshold() {
        XCTAssertEqual(
            AuthController.restoreBackoff,
            [1, 2, 4, 8, 15, 30].map { Duration.seconds($0) }
        )
        XCTAssertEqual(AuthController.stallAfter, 60)
    }

    // MARK: - Gate

    /// Local has no session concept: the gate is always open, whatever auth says.
    @MainActor
    func testLocalTargetIsAlwaysReady() async {
        let defaults = UserDefaults(suiteName: "AuthStateTests-\(UUID().uuidString)")!
        let env = AppEnvironment(preferences: Preferences(defaults: defaults))
        XCTAssertEqual(env.preferences.serverTarget, .local)
        XCTAssertEqual(env.auth.status, .unknown)
        XCTAssertEqual(env.gate, .ready)
        XCTAssertTrue(env.canUseData)

        await env.auth.restore(requiresAuth: false)
        XCTAssertEqual(env.auth.status, .signedOut)
        XCTAssertEqual(env.gate, .ready, "local's .signedOut is bookkeeping, not a gate")
    }

    /// Cloud before the first answer is CONNECTING, not signed out.
    @MainActor
    func testCloudStartsConnecting() {
        let env = makeEnvironment()
        XCTAssertEqual(env.auth.status, .unknown)
        XCTAssertEqual(env.gate, .connecting)
        XCTAssertFalse(env.canUseData)
    }

    // MARK: - Identity

    func testInitialsFromNameThenEmail() {
        XCTAssertEqual(AccountInfo(signedIn: true, name: "Tara Gupta", email: "tara@purecode.ai").initials, "TG")
        XCTAssertEqual(AccountInfo(signedIn: true, name: "Tara", email: nil).initials, "T")
        XCTAssertEqual(AccountInfo(signedIn: true, name: nil, email: "tara@purecode.ai").initials, "T")
        XCTAssertEqual(AccountInfo(signedIn: true, name: nil, email: nil).initials, "")
        XCTAssertFalse(AccountInfo(signedIn: true, name: nil, email: nil).hasIdentity)
        XCTAssertTrue(AccountInfo(signedIn: true, name: nil, email: "t@x.io").hasIdentity)
    }

    /// A transient `/api/me` failure keeps the identity of the SAME session;
    /// only a sign-out clears it.
    @MainActor
    func testLoadAccountKeepsIdentityOnFailure() async {
        let env = makeEnvironment()
        env.auth.seed(status: .signedIn, account: AccountInfo(signedIn: true, name: "Tara Gupta", email: "tara@purecode.ai"))
        env.auth.mintOverride = { _ in .unavailable } // no token ⇒ /api/me fails locally

        await env.auth.loadAccount(using: env.api)

        XCTAssertEqual(env.auth.account?.email, "tara@purecode.ai")
    }
}
