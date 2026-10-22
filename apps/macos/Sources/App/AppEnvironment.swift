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
    /// Cloud without an admitted cache or session: sign-in is required.
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
    let organization: OrganizationModel
    let chat: ChatModel
    let sessions: SessionsModel
    let live: LiveModel
    let settings: SettingsModel
    let skills: SkillsModel
    let mcpTokens: McpTokensModel
    /// The update banner's brain — polls `/api/app/releases` while the gate is open.
    let updates: AppUpdateModel

    /// The last session's library on disk, written through on every successful
    /// refresh and read once at launch so the window renders real content
    /// before the first network round-trip. Injectable for tests.
    let cache: LibraryCache

    /// Set when a disk snapshot actually hydrates the models (`hydrateFromCache`)
    /// and cleared the moment the launch refresh settles (`loadEverything`, in
    /// its `defer`) or the sign-out flush runs. The pill's LATCH, never re-armed
    /// by later refreshes — the models' own `isSyncingFromCache` flags carry the
    /// "the rendered rows are still cache" half of the condition.
    private var launchSyncPending = false
    private var cachedState: LibraryCacheState?
    private var dataGeneration = UUID()
    var lastUpdated: Date? { cachedState?.savedAt.flatMap(ISO8601.date) }
    var displayAccount: AccountInfo? { auth.account ?? cachedState?.account }
    var isCachedReader: Bool {
        guard let state = cachedState, state.accountId != nil, state.origin == api.target.baseURL.absoluteString else { return false }
        if let current = auth.confirmedAccountIdentifier { return current == state.accountId }
        return true
    }
    var isReadOnly: Bool { preferences.serverTarget.requiresAuth && auth.status != .signedIn }
    var cacheStatus: String? {
        guard isCachedReader else { return nil }
        if isReadOnly { return auth.status == .signedOut ? "Cached library · sign in to sync" : "Offline library · reconnecting quietly" }
        if library.errorMessage != nil { return "Offline · showing saved library" }
        return nil
    }

    /// The syncing pill's condition: the launch refresh is in flight AND at
    /// least one hydrated model still shows cache-derived rows. Derived, so the
    /// pill can't desynchronize from the data it describes. A true first run
    /// (nothing hydrated) keeps the current full-window loading look.
    var isSyncing: Bool {
        launchSyncPending && (library.isSyncingFromCache || sessions.isSyncingFromCache)
    }

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
    /// network; `cache` so tests use a throwaway folder instead of the app's
    /// real snapshot (the test host IS the app).
    init(preferences: Preferences? = nil, session: URLSession? = nil, cache: LibraryCache? = nil) {
        let preferences = preferences ?? Preferences()
        let api = ApiClient(target: preferences.serverTarget, session: session)
        let auth = AuthController(origin: preferences.serverTarget.authOrigin)
        let cache = cache ?? LibraryCache.shared

        self.preferences = preferences
        self.api = api
        self.auth = auth
        self.cache = cache
        self.library = LibraryModel(api: api)
        self.chat = ChatModel(api: api)
        self.organization = OrganizationModel(api: api)
        self.sessions = SessionsModel(api: api)
        self.live = LiveModel(api: api)
        self.settings = SettingsModel(api: api)
        self.skills = SkillsModel(api: api)
        self.mcpTokens = McpTokensModel(api: api)
        self.updates = AppUpdateModel(api: api, defaults: preferences.defaults)

        self.organization.onChange = { [weak self] in
            guard let self else { return }
            await self.library.refresh()
            if !self.library.searchText.isEmpty { await self.library.search(self.library.searchText) }
        }

        // ApiClient asks AuthController for a bearer token on every cloud request.
        api.tokenProvider = { [weak auth] forceRefresh in
            await auth?.token(forceRefresh: forceRefresh)
        }
        // A 401 that survives the forced re-mint ends the session for the app.
        api.onUnauthorized = { [weak auth] in
            Task { @MainActor in auth?.handleUnauthorized() }
        }

        // Revocation clears private state. Missing/expired sessions retain only
        // the previously authorized read-only snapshot; confirmed sessions refresh.
        auth.onAccessRevoked = { [weak self] in self?.clearPrivateData() }
        auth.onSignedOut = { [weak self] in self?.handleSignedOut() }
        auth.onSessionConfirmed = { [weak self] in self?.gateOpened() }

        // A chat tool that creates/installs a skill refreshes the Skills sheet.
        let skills = self.skills
        self.chat.onSkillsChanged = { Task { await skills.load() } }

        // Show LAST SESSION'S data before any network work: hydrate the models
        // the main window renders at rest. A snapshot from another target is
        // dropped; the pill only arms if something actually hydrated.
        hydrateFromCache(cache.read())
        library.onLoaded = { [weak self] in self?.persistSnapshot() }
        sessions.onLoaded = { [weak self] in self?.persistSnapshot() }
    }

    /// Render LAST SESSION'S data before any network work: hydrate the models
    /// the main window renders at rest and arm the pill's latch when something
    /// actually applied. Kept on `AppEnvironment` (not just the models) because
    /// arming app-level state — the pill, and through it the gate — is an
    /// app-level decision the models must not be able to trigger from the
    /// outside. Tests call this instead of the models' own hydrators.
    @discardableResult
    func hydrateFromCache(_ state: LibraryCacheState?) -> Bool {
        let target = preferences.serverTarget.rawValue
        guard let state, state.serverTarget == target else { return false }
        if SupabaseConfiguration.isSupabase || state.accountId != nil {
            guard state.accountId != nil, state.origin == api.target.baseURL.absoluteString else { return false }
            if let current = auth.confirmedAccountIdentifier, current != state.accountId { return false }
            cachedState = state
            organization.restoreMetadata(state.organization)
            settings.restoreSnapshot(planId: state.planId, usage: state.aiUsage)
            library.isReadOnly = isReadOnly; sessions.isReadOnly = isReadOnly
            library.cachedFolders = state.organization?.folders ?? []
        }
        let libraryApplied = library.hydrateFromCache(state, serverTarget: target)
        let sessionsApplied = sessions.hydrateFromCache(state, serverTarget: target)
        launchSyncPending = libraryApplied || sessionsApplied
        return launchSyncPending
    }

    // MARK: - Gate

    /// See `AccessGate`. Local never gates; cloud follows the auth status —
    /// EXCEPT when the window is already showing last session's data from the
    /// disk cache: then the connecting stretch does NOT blank the window with
    /// the spinner (Tara's cold-start spec). The cached library renders, the
    /// restore retries underneath. Missing/expired authentication leaves a
    /// read-only reader; rejected credentials, MFA, logout and deletion purge it.
    var gate: AccessGate {
        guard preferences.serverTarget.requiresAuth else { return .ready }
        switch auth.status {
        case .signedIn:
            if let owner = cachedState?.accountId, let current = auth.confirmedAccountIdentifier, owner != current { return .connecting }
            return .ready
        case .signedOut: return isCachedReader ? .ready : .signedOut
        case .unknown, .unreachable:
            return isCachedReader || isSyncing ? .ready : .connecting
        }
    }

    /// Data is fetched (and data-bearing UI shown) ONLY behind an open gate.
    /// Signed out: the sign-in screen. Connecting: the spinner. Nothing is
    /// requested without a session, so a Clerk blip never yields 401 banners.
    var canUseData: Bool { gate == .ready && (!preferences.serverTarget.requiresAuth || auth.status == .signedIn) }

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
        await auth.updateOrigin(target.authOrigin)
        await auth.restore(requiresAuth: target.requiresAuth)
        if !target.requiresAuth { gateOpened() }
    }

    /// The gate just opened — load everything, in a task of ITS OWN. Every
    /// opening passes through here: a confirmed cloud session (whichever path
    /// confirmed it) and the Local target. Owning the task keeps identity and
    /// model loading independent from the restore or browser-handoff task that
    /// opened the gate; dismissing or canceling its source UI cannot cancel the
    /// account load after the session has been adopted.
    private func gateOpened() {
        if let owner = cachedState?.accountId, let current = auth.confirmedAccountIdentifier, owner != current {
            clearPrivateData()
        }
        library.isReadOnly = false; sessions.isReadOnly = false
        sessionLoad = Task { @MainActor [weak self] in await self?.loadEverything() }
    }

    /// Refresh the library plus the side reads that decorate the UI: who is
    /// signed in (footer, Settings ▸ Account) and the server's health. Also the
    /// moment the update poll starts — every gate opening passes through here
    /// (via `gateOpened`), and so does ⌘R. Every successful refresh is
    /// written through to the disk cache, so the NEXT launch can render this
    /// state immediately.
    func loadEverything() async {
        guard canUseData else {
            launchSyncPending = false
            library.isReadOnly = true; sessions.isReadOnly = true
            return
        }
        let ticket = dataGeneration
        defer { if ticket == dataGeneration { launchSyncPending = false } }
        updates.start()
        // Identity precedes private loads, so a new account cannot receive an old snapshot.
        await auth.loadAccount(using: api)
        guard ticket == dataGeneration, !Task.isCancelled else { return }
        let accountId = auth.account?.accountId ?? (!api.target.requiresAuth ? "local" : nil)
        if let old = cachedState?.accountId, let accountId, old != accountId {
            library.reset(); sessions.reset(); settings.reset(); chat.reset(); organization.reset()
            cache.delete(); cachedState = nil
        }
        organization.bind(accountId: accountId)
        if organization.data == nil { organization.restoreMetadata(cachedState?.organization) }
        chat.bind(scope: accountId.map { OrganizationScope(origin: api.target.baseURL.absoluteString, accountId: $0) })
        library.isReadOnly = false; sessions.isReadOnly = false
        async let rows: Void = library.refresh()
        async let metadata: Void = organization.refresh()
        async let profile: Void = settings.load()
        _ = await (rows, metadata, profile)
        guard ticket == dataGeneration, !Task.isCancelled else { return }
        health = try? await api.health()
        guard ticket == dataGeneration else { return }
        persistSnapshot()
    }
    func retryConnection() async {
        if auth.status == .signedIn || !api.target.requiresAuth { await loadEverything() }
        else { await auth.restore(requiresAuth: api.target.requiresAuth) }
    }

    /// The snapshot to write through: the All-Bookmarks state (what the app
    /// always opens on) stamped with the current target, plus the Sessions
    /// list. Written after every successful refresh, so the NEXT launch
    /// renders this exact state instantly.
    func persistSnapshot() {
        guard canUseData, library.errorMessage == nil else { return }
        var state = library.cacheState(serverTarget: preferences.serverTarget.rawValue, sessions: sessions.sessions)
        let accountId = auth.account?.accountId ?? (!api.target.requiresAuth ? "local" : nil)
        if SupabaseConfiguration.isSupabase && accountId == nil { return }
        if let confirmed = auth.confirmedAccountIdentifier, let accountId, confirmed != accountId { return }
        state.accountId = accountId; state.origin = api.target.baseURL.absoluteString
        state.savedAt = ISO8601DateFormatter().string(from: Date())
        state.organization = organization.data ?? cachedState?.organization
        state.account = auth.account ?? cachedState?.account
        state.planId = settings.plan?.id; state.aiUsage = settings.aiUsage
        cachedState = state
        cache.write(state)
    }
    /// Explicit logout/deletion is different from expired/offline authentication.
    /// Clear before suspension so late callbacks cannot revive private content.
    func clearPrivateData() {
        let scope = cachedState?.accountId.map { OrganizationScope(origin: cachedState?.origin ?? api.target.baseURL.absoluteString, accountId: $0) }
        chat.clearPrivateDrafts(scope: scope); organization.clearPrivateRecovery(scope: scope)
        resetModels()
    }

    /// Account menu / Settings ▸ Sign Out. The flush happens through `auth.onSignedOut`.
    func signOut() async {
        clearPrivateData()
        await auth.signOut()
    }

    /// Keep only an admitted account snapshot through an absent session. Server
    /// mutations, chat and live data remain unavailable until authentication returns.
    func handleSignedOut() {
        if isCachedReader {
            dataGeneration = UUID(); sessionLoad?.cancel(); sessionLoad = nil
            chat.reset(); organization.reset(); live.reset(); skills.reset(); mcpTokens.reset()
            organization.restoreMetadata(cachedState?.organization)
            library.isReadOnly = true; sessions.isReadOnly = true
            library.searchText = ""
            library.cachedFolders = cachedState?.organization?.folders ?? []
            launchSyncPending = false; updates.stop()
        } else { resetModels() }
        requestedSettingsTab = nil
        isPresentingTour = false
    }

    private func resetModels() {
        dataGeneration = UUID(); cachedState = nil
        // A load still in flight for the closing gate must not land in the
        // emptied models (or in the next account's).
        sessionLoad?.cancel()
        sessionLoad = nil
        library.reset()
        chat.reset()
        organization.reset()
        sessions.reset()
        live.reset()
        settings.reset()
        skills.reset()
        mcpTokens.reset()
        health = nil
        // The snapshot is account data: a signed-out window (or the next
        // account / server target) must never render the previous one's rows
        // from disk, exactly as if they had never been fetched.
        cache.delete()
        launchSyncPending = false
        // The gate is closing (or the target is changing): stop polling; the
        // next `loadEverything` restarts it against the current server. The
        // last answer is not account data and stays.
        updates.stop()
    }
}
