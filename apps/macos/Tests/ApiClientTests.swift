import XCTest
@testable import BookmarkAI

/// URL construction and error mapping — the two pure pieces of `ApiClient` that
/// are worth pinning down, because getting either wrong fails silently at runtime.
final class ApiClientTests: XCTestCase {

    // MARK: - Base URLs

    /// The cloud base MUST be `www`. The apex 308-redirects `/api/*` to `www`,
    /// and URLSession strips `Authorization` across that origin hop — the exact
    /// trap documented in apps/mobile/src/api.ts.
    func testCloudBaseUsesWWWHost() {
        XCTAssertEqual(ServerTarget.cloud.baseURL.absoluteString, "https://www.bookmark-ai.cloud")
        XCTAssertEqual(ServerTarget.cloud.baseURL.host(), "www.bookmark-ai.cloud")
    }

    func testLocalBaseIsDevServer() {
        XCTAssertEqual(ServerTarget.local.baseURL.absoluteString, "http://localhost:3000")
    }

    /// Only cloud gets a bearer token; local relies on DEV_OPEN_API.
    func testOnlyCloudRequiresAuth() {
        XCTAssertTrue(ServerTarget.cloud.requiresAuth)
        XCTAssertFalse(ServerTarget.local.requiresAuth)
    }

    // MARK: - URL building

    func testMakeURLBuildsPathAndQuery() throws {
        let url = try XCTUnwrap(ApiClient.makeURL(
            base: ServerTarget.local.baseURL,
            path: "/api/search",
            query: [
                URLQueryItem(name: "q", value: "swift ui"),
                URLQueryItem(name: "mode", value: "hybrid"),
                URLQueryItem(name: "limit", value: "40"),
            ]
        ))

        let components = try XCTUnwrap(URLComponents(url: url, resolvingAgainstBaseURL: false))
        XCTAssertEqual(components.host, "localhost")
        XCTAssertEqual(components.port, 3000)
        XCTAssertEqual(components.path, "/api/search")
        // The space must be percent-encoded, not dropped or left raw.
        XCTAssertTrue(url.absoluteString.contains("q=swift%20ui"), url.absoluteString)
        XCTAssertEqual(components.queryItems?.first { $0.name == "mode" }?.value, "hybrid")
    }

    func testMakeURLOmitsEmptyQuery() throws {
        let url = try XCTUnwrap(ApiClient.makeURL(
            base: ServerTarget.cloud.baseURL, path: "/api/meta", query: []
        ))
        XCTAssertEqual(url.absoluteString, "https://www.bookmark-ai.cloud/api/meta")
    }

    /// The cloud path must never lose the `www` host when a route is appended.
    func testMakeURLKeepsCloudHost() throws {
        let url = try XCTUnwrap(ApiClient.makeURL(
            base: ServerTarget.cloud.baseURL, path: "/api/bookmarks", query: []
        ))
        XCTAssertEqual(url.host(), "www.bookmark-ai.cloud")
    }

    // MARK: - Server limits

    func testLimitsMatchTheZodSchemas() {
        XCTAssertEqual(ApiClient.maxBookmarksLimit, 200)
        XCTAssertEqual(ApiClient.maxSearchLimit, 50)
    }

    // MARK: - Error mapping

    func test401MapsToUnauthorized() {
        let error = ApiError.fromResponse(
            status: 401, body: ErrorBody(error: "Missing or invalid bearer token", code: nil)
        )
        guard case .unauthorized(let message) = error else {
            return XCTFail("expected .unauthorized, got \(error)")
        }
        XCTAssertEqual(message, "Missing or invalid bearer token")
    }

    /// 403 + `code:"forbidden"` is "wrong account", NOT "signed out" — the UI
    /// must not offer a plain retry for it.
    func test403WithForbiddenCodeMapsToForbidden() {
        let error = ApiError.fromResponse(
            status: 403, body: ErrorBody(error: ApiError.forbiddenMessage, code: "forbidden")
        )
        guard case .forbidden = error else {
            return XCTFail("expected .forbidden, got \(error)")
        }
    }

    /// Older server builds omit `code`; the message alone must still classify.
    func test403WithoutCodeStillMapsToForbidden() {
        let error = ApiError.fromResponse(
            status: 403, body: ErrorBody(error: ApiError.forbiddenMessage, code: nil)
        )
        guard case .forbidden = error else {
            return XCTFail("expected .forbidden, got \(error)")
        }
    }

    func testProvisioningCodeWinsOverStatus() {
        let error = ApiError.fromResponse(
            status: 503, body: ErrorBody(error: "Account not provisioned yet", code: "provisioning")
        )
        guard case .provisioning = error else {
            return XCTFail("expected .provisioning, got \(error)")
        }
    }

    func test429MapsToRateLimited() {
        let error = ApiError.fromResponse(
            status: 429, body: ErrorBody(error: "Too many requests", code: nil)
        )
        guard case .rateLimited = error else {
            return XCTFail("expected .rateLimited, got \(error)")
        }
    }

    func testUnknownStatusFallsBackToServerError() {
        let error = ApiError.fromResponse(status: 500, body: nil)
        guard case .server(let status, let message) = error else {
            return XCTFail("expected .server, got \(error)")
        }
        XCTAssertEqual(status, 500)
        XCTAssertEqual(message, "Request failed (500)")
    }
}
