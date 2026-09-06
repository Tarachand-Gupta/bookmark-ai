import XCTest
@testable import BookmarkAI

/// `ApiClient`'s auth behaviour against a stubbed transport: a cloud request
/// without a token fails LOCALLY (never goes bare), the single 401 replay
/// re-mints, and only a rejected FRESH token reports `onUnauthorized`.
final class ApiClientAuthTests: XCTestCase {

    /// Records every request and answers from `handler`.
    final class StubURLProtocol: URLProtocol {
        static var handler: ((URLRequest) -> (Int, Data))?
        static var requests: [URLRequest] = []

        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

        override func startLoading() {
            Self.requests.append(request)
            let (status, body) = Self.handler?(request) ?? (500, Data())
            let response = HTTPURLResponse(
                url: request.url!, statusCode: status, httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "application/json"]
            )!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: body)
            client?.urlProtocolDidFinishLoading(self)
        }

        override func stopLoading() {}
    }

    private static let metaJSON = Data(
        #"{"categories":[],"browsers":[],"devices":[],"days":[],"tags":[],"total":3}"#.utf8
    )
    private static let unauthorizedJSON = Data(#"{"error":"Missing or invalid bearer token"}"#.utf8)

    @MainActor
    private func makeClient() -> ApiClient {
        StubURLProtocol.requests = []
        StubURLProtocol.handler = nil
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [StubURLProtocol.self]
        return ApiClient(target: .cloud, session: URLSession(configuration: configuration))
    }

    /// Clerk unreachable ⇒ no token ⇒ the request must not leave the app. A
    /// bare request would 401, replay bare, and sign the user out for a blip.
    @MainActor
    func testCloudRequestWithoutTokenFailsBeforeTheNetwork() async {
        let api = makeClient()
        var providerCalls = 0
        var unauthorized = 0
        api.tokenProvider = { _ in providerCalls += 1; return nil }
        api.onUnauthorized = { unauthorized += 1 }
        StubURLProtocol.handler = { _ in (200, Self.metaJSON) }

        do {
            _ = try await api.meta()
            XCTFail("expected ApiError.noToken")
        } catch {
            XCTAssertEqual(error as? ApiError, .noToken)
        }
        XCTAssertEqual(StubURLProtocol.requests.count, 0, "nothing may be sent without a token")
        XCTAssertEqual(providerCalls, 1)
        XCTAssertEqual(unauthorized, 0, "a missing token is not a rejected one")
    }

    /// A token that expired in flight: 401 → forced re-mint → replay → 200.
    @MainActor
    func testExpiredTokenRecoversOnTheSingleReplay() async throws {
        let api = makeClient()
        var forced: [Bool] = []
        var unauthorized = 0
        api.tokenProvider = { force in forced.append(force); return "jwt-\(forced.count)" }
        api.onUnauthorized = { unauthorized += 1 }
        StubURLProtocol.handler = { request in
            request.value(forHTTPHeaderField: "Authorization") == "Bearer jwt-1"
                ? (401, Self.unauthorizedJSON)
                : (200, Self.metaJSON)
        }

        let meta = try await api.meta()

        XCTAssertEqual(meta.total, 3)
        XCTAssertEqual(forced, [false, true], "the replay must force a fresh mint")
        XCTAssertEqual(StubURLProtocol.requests.count, 2)
        XCTAssertEqual(unauthorized, 0)
    }

    /// A FRESH token rejected on the replay is definitive: the app is told once.
    @MainActor
    func testFreshTokenRejectedReportsUnauthorizedOnce() async {
        let api = makeClient()
        var mints = 0
        var unauthorized = 0
        api.tokenProvider = { _ in mints += 1; return "jwt-\(mints)" }
        api.onUnauthorized = { unauthorized += 1 }
        StubURLProtocol.handler = { _ in (401, Self.unauthorizedJSON) }

        do {
            _ = try await api.meta()
            XCTFail("expected ApiError.unauthorized")
        } catch {
            guard case .unauthorized = error as? ApiError else { return XCTFail("got \(error)") }
        }
        XCTAssertEqual(StubURLProtocol.requests.count, 2, "exactly one replay")
        XCTAssertEqual(
            StubURLProtocol.requests.map { $0.value(forHTTPHeaderField: "Authorization") },
            ["Bearer jwt-1", "Bearer jwt-2"]
        )
        XCTAssertEqual(unauthorized, 1)
    }

    /// Local never consults the provider and never attaches a header.
    @MainActor
    func testLocalTargetSendsNoAuthorization() async throws {
        let api = makeClient()
        api.target = .local
        var providerCalls = 0
        api.tokenProvider = { _ in providerCalls += 1; return "never" }
        StubURLProtocol.handler = { _ in (200, Self.metaJSON) }

        _ = try await api.meta()

        XCTAssertEqual(providerCalls, 0)
        XCTAssertNil(StubURLProtocol.requests.first?.value(forHTTPHeaderField: "Authorization"))
    }
}
