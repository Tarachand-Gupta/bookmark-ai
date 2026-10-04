import AppKit
import Foundation
import Observation
import OSLog

enum BrowserSignInState: Equatable {
    case idle
    case starting
    case waiting(code: String, browserURL: URL, expiresAt: Date, openError: String?)
    case redeeming(code: String)
    case failed(message: String)
}

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
/// Breadcrumbs: `log show --predicate 'subsystem == "ai.bookmarkai" AND category == "auth"'`.
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
    /// The native sheet never hosts OAuth UI. It reports progress while the
    /// default browser confirms the account and this app polls for the handoff.
    private(set) var browserSignInState: BrowserSignInState = .idle
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
    private static let log = Logger(subsystem: "ai.bookmarkai", category: "auth")

    private let nativeMode: Bool
    private let web: ClerkWebAuth?
    let native: SupabaseNativeAuth?
    var nativeBusy = false
    var needsMFA = false
    var needsPasswordUpdate = false
    var nativeMessage: String?
    private var nativeUserId: UUID?
    // Only assigned on MainActor; Sendable task cancellation is safe in deinit.
    @ObservationIgnored nonisolated(unsafe) private var nativeEvents: Task<Void, Never>?
    private var nativeBrowserAttempt: (flow: String, verifier: String, state: String)?
    private let browserClient: BrowserSignInClient
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
    /// Every browser attempt gets a generation. Any suspension that resumes for
    /// an older generation may clean up, but may never adopt a session or alter
    /// the newer sheet.
    private var browserAttemptID: UUID?
    private var browserAttemptTask: Task<Void, Never>?
    /// Invalidates token-mint results that began before a browser attempt,
    /// even if that attempt has already finished by the time the mint resumes.
    private var authOperationGeneration: UInt64 = 0

    #if DEBUG
    /// Tests: stand in for the webview. Receives `fresh`; returns the outcome.
    var mintOverride: ((Bool) async -> MintOutcome)?
    var browserStartOverride: ((String) async throws -> BrowserSignInStart)?
    var browserExchangeOverride: ((String, String) async throws -> BrowserSignInExchange)?
    var browserOpenOverride: ((URL) -> Bool)?
    var browserSleepOverride: ((TimeInterval) async throws -> Void)?
    var browserNowOverride: (() -> Date)?
    var redeemTicketOverride: ((String) async -> TicketRedemptionOutcome)?
    var webSignOutOverride: (() async -> Void)?
    #endif

    init(origin: URL, nativeMode: Bool = SupabaseConfiguration.isQA) {
        self.nativeMode = nativeMode
        self.web = nativeMode ? nil : ClerkWebAuth(origin: origin)
        self.native = nativeMode ? SupabaseConfiguration.current.map { SupabaseNativeAuth(configuration: $0) } : nil
        self.browserClient = BrowserSignInClient(origin: origin, nativeMode: nativeMode)
        self.currentAuthOrigin = origin
        if let native {
            nativeEvents = Task { [weak self] in
                for await (event, _) in native.client.authStateChanges {
                    guard !Task.isCancelled else { return }
                    if event == .signedOut { self?.setSignedOut() }
                }
            }
        }
    }

    /// The Local/Cloud switch changed. Auth is only meaningful for cloud.
    func updateOrigin(_ origin: URL) async {
        await invalidateBrowserAttemptAndWait(dismissSheet: true)
        web?.updateOrigin(origin)
        browserClient.updateOrigin(origin)
        currentAuthOrigin = origin
        invalidateToken()
        cancelRestoreRetry()
    }

    var isSignedIn: Bool { status == .signedIn }

    private func confirmNative() async throws {
        guard let native else { throw NativeAuthError.unavailable }
        let assurance = try await native.client.mfa.getAuthenticatorAssuranceLevel()
        if assurance.nextLevel == "aal2", assurance.currentLevel != "aal2" { needsMFA = true; beginSignIn(); return }
        let nextUser = native.client.currentUser?.id
        if let previous = nativeUserId, previous != nextUser { setSignedOut(force: true) }
        nativeUserId = nextUser
        invalidateToken()
        let result = await mint(forceRefresh: false)
        guard case .token = result else { throw NativeAuthError.unavailable }
        let api = nativeAPI()
        try await api.registerCurrentSession()
        isPresentingSignIn = false
    }

    func handleNativeCallback(_ url: URL) async {
        if nativeMode, let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
           components.queryItems?.contains(where: { $0.name == "flow" }) == true {
            guard let attempt = nativeBrowserAttempt, native?.configuration.acceptsCallback(url) == true,
                  components.queryItems?.filter({ $0.name == "flow" }).count == 1,
                  components.queryItems?.filter({ $0.name == "state" }).count == 1,
                  components.queryItems?.first(where: { $0.name == "flow" })?.value == attempt.flow,
                  components.queryItems?.first(where: { $0.name == "state" })?.value == attempt.state,
                  let code = components.queryItems?.first(where: { $0.name == "code" })?.value,
                  components.queryItems?.filter({ $0.name == "code" }).count == 1,
                  components.queryItems?.count == 3, BrowserSignInWireValidator.isOpaque43(code),
                  url.fragment == nil else { return }
            browserClient.nativeCompletionCode = code
            return
        }
        guard let native, native.configuration.acceptsCallback(url), !nativeBusy else { return }
        nativeBusy = true; defer { nativeBusy = false }
        do {
            try await native.callback(url)
            try await confirmNative()
        } catch { lastError = error.localizedDescription; isPresentingSignIn = true }
    }
    private func nativeAPI() -> ApiClient {
        let api = ApiClient(target: .cloud)
        api.tokenProvider = { [weak self] fresh in await self?.token(forceRefresh: fresh) }
        return api
    }
    func nativeSessionScope(_ scope: String) async throws {
        try await nativeAPI().signOutSessions(scope: scope)
        if scope != "others" {
            await native?.clearLocalSession()
            nativeUserId = nil; needsMFA = false; needsPasswordUpdate = false
            setSignedOut(force: true)
        }
    }
    func nativeAccountDeleted() async { await native?.clearLocalSession(); nativeUserId = nil; setSignedOut(force: true) }

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
        guard browserAttemptID == nil else { return .unavailable }
        let generation = authOperationGeneration
        let outcome = await performMint(forceRefresh: forceRefresh)
        guard browserAttemptID == nil, authOperationGeneration == generation else { return .unavailable }
        if nativeMode, native?.needsBrowserVerification == true {
            needsMFA = true
            setSignedOut()
            beginSignIn()
            return .unavailable
        }
        applyMintOutcome(outcome)
        return outcome
    }

    /// Runs the single-flight webview operation without adopting its result.
    /// Browser sign-in uses this split so an attempt canceled while the webview
    /// is suspended cannot become `.signedIn` when it resumes.
    private func performMint(forceRefresh: Bool) async -> MintOutcome {
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
        // whose UI or request is about to cancel, and the webview evaluation
        // must still settle before another operation uses it.
        let task = Task { @MainActor [web, native] in
            #if DEBUG
            if let mintOverride { return await mintOverride(forceRefresh) }
            #endif
            if nativeMode { return await native?.mint(fresh: forceRefresh) ?? .unavailable }
            return await web?.mintToken(fresh: forceRefresh) ?? .unavailable
        }
        mintTask = task
        mintTaskIsFresh = forceRefresh
        let outcome = await task.value
        if mintTask == task { mintTask = nil }

        return outcome
    }

    private func applyMintOutcome(_ outcome: MintOutcome) {
        switch outcome {
        case .token(let token):
            if nativeMode, let next = native?.client.currentUser?.id {
                if let previous = nativeUserId, previous != next { setSignedOut(force: true) }
                nativeUserId = next
            }
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
        if nativeMode && needsMFA { return }

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
        isPresentingSignIn = true
        startBrowserAttempt()
    }

    func retrySignIn() {
        guard isPresentingSignIn else { return }
        startBrowserAttempt()
    }

    func openBrowserAgain() {
        guard case .waiting(let code, let url, let expiresAt, _) = browserSignInState else { return }
        let opened = openBrowser(url)
        browserSignInState = .waiting(
            code: code,
            browserURL: url,
            expiresAt: expiresAt,
            openError: opened ? nil : "Couldn't open the default browser. Open it again to continue."
        )
    }

    func cancelSignIn() {
        if let attempt = nativeBrowserAttempt {
            nativeBrowserAttempt = nil
            Task { await browserClient.cancel(flowId: attempt.flow, verifier: attempt.verifier) }
        }
        authOperationGeneration &+= 1
        browserAttemptID = nil
        browserAttemptTask?.cancel()
        isPresentingSignIn = false
        browserSignInState = .idle
    }

    private func startBrowserAttempt() {
        let previous = browserAttemptTask
        previous?.cancel()
        authOperationGeneration &+= 1
        let attemptID = UUID()
        browserAttemptID = attemptID
        lastError = nil
        browserSignInState = .starting
        cancelRestoreRetry()

        let task = Task { @MainActor [weak self] in
            // Retry never overlaps a late ticket redemption. The older attempt
            // gets first chance to clear any session it created after cancel.
            if let previous { await previous.value }
            guard let self, self.isCurrentBrowserAttempt(attemptID) else { return }
            await self.runBrowserAttempt(attemptID)
        }
        browserAttemptTask = task
    }

    private func runBrowserAttempt(_ attemptID: UUID) async {
        do {
            let verifier = try BrowserSignInPKCE.generateVerifier()
            let challenge = BrowserSignInPKCE.challenge(for: verifier)
            let startedAt = browserNow()
            let start = try await startBrowserFlow(challenge: challenge)
            guard isCurrentBrowserAttempt(attemptID) else { return }
            guard let browserURL = start.browserURL,
                  BrowserSignInWireValidator.isOpaque43(start.flowId),
                  BrowserSignInWireValidator.isVerificationCode(start.verificationCode),
                  (nativeMode ? NativeBrowserURLValidator.validate(browserURL, flowId: start.flowId, origin: currentAuthOrigin) : BrowserSignInURLValidator.validate(browserURL, flowId: start.flowId, origin: currentAuthOrigin)),
                  start.expirationDate > browserNow()
            else { throw BrowserSignInError.invalidBrowserURL }

            if nativeMode, let state = browserClient.nativeState {
                nativeBrowserAttempt = (start.flowId, verifier, state)
            }
            defer {
                if nativeBrowserAttempt?.flow == start.flowId {
                    nativeBrowserAttempt = nil
                    Task { await browserClient.cancel(flowId: start.flowId, verifier: verifier) }
                }
            }
            let deadline = min(start.expirationDate, startedAt.addingTimeInterval(BrowserSignInPollPolicy.maximumLifetime))
            let opened = openBrowser(browserURL)
            browserSignInState = .waiting(
                code: start.verificationCode,
                browserURL: browserURL,
                expiresAt: deadline,
                openError: opened ? nil : "Couldn't open the default browser. Open it again to continue."
            )

            guard await sleepForBrowserPoll(
                BrowserSignInPollPolicy.initialDelay,
                until: deadline,
                attemptID: attemptID
            ) else {
                expireBrowserAttempt(attemptID)
                return
            }

            var retry = 0
            while isCurrentBrowserAttempt(attemptID) {
                do {
                    let exchange = try await exchangeBrowserFlow(flowId: start.flowId, verifier: verifier)
                    guard isCurrentBrowserAttempt(attemptID) else {
                        if case .nativeComplete(let session) = exchange { await native?.revokeHandoff(session) }
                        return
                    }

                    switch exchange {
                    case .nativeComplete(let session):
                        guard let native else { throw NativeAuthError.unavailable }
                        browserSignInState = .redeeming(code: start.verificationCode)
                        do {
                            try await native.importHandoff(session)
                            guard isCurrentBrowserAttempt(attemptID) else { throw CancellationError() }
                            let outcome = await performMint(forceRefresh: false)
                            guard isCurrentBrowserAttempt(attemptID), case .token(let token) = outcome else { throw NativeAuthError.unavailable }
                            let api = nativeAPI()
                            api.tokenProvider = { _ in token }
                            try await api.registerCurrentSession()
                            guard isCurrentBrowserAttempt(attemptID) else { throw CancellationError() }
                            cachedToken = nil; cachedAt = nil
                            applyMintOutcome(outcome)
                        } catch {
                            await native.revokeHandoff(session)
                            await native.clearHandoffSession(session)
                            throw error
                        }
                        nativeBrowserAttempt = nil; browserAttemptID = nil; browserSignInState = .idle
                        isPresentingSignIn = false; lastError = nil
                        return
                    case .complete(let ticket, let ticketExpiresAt):
                        guard ticketExpiresAt > browserNow() else {
                            failBrowserAttempt(attemptID, message: "The secure sign-in handoff expired. Try again.")
                            return
                        }
                        browserSignInState = .redeeming(code: start.verificationCode)

                        // Do not race ticket redemption with a silent-restore
                        // token evaluation that was already using the webview.
                        if let existingMint = mintTask {
                            _ = await existingMint.value
                            if mintTask == existingMint { mintTask = nil }
                        }
                        guard isCurrentBrowserAttempt(attemptID) else { return }
                        guard ticketExpiresAt > browserNow() else {
                            failBrowserAttempt(attemptID, message: "The secure sign-in handoff expired. Try again.")
                            return
                        }

                        let redemption = await redeemBrowserTicket(ticket)
                        guard isCurrentBrowserAttempt(attemptID) else {
                            // The JS may have created a session and then failed
                            // before returning its sentinel. Once redemption
                            // began, stale cleanup is unconditional.
                            await signOutWebSession()
                            return
                        }
                        guard redemption == .success else {
                            await signOutWebSession()
                            failBrowserAttempt(
                                attemptID,
                                message: "The secure handoff couldn't be completed in the app. Try again."
                            )
                            return
                        }

                        cachedToken = nil
                        cachedAt = nil
                        let outcome = await performMint(forceRefresh: true)
                        guard isCurrentBrowserAttempt(attemptID) else {
                            await signOutWebSession()
                            return
                        }
                        guard case .token = outcome else {
                            await signOutWebSession()
                            failBrowserAttempt(
                                attemptID,
                                message: "Sign-in completed, but a session token couldn't be created. Try again."
                            )
                            return
                        }

                        applyMintOutcome(outcome)
                        browserAttemptID = nil
                        browserSignInState = .idle
                        isPresentingSignIn = false
                        lastError = nil
                        Self.log.notice("default-browser sign-in completed")
                        return

                    case .pending(let serverDelay):
                        let delay = min(
                            BrowserSignInPollPolicy.maximumDelay,
                            max(serverDelay, BrowserSignInPollPolicy.backoff(afterRetry: retry))
                        )
                        retry += 1
                        guard await sleepForBrowserPoll(delay, until: deadline, attemptID: attemptID) else {
                            expireBrowserAttempt(attemptID)
                            return
                        }

                    case .rateLimited(let retryAfter):
                        // Rate limiting is not an auth failure. Honor the server
                        // while bounding the wait by this flow's hard deadline.
                        guard await sleepForBrowserPoll(retryAfter, until: deadline, attemptID: attemptID) else {
                            expireBrowserAttempt(attemptID)
                            return
                        }
                    }
                } catch is CancellationError {
                    return
                } catch BrowserSignInError.temporary {
                    let delay = BrowserSignInPollPolicy.backoff(afterRetry: retry)
                    retry += 1
                    guard await sleepForBrowserPoll(delay, until: deadline, attemptID: attemptID) else {
                        expireBrowserAttempt(attemptID)
                        return
                    }
                } catch let error as BrowserSignInError {
                    failBrowserAttempt(attemptID, message: error.localizedDescription)
                    return
                } catch {
                    failBrowserAttempt(attemptID, message: "Sign-in couldn't be completed. Try again.")
                    return
                }
            }
        } catch is CancellationError {
            return
        } catch let error as BrowserSignInError {
            failBrowserAttempt(attemptID, message: error.localizedDescription)
        } catch {
            failBrowserAttempt(attemptID, message: "Sign-in couldn't be started. Try again.")
        }
    }

    private var currentAuthOrigin = ServerTarget.cloud.authOrigin

    private func startBrowserFlow(challenge: String) async throws -> BrowserSignInStart {
        #if DEBUG
        if let browserStartOverride { return try await browserStartOverride(challenge) }
        #endif
        return try await browserClient.start(codeChallenge: challenge)
    }

    private func exchangeBrowserFlow(flowId: String, verifier: String) async throws -> BrowserSignInExchange {
        #if DEBUG
        if let browserExchangeOverride { return try await browserExchangeOverride(flowId, verifier) }
        #endif
        return try await browserClient.exchange(flowId: flowId, verifier: verifier)
    }

    private func openBrowser(_ url: URL) -> Bool {
        #if DEBUG
        if let browserOpenOverride { return browserOpenOverride(url) }
        #endif
        return NSWorkspace.shared.open(url)
    }

    private func browserNow() -> Date {
        #if DEBUG
        if let browserNowOverride { return browserNowOverride() }
        #endif
        return Date()
    }

    private func sleepForBrowserPoll(_ delay: TimeInterval, until deadline: Date, attemptID: UUID) async -> Bool {
        guard isCurrentBrowserAttempt(attemptID) else { return false }
        let remaining = deadline.timeIntervalSince(browserNow())
        guard remaining > 0 else { return false }
        do {
            #if DEBUG
            if let browserSleepOverride {
                try await browserSleepOverride(min(max(0, delay), remaining))
            } else {
                try await Task.sleep(for: .seconds(min(max(0, delay), remaining)))
            }
            #else
            try await Task.sleep(for: .seconds(min(max(0, delay), remaining)))
            #endif
        } catch {
            return false
        }
        return isCurrentBrowserAttempt(attemptID) && browserNow() < deadline
    }

    private func redeemBrowserTicket(_ ticket: String) async -> TicketRedemptionOutcome {
        #if DEBUG
        if let redeemTicketOverride { return await redeemTicketOverride(ticket) }
        #endif
        return await web?.redeemTicket(ticket) ?? .failure
    }

    private func signOutWebSession() async {
        cachedToken = nil
        cachedAt = nil
        #if DEBUG
        if let webSignOutOverride {
            await webSignOutOverride()
            return
        }
        #endif
        if nativeMode { await native?.clearLocalSession() }
        else { await web?.signOut() }
    }

    private func isCurrentBrowserAttempt(_ attemptID: UUID) -> Bool {
        browserAttemptID == attemptID
    }

    private func expireBrowserAttempt(_ attemptID: UUID) {
        failBrowserAttempt(attemptID, message: "This sign-in request expired. Try again.")
    }

    private func failBrowserAttempt(_ attemptID: UUID, message: String) {
        guard isCurrentBrowserAttempt(attemptID) else { return }
        browserAttemptID = nil
        browserSignInState = .failed(message: message)
        lastError = message
    }

    private func invalidateBrowserAttemptAndWait(dismissSheet: Bool) async {
        authOperationGeneration &+= 1
        browserAttemptID = nil
        browserAttemptTask?.cancel()
        if dismissSheet {
            isPresentingSignIn = false
            browserSignInState = .idle
        }
        await browserAttemptTask?.value
        browserAttemptTask = nil
    }

    func signOut() async {
        if nativeMode {
            do { try await nativeSessionScope("local") } catch { lastError = error.localizedDescription }
            return
        }
        Self.log.notice("explicit sign-out")
        await invalidateBrowserAttemptAndWait(dismissSheet: true)
        cancelRestoreRetry()
        refreshLoop?.cancel()
        refreshLoop = nil
        invalidateToken()
        await signOutWebSession()
        setSignedOut(force: true)
    }

    /// The server rejected a FRESHLY minted token (401 after the one retry):
    /// whatever Clerk thinks, this account can't use the API — signed out.
    func handleUnauthorized() {
        guard status == .signedIn || status == .unreachable else { return }
        cancelSignIn()
        Self.log.error("401 after a forced re-mint — treating as signed out")
        lastError = "The server rejected the session. Sign in again."
        if nativeMode {
            let rejectedUser = native?.client.currentUser?.id
            Task { if native?.client.currentUser?.id == rejectedUser { await native?.clearLocalSession() } }
        }
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

    deinit { nativeEvents?.cancel() }

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
        if nativeMode { return }
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

    #if DEBUG
    /// Lets lifecycle tests await the whole attempt without guessing at timing.
    func waitForBrowserAttempt() async {
        await browserAttemptTask?.value
    }
    #endif
}
