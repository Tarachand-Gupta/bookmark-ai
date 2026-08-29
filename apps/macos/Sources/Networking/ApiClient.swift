import Foundation

/// Mints a Clerk session JWT. `forceRefresh` bypasses any cached token — used by
/// the single 401 retry, so a token that expired mid-flight recovers silently.
/// Stored in `ApiClient`, which is `@MainActor`, so the closure is main-isolated.
typealias TokenProvider = (_ forceRefresh: Bool) async -> String?

/// The whole HTTP surface this app uses, over `async`/`await` URLSession.
///
/// One implementation serves both targets — the Next route handlers are the same
/// code locally and on Vercel (see root CLAUDE.md), so only the base URL and the
/// `Authorization` header differ.
@MainActor
final class ApiClient {
    /// Which backend to talk to. Changing it takes effect on the next request.
    var target: ServerTarget

    /// Supplied by `AuthController`. Only consulted when `target.requiresAuth`.
    var tokenProvider: TokenProvider?

    /// Internal (not private) so the chat-stream extension can open SSE byte
    /// streams over the same configured session.
    let session: URLSession

    init(target: ServerTarget = .local, session: URLSession? = nil) {
        self.target = target
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.default
            configuration.timeoutIntervalForRequest = 20
            configuration.waitsForConnectivity = false
            // The API is the source of truth; a stale cached list is worse than
            // a spinner, and every response is small.
            configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
            self.session = URLSession(configuration: configuration)
        }
    }

    // MARK: - Routes

    /// `GET /api/bookmarks`. `limit` is clamped to the server's max of 200.
    func listBookmarks(
        category: String? = nil,
        tag: String? = nil,
        day: String? = nil,
        browser: String? = nil,
        device: String? = nil,
        limit: Int = 100,
        offset: Int = 0
    ) async throws -> ListBookmarksResponse {
        var items = [
            URLQueryItem(name: "limit", value: String(min(max(limit, 1), Self.maxBookmarksLimit))),
            URLQueryItem(name: "offset", value: String(max(offset, 0))),
        ]
        if let category, !category.isEmpty { items.append(URLQueryItem(name: "category", value: category)) }
        if let tag, !tag.isEmpty { items.append(URLQueryItem(name: "tag", value: tag)) }
        if let day, !day.isEmpty { items.append(URLQueryItem(name: "day", value: day)) }
        if let browser, !browser.isEmpty { items.append(URLQueryItem(name: "browser", value: browser)) }
        if let device, !device.isEmpty { items.append(URLQueryItem(name: "device", value: device)) }
        return try await get("/api/bookmarks", query: items)
    }

    /// `GET /api/meta` — the sidebar's facets and counts.
    func meta() async throws -> MetaResponse {
        try await get("/api/meta")
    }

    /// `GET /api/search`. `limit` is clamped to the server's max of 50; hybrid
    /// blends the full-text and vector rankings with RRF.
    func search(
        query: String,
        mode: SearchMode = .hybrid,
        limit: Int = 40
    ) async throws -> SearchResponse {
        try await get("/api/search", query: [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "mode", value: mode.rawValue),
            URLQueryItem(name: "limit", value: String(min(max(limit, 1), Self.maxSearchLimit))),
        ])
    }

    /// `GET /api/me` — the account row in the sidebar footer.
    func me() async throws -> AccountInfo {
        try await get("/api/me")
    }

    /// `GET /api/health` — public liveness + whether AI is configured.
    func health() async throws -> HealthResponse {
        try await get("/api/health")
    }

    /// `DELETE /api/bookmarks/:id` → 204.
    func deleteBookmark(id: String) async throws {
        let path = "/api/bookmarks/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)"
        _ = try await send(path: path, method: "DELETE", query: [], allowRetry: true)
    }

    /// `GET /api/sessions` — saved tab snapshots, newest first.
    func listSessions() async throws -> ListSessionsResponse {
        try await get("/api/sessions")
    }

    /// `DELETE /api/sessions/:id` → 204.
    func deleteSession(id: String) async throws {
        let path = "/api/sessions/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)"
        _ = try await send(path: path, method: "DELETE", query: [], allowRetry: true)
    }

    /// `GET /api/chat/conversations` — chat history, newest updated first.
    func listConversations() async throws -> ChatConversationsResponse {
        try await get("/api/chat/conversations")
    }

    /// `GET /api/chat/conversations/:id` — one conversation's stored transcript.
    /// The parts come back exactly as the server persisted them (tool calls,
    /// provider metadata), which is what the next turn must re-send.
    func conversation(id: String) async throws -> ChatConversationDetailResponse {
        let path = "/api/chat/conversations/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)"
        return try await get(path)
    }

    /// `DELETE /api/chat/conversations/:id` → 204.
    func deleteConversation(id: String) async throws {
        let path = "/api/chat/conversations/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)"
        _ = try await send(path: path, method: "DELETE", query: [], allowRetry: true)
    }

    /// `GET /api/settings` — provider config, live-server override, AI meter.
    func settings() async throws -> SettingsResponse {
        try await get("/api/settings")
    }

    /// `PUT /api/settings` — absent = keep, `""` = clear (apiKey/liveServerUrl).
    /// Returns the updated settings, same envelope as the GET.
    func updateSettings(_ body: UpdateSettingsBody) async throws -> SettingsResponse {
        let data = try await send(
            path: "/api/settings", method: "PUT", query: [],
            body: try JSONEncoder().encode(body), allowRetry: true
        )
        do {
            return try Self.decoder.decode(SettingsResponse.self, from: data)
        } catch {
            throw ApiError.decoding(String(describing: error))
        }
    }

    /// `PATCH /api/sessions/:id` — rename; the embedding re-runs server-side.
    func renameSession(id: String, name: String) async throws -> Session {
        let path = "/api/sessions/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)"
        struct Body: Encodable { let name: String }
        let data = try await send(
            path: path, method: "PATCH", query: [],
            body: try JSONEncoder().encode(Body(name: name)), allowRetry: true
        )
        return try Self.decoder.decode(SessionEnvelope.self, from: data).session
    }

    /// `POST /api/sessions/:id/ai-name` — AI retitle + fresh description.
    func summarizeSession(id: String) async throws -> Session {
        let path = "/api/sessions/\(id.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? id)/ai-name"
        let data = try await send(path: path, method: "POST", query: [], allowRetry: true)
        return try Self.decoder.decode(SessionEnvelope.self, from: data).session
    }

    /// `POST /api/settings/ai/models` — list a provider's models, validating the
    /// key as a side effect. Omit `apiKey` to check against the stored one.
    func listModels(provider: String, apiKey: String?, baseUrl: String?) async throws -> [AiModel] {
        struct Body: Encodable {
            let provider: String
            let apiKey: String?
            let baseUrl: String?
        }
        let payload = Body(
            provider: provider,
            apiKey: (apiKey?.isEmpty ?? true) ? nil : apiKey,
            baseUrl: (baseUrl?.isEmpty ?? true) ? nil : baseUrl
        )
        let data = try await send(
            path: "/api/settings/ai/models", method: "POST", query: [],
            body: try JSONEncoder().encode(payload), allowRetry: true
        )
        return try Self.decoder.decode(ListModelsResponse.self, from: data).models
    }

    /// `GET /api/export` — the full lossless bundle, returned raw so the caller
    /// can write it to the file the user picked without a decode/re-encode trip.
    func exportData() async throws -> Data {
        try await send(path: "/api/export", method: "GET", query: [], allowRetry: true)
    }

    /// `POST /api/import` — a bundle previously produced by export. The server
    /// validates/upgrades it; re-importing the same file is a safe no-op.
    func importData(_ bundle: Data) async throws {
        _ = try await send(path: "/api/import", method: "POST", query: [], body: bundle, allowRetry: true)
    }

    // MARK: - Limits (server-enforced; mirrored here so the UI never over-asks)

    /// `listBookmarksQuerySchema.limit` max in `packages/types`.
    static let maxBookmarksLimit = 200
    /// `searchQuerySchema.limit` max in `packages/types`.
    static let maxSearchLimit = 50

    // MARK: - Request plumbing

    private func get<T: Decodable>(_ path: String, query: [URLQueryItem] = []) async throws -> T {
        let data = try await send(path: path, method: "GET", query: query, allowRetry: true)
        do {
            return try Self.decoder.decode(T.self, from: data)
        } catch {
            throw ApiError.decoding(String(describing: error))
        }
    }

    /// Performs the request, injecting auth for cloud. On a 401 it force-refreshes
    /// the token and replays the request EXACTLY once — a Clerk session JWT has a
    /// ~60s TTL, so a token can legitimately expire between mint and arrival.
    private func send(
        path: String,
        method: String,
        query: [URLQueryItem],
        body: Data? = nil,
        allowRetry: Bool
    ) async throws -> Data {
        guard let url = Self.makeURL(base: target.baseURL, path: path, query: query) else {
            throw ApiError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        if target.requiresAuth, let tokenProvider {
            if let token = await tokenProvider(!allowRetry) {
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
        }

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch let error as URLError {
            throw ApiError.network(Self.describe(error))
        } catch {
            throw ApiError.network(error.localizedDescription)
        }

        guard let http = response as? HTTPURLResponse else {
            throw ApiError.network("The server sent a response the app couldn't interpret.")
        }

        if http.statusCode == 204 { return Data() }
        if (200..<300).contains(http.statusCode) { return data }

        let errorBody = try? Self.decoder.decode(ErrorBody.self, from: data)
        let apiError = ApiError.fromResponse(status: http.statusCode, body: errorBody)

        // Single retry on 401, with a forced token re-mint. `allowRetry` is the
        // recursion guard — the replay passes false, so it can never loop.
        if case .unauthorized = apiError, allowRetry, target.requiresAuth, tokenProvider != nil {
            return try await send(path: path, method: method, query: query, body: body, allowRetry: false)
        }
        throw apiError
    }

    /// Pure URL construction — extracted so it can be unit-tested without a server.
    /// Percent-encoding of query values is `URLComponents`' job; the path is
    /// appended verbatim because callers pre-encode any interpolated id.
    nonisolated static func makeURL(base: URL, path: String, query: [URLQueryItem]) -> URL? {
        guard var components = URLComponents(url: base, resolvingAgainstBaseURL: false) else {
            return nil
        }
        components.path = path
        components.queryItems = query.isEmpty ? nil : query
        return components.url
    }

    /// A JSONDecoder configured for this API. Dates stay as `String` in the models
    /// (the API mixes fractional-second and plain ISO 8601), so no date strategy.
    nonisolated static let decoder = JSONDecoder()

    /// Turn URLSession's failure codes into something a person can act on.
    nonisolated static func describe(_ error: URLError) -> String {
        switch error.code {
        case .cannotConnectToHost, .cannotFindHost:
            "Couldn't reach the server. Is the dev server running on :3000?"
        case .notConnectedToInternet:
            "No internet connection."
        case .timedOut:
            "The server took too long to respond."
        case .cancelled:
            "The request was cancelled."
        default:
            error.localizedDescription
        }
    }
}
