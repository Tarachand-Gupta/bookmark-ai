import SwiftUI

/// Settings ▸ MCP — full parity with the web's `McpSection`: the endpoint,
/// copyable client-setup snippets (seeded with a freshly minted token, else
/// `<YOUR_TOKEN>`), the tool allowlist, and token management: name + Generate,
/// the one-time reveal, the list with hint / created / last used / revoked,
/// and revoke with an inline confirm. Order is deliberate: setup first (what a
/// first-time visitor needs), tokens last.
struct McpSettingsTab: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    @State private var newTokenName = ""
    @State private var setupExpanded = false

    var body: some View {
        let settingsModel = appEnvironment.settings
        let tokens = appEnvironment.mcpTokens
        let endpoint = McpSnippets.endpoint(base: appEnvironment.preferences.serverTarget.baseURL)
        let freshToken = tokens.fresh?.token

        Form {
            Section {
                CodeBlockText(text: endpoint)
                    .listRowInsets(EdgeInsets(top: 8, leading: 8, bottom: 4, trailing: 8))
                HStack {
                    CopyButton(value: endpoint, label: "Copy Endpoint")
                    Spacer()
                }
            } header: {
                Text("Endpoint")
            } footer: {
                Text("Bookmark AI speaks the Model Context Protocol over HTTP, so any MCP client — Claude Code, Claude Desktop, your own agent — can search, browse, and save bookmarks with a token you mint below.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section {
                DisclosureGroup("Client setup", isExpanded: $setupExpanded) {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Claude Code — one command:")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        let command = McpSnippets.claudeCodeCommand(endpoint: endpoint, token: freshToken)
                        CodeBlockText(text: command)
                        CopyButton(value: command, label: "Copy Command")

                        Text("Or add this to any client's MCP config file:")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.top, 4)
                        let config = McpSnippets.jsonConfig(endpoint: endpoint, token: freshToken)
                        CodeBlockText(text: config)
                        CopyButton(value: config, label: "Copy Config")

                        // Seeded with the just-minted secret when there is one, so
                        // the user is never told to substitute a placeholder that
                        // isn't there — and knows what they copied IS a credential.
                        Text(freshToken != nil
                            ? "Both snippets already contain the token you just generated — nothing to substitute. They're as sensitive as the token itself, so paste them somewhere private."
                            : "Replace <YOUR_TOKEN> with a token from below if you generated it earlier.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.top, 2)
                    }
                    .padding(.top, 6)
                }
                .pointingHandCursor()
            }

            Section {
                ForEach(McpTool.allCases) { tool in
                    Toggle(isOn: toolBinding(for: tool)) {
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
                Text("Tools")
            } footer: {
                Text("What connected assistants are allowed to do. Applies to every token immediately.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Section {
                HStack(spacing: 8) {
                    TextField("Token name", text: $newTokenName, prompt: Text("e.g. Claude Code on my laptop"))
                        .textFieldStyle(.roundedBorder)
                        .onSubmit { mint() }
                        .disabled(tokens.isMinting)
                    Button {
                        mint()
                    } label: {
                        if tokens.isMinting {
                            HStack(spacing: 6) {
                                ProgressView().controlSize(.small)
                                Text("Generating…")
                            }
                        } else {
                            Text("Generate Token")
                        }
                    }
                    .disabled(tokens.isMinting || newTokenName.trimmingCharacters(in: .whitespaces).isEmpty)
                    .pointingHandCursor()
                }

                if let fresh = tokens.fresh {
                    FreshTokenCard(fresh: fresh) { tokens.dismissFresh() }
                        .listRowInsets(EdgeInsets(top: 6, leading: 8, bottom: 6, trailing: 8))
                }

                if tokens.isLoading, !tokens.hasLoaded {
                    HStack(spacing: 8) {
                        ProgressView().controlSize(.small)
                        Text("Loading tokens…")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } else if let error = tokens.loadError {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Image(systemName: "exclamationmark.triangle")
                            .foregroundStyle(.secondary)
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("Retry") { Task { await tokens.load() } }
                            .controlSize(.small)
                    }
                } else if tokens.tokens.isEmpty {
                    Text("No tokens yet.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(tokens.tokens) { token in
                        McpTokenRow(
                            token: token,
                            isConfirming: tokens.confirmingRevokeId == token.id,
                            isRevoking: tokens.revokingId == token.id,
                            onRevoke: { tokens.confirmingRevokeId = token.id },
                            onConfirm: { Task { await tokens.revoke(id: token.id) } },
                            onCancel: { tokens.confirmingRevokeId = nil }
                        )
                    }
                }

                if let error = tokens.actionError {
                    Text(error)
                        .font(.caption)
                        .foregroundStyle(.red)
                }
            } header: {
                Text("Tokens")
            } footer: {
                Text("One token per client, so you can revoke a single machine without touching the rest. Tokens are valid for a year; the value is shown once, right after generating.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if let message = settingsModel.statusMessage, settingsModel.statusIsError {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.red)
            }
        }
        .formStyle(.grouped)
        .frame(height: 640)
        .task { await appEnvironment.mcpTokens.load() }
        // The status line is shared across tabs; an error left behind by the
        // AI tab must not read as a tools-toggle failure here.
        .onAppear { appEnvironment.settings.clearStatus() }
    }

    private func mint() {
        let name = newTokenName
        guard !name.trimmingCharacters(in: .whitespaces).isEmpty else { return }
        Task {
            await appEnvironment.mcpTokens.mint(name: name)
            if appEnvironment.mcpTokens.fresh != nil {
                newTokenName = ""
                setupExpanded = true
            }
        }
    }

    /// Stored null/absent = every tool enabled — the toggle set reflects that.
    private func enabledTools() -> Set<String> {
        if let stored = appEnvironment.settings.settings?.mcpTools {
            return Set(stored)
        }
        return Set(McpTool.allCases.map(\.rawValue))
    }

    private func toolBinding(for tool: McpTool) -> Binding<Bool> {
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

/// The show-once card: the secret, wrapped (not scrolled) so it can be read
/// and verified, with Copy. Dismissable; also dropped when that token is revoked.
private struct FreshTokenCard: View {
    let fresh: CreateMcpTokenResponse
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Label("Copy “\(fresh.name)” now — this is the only time it will be shown.", systemImage: "key.horizontal.fill")
                    .font(.caption)
                    .fontWeight(.medium)
                Spacer()
                Button {
                    onDismiss()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .pointingHandCursor()
                .help("Dismiss — the token stays valid")
            }
            CodeBlockText(text: fresh.token)
            CopyButton(value: fresh.token, label: "Copy Token")
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(.orange.opacity(0.08))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .strokeBorder(.orange.opacity(0.4), lineWidth: 1)
        )
    }
}

/// One token in the list: name (+ revoked), the `bkmcp_…` hint, created · last
/// used, and Revoke → inline "Revoke / Cancel" confirm.
private struct McpTokenRow: View {
    let token: McpToken
    let isConfirming: Bool
    let isRevoking: Bool
    let onRevoke: () -> Void
    let onConfirm: () -> Void
    let onCancel: () -> Void

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(token.name)
                        .fontWeight(.medium)
                        .lineLimit(1)
                        .foregroundStyle(token.isRevoked ? AnyShapeStyle(.secondary) : AnyShapeStyle(.primary))
                    if token.isRevoked {
                        Text("revoked")
                            .font(.caption2)
                            .fontWeight(.medium)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(.quaternary, in: Capsule())
                            .foregroundStyle(.secondary)
                    }
                }
                // Which token this row IS — captured at mint time; null for
                // tokens minted before the column existed (render nothing).
                if let hint = token.hint {
                    Text(hint)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(.secondary)
                }
                Text("Created \(Self.formatWhen(token.createdAt)) · last used \(Self.formatWhen(token.lastUsedAt))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer(minLength: 8)

            if !token.isRevoked {
                if isConfirming {
                    HStack(spacing: 6) {
                        Button(role: .destructive) {
                            onConfirm()
                        } label: {
                            if isRevoking {
                                HStack(spacing: 5) {
                                    ProgressView().controlSize(.mini)
                                    Text("Revoking…")
                                }
                            } else {
                                Text("Revoke")
                            }
                        }
                        .tint(.red)
                        .buttonStyle(.borderedProminent)
                        .controlSize(.small)
                        .disabled(isRevoking)
                        .pointingHandCursor()
                        Button("Cancel") { onCancel() }
                            .controlSize(.small)
                            .disabled(isRevoking)
                            .pointingHandCursor()
                    }
                    .transition(.opacity)
                } else {
                    Button {
                        onRevoke()
                    } label: {
                        Label("Revoke", systemImage: "trash")
                    }
                    .controlSize(.small)
                    .pointingHandCursor()
                    .help("Revoke this token — clients using it stop working immediately")
                }
            }
        }
        .padding(.vertical, 3)
        .animation(.easeOut(duration: 0.15), value: isConfirming)
    }

    static func formatWhen(_ iso: String?) -> String {
        guard let iso else { return "never" }
        guard let date = ISO8601.date(from: iso) else { return "unknown" }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}
