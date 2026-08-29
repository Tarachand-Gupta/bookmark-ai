import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// The tabs of the Settings window. Raw values keep them stable for deep links
/// (the sidebar's MCP row opens straight into `.mcp`, like the web).
enum SettingsTab: String, Hashable {
    case general, ai, mcp, sync, live, data, account
}

/// The standard Settings scene (⌘,), mirroring the web app's settings dialog:
/// General (server), AI (free credits ⇄ own key), MCP (tool allowlist),
/// Sync (native bookmark mirroring), Live (server URL), Data (export/import),
/// Account.
struct SettingsView: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    @State private var selection: SettingsTab = .general

    var body: some View {
        TabView(selection: $selection) {
            GeneralSettingsTab()
                .tabItem { Label("General", systemImage: "gearshape") }
                .tag(SettingsTab.general)

            AiSettingsTab()
                .tabItem { Label("AI", systemImage: "sparkles") }
                .tag(SettingsTab.ai)

            McpSettingsTab()
                .tabItem { Label("MCP", systemImage: "powerplug") }
                .tag(SettingsTab.mcp)

            SyncSettingsTab()
                .tabItem { Label("Sync", systemImage: "arrow.triangle.2.circlepath") }
                .tag(SettingsTab.sync)

            LiveSettingsTab()
                .tabItem { Label("Live", systemImage: "dot.radiowaves.left.and.right") }
                .tag(SettingsTab.live)

            DataSettingsTab()
                .tabItem { Label("Data", systemImage: "arrow.up.arrow.down.square") }
                .tag(SettingsTab.data)

            AccountSettingsTab()
                .tabItem { Label("Account", systemImage: "person.crop.circle") }
                .tag(SettingsTab.account)
        }
        .frame(width: 500)
        .task { await appEnvironment.settings.load() }
        // The sidebar can ask for a specific tab before the window opens.
        .onChange(of: appEnvironment.requestedSettingsTab, initial: true) { _, requested in
            if let requested {
                selection = requested
                appEnvironment.requestedSettingsTab = nil
            }
        }
    }
}

/// The Local/Cloud switch, plus a live read of the chosen server's health.
struct GeneralSettingsTab: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    var body: some View {
        Form {
            Section {
                Picker("Server", selection: targetBinding) {
                    ForEach(ServerTarget.allCases) { target in
                        Text(target.displayName).tag(target)
                    }
                }
                .pickerStyle(.segmented)

                LabeledContent("Endpoint") {
                    Text(appEnvironment.preferences.serverTarget.baseURL.absoluteString)
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            } footer: {
                Text(appEnvironment.preferences.serverTarget.subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Status") {
                LabeledContent("Reachable") {
                    if let health = appEnvironment.health {
                        Label(
                            health.ok ? "Yes" : "No",
                            systemImage: health.ok ? "checkmark.circle.fill" : "xmark.circle.fill"
                        )
                        .foregroundStyle(health.ok ? .green : .red)
                    } else {
                        Text("Unknown").foregroundStyle(.secondary)
                    }
                }

                LabeledContent("AI features") {
                    Text(appEnvironment.health?.ai == true ? "Configured" : "Unavailable")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .frame(height: 320)
    }

    private var targetBinding: Binding<ServerTarget> {
        Binding(
            get: { appEnvironment.preferences.serverTarget },
            set: { newValue in
                Task { await appEnvironment.changeTarget(newValue) }
            }
        )
    }
}

/// Which AI powers the account — a first-class toggle (Tara's call), not an
/// implicit "did you paste a key" state. The truth on the server is simply
/// whether an own key is stored: Included = no key, Own key = key set.
private enum AiMode: String, CaseIterable, Identifiable {
    case included
    case ownKey

    var id: String { rawValue }
    var title: String {
        switch self {
        case .included: "Included free AI"
        case .ownKey: "Your own key"
        }
    }
}

/// The mode toggle up top, the credits meter, and the own-key form — which is
/// DISABLED (visually and literally) while the included AI is active, and whose
/// model is a real picker fed by `POST /api/settings/ai/models` once the key
/// checks out.
struct AiSettingsTab: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    @State private var mode: AiMode = .included
    @State private var provider = "google"
    @State private var baseUrl = ""
    @State private var model = ""
    @State private var apiKey = ""
    @State private var availableModels: [AiModel] = []
    @State private var isLoadingModels = false
    @State private var modelsMessage: String?
    @State private var hydratedFromServer = false

    private static let providers: [(id: String, label: String)] = [
        ("google", "Google Gemini"),
        ("openai", "OpenAI"),
        ("anthropic", "Anthropic"),
        ("custom", "Custom (OpenAI-compatible)"),
    ]

    var body: some View {
        let settingsModel = appEnvironment.settings
        let ownKeyActive = mode == .ownKey

        Form {
            Section {
                Picker("AI to use", selection: $mode) {
                    ForEach(AiMode.allCases) { entry in
                        Text(entry.title).tag(entry)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
            } footer: {
                Text(ownKeyActive
                    ? "Chat runs on your key and provider. Nothing is metered against the free credits."
                    : "Chat runs on Bookmark AI's shared model — 1,000 free credits every week, no setup.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section {
                AiCreditsCard(usage: settingsModel.aiUsage, dim: ownKeyActive)
                    .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
            }

            Section {
                Picker("Provider", selection: $provider) {
                    ForEach(Self.providers, id: \.id) { entry in
                        Text(entry.label).tag(entry.id)
                    }
                }
                .onChange(of: provider) {
                    // A model list belongs to one provider — never carry it over.
                    availableModels = []
                    model = ""
                    modelsMessage = nil
                }

                if provider == "custom" {
                    TextField("Base URL", text: $baseUrl, prompt: Text("https://api.example.com/v1"))
                }

                SecureField("API key", text: $apiKey, prompt: Text(keyPrompt))

                // The model becomes a real picker the moment a key can list
                // models; before that, the row offers the verification instead
                // of a free-text field that would accept typos silently.
                if availableModels.isEmpty {
                    LabeledContent("Model") {
                        HStack(spacing: 8) {
                            if isLoadingModels {
                                ProgressView().controlSize(.small)
                            }
                            Button("Verify Key & List Models") { loadModels() }
                                .disabled(isLoadingModels || (apiKey.isEmpty && !settingsModel.hasOwnKey))
                        }
                    }
                } else {
                    Picker("Model", selection: $model) {
                        Text("Provider default").tag("")
                        Divider()
                        ForEach(availableModels) { entry in
                            Text(entry.label).tag(entry.id)
                        }
                    }
                }

                if let modelsMessage {
                    Text(modelsMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } header: {
                Text("Your key")
            } footer: {
                Text("The key is stored encrypted server-side and never shown again — only its last 4 characters.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .disabled(!ownKeyActive)
            .opacity(ownKeyActive ? 1 : 0.45)

            Section {
                HStack {
                    if ownKeyActive {
                        Button("Save") { saveOwnKey() }
                            .buttonStyle(.borderedProminent)
                            .disabled(settingsModel.isSaving || (apiKey.isEmpty && !settingsModel.hasOwnKey))
                    } else if settingsModel.hasOwnKey {
                        // Flipping back to Included is a real change: the stored
                        // key is removed so metering (and the server) agree.
                        Button("Switch to Free AI (removes your key)") { removeKey() }
                            .buttonStyle(.borderedProminent)
                            .disabled(settingsModel.isSaving)
                    }

                    if settingsModel.isSaving {
                        ProgressView().controlSize(.small)
                    }
                    Spacer()
                }

                if let message = settingsModel.statusMessage {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(settingsModel.statusIsError ? .red : .secondary)
                }
            }
        }
        .formStyle(.grouped)
        .frame(height: 560)
        // Hydrate the form from the server ONCE — later reloads (credit meter
        // refreshes) must not stomp what the user is typing.
        .onChange(of: settingsModel.settings != nil, initial: true) { _, _ in
            guard !hydratedFromServer, let settings = settingsModel.settings else { return }
            hydratedFromServer = true
            mode = settings.apiKeySet ? .ownKey : .included
            provider = settings.provider
            baseUrl = settings.baseUrl ?? ""
            model = settings.model ?? ""
        }
    }

    private var keyPrompt: String {
        if let last4 = appEnvironment.settings.settings?.apiKeyLast4,
           appEnvironment.settings.hasOwnKey {
            return "Saved (••••\(last4)) — type to replace"
        }
        return "sk-…"
    }

    private func loadModels() {
        isLoadingModels = true
        modelsMessage = nil
        Task {
            defer { isLoadingModels = false }
            do {
                let models = try await appEnvironment.api.listModels(
                    provider: provider, apiKey: apiKey, baseUrl: baseUrl
                )
                availableModels = models
                modelsMessage = models.isEmpty ? "The key works, but no models were listed." : "Key verified — \(models.count) models."
                // Keep the saved model selected when it's in the list.
                if !model.isEmpty, !models.contains(where: { $0.id == model }) { model = "" }
            } catch {
                modelsMessage = (error as? ApiError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    private func saveOwnKey() {
        var body = UpdateSettingsBody(provider: provider)
        if !apiKey.isEmpty { body.apiKey = apiKey }
        if provider == "custom" { body.baseUrl = baseUrl }
        body.model = model
        Task {
            if await appEnvironment.settings.save(body) {
                apiKey = ""
            }
        }
    }

    private func removeKey() {
        Task {
            if await appEnvironment.settings.save(UpdateSettingsBody(apiKey: "")) {
                availableModels = []
                model = ""
            }
        }
    }
}

/// The MCP tool allowlist — which tools `POST /api/mcp` exposes to connected
/// agents. Mirrors the web's Settings → MCP; toggles save immediately.
struct McpSettingsTab: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    var body: some View {
        let settingsModel = appEnvironment.settings

        Form {
            Section {
                ForEach(McpTool.allCases) { tool in
                    Toggle(isOn: binding(for: tool)) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(tool.title)
                            Text(tool.detail)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .disabled(settingsModel.isSaving)
                }
            } header: {
                Text("Tools exposed over MCP")
            } footer: {
                Text("What a connected agent (Claude Code, Claude.ai, …) may do with your library. Changes apply to every existing token immediately.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section {
                LabeledContent("Endpoint") {
                    Text("\(appEnvironment.preferences.serverTarget.baseURL.absoluteString)/api/mcp")
                        .foregroundStyle(.secondary)
                        .textSelection(.enabled)
                }
            } footer: {
                Text("Long-lived access tokens (bkmcp_…) are minted and revoked in the web app's Settings → MCP.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let message = settingsModel.statusMessage {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(settingsModel.statusIsError ? .red : .secondary)
            }
        }
        .formStyle(.grouped)
        .frame(height: 400)
    }

    /// Stored null/absent = every tool enabled — the toggle set reflects that.
    private func enabledTools() -> Set<String> {
        if let stored = appEnvironment.settings.settings?.mcpTools {
            return Set(stored)
        }
        return Set(McpTool.allCases.map(\.rawValue))
    }

    private func binding(for tool: McpTool) -> Binding<Bool> {
        Binding(
            get: { enabledTools().contains(tool.rawValue) },
            set: { enabled in
                var tools = enabledTools()
                if enabled { tools.insert(tool.rawValue) } else { tools.remove(tool.rawValue) }
                // Always send the full array — an all-names array is equivalent
                // to the server's null ("all tools").
                let ordered = McpTool.allCases.map(\.rawValue).filter(tools.contains)
                Task { await appEnvironment.settings.save(UpdateSettingsBody(mcpTools: ordered)) }
            }
        )
    }
}

/// Native browser-bookmark mirroring (extension → Bookmark AI). Two toggles,
/// saved on change — same semantics as the web's Settings → Sync.
struct SyncSettingsTab: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    var body: some View {
        let settingsModel = appEnvironment.settings

        Form {
            Section {
                Toggle(isOn: syncBinding(\.nativeSyncEnabled, key: "nativeSyncEnabled")) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Mirror new browser bookmarks")
                        Text("Bookmarks (and Chrome's reading list) added in the browser are saved here automatically.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .disabled(settingsModel.isSaving)

                Toggle(isOn: syncBinding(\.nativeSyncFull, key: "nativeSyncFull")) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Full sync")
                        Text("Deletions propagate too: removing a native bookmark also removes the saved copy.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .disabled(settingsModel.isSaving)
            } header: {
                Text("Browser bookmark sync")
            } footer: {
                Text("Applies to the browser extension on every device you're signed in on.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let message = settingsModel.statusMessage {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(settingsModel.statusIsError ? .red : .secondary)
            }
        }
        .formStyle(.grouped)
        .frame(height: 280)
    }

    private func syncBinding(_ keyPath: KeyPath<UserSettings, Bool?>, key: String) -> Binding<Bool> {
        Binding(
            get: { appEnvironment.settings.settings?[keyPath: keyPath] ?? false },
            set: { enabled in
                var body = UpdateSettingsBody()
                if key == "nativeSyncEnabled" { body.nativeSyncEnabled = enabled }
                if key == "nativeSyncFull" { body.nativeSyncFull = enabled }
                Task { await appEnvironment.settings.save(body) }
            }
        )
    }
}

/// Settings ▸ Live — the Mac mirror of the web's Devices section: the
/// account-wide sharing switch (off purges every device), per-device
/// "new windows join automatically" switches with Forget, Forget All, and the
/// live-server URL override.
struct LiveSettingsTab: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    @State private var liveServerUrl = ""
    @State private var hydrated = false
    @State private var confirmingDisable = false

    var body: some View {
        let settingsModel = appEnvironment.settings
        let live = appEnvironment.live

        Form {
            Section {
                Toggle(isOn: sharingBinding) {
                    VStack(alignment: .leading, spacing: 1) {
                        Text("Share live tabs")
                        Text("Mirror the tabs your browsers have open so your other devices (and Ask AI) can see them.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .disabled(live.settingsBusy)
            } footer: {
                if let error = live.settingsError {
                    Text(error).font(.caption).foregroundStyle(.red)
                }
            }

            if live.enabled {
                Section {
                    if live.devices.isEmpty {
                        Text("No devices are mirroring tabs yet.")
                            .foregroundStyle(.secondary)
                    }
                    ForEach(live.devices) { device in
                        LiveDeviceSettingsRow(device: device)
                    }

                    if live.devices.count > 1 {
                        Button("Forget All Devices", role: .destructive) {
                            Task { await appEnvironment.live.forgetAllDevices() }
                        }
                        .disabled(live.settingsBusy)
                    }
                } header: {
                    Text("Devices")
                } footer: {
                    Text("Forgetting a device deletes its mirrored tabs from the server. It starts again the next time that browser pushes.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Section {
                TextField(
                    "Server URL",
                    text: $liveServerUrl,
                    prompt: Text(appEnvironment.preferences.serverTarget.liveBaseURL.absoluteString)
                )

                HStack {
                    Button("Save") { save(liveServerUrl) }
                        .disabled(settingsModel.isSaving)
                    Button("Use Default") {
                        liveServerUrl = ""
                        save("")
                    }
                    .disabled(settingsModel.isSaving)
                    Spacer()
                }

                if let message = settingsModel.statusMessage {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(settingsModel.statusIsError ? .red : .secondary)
                }
            } header: {
                Text("Live sessions server")
            } footer: {
                Text("Where Live Tabs connects. Leave empty to use the default for the selected server. All your clients (web, mobile, this app) follow this one setting.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .frame(height: 480)
        .task { await appEnvironment.live.loadForSettings() }
        .onChange(of: settingsModel.settings != nil, initial: true) { _, _ in
            guard !hydrated, let settings = settingsModel.settings else { return }
            hydrated = true
            liveServerUrl = settings.liveServerUrl ?? ""
        }
        .confirmationDialog(
            "Turn off live tab sharing?",
            isPresented: $confirmingDisable,
            titleVisibility: .visible
        ) {
            Button("Turn Off & Delete Mirrored Tabs", role: .destructive) {
                Task { await appEnvironment.live.setSharing(enabled: false) }
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Every device's mirrored tabs are deleted from the server immediately.")
        }
    }

    /// Off is destructive (the server purges every device), so the switch asks
    /// before flipping down; turning ON needs no ceremony.
    private var sharingBinding: Binding<Bool> {
        Binding(
            get: { appEnvironment.live.enabled },
            set: { newValue in
                if newValue {
                    Task { await appEnvironment.live.setSharing(enabled: true) }
                } else {
                    confirmingDisable = true
                }
            }
        )
    }

    private func save(_ value: String) {
        Task {
            if await appEnvironment.settings.save(UpdateSettingsBody(liveServerUrl: value)) {
                // The Live view caches its resolved base — drop it so the next
                // connect honours the new URL immediately, not in 5 minutes.
                appEnvironment.live.reset()
            }
        }
    }
}

/// One device in Settings ▸ Live: identity + freshness, the per-device
/// "new windows join automatically" switch, and Forget.
private struct LiveDeviceSettingsRow: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    let device: LiveDevice

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: device.symbolName)
                    .foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 0) {
                    Text(device.label)
                    Text("\(device.browser.capitalized) · \(device.freshnessText) · \(device.tabCount) tab\(device.tabCount == 1 ? "" : "s")")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button("Forget") {
                    Task { await appEnvironment.live.forgetDevice(deviceId: device.deviceId) }
                }
                .controlSize(.small)
                .disabled(appEnvironment.live.settingsBusy)
            }

            Toggle("New windows join automatically", isOn: newWindowsBinding)
                .font(.caption)
                .controlSize(.small)
                .disabled(appEnvironment.live.settingsBusy)
                .help("Off: windows opened on this device after the change aren't shared unless turned on individually in the extension popup.")
        }
        .padding(.vertical, 2)
    }

    /// Absent = true — the fail-safe default from the schema.
    private var newWindowsBinding: Binding<Bool> {
        Binding(
            get: { device.newWindowsShared ?? true },
            set: { shared in
                Task {
                    await appEnvironment.live.setNewWindowsShared(
                        deviceId: device.deviceId, shared: shared
                    )
                }
            }
        )
    }
}

/// Export/import of the full library — the same lossless bundle as the web's
/// Settings ▸ Data. Files go through the user's own save/open panels.
struct DataSettingsTab: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    @State private var isWorking = false
    @State private var statusMessage: String?
    @State private var statusIsError = false

    var body: some View {
        Form {
            Section {
                LabeledContent("Everything, as JSON") {
                    Button("Export…") { exportBundle() }
                        .disabled(isWorking)
                }
            } header: {
                Text("Export")
            } footer: {
                Text("Every bookmark and session, minus the regenerable AI embeddings. Re-importing the same file later is a safe no-op.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section("Import") {
                LabeledContent("From a previous export") {
                    Button("Import…") { importBundle() }
                        .disabled(isWorking)
                }
            }

            if isWorking {
                ProgressView().controlSize(.small)
            }
            if let statusMessage {
                Text(statusMessage)
                    .font(.caption)
                    .foregroundStyle(statusIsError ? .red : .secondary)
            }
        }
        .formStyle(.grouped)
        .frame(height: 280)
    }

    private func exportBundle() {
        let panel = NSSavePanel()
        panel.allowedContentTypes = [.json]
        panel.nameFieldStringValue = "bookmark-ai-export.json"
        guard panel.runModal() == .OK, let url = panel.url else { return }

        isWorking = true
        statusMessage = nil
        Task {
            defer { isWorking = false }
            do {
                let data = try await appEnvironment.api.exportData()
                try data.write(to: url)
                statusMessage = "Exported to \(url.lastPathComponent)."
                statusIsError = false
            } catch {
                statusMessage = (error as? ApiError)?.errorDescription ?? error.localizedDescription
                statusIsError = true
            }
        }
    }

    private func importBundle() {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [.json]
        panel.allowsMultipleSelection = false
        guard panel.runModal() == .OK, let url = panel.url else { return }

        isWorking = true
        statusMessage = nil
        Task {
            defer { isWorking = false }
            do {
                let data = try Data(contentsOf: url)
                try await appEnvironment.api.importData(data)
                statusMessage = "Imported. Refreshing the library…"
                statusIsError = false
                await appEnvironment.loadEverything()
            } catch {
                statusMessage = (error as? ApiError)?.errorDescription ?? error.localizedDescription
                statusIsError = true
            }
        }
    }
}

/// Sign in / sign out, and whatever `GET /api/me` reports.
struct AccountSettingsTab: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    var body: some View {
        let target = appEnvironment.preferences.serverTarget
        let auth = appEnvironment.auth

        Form {
            if target.requiresAuth {
                Section {
                    LabeledContent("Status") {
                        switch auth.status {
                        case .unknown:
                            Text("Checking…").foregroundStyle(.secondary)
                        case .signedOut:
                            Label("Signed out", systemImage: "person.crop.circle.badge.xmark")
                                .foregroundStyle(.secondary)
                        case .signedIn:
                            Label("Signed in", systemImage: "checkmark.seal.fill")
                                .foregroundStyle(.green)
                        }
                    }

                    if let account = auth.account {
                        LabeledContent("Name") {
                            Text(account.displayName).foregroundStyle(.secondary)
                        }
                        if let detail = account.displayDetail {
                            LabeledContent("Email") {
                                Text(detail).foregroundStyle(.secondary).textSelection(.enabled)
                            }
                        }
                    }
                } footer: {
                    Text("Sign-in opens the web app's Clerk page in a secure window. The session is kept in this app's own sandboxed website storage — no password or token is written anywhere else.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section {
                    if auth.status == .signedIn {
                        Button("Sign Out") {
                            Task { await appEnvironment.signOut() }
                        }
                    } else {
                        Button("Sign In…") { auth.beginSignIn() }
                            .buttonStyle(.borderedProminent)
                    }

                    if let error = auth.lastError {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                }
            } else {
                Section {
                    Label("Local mode needs no sign-in", systemImage: "laptopcomputer")
                } footer: {
                    Text("The local dev server is expected to run with DEV_OPEN_API=1, which bypasses Clerk entirely. Switch to Cloud in General to sign in.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .frame(height: 320)
    }
}
