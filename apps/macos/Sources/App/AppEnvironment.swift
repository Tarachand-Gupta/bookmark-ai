import Foundation
import Observation

/// What the window may show right now. Derived from the server target and the
/// auth status — the ONE gate every scene (main window, Settings, menu bar)
/// reads, so they can never disagree about whether data may be on screen.
enum AccessGate: Equatable {
    /// Local target, or a confirmed cloud session: the full app.
    case ready
    /// Cloud, session neither confirmed nor denied yet: spinner, no data.
    case connecting
    /// Cloud, Clerk says no session: the sign-in screen and nothing else.
    case signedOut
}

/// Composition root — builds the object graph once and keeps the pieces wired
/// as settings change. Held as a single `@State` in the `App`, then injected
/// into the view tree with `.environment(_:)`.
@MainActor
@Observable
final class AppEnvironment {

    let preferences: Preferences
    let api: ApiClient
    let auth: AuthController
    let library: LibraryModel
    let chat: ChatModel
    let sessions: SessionsModel
    let live: LiveModel
    let settings: SettingsModel
    let skills: SkillsModel
    let mcpTokens: McpTokensModel
    /// The update banner's brain — polls `/api/app/releases` while the gate is open.
    let updates: AppUpdateModel

    /// `GET /api/health` for the Settings diagnostics row.
    private(set) var health: HealthResponse?

    /// Set by the sidebar's MCP row (etc.) just before opening Settings, so the
    /// window lands on that tab. Consumed by `SettingsView`.
    var requestedSettingsTab: SettingsTab?

    /// Drives the feature-tour sheet (sidebar ▸ Tour).
    var isPresentingTour = false

    /// The load started by the last gate opening (`gateOpened`). Cancelled by
    /// the flush; awaited by tests.
    @ObservationIgnored private(set) var sessionLoad: Task<Void, Never>?

    /// `preferences` is injectable so tests/previews can use a throwaway
    /// `UserDefaults` suite instead of the app's real one (the unit-test host
    /// IS the app, so `.standard` would be Tara's actual settings); `session`
    /// so they can answer the API from a stubbed `URLProtocol` instead of the
    /// network.
    init(preferences: Preferences? = nil, session: URLSession? = nil) {
        let preferences = preferences ?? Preferences()
        let api = ApiClient(target: preferences.serverTarget, session: session)
        let auth = AuthController(origin: preferences.serverTarget.authOrigin)

        self.preferences = preferences
        self.api = api
        self.auth = auth
        self.library = LibraryModel(api: api)
        self.chat = ChatModel(api: api)
        self.sessions = SessionsModel(api: api)
        self.live = LiveModel(api: api)
        self.settings = SettingsModel(api: api)
        self.skills = SkillsModel(api: api)
        self.mcpTokens = McpTokensModel(api: api)
        self.updates = AppUpdateModel(api: api, defaults: preferences.defaults)

        // ApiClient asks AuthController for a bearer token on every cloud request.
        api.tokenProvider = { [weak auth] forceRefresh in
            await auth?.token(forceRefresh: forceRefresh)
        }
        // A 401 that survives the forced re-mint ends the session for the app.
        api.onUnauthorized = { [weak auth] in
            Task { @MainActor in auth?.handleUnauthorized() }
        }

        // Every definitive sign-out — Clerk saying "no session", the account
        // menu, a rejected fresh token — flushes the models in ONE place; every
        // confirmed session — launch restore, backoff retry, Retry, the sign-in
        // sheet, an on-demand mint — loads them in ONE place.
        auth.onSignedOut = { [weak self] in self?.handleSignedOut() }
        auth.onSessionConfirmed = { [weak self] in self?.gateOpened() }

        // A chat tool that creates/installs a skill refreshes the Skills sheet.
        let skills = self.skills
        self.chat.onSkillsChanged = { Task { await skills.load() } }
    }

    // MARK: - Gate

    /// See `AccessGate`. Local never gates; cloud follows the auth status.
    var gate: AccessGate {
        guard preferences.serverTarget.requiresAuth else { return .ready }
        switch auth.status {
        case .signedIn: return .ready
        case .signedOut: return .signedOut
        case .unknown, .unreachable: return .connecting
        }
    }

    /// Data is fetched (and data-bearing UI shown) ONLY behind an open gate.
    /// Signed out: the sign-in screen. Connecting: the spinner. Nothing is
    /// requested without a session, so a Clerk blip never yields 401 banners.
    var canUseData: Bool { gate == .ready }

    // MARK: - Lifecycle

    /// First run of the app: restore any persisted session. A confirmed cloud
    /// session loads through `auth.onSessionConfirmed`; Local has no session to
    /// confirm — its gate is open from the start — so it loads here.
    func start() async {
        await auth.restore(requiresAuth: preferences.serverTarget.requiresAuth)
        if !preferences.serverTarget.requiresAuth { gateOpened() }
    }

    /// Flip Local ↔︎ Cloud. Everything downstream is rebuilt: no row, facet,
    /// token, transcript, or live frame from the previous backend may leak into
    /// the new one.
    func changeTarget(_ target: ServerTarget) async {
        guard target != preferences.serverTarget else { return }
        preferences.serverTarget = target
        api.target = target
        resetModels()

        // Auth points at the CLOUD origin — the Clerk-backed one — unless the
        // local target was started with sign-in on (`ServerTarget.authOrigin`).
        // Plain Local mode simply never attaches the token.
        auth.updateOrigin(target.authOrigin)
        await auth.restore(requiresAuth: target.requiresAuth)
        if !target.requiresAuth { gateOpened() }
    }

    /// The gate just opened — load everything, in a task of ITS OWN. Every
    /// opening passes through here: a confirmed cloud session (whichever path
    /// confirmed it) and the Local target. Owning the task is the point: the
    /// trigger may be running inside a task somebody else is about to cancel.
    /// The sign-in sheet's `.task` is the case that bit — SwiftUI cancels it
    /// the instant the sheet dismisses (the first thing `completeSignIn` does),
    /// and inside a cancelled task URLSession fails with `.cancelled` before
    /// any response is read. The token survived (its mint runs in its own
    /// task), so the app read "Signed in" while `/api/me` — awaited as a child
    /// of that task — never landed, and the identity sat on "Loading your
    /// account…" until a relaunch. The library, which hops into its own task,
    /// loaded fine, which is why only the identity looked broken.
    private func gateOpened() {
        sessionLoad = Task { @MainActor [weak self] in await self?.loadEverything() }
    }

    /// Refresh the library plus the side reads that decorate the UI: who is
    /// signed in (footer, Settings ▸ Account) and the server's health. Also the
    /// moment the update poll starts — every gate opening passes through here
    /// (via `gateOpened`), and so does ⌘R.
    func loadEverything() async {
        guard canUseData else { return }
        updates.start()
        async let identity: Void = auth.loadAccount(using: api)
        async let rows: Void = library.refresh()
        _ = await (identity, rows)
        health = try? await api.health()
    }

    /// The sign-in sheet saw a token. Adopts the session in a task of its own
    /// — the sheet's `.task` dies with the sheet, which `completeSignIn()`
    /// dismisses first thing — and the confirmed session then loads through
    /// `onSessionConfirmed` → `gateOpened()`. Returned so tests can await it.
    @discardableResult
    func finishSignIn() -> Task<Void, Never> {
        Task { @MainActor [auth] in await auth.completeSignIn() }
    }

    /// Account menu / Settings ▸ Sign Out. The flush happens through `auth.onSignedOut`.
    func signOut() async {
        await auth.signOut()
    }

    /// THE flush: every model empties on any transition to signed-out, so
    /// nothing from the previous account can remain anywhere — library, chat,
    /// sessions, live, settings + plan, skills, MCP tokens, health, and the
    /// window state that pointed into them. Idempotent — `AuthController`
    /// calls it through `onSignedOut`.
    func handleSignedOut() {
        resetModels()
        requestedSettingsTab = nil
        isPresentingTour = false
    }

    private func resetModels() {
        // A load still in flight for the closing gate must not land in the
        // emptied models (or in the next account's).
        sessionLoad?.cancel()
        sessionLoad = nil
        library.reset()
        chat.reset()
        sessions.reset()
        live.reset()
        settings.reset()
        skills.reset()
        mcpTokens.reset()
        health = nil
        // The gate is closing (or the target is changing): stop polling; the
        // next `loadEverything` restarts it against the current server. The
        // last answer is not account data and stays.
        updates.stop()
    }
}
