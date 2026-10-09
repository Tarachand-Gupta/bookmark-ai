import Auth
import Foundation
import XCTest
@testable import BookmarkAI

final class SupabaseNativeAuthTests: XCTestCase {
    final class MemoryStorage: AuthLocalStorage, @unchecked Sendable {
        private let lock = NSLock()
        private var values: [String: Data] = [:]
        func store(key: String, value: Data) throws { lock.lock(); defer { lock.unlock() }; values[key] = value }
        func retrieve(key: String) throws -> Data? { lock.lock(); defer { lock.unlock() }; return values[key] }
        func remove(key: String) throws { lock.lock(); defer { lock.unlock() }; values.removeValue(forKey: key) }
    }
    static let info: [String: Any] = ["BOOKMARK_BUILD_VARIANT": "supabase-qa", "SUPABASE_URL": "https://xogqaqtyacmecdbmgqqd.supabase.co", "SUPABASE_PUBLISHABLE_KEY": "sb_publishable_test", "BOOKMARK_API_URL": "http://localhost:3100", "BOOKMARK_LIVE_URL": "http://localhost:3101", "BOOKMARK_AUTH_STORAGE_NAMESPACE": "bookmark-ai:supabase-qa", "BOOKMARK_AUTH_CALLBACK_SCHEME": "bookmarkai-macos-supabase-qa"]
    static let userJSON = """
    {"id":"fcaa51f1-e2e9-4b90-8ea5-313b7b62b6aa","aud":"authenticated","role":"authenticated","email":"qa@example.test","app_metadata":{},"user_metadata":{},"created_at":"2026-10-04T00:00:00Z","updated_at":"2026-10-04T00:00:00Z","identities":[]}
    """
    static func token(expiration: Date, aal: String = "aal1") -> String {
        let body = try! JSONSerialization.data(withJSONObject: ["exp": Int(expiration.timeIntervalSince1970), "sub": "fcaa51f1-e2e9-4b90-8ea5-313b7b62b6aa", "aal": aal, "session_id": "00000000-0000-4000-8000-000000000002"])
        return "e30." + body.base64EncodedString().replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "") + ".test-signature"
    }
    static func sessionJSON(expiration: Date) -> Data {
        Data("{\"access_token\":\"\(token(expiration: expiration))\",\"refresh_token\":\"fake-refresh\",\"expires_in\":3600,\"expires_at\":\(Int(expiration.timeIntervalSince1970)),\"token_type\":\"bearer\",\"user\":\(userJSON)}".utf8)
    }
    static func storedSessionJSON(expiration: Date) throws -> Data {
        let user = User(id: UUID(uuidString: "fcaa51f1-e2e9-4b90-8ea5-313b7b62b6aa")!, appMetadata: [:], userMetadata: [:], aud: "authenticated", email: "qa@example.test", createdAt: Date(), updatedAt: Date())
        return try JSONEncoder().encode(Session(accessToken: token(expiration: expiration), tokenType: "bearer", expiresIn: 3600, expiresAt: expiration.timeIntervalSince1970, refreshToken: "fake-refresh", user: user))
    }
    static func response(_ request: URLRequest, status: Int, body: Data) -> (Data, URLResponse) {
        (body, HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!)
    }

    func testConfigurationCannotFallBackToProductionOrShareKeychain() {
        XCTAssertNotNil(SupabaseConfiguration.parse(Self.info))
        for (key, bad) in [("BOOKMARK_API_URL", "https://www.bookmark-ai.cloud"), ("BOOKMARK_LIVE_URL", "https://live.bookmark-ai.cloud"), ("SUPABASE_URL", "https://other.supabase.co"), ("BOOKMARK_AUTH_STORAGE_NAMESPACE", "supabase.gotrue.swift"), ("SUPABASE_PUBLISHABLE_KEY", "")] {
            var info = Self.info; info[key] = bad; XCTAssertNil(SupabaseConfiguration.parse(info), key)
        }
    }
    func testHostedTargetRequiresExplicitMarkerAndExactCanonicalOrigins() {
        var info = Self.info
        info["BOOKMARK_HOSTED_TARGET"] = "production"
        info["BOOKMARK_API_URL"] = "https://www.bookmark-ai.cloud"
        info["BOOKMARK_LIVE_URL"] = "https://live.bookmark-ai.cloud"
        XCTAssertNotNil(SupabaseConfiguration.parse(info))
        for bad in ["https://bookmark-ai.cloud", "http://www.bookmark-ai.cloud", "https://www.bookmark-ai.cloud.evil.invalid", "https://evil.bookmark-ai.cloud", "https://www.bookmark-ai.cloud/api"] {
            var changed = info; changed["BOOKMARK_API_URL"] = bad; XCTAssertNil(SupabaseConfiguration.parse(changed))
        }
        info.removeValue(forKey: "BOOKMARK_HOSTED_TARGET"); XCTAssertNil(SupabaseConfiguration.parse(info))
    }
    func testCallbackRequiresExactSchemeHostAndPath() {
        let config = SupabaseConfiguration.parse(Self.info)!
        XCTAssertTrue(config.acceptsCallback(URL(string: "bookmarkai-macos-supabase-qa://auth/callback?code=one-use")!))
        for value in ["bookmarkai://auth/callback", "bookmarkai-macos-supabase-qa://evil/callback", "bookmarkai-macos-supabase-qa://auth/other"] { XCTAssertFalse(config.acceptsCallback(URL(string: value)!)) }
    }
    func testProductionConfigurationUsesExactOriginsAndSeparateStorageAndCallback() {
        var info = Self.info
        info["BOOKMARK_BUILD_VARIANT"] = "supabase-production"
        info["BOOKMARK_HOSTED_TARGET"] = "production"
        info["BOOKMARK_API_URL"] = "https://www.bookmark-ai.cloud"
        info["BOOKMARK_LIVE_URL"] = "https://live.bookmark-ai.cloud"
        info["BOOKMARK_AUTH_STORAGE_NAMESPACE"] = "bookmark-ai:supabase-production"
        info["BOOKMARK_AUTH_CALLBACK_SCHEME"] = "bookmarkai-macos"
        let config = SupabaseConfiguration.parse(info)
        XCTAssertNotNil(config)
        XCTAssertTrue(config!.acceptsCallback(URL(string: "bookmarkai-macos://auth/callback?code=one-use")!))
        XCTAssertFalse(config!.acceptsCallback(URL(string: "bookmarkai-macos-supabase-qa://auth/callback")!))
        for (key, value) in [("BOOKMARK_HOSTED_TARGET", ""), ("BOOKMARK_API_URL", "http://localhost:3100"), ("BOOKMARK_AUTH_STORAGE_NAMESPACE", "bookmark-ai:supabase-qa"), ("BOOKMARK_AUTH_CALLBACK_SCHEME", "bookmarkai-macos-supabase-qa")] {
            var invalid = info; invalid[key] = value; XCTAssertNil(SupabaseConfiguration.parse(invalid))
        }
    }
    @MainActor func testSDKRefreshesPersistedSessionAfterSimulated21DayAbsence() async throws {
        let storage = MemoryStorage()
        let config = SupabaseConfiguration.parse(Self.info)!
        let expired = Date().addingTimeInterval(-21 * 86400)
        try storage.store(key: config.namespace + ":session", value: Self.storedSessionJSON(expiration: expired))
        let refreshed = Self.sessionJSON(expiration: Date().addingTimeInterval(3600))
        let native = SupabaseNativeAuth(configuration: config, storage: storage, fetch: { request in
            if request.url!.path.hasSuffix("/token") {
                XCTAssertEqual(request.url!.query, "grant_type=refresh_token")
                return Self.response(request, status: 200, body: refreshed)
            }
            return Self.response(request, status: 200, body: Data(Self.userJSON.utf8))
        }, autoRefresh: false)
        guard case .token = await native.mint(fresh: false) else { return XCTFail("SDK must refresh an expired persisted session") }
        let session = try await native.client.session
        XCTAssertFalse(session.isExpired)
        XCTAssertNotNil(try storage.retrieve(key: config.namespace + ":session"))
    }
    @MainActor func testNewLiveMFAFactorBlocksCachedFactorFreeSession() async throws {
        let storage = MemoryStorage(); let config = SupabaseConfiguration.parse(Self.info)!
        try storage.store(key: config.namespace + ":session", value: Self.storedSessionJSON(expiration: Date().addingTimeInterval(3600)))
        let body = Self.userJSON.dropLast() + ",\"factors\":[{\"id\":\"00000000-0000-4000-8000-000000000004\",\"status\":\"verified\",\"factor_type\":\"totp\",\"created_at\":\"2026-10-04T00:00:00Z\",\"updated_at\":\"2026-10-04T00:00:00Z\"}]}"
        let native = SupabaseNativeAuth(configuration: config, storage: storage, fetch: { request in
            Self.response(request, status: 200, body: Data(body.utf8))
        }, autoRefresh: false)
        let outcome = await native.mint(fresh: false)
        XCTAssertEqual(outcome, .unavailable)
        XCTAssertTrue(native.needsBrowserVerification)
    }
    @MainActor func testAAL2HandoffImportsProviderSessionAndMismatchNeverPublishes() async throws {
        let config = SupabaseConfiguration.parse(Self.info)!
        let native = SupabaseNativeAuth(configuration: config, storage: MemoryStorage(), fetch: { request in
            Self.response(request, status: 200, body: Data(Self.userJSON.utf8))
        }, autoRefresh: false)
        let expiry = Date().addingTimeInterval(3600)
        let payload = NativeHandoffSession(access_token: Self.token(expiration: expiry, aal: "aal2"), refresh_token: "native-refresh", user_id: "fcaa51f1-e2e9-4b90-8ea5-313b7b62b6aa", session_id: "00000000-0000-4000-8000-000000000002", expires_at: expiry.timeIntervalSince1970)
        try await native.importHandoff(payload)
        XCTAssertEqual(native.client.currentSession?.refreshToken, "native-refresh")
        let outcome = await native.mint(fresh: false)
        guard case .token = outcome else { return XCTFail("Provider-confirmed AAL2 must be admitted") }
        let wrong = NativeHandoffSession(access_token: payload.access_token, refresh_token: "other", user_id: "00000000-0000-4000-8000-000000000009", session_id: payload.session_id, expires_at: payload.expires_at)
        do { try await native.importHandoff(wrong); XCTFail("Identity swap must fail before SDK import") } catch {}
        XCTAssertEqual(native.client.currentSession?.refreshToken, "native-refresh")
        await native.clearHandoffSession(wrong)
        XCTAssertNotNil(native.client.currentSession)
    }
    @MainActor func testOnlineOutagePreservesSDKCredentials() async throws {
        let storage = MemoryStorage(); let config = SupabaseConfiguration.parse(Self.info)!
        try storage.store(key: config.namespace + ":session", value: Self.storedSessionJSON(expiration: Date().addingTimeInterval(3600)))
        let native = SupabaseNativeAuth(configuration: config, storage: storage, fetch: { request in
            Self.response(request, status: 503, body: Data("{\"msg\":\"Temporary outage\"}".utf8))
        }, autoRefresh: false)
        let outcome = await native.mint(fresh: false)
        XCTAssertEqual(outcome, .unavailable)
        XCTAssertNotNil(native.client.currentSession)
        XCTAssertNotNil(try storage.retrieve(key: config.namespace + ":session"))
    }
    @MainActor func testRetainedUnexpiredJWTRejectedAfterNativeRevoke() async throws {
        let storage = MemoryStorage(); let config = SupabaseConfiguration.parse(Self.info)!
        try storage.store(key: config.namespace + ":session", value: Self.storedSessionJSON(expiration: Date().addingTimeInterval(3600)))
        let native = SupabaseNativeAuth(configuration: config, storage: storage, fetch: { request in
            Self.response(request, status: 401, body: Data("{\"code\":\"session_not_found\",\"msg\":\"Session not found\"}".utf8))
        }, autoRefresh: false)
        let outcome = await native.mint(fresh: false)
        XCTAssertEqual(outcome, .noSession)
        await native.clearLocalSession()
        XCTAssertNil(native.client.currentSession)
        XCTAssertNil(try storage.retrieve(key: config.namespace + ":session"))
    }
    @MainActor func testOnlyDefinitiveProviderErrorsSignOut() {
        XCTAssertFalse(SupabaseNativeAuth.isDefinitive(URLError(.notConnectedToInternet)))
        XCTAssertTrue(SupabaseNativeAuth.isDefinitive(AuthError.sessionMissing))
        XCTAssertFalse(SupabaseNativeAuth.isDefinitive(AuthError.refreshDiscarded))
    }
    @MainActor func testDeviceMetadataHasNoBearerAndMutationUsesAuthorizationHeader() async throws {
        let transport = ApiClientAuthTests.StubURLProtocol.self
        transport.requests = []
        transport.handler = { _ in (204, Data()) }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [transport]
        let api = ApiClient(target: .cloud, session: URLSession(configuration: configuration))
        api.tokenProvider = { _ in "fake-jwt" }
        try await api.registerCurrentSession()
        try await api.signOutSessions(scope: "others")
        XCTAssertEqual(transport.requests.count, 2)
        XCTAssertEqual(transport.requests[0].value(forHTTPHeaderField: "Authorization"), "Bearer fake-jwt")
        let body: Data
        if let data = transport.requests[0].httpBody { body = data }
        else if let stream = transport.requests[0].httpBodyStream {
            stream.open(); defer { stream.close() }
            var data = Data(); var bytes = [UInt8](repeating: 0, count: 2048)
            while stream.hasBytesAvailable { let count = stream.read(&bytes, maxLength: bytes.count); if count <= 0 { break }; data.append(contentsOf: bytes.prefix(count)) }
            body = data
        } else { return XCTFail("metadata request body missing") }
        let metadata = try JSONSerialization.jsonObject(with: body) as! [String: String]
        XCTAssertEqual(metadata["clientType"], "macos")
        XCTAssertNil(metadata["accessToken"])
        XCTAssertFalse(String(data: body, encoding: .utf8)!.contains("fake-jwt"))
        XCTAssertEqual(transport.requests[1].url?.path, "/api/auth/sessions/sign-out")
        do { try await api.revokeNativeSession("../account"); XCTFail("invalid native ID must not become a route") }
        catch { XCTAssertEqual(error as? ApiError, .invalidURL) }
        XCTAssertEqual(transport.requests.count, 2)
    }
}
