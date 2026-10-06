import Observation
import XCTest
@testable import BookmarkAI

/// Loading the account's data — the identity above all — on EVERY transition
/// to signed-in, in a task the app owns (`AppEnvironment.gateOpened`).
final class SessionLoadTests: XCTestCase {

    private static let meJSON = Data(#"{"signedIn":true,"name":"Tara Gupta","email":"tara@bookmark-ai.cloud"}"#.utf8)

    /// A cloud environment whose API is answered by the stub protocol:
    /// `/api/me` with Tara's identity, everything else 404 (the library shows
    /// its error, health stays nil — neither is what these tests are about).
    @MainActor
    static func makeStubbedEnvironment() -> AppEnvironment {
        ApiClientAuthTests.StubURLProtocol.requests = []
        ApiClientAuthTests.StubURLProtocol.handler = { request in
            request.url?.path == "/api/me" ? (200, meJSON) : (404, Data("{}".utf8))
        }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ApiClientAuthTests.StubURLProtocol.self]
        return SignedOutResetTests.makeCloudEnvironment(session: URLSession(configuration: configuration))
    }

    /// How many times `/api/me` was requested so far.
    private func identityRequests() -> Int {
        ApiClientAuthTests.StubURLProtocol.requests.filter { $0.url?.path == "/api/me" }.count
    }

    @MainActor
    static func completeBrowserSignIn(_ env: AppEnvironment, token: String = "jwt-browser") async {
        let flow = String(repeating: "A", count: 43)
        env.auth.browserStartOverride = { _ in
            BrowserSignInStart(
                flowId: flow,
                browserUrl: "https://www.bookmark-ai.cloud/macos-auth?flow=\(flow)",
                verificationCode: "ABCD-EFGH",
                expiresAt: Date().addingTimeInterval(600).timeIntervalSince1970 * 1_000,
                expiresInSeconds: 600
            )
        }
        env.auth.browserExchangeOverride = { _, _ in
            .complete(ticket: "one-time-ticket", expiresAt: Date().addingTimeInterval(60))
        }
        env.auth.browserOpenOverride = { _ in true }
        env.auth.browserSleepOverride = { _ in }
        env.auth.redeemTicketOverride = { _ in .success }
        env.auth.mintOverride = { _ in .token(token) }
        env.auth.beginSignIn()
        await env.auth.waitForBrowserAttempt()
    }

    @MainActor
    func testBrowserSignInLoadsIdentityAfterTheSheetDismisses() async throws {
        try XCTSkipIf(SupabaseConfiguration.isQA, "Legacy Clerk ticket flow; run in the ordinary test-host configuration. Native handoff is covered by BrowserSignInTests and SupabaseNativeAuthTests.")
        let env = Self.makeStubbedEnvironment()
        env.auth.seed(status: .signedOut)

        await Self.completeBrowserSignIn(env)
        XCTAssertFalse(env.auth.isPresentingSignIn)
        XCTAssertEqual(env.auth.status, .signedIn)
        XCTAssertEqual(env.gate, .ready)

        let load = try XCTUnwrap(env.sessionLoad, "a confirmed session must start the app's own load")
        await load.value
        XCTAssertEqual(env.auth.account?.email, "tara@bookmark-ai.cloud", "identity must load right after an in-app sign-in")
        XCTAssertEqual(env.auth.account?.name, "Tara Gupta")
        XCTAssertEqual(identityRequests(), 1, "one confirmation, one /api/me")
    }

    @MainActor
    func testTicketRedemptionConfirmsSessionAndLoadsIdentity() async throws {
        try XCTSkipIf(SupabaseConfiguration.isQA, "Legacy Clerk ticket flow; run in the ordinary test-host configuration.")
        let env = Self.makeStubbedEnvironment()
        env.auth.seed(status: .signedOut)

        await Self.completeBrowserSignIn(env)
        XCTAssertFalse(env.auth.isPresentingSignIn)
        XCTAssertEqual(env.auth.status, .signedIn)
        await env.sessionLoad?.value

        XCTAssertEqual(env.auth.account?.email, "tara@bookmark-ai.cloud")
        XCTAssertEqual(identityRequests(), 1)
    }

    /// One load per transition, whichever path made it: the launch restore
    /// loads; the 45 s tick while signed in loads nothing more; a sign-out
    /// clears the identity; the next sign-in loads it again.
    @MainActor
    func testEveryTransitionToSignedInLoadsIdentityExactlyOnce() async throws {
        try XCTSkipIf(SupabaseConfiguration.isQA, "Includes legacy Clerk ticket flow; run in the ordinary test-host configuration.")
        let env = Self.makeStubbedEnvironment()
        var confirmations = 0
        let load = env.auth.onSessionConfirmed
        env.auth.onSessionConfirmed = { confirmations += 1; load?() }
        env.auth.mintOverride = { _ in .token("jwt-1") }

        await env.auth.restore(requiresAuth: true)
        await env.sessionLoad?.value
        XCTAssertEqual(confirmations, 1)
        XCTAssertEqual(env.auth.account?.email, "tara@bookmark-ai.cloud", "the launch restore loads the identity")
        XCTAssertEqual(identityRequests(), 1)

        let launchLoad = env.sessionLoad
        await env.auth.refreshTick()
        XCTAssertEqual(confirmations, 1, "already signed in — the tick is not a transition")
        XCTAssertTrue(env.sessionLoad == launchLoad, "no second load for the tick")
        XCTAssertEqual(identityRequests(), 1)

        env.auth.handleUnauthorized()
        XCTAssertEqual(env.auth.status, .signedOut)
        XCTAssertNil(env.auth.account)
        XCTAssertNil(env.sessionLoad, "the flush drops the load handle")

        await Self.completeBrowserSignIn(env, token: "jwt-2")
        await env.sessionLoad?.value
        XCTAssertEqual(confirmations, 2)
        XCTAssertEqual(env.auth.account?.email, "tara@bookmark-ai.cloud", "signing in again loads it again")
        XCTAssertEqual(identityRequests(), 2)
    }

    /// While the launch restore is still retrying (connecting), a request that
    /// mints on demand may confirm the session first (⌘R, a view's own load).
    /// That is a transition like any other: it loads, and the scheduled retry
    /// can't demote the confirmed session afterwards.
    @MainActor
    func testOnDemandMintWhileConnectingConfirmsAndLoads() async throws {
        let env = Self.makeStubbedEnvironment()
        var outcome: MintOutcome = .unavailable
        env.auth.mintOverride = { _ in outcome }
        await env.auth.restore(requiresAuth: true)
        XCTAssertEqual(env.auth.status, .unreachable)
        XCTAssertNil(env.sessionLoad)

        outcome = .token("jwt-on-demand")
        let token = await env.auth.token(forceRefresh: true)

        XCTAssertEqual(token, "jwt-on-demand")
        XCTAssertEqual(env.auth.status, .signedIn)
        XCTAssertFalse(env.auth.restoreStalled)
        await env.sessionLoad?.value
        XCTAssertEqual(env.auth.account?.email, "tara@bookmark-ai.cloud")

        // The backoff retry that was scheduled (1 s) must find nothing to do.
        try await Task.sleep(for: .milliseconds(1300))
        XCTAssertEqual(env.auth.status, .signedIn)
        XCTAssertEqual(identityRequests(), 1)
    }
}
