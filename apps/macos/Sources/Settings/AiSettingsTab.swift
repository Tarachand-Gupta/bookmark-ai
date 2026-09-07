import SwiftUI

/// Settings ▸ AI. The mode switch up top is an explicit, persisted choice
/// (`aiMode`): switching PUTs `{aiMode}` alone and never touches the stored
/// key. The key form stays usable in both modes (saving a key switches to it),
/// and the only thing that ever sends `apiKey: ""` is "Remove key…", behind a
/// confirmation. The model is a real picker fed by
/// `POST /api/settings/ai/models` once the key checks out.
struct AiSettingsTab: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    @State private var provider = "google"
    @State private var baseUrl = ""
    @State private var model = ""
    @State private var apiKey = ""
    @State private var availableModels: [AiModel] = []
    @State private var isLoadingModels = false
    @State private var modelsMessage: String?
    @State private var hydratedFromServer = false
    /// The segmented control's optimistic value while the PUT is in flight.
    @State private var pendingMode: AiMode?
    @State private var confirmingRemoveKey = false
    /// Bumped after every successful save/remove: a focused NSSecureTextField
    /// can re-show its last typed text when the binding is cleared under it,
    /// so the field is recreated instead of merely emptied.
    @State private var keyFieldGeneration = 0

    private static let providers: [(id: String, label: String)] = [
        ("google", "Google Gemini"),
        ("openai", "OpenAI"),
        ("anthropic", "Anthropic"),
        ("custom", "Custom (OpenAI-compatible)"),
    ]

    /// Only Google has a server-side default model (gemini-2.5-flash); every
    /// other provider needs an explicit choice before the key is usable.
    private var needsModel: Bool { provider != "google" }

    var body: some View {
        let settingsModel = appEnvironment.settings
        let mode = pendingMode ?? settingsModel.aiMode
        let hasKey = settingsModel.hasOwnKey
        let ownKeyIncomplete = mode == .own && !(settingsModel.settings?.isOwnKeyReady ?? true)

        Form {
            Section {
                Picker("AI to use", selection: modeBinding) {
                    ForEach(AiMode.allCases) { entry in
                        Text(entry.title).tag(entry)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .disabled(settingsModel.isSaving || settingsModel.settings == nil)

                if ownKeyIncomplete {
                    Label {
                        Text(ChatReplyNote.ownKeyIncomplete.text)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle.fill")
                    }
                    .font(.callout)
                    .foregroundStyle(.orange)
                }
            } footer: {
                Text(modeFooter(mode: mode, hasKey: hasKey))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section {
                AiCreditsCard(usage: settingsModel.aiUsage, dim: mode == .own)
                    .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 8, trailing: 8))
            }

            Section {
                if hasKey {
                    LabeledContent("Saved key") {
                        HStack(spacing: 10) {
                            Text("••••\(settingsModel.settings?.apiKeyLast4 ?? "")")
                                .monospaced()
                                .foregroundStyle(.secondary)
                            Button("Remove key…", role: .destructive) { confirmingRemoveKey = true }
                                .controlSize(.small)
                                .disabled(settingsModel.isSaving)
                                .pointingHandCursor()
                        }
                    }
                }

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

                SecureField(hasKey ? "Replace key" : "API key", text: $apiKey, prompt: Text(keyPrompt))
                    .id(keyFieldGeneration)

                // The model becomes a real picker the moment a key can list
                // models; before that, the row offers the verification instead
                // of a free-text field that would accept typos silently.
                if availableModels.isEmpty {
                    LabeledContent("Model") {
                        HStack(spacing: 8) {
                            if !model.isEmpty {
                                Text(model)
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                            if isLoadingModels {
                                ProgressView().controlSize(.small)
                            }
                            Button("Verify Key & List Models") { loadModels() }
                                .disabled(isLoadingModels || (apiKey.isEmpty && !hasKey))
                        }
                    }
                } else {
                    Picker("Model", selection: $model) {
                        // Google falls back to gemini-2.5-flash server-side; the
                        // others have no default, so the empty choice is a prompt.
                        Text(needsModel ? "Choose a model…" : "Provider default").tag("")
                        Divider()
                        ForEach(availableModels) { entry in
                            Text(entry.label).tag(entry.id)
                        }
                    }
                }

                if needsModel, model.isEmpty {
                    Label {
                        Text("\(providerLabel) needs a model — verify the key, then pick one.")
                    } icon: {
                        Image(systemName: "info.circle")
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }

                if let modelsMessage {
                    Text(modelsMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } header: {
                Text("Your key")
            } footer: {
                Text(hasKey
                    ? "The key is stored encrypted server-side and never shown again — only its last 4 characters. Saving a new key replaces it and switches chat to your key."
                    : "Google, OpenAI, Anthropic, or any OpenAI-compatible endpoint. The key is stored encrypted server-side; saving it switches chat to your key.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section {
                HStack {
                    Button(hasKey ? "Save Changes" : "Save Key") { saveOwnKey() }
                        .buttonStyle(.borderedProminent)
                        .disabled(settingsModel.isSaving || (apiKey.isEmpty && !hasKey) || (needsModel && model.isEmpty))
                        .help(needsModel && model.isEmpty ? "Pick a model first" : "")

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
        .frame(height: 620)
        // A status left behind by another tab's action isn't this form's.
        .onAppear { appEnvironment.settings.clearStatus() }
        // Hydrate the form from the server ONCE — later reloads (credit meter
        // refreshes) must not stomp what the user is typing.
        .onChange(of: settingsModel.settings != nil, initial: true) { _, _ in
            guard !hydratedFromServer, let settings = settingsModel.settings else { return }
            hydratedFromServer = true
            provider = settings.provider
            baseUrl = settings.baseUrl ?? ""
            model = settings.model ?? ""
        }
        .confirmationDialog(
            "Remove your API key?",
            isPresented: $confirmingRemoveKey,
            titleVisibility: .visible
        ) {
            Button("Remove Key", role: .destructive) { removeKey() }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Chat switches to the included free AI. You can add a key again any time.")
        }
    }

    /// PUTs `{aiMode}` only. Optimistic; the server's echo (or a 400 such as
    /// "Add an API key before switching to your own key") settles the control.
    private var modeBinding: Binding<AiMode> {
        Binding(
            get: { pendingMode ?? appEnvironment.settings.aiMode },
            set: { newMode in
                guard newMode != appEnvironment.settings.aiMode else { return }
                pendingMode = newMode
                Task {
                    await appEnvironment.settings.setAiMode(newMode)
                    pendingMode = nil
                }
            }
        )
    }

    private func modeFooter(mode: AiMode, hasKey: Bool) -> String {
        switch (mode, hasKey) {
        case (.own, _):
            "Chat runs on your key. Nothing is metered against the free credits."
        case (.included, true):
            "Your key stays saved. When the free credits run out this week, chat automatically switches to your key."
        case (.included, false):
            "Chat runs on Bookmark AI's shared model — 2,000 free credits every week, no setup."
        }
    }

    private var providerLabel: String {
        Self.providers.first { $0.id == provider }?.label ?? provider.capitalized
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

    /// Provider/base URL/model always; the key only when one was typed. A
    /// non-empty key makes the server switch the mode to `own` itself.
    private func saveOwnKey() {
        var body = UpdateSettingsBody(provider: provider)
        if !apiKey.isEmpty { body.apiKey = apiKey }
        if provider == "custom" { body.baseUrl = baseUrl }
        body.model = model
        Task {
            if await appEnvironment.settings.save(body) {
                apiKey = ""
                keyFieldGeneration += 1
            }
        }
    }

    private func removeKey() {
        Task {
            if await appEnvironment.settings.removeKey() {
                availableModels = []
                model = ""
                apiKey = ""
                keyFieldGeneration += 1
            }
        }
    }
}
