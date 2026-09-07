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
/// The mirror image holds too: every transition INTO `.signedIn` — the silent
/// restore, a backoff retry or Retry, the sign-in sheet, an on-demand mint —
/// goes through ONE path, `setSignedIn()`, which announces it through
/// `onSessionConfirmed` so the app loads that account's data (identity,
/// library, health) from one place, whichever path confirmed the session.
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
    /// Fired on EVERY transition to signed-in on the cloud origin — the silent
    /// restore at launch, a backoff retry or Retry, the sign-in sheet, or an
    /// on-demand mint that confirmed the session (e.g. ⌘R while connecting) —
    /// so the app loads that account's data in one place. Never fires while
    /// already signed in (the 45 s tick changes nothing).
    var onSessionConfirmed: (() -> Void)?

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

    /// One mint, coalesced, with the status bookkeeping every caller shares:
    /// a token confirms the session (`setSignedIn`), "no session" ends it
    /// (`setSignedOut`), and "unavailable" changes nothing. Both transitions
    /// are idempotent, so whoever triggered the mint — the restore, the sheet,
    /// the 45 s tick, a request — needs no bookkeeping of its own.
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

        // Its own task on purpose: the caller may be running inside a task
        // SwiftUI is about to cancel (the sign-in sheet's), and the webview
        // evaluation must still complete.
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
            setSignedIn()
        case .noSession:
            // Definitive: Clerk loaded and reports no session. Sign out for real —
            // this is how a session that expired under a days-idle app ends.
            cachedToken = nil
            cachedAt = nil
            if status != .signedOut {
                Self.log.notice("Clerk reports no session (was \(String(describing: self.status), privacy: .public)) — signing out")
            }
            setSignedOut()
        case .unavailable:
            // Transient (network down, page not loaded, renderer recycled). Says
            // NOTHING about the session, so a mid-session blip must not bounce
            // the user to the sign-in screen. Drop the cache, keep the status;
            // the failing request surfaces its own error and the next tick
            // retries. (The restore path schedules its own retry.)
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
    /// until Clerk answers either way. Returns after the FIRST attempt; a
    /// confirmed session — now or on a later attempt — reports through
    /// `onSessionConfirmed`.
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
        await attemptRestore(attempt: 0)
    }

    /// One restore attempt. The mint itself makes (and announces) the
    /// signed-in / signed-out transition; this only owns the connecting state
    /// and its retry schedule.
    private func attemptRestore(attempt: Int) async {
        let outcome = await mint(forceRefresh: true)

        switch outcome {
        case .token:
            Self.log.notice("silent restore: signed in (attempt \(attempt))")
        case .noSession:
            Self.log.notice("silent restore: Clerk reports no session (attempt \(attempt))")
        case .unavailable:
            // An on-demand mint may have confirmed the session while this
            // attempt was in flight — never demote a confirmed session.
            guard status != .signedIn else { return }
            status = .unreachable
            if let began = restoreBeganAt, Date().timeIntervalSince(began) >= Self.stallAfter {
                restoreStalled = true
            }
            let delay = Self.restoreBackoff[min(attempt, Self.restoreBackoff.count - 1)]
            Self.log.notice("silent restore: Clerk unreachable (attempt \(attempt), stalled \(self.restoreStalled)) — retrying in \(String(describing: delay), privacy: .public)")
            restoreRetry = Task { @MainActor [weak self] in
                try? await Task.sleep(for: delay)
                guard let self, !Task.isCancelled, self.status == .unreachable else { return }
                await self.attemptRestore(attempt: attempt + 1)
            }
        }
    }

    /// The connecting screen's Retry: start the schedule over, right now.
    func retryRestoreNow() {
        guard status == .unreachable else { return }
        cancelRestoreRetry()
        restoreBeganAt = Date()
        restoreStalled = false
        Task { await attemptRestore(attempt: 0) }
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
    /// Dismissing the sheet is the FIRST thing this does, which is why the
    /// caller must not run it inside the sheet's own `.task`: SwiftUI cancels
    /// that task with the sheet (see `AppEnvironment.finishSignIn`).
    func completeSignIn() async {
        isPresentingSignIn = false
        cancelRestoreRetry()
        await reloadTokenPageAfterSignIn()
        let outcome = await mint(forceRefresh: true)
        if case .token = outcome {
            // `mint` made the transition and announced it (`onSessionConfirmed`).
            Self.log.notice("sign-in completed")
        } else {
            lastError = "Sign-in finished but no session token could be minted. Try again."
            Self.log.error("sign-in finished without a token: \(String(describing: outcome), privacy: .public)")
            setSignedOut(force: true)
        }
    }

    /// Re-park the token webview on the session the sheet just made. Tests
    /// stand in for the webview through `mintOverride`, so they skip it — the
    /// test host shares the app's website data store, and a real load here
    /// would hit the cloud sign-in page with the app's own cookies.
    private func reloadTokenPageAfterSignIn() async {
        #if DEBUG
        if mintOverride != nil { return }
        #endif
        await web.refreshAfterSignIn()
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

    /// The single path to signed-in — the mirror of `setSignedOut()`. A mint
    /// while already signed in (the 45 s tick, any request) changes nothing;
    /// a real transition ends the connecting state, starts the refresh loop,
    /// and announces itself through `onSessionConfirmed` — the ONE trigger for
    /// loading the account's data, whichever path confirmed the session.
    private func setSignedIn() {
        let previous = status
        guard previous != .signedIn else { return }
        cancelRestoreRetry()
        clearStall()
        status = .signedIn
        startRefreshLoop()
        Self.log.notice("session confirmed (was \(String(describing: previous), privacy: .public))")
        onSessionConfirmed?()
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
