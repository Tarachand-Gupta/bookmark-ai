import Foundation

extension ApiClient {
    /// Capture credentials and destination before suspension. A retry cannot adopt
    /// another account or origin. The server remains the authority for ownership.
    func organizationRequest<T: Decodable>(_ path: String, method: String = "GET", body: [String: JSONValue]? = nil, scope: OrganizationScope) async throws -> T {
        guard target.baseURL.absoluteString == scope.origin else { throw ApiError.network("The server changed. Reopen this action for the current account.") }
        let requiresAuth = target.requiresAuth
        let token = requiresAuth ? await tokenProvider?(false) : nil
        guard target.baseURL.absoluteString == scope.origin else { throw ApiError.noToken }
        if requiresAuth {
            guard let token, Self.importSubject(token) == scope.accountId else { throw ApiError.noToken }
        }
        guard let url = URL(string: scope.origin)?.appendingPathComponent(path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))) else { throw ApiError.invalidURL }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("macos", forHTTPHeaderField: "X-Bookmark-Client")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { request.httpBody = try JSONEncoder().encode(body); request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        let (data, response) = try await session.data(for: request)
        guard target.baseURL.absoluteString == scope.origin else { throw ApiError.noToken }
        if requiresAuth {
            guard let current = await tokenProvider?(false), Self.importSubject(current) == scope.accountId else { throw ApiError.noToken }
        }
        guard let response = response as? HTTPURLResponse else { throw ApiError.network("The server response was incomplete.") }
        guard (200..<300).contains(response.statusCode) else {
            throw ApiError.fromResponse(status: response.statusCode, body: try? Self.decoder.decode(ErrorBody.self, from: data))
        }
        return try decode(T.self, from: data)
    }
}
