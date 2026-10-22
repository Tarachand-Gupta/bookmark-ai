import Foundation

extension ApiClient {
    /// The subject only scopes local progress. The server verifies every request.
    static func importSubject(_ token: String) -> String? {
        let pieces = token.split(separator: ".")
        guard pieces.count == 3 else { return nil }
        var encoded = String(pieces[1]).replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
        guard let data = Data(base64Encoded: encoded),
              let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let subject = body["sub"] as? String, !subject.isEmpty else { return nil }
        return subject
    }

    func importAccountIdentifier() async throws -> String {
        guard target.requiresAuth else { return "local" }
        guard let token = await tokenProvider?(false), let subject = Self.importSubject(token) else {
            throw ApiError.noToken
        }
        return subject
    }

    /// Capture the credential for this account once. Never replay a batch under a changed account.
    func bookmarkImportRequest(body: Data?, accountId: String, origin: String) async throws -> Data {
        guard target.baseURL.absoluteString == origin else {
            throw ApiError.network("The server changed. Reopen Import for the current server.")
        }
        let url = target.baseURL.appendingPathComponent("api/import/bookmarks")
        var request = URLRequest(url: url)
        request.httpMethod = body == nil ? "GET" : "POST"
        request.httpBody = body
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("macos", forHTTPHeaderField: "X-Bookmark-Client")
        if target.requiresAuth {
            guard let token = await tokenProvider?(false), Self.importSubject(token) == accountId else {
                throw ApiError.network("Your account changed. Reopen Import for the current account.")
            }
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        let (data, response) = try await session.data(for: request)
        guard target.baseURL.absoluteString == origin,
              try await importAccountIdentifier() == accountId else {
            throw ApiError.network("Your account or server changed. Reopen Import to continue.")
        }
        guard let http = response as? HTTPURLResponse else {
            throw ApiError.network("The server did not return an import receipt.")
        }
        guard (200..<300).contains(http.statusCode) else {
            if http.statusCode == 404 {
                throw ApiError.server(status: 404, message: "This server needs an update before it can import bookmarks.")
            }
            throw ApiError.fromResponse(status: http.statusCode, body: try? JSONDecoder().decode(ErrorBody.self, from: data))
        }
        return data
    }
}
