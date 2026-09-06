import Foundation
import Observation
import OSLog
import WebKit

/// Owns the app's authentication state and hands `ApiClient` its bearer tokens.
///
/// Clerk session JWTs live ~60s, so a token is cached only briefly and a
/// background loop re-mints ahead of expiry while the app is signed in. Nothing
/// is persisted here — see `ClerkWebAuth` for why there's no Keychain entry.
///
/// Two kinds of "no token" are kept apart on purpose:
/// - Clerk answering **"no session"** is DEFINITIVE: the app signs out and every
///   model flushes through `onSignedOut` — the ONE path to signed-out.
/// - Clerk being **unreachable** (token page not loaded yet, offline, renderer
///   recycled) says nothing about the session. At launch that is the
///   *connecting* state (`.unknown`/`.unreachable`, retried with backoff); mid-
///   session the status stays `.signedIn` and the data stays on screen.
///
/// Breadcrumbs: `log show --predicate 'subsystem == "ai.purecode.bookmarkai" AND category == "auth"'`.
@MainActor
@Observable
final class AuthController {

    enum Status: Equatable {
        /// Startup, before the first silent restore has answered.
        case unknown
        /// Clerk answered: there is no session (or the user signed out).
        case signedOut
        case signedIn
        /// The silent restore couldn't reach Clerk to answer at all. Says
        /// nothing about the session — the cookies almost certainly still
        /// carry it — so the app keeps retrying instead of showing sign-in.
        case unreachable
    }

    private(set) var status: Status = .unknown
    /// Who is signed in (`GET /api/me`). Cleared on every sign-out.
    private(set) var account: AccountInfo?
    /// Set when a sign-in attempt fails in a way worth surfacing in Settings.
    var lastError: String?
    /// Drives the sign-in sheet.
    var isPresentingSignIn = false
    /// True once the connecting state has lasted `stallAfter` without Clerk
    /// answering — the UI switches from a spinner to "Can't reach …" + Retry.
    /// Retries continue regardless.
    private(set) var restoreStalled = false

    /// Fired on every DEFINITIVE transition to signed-out on the cloud origin
    /// (Clerk says no session, explicit sign-out, 401 after the forced re-mint)
    /// — the app flushes every model in one place.
    var onSignedOut: (() -> Void)?
    /// Fired when a session is confirmed OUTSIDE the awaited `restore()` /
    /// `completeSignIn()` (a backoff retry, Retry, or an on-demand mint
    /// succeeded) so the app can load data it skipped earlier.
    var onSessionRestored: (() -> Void)?

    /// Re-mint this long after the last mint. Comfortably inside Clerk's ~60s TTL.
    private static let tokenMaxAge: TimeInterval = 40
    /// Background re-mint cadence while signed in.
    private static let refreshInterval: Duration = .seconds(45)
    /// Silent-restore retry schedule while Clerk is unreachable (last one repeats).
    static let restoreBackoff: [Duration] = [
        .seconds(1), .seconds(2), .seconds(4), .seconds(8), .seconds(15), .seconds(30),
    ]
    /// How long the connecting state may last before it admits it can't reach
    /// the cloud (the sum of the backoff schedule).
    static let stallAfter: TimeInterval = 60
    private static let log = Logger(subsystem: "ai.purecode.bookmarkai", category: "auth")

    private let web: ClerkWebAuth
    private var cachedToken: String?
    private var cachedAt: Date?
    private var mintTask: Task<MintOutcome, Never>?
    /// Whether the in-flight mint bypasses clerk-js's token cache. A forced
    /// caller may reuse an in-flight FRESH mint, but never a cached-path one —
    /// that could hand back the very token a 401 just rejected.
    private var mintTaskIsFresh = false
    private var refreshLoop: Task<Void, Never>?
    private var restoreRetry: Task<Void, Never>?
    /// When the current connecting stretch began — drives `restoreStalled`.
    private var restoreBeganAt: Date?
    /// True while `restore()` / `completeSignIn()` drive the status themselves,
    /// so the mint's own bookkeeping doesn't double-report.
    private var isRestoring = false

    #if DEBUG
    /// Tests: stand in for the webview. Receives `fresh`; returns the outcome.
    var mintOverride: ((Bool) async -> MintOutcome)?
    #endif

    init(origin: URL) {
        self.web = ClerkWebAuth(origin: origin)
    }

    /// The Local/Cloud switch changed. Auth is only meaningful for cloud.
    func updateOrigin(_ origin: URL) {
        web.updateOrigin(origin)
        invalidateToken()
        cancelRestoreRetry()
    }

    var isSignedIn: Bool { status == .signedIn }

    /// Launch / retry in progress: the session is neither confirmed nor denied.
    var isConnecting: Bool { status == .unknown || status == .unreachable }

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
        if case .token(let token) = await mint(forceRefresh: forceRefresh) { return token }
        return nil
    }

    /// One mint, coalesced, with the status bookkeeping every caller shares.
    private func mint(forceRefresh: Bool) async -> MintOutcome {
        // Coalesce concurrent mints: an in-flight mint satisfies this call unless
        // we need a guaranteed-fresh token and the in-flight one isn't. Never run
        // two mints at once — they'd race evaluations on the same webview.
        if let mintTask, !forceRefresh || mintTaskIsFresh {
            return await mintTask.value
        }
        if let mintTask {
            _ = await mintTask.value // let the cached-path mint settle first
        }

        let task = Task { @MainActor [web] in
            #if DEBUG
            if let mintOverride { return await mintOverride(forceRefresh) }
            #endif
            return await web.mintToken(fresh: forceRefresh)
        }
        mintTask = task
        mintTaskIsFresh = forceRefresh
        let outcome = await task.value
        if mintTask == task { mintTask = nil }

        switch outcome {
        case .token(let token):
            cachedToken = token
            cachedAt = Date()
            if status != .signedIn {
                let previous = status
                status = .signedIn
                Self.log.notice("session available (was \(String(describing: previous), privacy: .public))")
                if !isRestoring {
                    // An on-demand mint confirmed the session (e.g. ⌘R while
                    // connecting): behave like a completed restore.
                    clearStall()
                    startRefreshLoop()
                    onSessionRestored?()
                }
            }
        case .noSession:
            // Definitive: Clerk loaded and reports no session. Sign out for real —
            // this is how a session that expired under a days-idle app ends.
            cachedToken = nil
            cachedAt = nil
            if !isRestoring, status != .signedOut {
                Self.log.notice("Clerk reports no session (was \(String(describing: self.status), privacy: .public)) — signing out")
                setSignedOut()
            }
        case .unavailable:
            // Transient (network down, page not loaded, renderer recycled). Says
            // NOTHING about the session, so a mid-session blip must not bounce
            // the user to the sign-in screen. Drop the cache, keep the status;
            // the failing request surfaces its own error and the next tick
            // retries. (The restore path handles its own bookkeeping.)
            cachedToken = nil
            cachedAt = nil
            Self.log.info("token mint unavailable (status \(String(describing: self.status), privacy: .public)) — keeping state")
        }
        return outcome
    }

    private func invalidateToken() {
        cachedToken = nil
        cachedAt = nil
        mintTask?.cancel()
        mintTask = nil
    }

    // MARK: - Lifecycle

    /// Silent restore at launch (cloud only): if the persisted Clerk cookies still
    /// carry a session, the user is signed in without seeing anything. An
    /// unreachable Clerk is NOT "signed out" — it becomes `.unreachable`
    /// (rendered as "Connecting to your account…") and retries with backoff
    /// until Clerk answers either way. Returns after the FIRST attempt; a later
    /// success reports through `onSessionRestored`.
    func restore(requiresAuth: Bool) async {
        cancelRestoreRetry()
        guard requiresAuth else {
            // Local has no session concept: not a sign-out transition, nothing to flush.
            refreshLoop?.cancel()
            refreshLoop = nil
            clearStall()
            status = .signedOut
            account = nil
            return
        }
        restoreBeganAt = Date()
        restoreStalled = false
        await attemptRestore(attempt: 0, notifies: false)
    }

    /// One restore attempt. `notifies` is true for every attempt AFTER the one
    /// the caller awaited (scheduled retries, Retry) — those must announce a
    /// confirmed session themselves, since nobody is awaiting them.
    private func attemptRestore(attempt: Int, notifies: Bool) async {
        isRestoring = true
        let outcome = await mint(forceRefresh: true)
        isRestoring = false

        switch outcome {
        case .token:
            clearStall()
            status = .signedIn
            startRefreshLoop()
            Self.log.notice("silent restore: signed in (attempt \(attempt))")
            if notifies { onSessionRestored?() }
        case .noSession:
            clearStall()
            Self.log.notice("silent restore: Clerk reports no session (attempt \(attempt))")
            setSignedOut()
        case .unavailable:
            status = .unreachable
            if let began = restoreBeganAt, Date().timeIntervalSince(began) >= Self.stallAfter {
                restoreStalled = true
            }
            let delay = Self.restoreBackoff[min(attempt, Self.restoreBackoff.count - 1)]
            Self.log.notice("silent restore: Clerk unreachable (attempt \(attempt), stalled \(self.restoreStalled)) — retrying in \(String(describing: delay), privacy: .public)")
            restoreRetry = Task { @MainActor [weak self] in
                try? await Task.sleep(for: delay)
                guard let self, !Task.isCancelled, self.status == .unreachable else { return }
                await self.attemptRestore(attempt: attempt + 1, notifies: true)
            }
        }
    }

    /// The connecting screen's Retry: start the schedule over, right now.
    func retryRestoreNow() {
        guard status == .unreachable else { return }
        cancelRestoreRetry()
        restoreBeganAt = Date()
        restoreStalled = false
        Task { await attemptRestore(attempt: 0, notifies: true) }
    }

    private func cancelRestoreRetry() {
        restoreRetry?.cancel()
        restoreRetry = nil
    }

    private func clearStall() {
        restoreBeganAt = nil
        restoreStalled = false
    }

    func beginSignIn() {
        lastError = nil
        isPresentingSignIn = true
    }

    /// The sign-in sheet saw a token — adopt the session for the whole app.
    func completeSignIn() async {
        isPresentingSignIn = false
        cancelRestoreRetry()
        await web.refreshAfterSignIn()
        isRestoring = true
        let outcome = await mint(forceRefresh: true)
        isRestoring = false
        if case .token = outcome {
            clearStall()
            status = .signedIn
            startRefreshLoop()
            Self.log.notice("sign-in completed")
        } else {
            lastError = "Sign-in finished but no session token could be minted. Try again."
            Self.log.error("sign-in finished without a token: \(String(describing: outcome), privacy: .public)")
            setSignedOut(force: true)
        }
    }

    func cancelSignIn() {
        isPresentingSignIn = false
    }

    func signOut() async {
        Self.log.notice("explicit sign-out")
        cancelRestoreRetry()
        refreshLoop?.cancel()
        refreshLoop = nil
        invalidateToken()
        await web.signOut()
        setSignedOut(force: true)
    }

    /// The server rejected a FRESHLY minted token (401 after the one retry):
    /// whatever Clerk thinks, this account can't use the API — signed out.
    func handleUnauthorized() {
        guard status == .signedIn || status == .unreachable else { return }
        Self.log.error("401 after a forced re-mint — treating as signed out")
        lastError = "The server rejected the session. Sign in again."
        setSignedOut()
    }

    /// The single definitive path to signed-out: drops the token and identity,
    /// stops the refresh loop, and tells the app to flush every model.
    private func setSignedOut(force: Bool = false) {
        guard force || status != .signedOut else { return }
        cancelRestoreRetry()
        refreshLoop?.cancel()
        refreshLoop = nil
        cachedToken = nil
        cachedAt = nil
        clearStall()
        status = .signedOut
        account = nil
        onSignedOut?()
    }

    /// Fill the identity (sidebar footer, Settings ▸ Account) from `GET /api/me`.
    /// A transient failure keeps the last known identity — it belongs to the
    /// same session; only a sign-out clears it.
    func loadAccount(using api: ApiClient) async {
        guard let info = try? await api.me() else { return }
        account = info
    }

    /// Keeps a fresh token on hand so the first request after an idle period
    /// doesn't pay the mint latency (or, worse, race the TTL).
    private func startRefreshLoop() {
        refreshLoop?.cancel()
        refreshLoop = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: Self.refreshInterval)
                guard let self, !Task.isCancelled, self.status == .signedIn else { return }
                await self.refreshTick()
            }
        }
    }

    /// One iteration of the refresh loop — the same forced mint the loop runs.
    /// Split out so tests can drive it without waiting 45 s.
    func refreshTick() async {
        _ = await token(forceRefresh: true)
    }

    #if DEBUG
    /// Tests/previews: a status (and identity) without a webview.
    func seed(status: Status, account: AccountInfo? = nil, stalled: Bool = false) {
        self.status = status
        self.account = account
        self.restoreStalled = stalled
    }
    #endif

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
