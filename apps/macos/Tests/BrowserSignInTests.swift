import XCTest
import WebKit
@testable import BookmarkAI

final class BrowserSignInTests: XCTestCase {
    private static let origin = URL(string: "https://www.bookmark-ai.cloud")!
    private static let flow = String(repeating: "A", count: 43)

    final class StubURLProtocol: URLProtocol {
        static var handler: ((URLRequest) -> (Int, [String: String], Data))?
        static var requests: [URLRequest] = []

        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

        override func startLoading() {
            Self.requests.append(request)
            let (status, headers, data) = Self.handler?(request) ?? (500, ["Content-Type": "application/json"], Data())
            let response = HTTPURLResponse(
                url: request.url!, statusCode: status, httpVersion: "HTTP/1.1", headerFields: headers
            )!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }

        override func stopLoading() {}
    }

    @MainActor
    final class NavigationWaiter: NSObject, WKNavigationDelegate {
        private var continuation: CheckedContinuation<Void, Never>?

        func waitForLoad(in webView: WKWebView, html: String) async {
            webView.navigationDelegate = self
            await withCheckedContinuation { continuation in
                self.continuation = continuation
                webView.loadHTMLString(html, baseURL: BrowserSignInTests.origin)
            }
            webView.navigationDelegate = nil
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            continuation?.resume()
            continuation = nil
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            continuation?.resume()
            continuation = nil
        }
    }

    private func client() -> BrowserSignInClient {
        Self.StubURLProtocol.requests = []
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.urlCache = nil
        return BrowserSignInClient(origin: Self.origin, session: URLSession(configuration: configuration))
    }

    @MainActor
    private func evaluate(_ script: String, in webView: WKWebView) async throws -> Any? {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Any?, Error>) in
            webView.evaluateJavaScript(script) { value, error in
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: value) }
            }
        }
    }

    @MainActor
    private func callTicketScript(_ ticket: String, in webView: WKWebView) async throws -> Any? {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Any?, Error>) in
            webView.callAsyncJavaScript(
                ClerkWebAuth.ticketRedemptionScript,
                arguments: ["ticket": ticket],
                in: nil,
                in: .page
            ) { outcome in
                switch outcome {
                case .success(let value): continuation.resume(returning: value)
                case .failure(let error): continuation.resume(throwing: error)
                }
            }
        }
    }

    private static func start(
        now: Date = Date(),
        origin: URL = BrowserSignInTests.origin,
        flow: String = BrowserSignInTests.flow
    ) -> BrowserSignInStart {
        BrowserSignInStart(
            flowId: flow,
            browserUrl: origin.appendingPathComponent("macos-auth").appending(queryItems: [
                URLQueryItem(name: "flow", value: flow),
            ]).absoluteString,
            verificationCode: "ABCD-EFGH",
            expiresAt: now.addingTimeInterval(600).timeIntervalSince1970 * 1_000,
            expiresInSeconds: 600
        )
    }

    @MainActor
    private func waitUntil(_ predicate: @escaping () -> Bool) async -> Bool {
        for _ in 0..<2_000 {
            if predicate() { return true }
            try? await Task.sleep(for: .milliseconds(1))
        }
        return predicate()
    }

    func testRFC7636ChallengeVectorAndGeneratedVerifierShape() throws {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"
        XCTAssertEqual(BrowserSignInPKCE.challenge(for: verifier), "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")

        let generated = try BrowserSignInPKCE.generateVerifier()
        XCTAssertTrue(BrowserSignInWireValidator.isOpaque43(generated))
        XCTAssertEqual(Data(base64Encoded: generated.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/") + "=")?.count, 32)
    }

    func testBrowserURLRequiresExactConfiguredOriginPathAndFlowOnly() {
        let valid = URL(string: "https://www.bookmark-ai.cloud/macos-auth?flow=\(Self.flow)")!
        XCTAssertTrue(BrowserSignInURLValidator.validate(valid, flowId: Self.flow, origin: Self.origin))
        XCTAssertFalse(BrowserSignInURLValidator.validate(URL(string: "https://bookmark-ai.cloud/macos-auth?flow=\(Self.flow)")!, flowId: Self.flow, origin: Self.origin))
        XCTAssertFalse(BrowserSignInURLValidator.validate(URL(string: "https://www.bookmark-ai.cloud.evil.example/macos-auth?flow=\(Self.flow)")!, flowId: Self.flow, origin: Self.origin))
        XCTAssertFalse(BrowserSignInURLValidator.validate(URL(string: "https://www.bookmark-ai.cloud/sign-in?flow=\(Self.flow)")!, flowId: Self.flow, origin: Self.origin))
        XCTAssertFalse(BrowserSignInURLValidator.validate(URL(string: "https://www.bookmark-ai.cloud/macos-auth?flow=wrong")!, flowId: Self.flow, origin: Self.origin))
        XCTAssertFalse(BrowserSignInURLValidator.validate(URL(string: "https://www.bookmark-ai.cloud/macos-auth?flow=\(Self.flow)&next=https://evil.example")!, flowId: Self.flow, origin: Self.origin))
    }

    func testClientUsesJSONPostAndMapsPendingRateLimitAndComplete() async throws {
        let client = client()
        var response = 0
        StubURLProtocol.handler = { request in
            response += 1
            XCTAssertEqual(request.httpMethod, "POST")
            XCTAssertEqual(request.value(forHTTPHeaderField: "Content-Type"), "application/json")
            XCTAssertEqual(request.cachePolicy, .reloadIgnoringLocalCacheData)
            XCTAssertNotNil(request.httpBody)
            switch response {
            case 1:
                return (202, ["Content-Type": "application/json", "Retry-After": "3"], Data(#"{"status":"pending","retryAfterSeconds":2}"#.utf8))
            case 2:
                return (429, ["Content-Type": "application/json", "Retry-After": "7"], Data(#"{"error":"Too many requests"}"#.utf8))
            default:
                return (200, ["Content-Type": "application/json"], Data(#"{"status":"complete","ticket":"secret-ticket","expiresAt":2000000000000}"#.utf8))
            }
        }

        let pending = try await client.exchange(flowId: Self.flow, verifier: Self.flow)
        let limited = try await client.exchange(flowId: Self.flow, verifier: Self.flow)
        let complete = try await client.exchange(flowId: Self.flow, verifier: Self.flow)
        XCTAssertEqual(pending, .pending(retryAfter: 3))
        XCTAssertEqual(limited, .rateLimited(retryAfter: 7))
        XCTAssertEqual(
            complete,
            .complete(ticket: "secret-ticket", expiresAt: Date(timeIntervalSince1970: 2_000_000_000))
        )
    }

    func testClientTreats502AsTerminalAnd503AsTemporary() async {
        let client = client()
        var status = 502
        StubURLProtocol.handler = { _ in
            (status, ["Content-Type": "application/json"], Data(#"{"error":"service failed"}"#.utf8))
        }

        do {
            _ = try await client.exchange(flowId: Self.flow, verifier: Self.flow)
            XCTFail("expected terminal 502")
        } catch {
            guard case .terminal = error as? BrowserSignInError else { return XCTFail("got \(error)") }
        }

        status = 503
        StubURLProtocol.handler = { _ in
            (status, ["Content-Type": "text/html"], Data("upstream unavailable".utf8))
        }
        do {
            _ = try await client.exchange(flowId: Self.flow, verifier: Self.flow)
            XCTFail("expected temporary 503")
        } catch {
            guard case .temporary = error as? BrowserSignInError else { return XCTFail("got \(error)") }
        }
    }

    func testClientRejectsWrongContentTypeAndOversizedResponse() async {
        let client = client()
        StubURLProtocol.handler = { _ in (200, ["Content-Type": "text/html"], Data("<html>".utf8)) }
        do {
            _ = try await client.exchange(flowId: Self.flow, verifier: Self.flow)
            XCTFail("expected invalid response")
        } catch {
            XCTAssertEqual(error as? BrowserSignInError, .invalidResponse)
        }

        StubURLProtocol.handler = { _ in
            (200, ["Content-Type": "application/json"], Data(repeating: 0x41, count: 64 * 1_024 + 1))
        }
        do {
            _ = try await client.exchange(flowId: Self.flow, verifier: Self.flow)
            XCTFail("expected bounded response rejection")
        } catch {
            XCTAssertEqual(error as? BrowserSignInError, .invalidResponse)
        }
    }

    func testRedirectDelegateRefusesEveryRedirect() {
        let session = URLSession(configuration: .ephemeral)
        let task = session.dataTask(with: Self.origin)
        let response = HTTPURLResponse(
            url: Self.origin,
            statusCode: 307,
            httpVersion: "HTTP/1.1",
            headerFields: ["Location": "https://evil.example/capture"]
        )!
        let redirected = URLRequest(url: URL(string: "https://evil.example/capture")!)
        var followed: URLRequest? = redirected

        BrowserSignInRedirectBlocker.shared.urlSession(
            session,
            task: task,
            willPerformHTTPRedirection: response,
            newRequest: redirected
        ) { followed = $0 }

        XCTAssertNil(followed, "the verifier POST must never follow a redirect")
        session.invalidateAndCancel()
    }

    @MainActor
    func testPendingAndRateLimitDelaysThenSuccessfulTicketAdoptsSession() async {
        let auth = AuthController(origin: Self.origin)
        auth.seed(status: .signedOut)
        let now = Date()
        var delays: [TimeInterval] = []
        var exchanges = 0
        var confirmed = 0
        var opened: URL?
        auth.onSessionConfirmed = { confirmed += 1 }
        auth.browserStartOverride = { challenge in
            XCTAssertTrue(BrowserSignInWireValidator.isOpaque43(challenge))
            return Self.start(now: now)
        }
        auth.browserExchangeOverride = { flow, verifier in
            XCTAssertEqual(flow, Self.flow)
            XCTAssertEqual(BrowserSignInPKCE.challenge(for: verifier).count, 43)
            exchanges += 1
            switch exchanges {
            case 1: return .pending(retryAfter: 2)
            case 2: return .rateLimited(retryAfter: 7)
            default: return .complete(ticket: "ticket", expiresAt: now.addingTimeInterval(60))
            }
        }
        auth.browserOpenOverride = { opened = $0; return true }
        auth.browserSleepOverride = { delays.append($0) }
        auth.browserNowOverride = { now }
        auth.redeemTicketOverride = { ticket in XCTAssertEqual(ticket, "ticket"); return .success }
        auth.mintOverride = { fresh in XCTAssertTrue(fresh); return .token("full-clerk-jwt") }

        auth.beginSignIn()
        await auth.waitForBrowserAttempt()

        XCTAssertEqual(opened?.host, "www.bookmark-ai.cloud")
        XCTAssertEqual(delays, [2, 2, 7])
        XCTAssertEqual(auth.status, .signedIn)
        XCTAssertFalse(auth.isPresentingSignIn)
        XCTAssertEqual(auth.browserSignInState, .idle)
        XCTAssertEqual(confirmed, 1)
        let cachedToken = await auth.token(forceRefresh: false)
        XCTAssertEqual(cachedToken, "full-clerk-jwt")
    }

    @MainActor
    func testOpenFailureKeepsFlowWaitingAndReopenCanRecover() async {
        let auth = AuthController(origin: Self.origin)
        auth.seed(status: .signedOut)
        auth.browserStartOverride = { _ in Self.start() }
        auth.browserExchangeOverride = { _, _ in .pending(retryAfter: 2) }
        var opens = 0
        auth.browserOpenOverride = { _ in opens += 1; return opens > 1 }
        auth.browserSleepOverride = { _ in try await Task.sleep(for: .seconds(60)) }

        auth.beginSignIn()
        let reachedWaiting = await waitUntil {
            if case .waiting(_, _, _, let error) = auth.browserSignInState { return error != nil }
            return false
        }
        XCTAssertTrue(reachedWaiting)

        auth.openBrowserAgain()
        if case .waiting(_, _, _, let error) = auth.browserSignInState {
            XCTAssertNil(error)
        } else {
            XCTFail("flow should remain waiting")
        }
        XCTAssertEqual(opens, 2)
        auth.cancelSignIn()
        await auth.waitForBrowserAttempt()
        XCTAssertEqual(auth.status, .signedOut)
    }

    @MainActor
    func testMintStartedBeforeBrowserAttemptCannotReturnOldToken() async {
        let auth = AuthController(origin: Self.origin)
        auth.seed(status: .signedOut)
        var mint: CheckedContinuation<MintOutcome, Never>?
        auth.mintOverride = { _ in await withCheckedContinuation { mint = $0 } }

        let oldToken = Task { @MainActor in await auth.token(forceRefresh: true) }
        let mintStarted = await waitUntil { mint != nil }
        guard mintStarted else {
            oldToken.cancel()
            return XCTFail("mint never started")
        }

        auth.browserStartOverride = { _ in
            try await Task.sleep(for: .seconds(60))
            throw CancellationError()
        }
        auth.beginSignIn()
        mint?.resume(returning: .token("old-account-token"))

        let staleToken = await oldToken.value
        XCTAssertNil(staleToken)
        XCTAssertNotEqual(auth.status, .signedIn)
        auth.cancelSignIn()
        await auth.waitForBrowserAttempt()
    }

    @MainActor
    func testCancelDuringRedemptionClearsLateHiddenSession() async {
        let auth = AuthController(origin: Self.origin)
        auth.seed(status: .signedOut)
        auth.browserStartOverride = { _ in Self.start() }
        auth.browserExchangeOverride = { _, _ in .complete(ticket: "ticket", expiresAt: Date().addingTimeInterval(60)) }
        auth.browserOpenOverride = { _ in true }
        auth.browserSleepOverride = { _ in }
        var redemption: CheckedContinuation<TicketRedemptionOutcome, Never>?
        auth.redeemTicketOverride = { _ in
            await withCheckedContinuation { redemption = $0 }
        }
        var hiddenSignOuts = 0
        auth.webSignOutOverride = { hiddenSignOuts += 1 }

        auth.beginSignIn()
        let reachedRedeeming = await waitUntil {
            if case .redeeming = auth.browserSignInState { return true }
            return false
        }
        guard reachedRedeeming else {
            auth.cancelSignIn()
            return XCTFail("redemption never started")
        }
        auth.cancelSignIn()
        redemption?.resume(returning: .success)
        await auth.waitForBrowserAttempt()

        XCTAssertEqual(hiddenSignOuts, 1)
        XCTAssertEqual(auth.status, .signedOut)
        XCTAssertFalse(auth.isPresentingSignIn)
    }

    @MainActor
    func testCanceledRedemptionCleansUpEvenWhenJavaScriptReportsFailure() async {
        let auth = AuthController(origin: Self.origin)
        auth.seed(status: .signedOut)
        auth.browserStartOverride = { _ in Self.start() }
        auth.browserExchangeOverride = { _, _ in .complete(ticket: "ticket", expiresAt: Date().addingTimeInterval(60)) }
        auth.browserOpenOverride = { _ in true }
        auth.browserSleepOverride = { _ in }
        var redemption: CheckedContinuation<TicketRedemptionOutcome, Never>?
        auth.redeemTicketOverride = { _ in await withCheckedContinuation { redemption = $0 } }
        var hiddenSignOuts = 0
        auth.webSignOutOverride = { hiddenSignOuts += 1 }

        auth.beginSignIn()
        let reachedRedeeming = await waitUntil {
            if case .redeeming = auth.browserSignInState { return true }
            return false
        }
        guard reachedRedeeming else {
            auth.cancelSignIn()
            return XCTFail("redemption never started")
        }
        auth.cancelSignIn()
        redemption?.resume(returning: .failure)
        await auth.waitForBrowserAttempt()

        XCTAssertEqual(hiddenSignOuts, 1, "a failure sentinel does not prove Clerk created no session")
        XCTAssertEqual(auth.status, .signedOut)
    }

    @MainActor
    func testTargetChangeWaitsForLateRedemptionCleanup() async {
        let auth = AuthController(origin: Self.origin)
        auth.seed(status: .signedOut)
        auth.browserStartOverride = { _ in Self.start() }
        auth.browserExchangeOverride = { _, _ in .complete(ticket: "ticket", expiresAt: Date().addingTimeInterval(60)) }
        auth.browserOpenOverride = { _ in true }
        auth.browserSleepOverride = { _ in }
        var redemption: CheckedContinuation<TicketRedemptionOutcome, Never>?
        auth.redeemTicketOverride = { _ in await withCheckedContinuation { redemption = $0 } }
        var hiddenSignOuts = 0
        auth.webSignOutOverride = { hiddenSignOuts += 1 }

        auth.beginSignIn()
        let reachedRedeeming = await waitUntil {
            if case .redeeming = auth.browserSignInState { return true }
            return false
        }
        guard reachedRedeeming else {
            auth.cancelSignIn()
            return XCTFail("redemption never started")
        }

        let changed = Task { @MainActor in
            await auth.updateOrigin(URL(string: "http://localhost:3000")!)
        }
        await Task.yield()
        redemption?.resume(returning: .success)
        await changed.value

        XCTAssertEqual(hiddenSignOuts, 1)
        XCTAssertFalse(auth.isPresentingSignIn)
        XCTAssertEqual(auth.browserSignInState, .idle)
        XCTAssertEqual(auth.status, .signedOut)
    }

    @MainActor
    func testNewAttemptWaitsForCanceledRedemptionCleanup() async {
        let auth = AuthController(origin: Self.origin)
        auth.seed(status: .signedOut)
        var starts = 0
        var redemptions = 0
        var firstRedemption: CheckedContinuation<TicketRedemptionOutcome, Never>?
        var events: [String] = []
        auth.browserStartOverride = { _ in starts += 1; return Self.start() }
        auth.browserExchangeOverride = { _, _ in .complete(ticket: "ticket-\(starts)", expiresAt: Date().addingTimeInterval(60)) }
        auth.browserOpenOverride = { _ in true }
        auth.browserSleepOverride = { _ in }
        auth.redeemTicketOverride = { ticket in
            redemptions += 1
            events.append("redeem-\(ticket)")
            if redemptions == 1 {
                return await withCheckedContinuation { firstRedemption = $0 }
            }
            return .success
        }
        auth.webSignOutOverride = { events.append("cleanup") }
        auth.mintOverride = { _ in .token("jwt-new") }

        auth.beginSignIn()
        let firstRedeeming = await waitUntil { redemptions == 1 }
        guard firstRedeeming else {
            auth.cancelSignIn()
            return XCTFail("first redemption never started")
        }
        auth.cancelSignIn()
        auth.beginSignIn()
        await Task.yield()
        XCTAssertEqual(starts, 1, "the replacement must wait for stale redemption cleanup")

        firstRedemption?.resume(returning: .success)
        await auth.waitForBrowserAttempt()

        XCTAssertEqual(starts, 2)
        XCTAssertEqual(events, ["redeem-ticket-1", "cleanup", "redeem-ticket-2"])
        XCTAssertEqual(auth.status, .signedIn)
    }

    @MainActor
    func testExpiryStopsPollingAtServerDeadline() async {
        let auth = AuthController(origin: Self.origin)
        auth.seed(status: .signedOut)
        var now = Date()
        var exchanges = 0
        var start = Self.start(now: now)
        start = BrowserSignInStart(
            flowId: start.flowId,
            browserUrl: start.browserUrl,
            verificationCode: start.verificationCode,
            expiresAt: now.addingTimeInterval(3).timeIntervalSince1970 * 1_000,
            expiresInSeconds: 3
        )
        auth.browserStartOverride = { _ in start }
        auth.browserOpenOverride = { _ in true }
        auth.browserNowOverride = { now }
        auth.browserSleepOverride = { delay in now = now.addingTimeInterval(delay) }
        auth.browserExchangeOverride = { _, _ in exchanges += 1; return .pending(retryAfter: 2) }

        auth.beginSignIn()
        await auth.waitForBrowserAttempt()

        XCTAssertEqual(exchanges, 1)
        guard case .failed(let message) = auth.browserSignInState else {
            return XCTFail("expired flow should be retryable")
        }
        XCTAssertTrue(message.localizedCaseInsensitiveContains("expired"))
        XCTAssertTrue(auth.isPresentingSignIn)
    }

    @MainActor
    func testTicketScriptExecutesAgainstClientSignInMockWithStructuredArgument() async throws {
        let sampleSecret = "secret-ticket-that-must-not-enter-source"
        let webView = WKWebView(frame: .zero)
        let navigationWaiter = NavigationWaiter()
        await navigationWaiter.waitForLoad(in: webView, html: "<html><body></body></html>")
        _ = try await evaluate(
            """
            window.__redeemed = null;
            window.__active = null;
            window.Clerk = {
              loaded: true,
              client: { signIn: { create: async (options) => {
                window.__redeemed = options;
                return { status: 'complete', createdSessionId: 'sess_mock' };
              }}},
              setActive: async (options) => { window.__active = options; }
            };
            """,
            in: webView
        )

        let result = try await callTicketScript(sampleSecret, in: webView)
        let observed = try await evaluate(
            "JSON.stringify({ redeemed: window.__redeemed, active: window.__active })",
            in: webView
        ) as? String

        XCTAssertEqual(result as? String, "__TICKET_REDEEMED__")
        XCTAssertEqual(observed, #"{"redeemed":{"strategy":"ticket","ticket":"secret-ticket-that-must-not-enter-source"},"active":{"session":"sess_mock"}}"#)
        XCTAssertFalse(ClerkWebAuth.ticketRedemptionScript.contains(sampleSecret))
    }
}
