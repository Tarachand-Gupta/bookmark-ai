import Foundation

/// Typed API failures, mirroring the server's error contract in
/// `apps/web/lib/server/require-user.ts` and the mobile client's `errorFromBody`.
enum ApiError: LocalizedError, Equatable {
    /// 401 — no/expired session. Drives the auth-refresh + single-retry path.
    case unauthorized(String)
    /// 403 `{code:"forbidden"}` — authenticated, but not on the API's allowlist.
    /// A DIFFERENT failure from "signed out": the fix is a different account.
    case forbidden(String)
    /// 503 `{code:"provisioning"}` — a brand-new tenant's DB is still being made.
    case provisioning(String)
    /// 429 — the server's sliding-window rate limit (120 req / 60s per IP).
    case rateLimited(String)
    case server(status: Int, message: String)
    case network(String)
    case decoding(String)
    case invalidURL
    /// Cloud target, but no session token could be minted for this request
    /// (Clerk unreachable, or no session). Raised BEFORE any network call —
    /// see `ApiClient.send`. Never a sign-out signal.
    case noToken

    var errorDescription: String? {
        switch self {
        case .unauthorized(let message): message
        case .forbidden(let message): message
        case .provisioning(let message): message
        case .rateLimited(let message): message
        case .server(_, let message): message
        case .network(let message): message
        case .decoding(let message): "Couldn't read the server's response. \(message)"
        case .invalidURL: "Couldn't build a valid request URL."
        case .noToken: "Couldn't confirm your session with bookmark-ai.cloud."
        }
    }

    /// What the UI should suggest doing about it.
    var recoveryHint: String? {
        switch self {
        case .unauthorized: "Sign in from Settings to reach the cloud library."
        case .forbidden: "This account doesn't have access. Try signing in as a different user."
        case .provisioning: "Your account is still being set up — this usually takes a few seconds."
        case .rateLimited: "Too many requests. Wait a moment and try again."
        case .network: "Check that the server is reachable, then refresh."
        case .noToken: "Check your connection — the app keeps retrying in the background."
        default: nil
        }
    }

    /// The exact 403 body the server emits for an allowlist rejection — the
    /// message fallback for older server builds that omit `code`.
    static let forbiddenMessage = "This account may not use this API"

    /// Map a failed response's status + parsed body onto the right case.
    /// Kept static and pure so it is directly unit-testable.
    static func fromResponse(status: Int, body: ErrorBody?) -> ApiError {
        let message = body?.error ?? "Request failed (\(status))"
        if body?.code == "provisioning" { return .provisioning(message) }
        if status == 401 { return .unauthorized(message) }
        if status == 403, body?.code == "forbidden" || body?.error == forbiddenMessage {
            return .forbidden(message)
        }
        if status == 429 { return .rateLimited(message) }
        return .server(status: status, message: message)
    }
}

/// The JSON error envelope every route handler emits: `{error, code?}`.
struct ErrorBody: Codable, Sendable, Equatable {
    var error: String?
    var code: String?
}
