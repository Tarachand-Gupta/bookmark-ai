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

    /// `preferences` is injectable so tests/previews can use a throwaway
    /// `UserDefaults` suite instead of the app's real one (the unit-test host
    /// IS the app, so `.standard` would be Tara's actual settings).
    init(preferences: Preferences? = nil) {
        let preferences = preferences ?? Preferences()
        let api = ApiClient(target: preferences.serverTarget)
        let auth = AuthController(origin: ServerTarget.cloud.baseURL)

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
        // menu, a rejected fresh token — flushes the models in ONE place; a
        // session confirmed later (backoff retry, Retry) loads them.
        auth.onSignedOut = { [weak self] in self?.handleSignedOut() }
        auth.onSessionRestored = { [weak self] in
            Task { @MainActor in await self?.loadEverything() }
        }

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

    /// First run of the app: restore any persisted session, then load the library.
    func start() async {
        await auth.restore(requiresAuth: preferences.serverTarget.requiresAuth)
        if canUseData { await loadEverything() }
    }

    /// Flip Local ↔︎ Cloud. Everything downstream is rebuilt: no row, facet,
    /// token, transcript, or live frame from the previous backend may leak into
    /// the new one.
    func changeTarget(_ target: ServerTarget) async {
        guard target != preferences.serverTarget else { return }
        preferences.serverTarget = target
        api.target = target
        resetModels()

        // Auth always points at the CLOUD origin — that is the only Clerk-backed
        // one. Local mode simply never attaches the token.
        auth.updateOrigin(ServerTarget.cloud.baseURL)
        await auth.restore(requiresAuth: target.requiresAuth)
        if canUseData { await loadEverything() }
    }

    /// Refresh the library plus the side reads that decorate the UI: who is
    /// signed in (footer, Settings ▸ Account) and the server's health. Also the
    /// moment the update poll starts — every gate opening passes through here.
    func loadEverything() async {
        guard canUseData else { return }
        updates.start()
        async let identity: Void = auth.loadAccount(using: api)
        async let rows: Void = library.refresh()
        _ = await (identity, rows)
        health = try? await api.health()
    }

    /// Called after the sign-in sheet succeeds.
    func finishSignIn() async {
        await auth.completeSignIn()
        if canUseData { await loadEverything() }
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
