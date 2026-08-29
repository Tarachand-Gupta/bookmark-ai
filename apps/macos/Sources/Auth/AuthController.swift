import Foundation
import Observation
import WebKit

/// Owns the app's authentication state and hands `ApiClient` its bearer tokens.
///
/// Clerk session JWTs live ~60s, so a token is cached only briefly and a
/// background loop re-mints ahead of expiry while the app is signed in. Nothing
/// is persisted here — see `ClerkWebAuth` for why there's no Keychain entry.
@MainActor
@Observable
final class AuthController {

    enum Status: Equatable {
        /// Startup, before the first silent restore has answered.
        case unknown
        case signedOut
        case signedIn
    }

    private(set) var status: Status = .unknown
    private(set) var account: AccountInfo?
    /// Set when a sign-in attempt fails in a way worth surfacing in Settings.
    var lastError: String?
    /// Drives the sign-in sheet.
    var isPresentingSignIn = false

    /// Re-mint this long after the last mint. Comfortably inside Clerk's ~60s TTL.
    private static let tokenMaxAge: TimeInterval = 40
    /// Background re-mint cadence while signed in.
    private static let refreshInterval: Duration = .seconds(45)

    private let web: ClerkWebAuth
    private var cachedToken: String?
    private var cachedAt: Date?
    private var mintTask: Task<MintOutcome, Never>?
    /// Whether the in-flight mint bypasses clerk-js's token cache. A forced
    /// caller may reuse an in-flight FRESH mint, but never a cached-path one —
    /// that could hand back the very token a 401 just rejected.
    private var mintTaskIsFresh = false
    private var refreshLoop: Task<Void, Never>?

    init(origin: URL) {
        self.web = ClerkWebAuth(origin: origin)
    }

    /// The Local/Cloud switch changed. Auth is only meaningful for cloud.
    func updateOrigin(_ origin: URL) {
        web.updateOrigin(origin)
        invalidateToken()
    }

    // MARK: - Tokens

    /// The `TokenProvider` handed to `ApiClient`. Single-flighted: a burst of
    /// parallel requests costs one mint, not one per request.
    func token(forceRefresh: Bool) async -> String? {
        if !forceRefresh,
           let cachedToken,
           let cachedAt,
           Date().timeIntervalSince(cachedAt) < Self.tokenMaxAge {
            return cachedToken
        }

        // Coalesce concurrent mints: an in-flight mint satisfies this call unless
        // we need a guaranteed-fresh token and the in-flight one isn't. Never run
        // two mints at once — they'd race evaluations on the same webview.
        if let mintTask, !forceRefresh || mintTaskIsFresh {
            return token(from: await mintTask.value)
        }
        if let mintTask {
            _ = await mintTask.value // let the cached-path mint settle first
        }

        let task = Task { @MainActor [web] in
            await web.mintToken(fresh: forceRefresh)
        }
        mintTask = task
        mintTaskIsFresh = forceRefresh
        let outcome = await task.value
        if mintTask == task { mintTask = nil }

        switch outcome {
        case .token(let token):
            cachedToken = token
            cachedAt = Date()
            if status != .signedIn { status = .signedIn }
            return token
        case .noSession:
            // Definitive: Clerk loaded and reports no session. Sign out for real.
            cachedToken = nil
            cachedAt = nil
            if status == .signedIn { status = .signedOut }
            return nil
        case .unavailable:
            // Transient (network down, page not loaded, renderer recycled). Says
            // NOTHING about the session — the Clerk cookies almost certainly
            // still carry it — so a blip must not bounce the user to the sign-in
            // panel. Drop the cache, keep the status; the failing request
            // surfaces its own error and the next tick retries.
            cachedToken = nil
            cachedAt = nil
            return nil
        }
    }

    private func token(from outcome: MintOutcome) -> String? {
        if case .token(let token) = outcome { return token }
        return nil
    }

    private func invalidateToken() {
        cachedToken = nil
        cachedAt = nil
        mintTask?.cancel()
        mintTask = nil
    }

    // MARK: - Lifecycle

    /// Silent restore at launch (cloud only): if the persisted Clerk cookies still
    /// carry a session, the user is signed in without seeing anything.
    func restore(requiresAuth: Bool) async {
        guard requiresAuth else {
            status = .signedOut
            account = nil
            return
        }
        let token = await token(forceRefresh: true)
        status = token == nil ? .signedOut : .signedIn
        if token != nil { startRefreshLoop() }
    }

    func beginSignIn() {
        lastError = nil
        isPresentingSignIn = true
    }

    /// The sign-in sheet saw a token — adopt the session for the whole app.
    func completeSignIn() async {
        isPresentingSignIn = false
        await web.refreshAfterSignIn()
        let token = await token(forceRefresh: true)
        if token == nil {
            status = .signedOut
            lastError = "Sign-in finished but no session token could be minted. Try again."
        } else {
            status = .signedIn
            startRefreshLoop()
        }
    }

    func cancelSignIn() {
        isPresentingSignIn = false
    }

    func signOut() async {
        refreshLoop?.cancel()
        refreshLoop = nil
        invalidateToken()
        await web.signOut()
        status = .signedOut
        account = nil
    }

    /// Fill the sidebar footer from `GET /api/me`.
    func loadAccount(using api: ApiClient) async {
        do {
            account = try await api.me()
        } catch {
            account = nil
        }
    }

    /// Keeps a fresh token on hand so the first request after an idle period
    /// doesn't pay the mint latency (or, worse, race the TTL).
    private func startRefreshLoop() {
        refreshLoop?.cancel()
        refreshLoop = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.refreshInterval)
                guard let self, !Task.isCancelled, self.status == .signedIn else { return }
                _ = await self.token(forceRefresh: true)
            }
        }
    }

    // MARK: - Sign-in sheet plumbing

    func makeSignInWebView() -> WKWebView {
        web.makeSignInWebView()
    }

    /// Polled by the sign-in sheet: non-nil means Clerk has a session on the
    /// app's origin and the sheet can close.
    func probeSignInWebView(_ webView: WKWebView) async -> String? {
        await web.evaluateToken(on: webView)
    }

    var signInURL: URL { web.signInURL }
}
