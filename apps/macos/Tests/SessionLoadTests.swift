import Observation
import XCTest
@testable import BookmarkAI

/// Loading the account's data — the identity above all — on EVERY transition
/// to signed-in, in a task the app owns (`AppEnvironment.gateOpened`). Pins the
/// bug behind "Status: Signed in, identity stuck on Loading your account…":
/// the sign-in sheet's `.task` is cancelled the instant the sheet dismisses,
/// and a load awaited inside it never lands.
final class SessionLoadTests: XCTestCase {

    private static let meJSON = Data(#"{"signedIn":true,"name":"Tara Gupta","email":"tara@purecode.ai"}"#.utf8)

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

    /// Complete a sign-in the way the sheet does — from inside a task SwiftUI
    /// cancels the moment `isPresentingSignIn` flips false — and return that
    /// task, so a test can prove the fixture really was cancelled.
    @MainActor
    static func completeSignInFromTheSheetsTask(_ env: AppEnvironment) async -> Task<Void, Never> {
        env.auth.beginSignIn()
        let sheetTask = Task { @MainActor in await env.auth.completeSignIn() }
        withObservationTracking {
            _ = env.auth.isPresentingSignIn
        } onChange: {
            sheetTask.cancel()
        }
        await sheetTask.value
        return sheetTask
    }

    /// THE bug. `SignInSheet` polls for a token inside its `.task`; on success
    /// it used to await the whole completion from there. `completeSignIn()`
    /// dismisses the sheet first thing, SwiftUI cancels that task at the next
    /// suspension, and URLSession fails with `.cancelled` inside a cancelled
    /// task — so the token (minted in its own task) arrived while `/api/me`
    /// (awaited as a child) never did: "Signed in" with no identity until a
    /// relaunch. Now the confirmed session loads in a task the app owns.
    @MainActor
    func testSignInCompletedInsideTheDismissedSheetsTaskStillLoadsIdentity() async throws {
        let env = Self.makeStubbedEnvironment()
        env.auth.seed(status: .signedOut)
        env.auth.mintOverride = { _ in .token("jwt-sheet") }

        let sheetTask = await Self.completeSignInFromTheSheetsTask(env)
        XCTAssertTrue(sheetTask.isCancelled, "the fixture must reproduce the dismissed sheet")
        XCTAssertFalse(env.auth.isPresentingSignIn)
        XCTAssertEqual(env.auth.status, .signedIn)
        XCTAssertEqual(env.gate, .ready)

        let load = try XCTUnwrap(env.sessionLoad, "a confirmed session must start the app's own load")
        await load.value
        XCTAssertEqual(env.auth.account?.email, "tara@purecode.ai", "identity must load right after an in-app sign-in")
        XCTAssertEqual(env.auth.account?.name, "Tara Gupta")
        XCTAssertEqual(identityRequests(), 1, "one confirmation, one /api/me")
    }

    /// The sheet's entry point hands off to a task of its own and returns at
    /// once; awaiting it (as tests do) ends with the session adopted and the
    /// identity in.
    @MainActor
    func testFinishSignInHandsOffAndLoadsIdentity() async throws {
        let env = Self.makeStubbedEnvironment()
        env.auth.seed(status: .signedOut)
        env.auth.beginSignIn()
        env.auth.mintOverride = { _ in .token("jwt-sheet") }

        let signIn = env.finishSignIn()
        XCTAssertTrue(env.auth.isPresentingSignIn, "returns before its task has even dismissed the sheet")
        await signIn.value
        XCTAssertFalse(env.auth.isPresentingSignIn)
        XCTAssertEqual(env.auth.status, .signedIn)
        await env.sessionLoad?.value

        XCTAssertEqual(env.auth.account?.email, "tara@purecode.ai")
        XCTAssertEqual(identityRequests(), 1)
    }

    /// One load per transition, whichever path made it: the launch restore
    /// loads; the 45 s tick while signed in loads nothing more; a sign-out
    /// clears the identity; the next sign-in loads it again.
    @MainActor
    func testEveryTransitionToSignedInLoadsIdentityExactlyOnce() async throws {
        let env = Self.makeStubbedEnvironment()
        var confirmations = 0
        let load = env.auth.onSessionConfirmed
        env.auth.onSessionConfirmed = { confirmations += 1; load?() }
        env.auth.mintOverride = { _ in .token("jwt-1") }

        await env.auth.restore(requiresAuth: true)
        await env.sessionLoad?.value
        XCTAssertEqual(confirmations, 1)
        XCTAssertEqual(env.auth.account?.email, "tara@purecode.ai", "the launch restore loads the identity")
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

        let sheetTask = await Self.completeSignInFromTheSheetsTask(env)
        XCTAssertTrue(sheetTask.isCancelled)
        await env.sessionLoad?.value
        XCTAssertEqual(confirmations, 2)
        XCTAssertEqual(env.auth.account?.email, "tara@purecode.ai", "signing in again loads it again")
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
        XCTAssertEqual(env.auth.account?.email, "tara@purecode.ai")

        // The backoff retry that was scheduled (1 s) must find nothing to do.
        try await Task.sleep(for: .milliseconds(1300))
        XCTAssertEqual(env.auth.status, .signedIn)
        XCTAssertEqual(identityRequests(), 1)
    }
}
