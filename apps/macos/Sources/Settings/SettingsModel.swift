import Foundation
import Observation

/// The server-side user settings (`GET/PUT /api/settings`): AI mode + provider
/// config, the free-credits meter, and the live-server override — plus the
/// account's plan (`GET /api/account`). One instance in `AppEnvironment` feeds
/// both the Settings window and the chat's credits card, so the numbers can't
/// drift between surfaces.
@MainActor
@Observable
final class SettingsModel {

    private(set) var settings: UserSettings?
    private(set) var isLoading = false
    private(set) var isSaving = false
    /// One line of outcome under the form ("Saved." / the error).
    private(set) var statusMessage: String?
    private(set) var statusIsError = false

    /// The account's plan, resolved from `GET /api/account` once per session.
    /// nil until loaded and after every sign-out — the plan card belongs to an
    /// account, so nothing is drawn before one is confirmed. Everyone resolves
    /// to Free today (also when the route isn't there).
    private(set) var plan: PlanInfo?

    private var generation = UUID()
    private var cachedUsage: AiUsage?
    private let api: ApiClient

    init(api: ApiClient) {
        self.api = api
    }

    var aiUsage: AiUsage? { settings?.aiUsage ?? cachedUsage }
    var hasOwnKey: Bool { settings?.apiKeySet ?? false }
    /// The persisted mode (or the legacy derivation on an older server).
    var aiMode: AiMode { settings?.resolvedAiMode ?? .included }

    func restoreSnapshot(planId: String?, usage: AiUsage?) {
        if let planId { plan = PlanInfo.resolve(planId) }
        cachedUsage = usage
    }
    func load() async {
        let ticket = generation
        isLoading = true
        defer { if ticket == generation { isLoading = false } }
        do {
            let response = try await api.settings()
            guard ticket == generation, !Task.isCancelled else { return }
            settings = response.settings; cachedUsage = response.settings.aiUsage
            statusMessage = nil; statusIsError = false
        } catch {
            guard ticket == generation else { return }
            statusMessage = "Couldn't refresh settings. Saved information is still shown."; statusIsError = true
        }
        let response = await planResponse()
        guard ticket == generation, !Task.isCancelled else { return }
        switch response {
        case .success(let account): plan = PlanInfo.resolve(account.plan)
        case .failure(ApiError.server(status: 404, _)): if plan == nil { plan = .free }
        case .failure: break
        }
    }

    private func planResponse() async -> Result<AccountResponse, Error> {
        do { return .success(try await api.account()) } catch { return .failure(error) }
    }

    /// PUT and adopt the server's echo. Returns success so callers can chain
    /// (e.g. reconnect the live stream after a URL change).
    @discardableResult
    func save(_ body: UpdateSettingsBody) async -> Bool {
        let ticket = generation
        isSaving = true
        defer { if ticket == generation { isSaving = false } }
        statusMessage = nil
        do {
            let response = try await api.updateSettings(body)
            guard ticket == generation, !Task.isCancelled else { return false }
            settings = response.settings
            statusMessage = "Saved."
            statusIsError = false
            return true
        } catch {
            guard ticket == generation else { return false }
            statusMessage = (error as? ApiError)?.errorDescription ?? error.localizedDescription
            statusIsError = true
            return false
        }
    }

    /// The Included ⇄ Own switch: PUTs `{aiMode}` ALONE, so the stored key,
    /// provider, and model are untouched. The server refuses `own` without a
    /// stored key (400) — the message is surfaced as the status line.
    @discardableResult
    func setAiMode(_ mode: AiMode) async -> Bool {
        guard mode != aiMode else { return true }
        return await save(UpdateSettingsBody(aiMode: mode))
    }

    /// The ONLY path that sends `apiKey: ""`. The server clears the key and
    /// switches the mode back to Included in the same write.
    @discardableResult
    func removeKey() async -> Bool {
        await save(UpdateSettingsBody(apiKey: ""))
    }

    func clearStatus() {
        statusMessage = nil
        statusIsError = false
    }

    #if DEBUG
    /// Previews/tests: settings as if `GET /api/settings` had answered.
    func seed(_ settings: UserSettings, plan: PlanInfo? = .free) {
        self.settings = settings
        self.plan = plan
    }
    #endif

    func reset() {
        generation = UUID(); cachedUsage = nil; isSaving = false; isLoading = false
        settings = nil
        statusMessage = nil
        statusIsError = false
        plan = nil
    }
}
