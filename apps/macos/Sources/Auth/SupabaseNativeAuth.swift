import AppKit
import AuthenticationServices
import Auth
import CryptoKit
import Foundation

/// The provider owns refresh rotation and persistence. No app bearer store or timer.
@MainActor
final class SupabaseNativeAuth: NSObject, ASWebAuthenticationPresentationContextProviding, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
    let client: AuthClient
    let configuration: SupabaseConfiguration
    private(set) var needsBrowserVerification = false
    private var webSession: ASWebAuthenticationSession?
    private var appleController: ASAuthorizationController?
    private var appleContinuation: CheckedContinuation<ASAuthorizationAppleIDCredential, Error>?
    private var appleNonce: String?

    init(configuration: SupabaseConfiguration, storage: (any AuthLocalStorage)? = nil, fetch: AuthClient.FetchHandler? = nil, autoRefresh: Bool = true) {
        self.configuration = configuration
        client = AuthClient(configuration: .init(
            url: configuration.url.appendingPathComponent("auth/v1"),
            headers: ["apikey": configuration.publishableKey], flowType: .pkce,
            redirectToURL: configuration.callbackURL, storageKey: configuration.namespace + ":session",
            localStorage: storage ?? KeychainLocalStorage(service: configuration.namespace),
            fetch: fetch ?? Self.uncachedFetch, autoRefreshToken: autoRefresh
        ))
        super.init()
    }

    nonisolated private static let uncachedFetch: AuthClient.FetchHandler = { request in
        var request = request
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        let configuration = URLSessionConfiguration.ephemeral
        configuration.urlCache = nil
        let session = URLSession(configuration: configuration)
        defer { session.finishTasksAndInvalidate() }
        return try await session.data(for: request)
    }

    static func isDefinitive(_ error: Error) -> Bool {
        guard let error = error as? AuthError else { return false }
        if error == .sessionMissing { return true }
        if case let .api(_, code, _, response) = error {
            return [ErrorCode.sessionNotFound, .refreshTokenNotFound, .refreshTokenAlreadyUsed, .badJWT].contains(code) || response.statusCode == 401
        }
        return false
    }

    func mint(fresh: Bool) async -> MintOutcome {
        needsBrowserVerification = false
        let snapshot = client.currentSession?.refreshToken
        do {
            let session = try await (fresh ? client.refreshSession() : client.session)
            // Locally held tokens never imply a live provider session.
            let user = try await client.user(jwt: session.accessToken)
            guard user.id == session.user.id, let aal = Self.claims(session.accessToken)?["aal"] as? String,
                  ["aal1", "aal2"].contains(aal) else { return .unavailable }
            needsBrowserVerification = user.factors?.contains(where: { $0.status == .verified }) == true && aal != "aal2"
            guard !needsBrowserVerification else { return .unavailable }
            return .token(session.accessToken)
        } catch {
            guard Self.isDefinitive(error) else { return .unavailable }
            guard client.currentSession?.refreshToken == snapshot else { return .unavailable }
            await clearLocalSession()
            return .noSession
        }
    }

    func revokeHandoff(_ value: NativeHandoffSession) async {
        var parts = URLComponents(url: configuration.url.appendingPathComponent("auth/v1/logout"), resolvingAgainstBaseURL: false)!
        parts.queryItems = [URLQueryItem(name: "scope", value: "local")]
        var request = URLRequest(url: parts.url!)
        request.httpMethod = "POST"; request.setValue("Bearer " + value.access_token, forHTTPHeaderField: "Authorization")
        request.setValue(configuration.publishableKey, forHTTPHeaderField: "apikey")
        _ = try? await Self.uncachedFetch(request)
    }

    func importHandoff(_ value: NativeHandoffSession) async throws {
        guard value.expires_at > Date().timeIntervalSince1970,
              UUID(uuidString: value.user_id) != nil, UUID(uuidString: value.session_id) != nil,
              !value.access_token.isEmpty, !value.refresh_token.isEmpty else { throw NativeAuthError.invalidCallback }
        let user = try await client.user(jwt: value.access_token)
        guard user.id.uuidString.lowercased() == value.user_id.lowercased(),
              Self.sessionID(value.access_token) == value.session_id,
              let aal = Self.claims(value.access_token)?["aal"] as? String,
              ["aal1", "aal2"].contains(aal),
              user.factors?.contains(where: { $0.status == .verified }) != true || aal == "aal2" else { throw NativeAuthError.invalidCallback }
        let session = try await client.setSession(accessToken: value.access_token, refreshToken: value.refresh_token)
        guard session.user.id.uuidString.lowercased() == value.user_id.lowercased(),
              Self.sessionID(session.accessToken) == value.session_id else { await clearHandoffSession(value); throw NativeAuthError.invalidCallback }
    }
    static func sessionID(_ token: String) -> String? { claims(token)?["session_id"] as? String }
    private static func claims(_ token: String) -> [String: Any]? {
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { return nil }
        var body = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        body += String(repeating: "=", count: (4 - body.count % 4) % 4)
        guard let data = Data(base64Encoded: body), let claims = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return claims
    }

    func clearHandoffSession(_ value: NativeHandoffSession) async {
        guard let current = client.currentSession,
              current.user.id.uuidString.lowercased() == value.user_id.lowercased(),
              Self.sessionID(current.accessToken) == value.session_id else { return }
        await clearLocalSession()
    }

    func clearLocalSession() async { try? await client.signOut(scope: .local) }

    func signIn(email: String, password: String) async throws {
        _ = try await client.signIn(email: email, password: password)
    }
    func signUp(email: String, password: String) async throws -> Bool {
        try await client.signUp(email: email, password: password, redirectTo: configuration.callbackURL).session != nil
    }
    func recover(email: String) async throws {
        try await client.resetPasswordForEmail(email, redirectTo: configuration.callbackURL)
    }
    func updatePassword(_ password: String) async throws { _ = try await client.update(user: .init(password: password)) }
    func updateEmail(_ email: String) async throws { _ = try await client.update(user: .init(email: email), redirectTo: configuration.callbackURL) }
    func verifyMFA(code: String) async throws {
        let factors = try await client.mfa.listFactors()
        guard let factor = factors.totp.first else { throw NativeAuthError.noAuthenticator }
        _ = try await client.mfa.challengeAndVerify(params: .init(factorId: factor.id, code: code))
    }

    func google() async throws {
        _ = try await client.signInWithOAuth(provider: .google, redirectTo: configuration.callbackURL) { [weak self] url in
            guard let self else { throw CancellationError() }
            return try await self.openOAuth(url)
        }
    }
    private func openOAuth(_ url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: configuration.callbackURL.scheme) { [weak self] callback, error in
                Task { @MainActor in
                    self?.webSession = nil
                    if let error { continuation.resume(throwing: error) }
                    else if let callback, self?.configuration.acceptsCallback(callback) == true { continuation.resume(returning: callback) }
                    else { continuation.resume(throwing: NativeAuthError.invalidCallback) }
                }
            }
            session.presentationContextProvider = self
            webSession = session
            if !session.start() { webSession = nil; continuation.resume(throwing: NativeAuthError.couldNotStart) }
        }
    }
    func callback(_ url: URL) async throws {
        guard configuration.acceptsCallback(url) else { throw NativeAuthError.invalidCallback }
        _ = try await client.session(from: url)
    }

    func apple() async throws {
        let nonce = try BrowserSignInPKCE.generateVerifier()
        appleNonce = nonce
        defer { appleNonce = nil; appleController = nil }
        let credential: ASAuthorizationAppleIDCredential = try await withCheckedThrowingContinuation { continuation in
            appleContinuation = continuation
            let request = ASAuthorizationAppleIDProvider().createRequest()
            request.requestedScopes = [.email, .fullName]
            request.nonce = SHA256.hash(data: Data(nonce.utf8)).map { String(format: "%02x", $0) }.joined()
            let controller = ASAuthorizationController(authorizationRequests: [request])
            controller.delegate = self
            controller.presentationContextProvider = self
            appleController = controller
            controller.performRequests()
        }
        guard let data = credential.identityToken, let token = String(data: data, encoding: .utf8), !token.isEmpty else { throw NativeAuthError.invalidCallback }
        _ = try await client.signInWithIdToken(credentials: .init(provider: .apple, idToken: token, nonce: nonce))
        if let name = credential.fullName {
            let fullName = PersonNameComponentsFormatter().string(from: name)
            if !fullName.isEmpty { _ = try await client.update(user: .init(data: ["full_name": .string(fullName)])) }
        }
    }
    func authorizationController(controller: ASAuthorizationController, didCompleteWithAuthorization authorization: ASAuthorization) {
        let continuation = appleContinuation; appleContinuation = nil
        guard let credential = authorization.credential as? ASAuthorizationAppleIDCredential else { continuation?.resume(throwing: NativeAuthError.invalidCallback); return }
        continuation?.resume(returning: credential)
    }
    func authorizationController(controller: ASAuthorizationController, didCompleteWithError error: Error) {
        appleContinuation?.resume(throwing: error); appleContinuation = nil
    }
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor { NSApp.keyWindow ?? AppDelegate.mainWindow ?? NSWindow() }
    func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor { NSApp.keyWindow ?? AppDelegate.mainWindow ?? NSWindow() }
    func cancel() { webSession?.cancel(); appleController?.cancel() }
}

enum NativeAuthError: LocalizedError {
    case invalidCallback, couldNotStart, noAuthenticator, unavailable
    var errorDescription: String? {
        switch self {
        case .invalidCallback: "The sign-in response is invalid. Try again."
        case .couldNotStart: "The secure sign-in window could not open."
        case .noAuthenticator: "No authenticator is enrolled for this account."
        case .unavailable: "Supabase QA configuration is unavailable."
        }
    }
}
