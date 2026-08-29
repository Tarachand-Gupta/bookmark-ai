import Foundation
import Observation

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

    /// `GET /api/health` for the Settings diagnostics row.
    private(set) var health: HealthResponse?

    /// Set by the sidebar's MCP row (etc.) just before opening Settings, so the
    /// window lands on that tab. Consumed by `SettingsView`.
    var requestedSettingsTab: SettingsTab?

    /// Drives the feature-tour sheet (sidebar ▸ Tour).
    var isPresentingTour = false

    init() {
        let preferences = Preferences()
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

        // ApiClient asks AuthController for a bearer token on every cloud request.
        api.tokenProvider = { [weak auth] forceRefresh in
            await auth?.token(forceRefresh: forceRefresh)
        }
    }

    /// First run of the app: restore any persisted session, then load the library.
    func start() async {
        await auth.restore(requiresAuth: preferences.serverTarget.requiresAuth)
        await loadEverything()
    }

    /// Flip Local ↔︎ Cloud. Everything downstream is rebuilt: no row, facet,
    /// token, transcript, or live frame from the previous backend may leak into
    /// the new one.
    func changeTarget(_ target: ServerTarget) async {
        guard target != preferences.serverTarget else { return }
        preferences.serverTarget = target
        api.target = target
        library.reset()
        chat.reset()
        sessions.reset()
        live.reset()
        settings.reset()
        health = nil

        // Auth always points at the CLOUD origin — that is the only Clerk-backed
        // one. Local mode simply never attaches the token.
        auth.updateOrigin(ServerTarget.cloud.baseURL)
        await auth.restore(requiresAuth: target.requiresAuth)
        await loadEverything()
    }

    /// Refresh the library plus the two side reads that decorate the UI.
    func loadEverything() async {
        await library.refresh()
        await auth.loadAccount(using: api)
        health = try? await api.health()
    }

    /// Called after the sign-in sheet succeeds.
    func finishSignIn() async {
        await auth.completeSignIn()
        await loadEverything()
    }

    func signOut() async {
        await auth.signOut()
        library.reset()
        chat.reset()
        sessions.reset()
        live.reset()
        settings.reset()
        await loadEverything()
    }
}
