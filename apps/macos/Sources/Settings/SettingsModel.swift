import Foundation
import Observation

/// The server-side user settings (`GET/PUT /api/settings`): AI provider config,
/// the free-credits meter, and the live-server override. One instance in
/// `AppEnvironment` feeds both the Settings window and the chat's credits card,
/// so the numbers can't drift between surfaces.
@MainActor
@Observable
final class SettingsModel {

    private(set) var settings: UserSettings?
    private(set) var isLoading = false
    private(set) var isSaving = false
    /// One line of outcome under the form ("Saved." / the error).
    private(set) var statusMessage: String?
    private(set) var statusIsError = false

    private let api: ApiClient

    init(api: ApiClient) {
        self.api = api
    }

    var aiUsage: AiUsage? { settings?.aiUsage }
    var hasOwnKey: Bool { settings?.apiKeySet ?? false }

    func load() async {
        isLoading = true
        defer { isLoading = false }
        settings = try? await api.settings().settings
    }

    /// PUT and adopt the server's echo. Returns success so callers can chain
    /// (e.g. reconnect the live stream after a URL change).
    @discardableResult
    func save(_ body: UpdateSettingsBody) async -> Bool {
        isSaving = true
        defer { isSaving = false }
        statusMessage = nil
        do {
            settings = try await api.updateSettings(body).settings
            statusMessage = "Saved."
            statusIsError = false
            return true
        } catch {
            statusMessage = (error as? ApiError)?.errorDescription ?? error.localizedDescription
            statusIsError = true
            return false
        }
    }

    func clearStatus() {
        statusMessage = nil
        statusIsError = false
    }

    func reset() {
        settings = nil
        statusMessage = nil
        statusIsError = false
    }
}
