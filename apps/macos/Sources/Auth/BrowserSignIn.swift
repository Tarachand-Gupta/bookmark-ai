import CryptoKit
import Foundation
import Security

struct BrowserSignInStart: Decodable, Equatable, Sendable {
    let flowId: String
    let browserUrl: String
    let verificationCode: String
    let expiresAt: Double
    let expiresInSeconds: Double

    var browserURL: URL? { URL(string: browserUrl) }
    var expirationDate: Date { Date(timeIntervalSince1970: expiresAt / 1_000) }
}

enum BrowserSignInExchange: Equatable, Sendable {
    case pending(retryAfter: TimeInterval)
    case rateLimited(retryAfter: TimeInterval)
    case complete(ticket: String, expiresAt: Date)
    case nativeComplete(NativeHandoffSession)
}

enum BrowserSignInError: LocalizedError, Equatable {
    case invalidBrowserURL
    case invalidResponse
    case temporary(String)
    case terminal(String)

    var errorDescription: String? {
        switch self {
        case .invalidBrowserURL:
            "The sign-in service returned an unsafe browser address."
        case .invalidResponse:
            "The sign-in service returned an unreadable response."
        case .temporary(let message), .terminal(let message):
            message
        }
    }
}

enum BrowserSignInPKCE {
    static func generateVerifier() throws -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw BrowserSignInError.terminal("Couldn't prepare a secure sign-in request. Try again.")
        }
        return base64URL(Data(bytes))
    }

    static func challenge(for verifier: String) -> String {
        base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
    }

    static func base64URL(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

enum BrowserSignInURLValidator {
    /// The server may choose the path and query only within the selected auth
    /// origin. A response can never send the app to a lookalike host.
    static func validate(_ candidate: URL, flowId: String, origin: URL) -> Bool {
        guard candidate.scheme?.lowercased() == origin.scheme?.lowercased(),
              candidate.host?.lowercased() == origin.host?.lowercased(),
              candidate.port == origin.port,
              candidate.user == nil,
              candidate.password == nil,
              candidate.path == "/macos-auth",
              candidate.fragment == nil,
              origin.scheme?.lowercased() != "https" || candidate.scheme?.lowercased() == "https",
              let components = URLComponents(url: candidate, resolvingAgainstBaseURL: false),
              let items = components.queryItems,
              items.count == 1,
              items[0].name == "flow",
              items[0].value == flowId
        else { return false }
        return true
    }
}

enum BrowserSignInWireValidator {
    private static let opaqueCharacters = CharacterSet(charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
    private static let codeCharacters = CharacterSet(charactersIn: "ABCDEFGHJKLMNPQRSTUVWXYZ23456789")

    static func isOpaque43(_ value: String) -> Bool {
        value.utf8.count == 43 && value.unicodeScalars.allSatisfy { opaqueCharacters.contains($0) }
    }

    static func isVerificationCode(_ value: String) -> Bool {
        let parts = value.split(separator: "-", omittingEmptySubsequences: false)
        return parts.count == 2 && parts.allSatisfy { part in
            part.utf8.count == 4 && part.unicodeScalars.allSatisfy { codeCharacters.contains($0) }
        }
    }
}

enum BrowserSignInPollPolicy {
    static let initialDelay: TimeInterval = 2
    static let maximumDelay: TimeInterval = 5
    static let maximumLifetime: TimeInterval = 10 * 60

    static func backoff(afterRetry retry: Int) -> TimeInterval {
        min(maximumDelay, initialDelay * pow(1.25, Double(max(0, retry))))
    }
}

/// Cookie-free transport for the browser handoff. The browser owns its Clerk
/// cookies; these two JSON calls deliberately do not share any of them.
final class BrowserSignInClient {
    private static let maximumResponseBytes = 64 * 1_024
    var nativeCompletionCode: String?
    private(set) var nativeState: String?
    private var origin: URL
    private let session: URLSession
    private let nativeMode: Bool

    init(origin: URL, session: URLSession? = nil, nativeMode: Bool = SupabaseConfiguration.isSupabase) {
        self.origin = origin
        self.nativeMode = nativeMode
        if let session {
            self.session = session
        } else {
            let configuration = URLSessionConfiguration.ephemeral
            configuration.httpCookieStorage = nil
            configuration.httpShouldSetCookies = false
            configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
            configuration.urlCache = nil
            self.session = URLSession(
                configuration: configuration,
                delegate: BrowserSignInRedirectBlocker.shared,
                delegateQueue: nil
            )
        }
    }

    func updateOrigin(_ origin: URL) {
        self.origin = origin
    }

    func start(codeChallenge: String) async throws -> BrowserSignInStart {
        if nativeMode {
            struct Body: Encodable { let clientType = "macos"; let buildVariant: String?; let codeChallenge: String; let state: String }
            let state = try BrowserSignInPKCE.generateVerifier()
            let (data, response) = try await post(path: "/api/auth/native/start", body: Body(buildVariant: SupabaseConfiguration.isProduction ? "supabase-production" : nil, codeChallenge: codeChallenge, state: state))
            guard response.statusCode == 201 else { throw error(for: response, data: data, terminal502: true) }
            struct Start: Decodable { let flowId: String; let browserUrl: String; let expiresAt: Double; let state: String }
            guard let result = try? JSONDecoder().decode(Start.self, from: data), result.state == state else { throw BrowserSignInError.invalidResponse }
            nativeState = state
            nativeCompletionCode = nil
            return BrowserSignInStart(flowId: result.flowId, browserUrl: result.browserUrl, verificationCode: "AAAA-AAAA", expiresAt: result.expiresAt, expiresInSeconds: 300)
        }
        struct Body: Encodable { let codeChallenge: String }
        let (data, response) = try await post(path: "/api/macos-auth/start", body: Body(codeChallenge: codeChallenge))
        guard response.statusCode == 201 else {
            throw error(for: response, data: data, terminal502: true)
        }
        guard isJSON(response) else { throw BrowserSignInError.invalidResponse }
        guard let result = try? JSONDecoder().decode(BrowserSignInStart.self, from: data) else {
            throw BrowserSignInError.invalidResponse
        }
        return result
    }

    func exchange(flowId: String, verifier: String) async throws -> BrowserSignInExchange {
        if nativeMode, nativeCompletionCode == nil { return .pending(retryAfter: 1) }
        struct Body: Encodable { let flowId: String; let verifier: String; let completionCode: String? }
        let (data, response) = try await post(
            path: nativeMode ? "/api/auth/native/exchange" : "/api/macos-auth/exchange",
            body: Body(flowId: flowId, verifier: verifier, completionCode: nativeMode ? nativeCompletionCode : nil)
        )

        switch response.statusCode {
        case 200:
            guard isJSON(response) else { throw BrowserSignInError.invalidResponse }
            if nativeMode {
                struct Complete: Decodable { let status: String; let session: NativeHandoffSession }
                guard let body = try? JSONDecoder().decode(Complete.self, from: data), body.status == "complete" else { throw BrowserSignInError.invalidResponse }
                return .nativeComplete(body.session)
            }
            struct Complete: Decodable { let status: String; let ticket: String; let expiresAt: Double }
            guard let body = try? JSONDecoder().decode(Complete.self, from: data),
                  body.status == "complete", !body.ticket.isEmpty
            else { throw BrowserSignInError.invalidResponse }
            return .complete(
                ticket: body.ticket,
                expiresAt: Date(timeIntervalSince1970: body.expiresAt / 1_000)
            )
        case 202:
            guard isJSON(response) else { throw BrowserSignInError.invalidResponse }
            struct Pending: Decodable { let status: String; let retryAfterSeconds: Double? }
            guard let body = try? JSONDecoder().decode(Pending.self, from: data), body.status == "pending" else {
                throw BrowserSignInError.invalidResponse
            }
            return .pending(retryAfter: retryAfter(response, fallback: body.retryAfterSeconds ?? 2))
        case 429:
            return .rateLimited(retryAfter: retryAfter(response, fallback: 2))
        default:
            throw error(for: response, data: data, terminal502: true)
        }
    }

    func cancel(flowId: String, verifier: String) async {
        struct Body: Encodable { let flowId: String; let verifier: String }
        _ = try? await post(path: "/api/auth/native/cancel", body: Body(flowId: flowId, verifier: verifier))
    }

    private func post<Body: Encodable>(path: String, body: Body) async throws -> (Data, HTTPURLResponse) {
        guard origin.scheme == "https" || (origin.scheme == "http" && ["localhost", "127.0.0.1"].contains(origin.host ?? "")) else {
            throw BrowserSignInError.terminal("This server target cannot be used for sign-in.")
        }
        let url = origin.appendingPathComponent(String(path.dropFirst()))
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = try JSONEncoder().encode(body)
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        request.cachePolicy = .reloadIgnoringLocalCacheData

        do {
            let (bytes, response) = try await session.bytes(for: request)
            guard let http = response as? HTTPURLResponse else { throw BrowserSignInError.invalidResponse }
            guard http.url == request.url else { throw BrowserSignInError.invalidResponse }
            if http.expectedContentLength > Self.maximumResponseBytes {
                throw BrowserSignInError.invalidResponse
            }
            var data = Data()
            data.reserveCapacity(min(max(0, Int(http.expectedContentLength)), Self.maximumResponseBytes))
            for try await byte in bytes {
                guard data.count < Self.maximumResponseBytes else {
                    throw BrowserSignInError.invalidResponse
                }
                data.append(byte)
            }
            return (data, http)
        } catch let error as BrowserSignInError {
            throw error
        } catch is CancellationError {
            throw CancellationError()
        } catch {
            throw BrowserSignInError.temporary("The sign-in service couldn't be reached. Retrying…")
        }
    }

    private func retryAfter(_ response: HTTPURLResponse, fallback: TimeInterval) -> TimeInterval {
        guard let raw = response.value(forHTTPHeaderField: "Retry-After"),
              let seconds = TimeInterval(raw), seconds >= 0
        else { return max(0, fallback) }
        return seconds
    }

    private func isJSON(_ response: HTTPURLResponse) -> Bool {
        guard let contentType = response.value(forHTTPHeaderField: "Content-Type"),
              let rawMime = contentType.split(separator: ";", maxSplits: 1).first
        else { return false }
        return String(rawMime).trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "application/json"
    }

    private func error(for response: HTTPURLResponse, data: Data, terminal502: Bool) -> BrowserSignInError {
        struct ErrorBody: Decodable { let error: String? }
        let decoded = try? JSONDecoder().decode(ErrorBody.self, from: data)
        let serverMessage = isJSON(response) ? decoded?.error : nil
        let fallback: String
        switch response.statusCode {
        case 404: fallback = "This sign-in request is no longer valid."
        case 409: fallback = "This sign-in request was already used."
        case 410: fallback = "This sign-in request expired or was canceled in the browser."
        case 502: fallback = "The account was confirmed, but the secure handoff couldn't be created. Start a new sign-in request."
        default: fallback = "The sign-in service is temporarily unavailable."
        }
        let message = serverMessage?.isEmpty == false ? serverMessage! : fallback

        if response.statusCode == 503 || response.statusCode >= 500 && response.statusCode != 502 {
            return .temporary(message)
        }
        if response.statusCode == 502 && !terminal502 { return .temporary(message) }
        return .terminal(message)
    }
}

final class BrowserSignInRedirectBlocker: NSObject, URLSessionTaskDelegate {
    static let shared = BrowserSignInRedirectBlocker()

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        // These are fixed API routes on the already-canonical auth origin. A
        // redirect is a configuration or interception error; never forward the
        // verifier POST body to another URL.
        completionHandler(nil)
    }
}

struct NativeHandoffSession: Decodable, Equatable, Sendable {
    let access_token: String
    let refresh_token: String
    let user_id: String
    let session_id: String
    let expires_at: Double
}

enum NativeBrowserURLValidator {
    static func validate(_ url: URL, flowId: String, origin: URL) -> Bool {
        guard url.scheme == origin.scheme, url.host == origin.host, url.port == origin.port,
              url.user == nil, url.password == nil, url.fragment == nil, url.path == "/sign-in",
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems,
              items.count == 1, items[0].name == "next", let next = items[0].value,
              let destination = URL(string: next, relativeTo: origin)?.absoluteURL,
              destination.host == origin.host, destination.path == "/auth/native/complete",
              let values = URLComponents(url: destination, resolvingAgainstBaseURL: false)?.queryItems,
              values.count == 2, values.first(where: { $0.name == "flow" })?.value == flowId,
              let nonce = values.first(where: { $0.name == "browser_nonce" })?.value,
              BrowserSignInWireValidator.isOpaque43(nonce) else { return false }
        return true
    }
}
