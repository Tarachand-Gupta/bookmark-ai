import SwiftUI

/// What the Settings window (⌘,) shows while the gate is closed: no tabs, no
/// account data — just the sign-in (or connecting) message and the server
/// picker, so Local mode stays reachable. Mirrors the main window's gate.
struct SettingsGatePanel: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    var body: some View {
        let auth = appEnvironment.auth

        VStack(spacing: 0) {
            VStack(spacing: 0) {
                if appEnvironment.gate == .connecting {
                    if auth.restoreStalled {
                        Image(systemName: "wifi.exclamationmark")
                            .font(.system(size: 34))
                            .symbolRenderingMode(.hierarchical)
                            .foregroundStyle(.secondary)
                        Text("Can't reach bookmark-ai.cloud")
                            .font(.title2.weight(.semibold))
                            .padding(.top, 14)
                        Text("Check your connection. The app keeps trying in the background.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .padding(.top, 6)
                        GateActionButton("Retry", prominent: false) { auth.retryRestoreNow() }
                            .padding(.top, 20)
                    } else {
                        ProgressView()
                            .controlSize(.large)
                        Text("Connecting to your account…")
                            .font(.title3.weight(.semibold))
                            .padding(.top, 16)
                        Text("Checking your session with bookmark-ai.cloud.")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .padding(.top, 6)
                    }
                } else {
                    AppMark(size: 60)
                    Text("Sign in to Bookmark AI")
                        .font(.title2.weight(.semibold))
                        .padding(.top, 16)
                    Text("Settings belong to your account. Sign in to see them.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .padding(.top, 6)
                    GateActionButton("Sign In…", isDefault: true) {
                        auth.beginSignIn()
                        bringMainWindowForward()
                    }
                    .padding(.top, 22)
                    if let error = auth.lastError {
                        Label(error, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundStyle(.red)
                            .padding(.top, 14)
                    }
                }
            }
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: 250)
            .padding(.horizontal, 32)
            .padding(.vertical, 28)

            Divider()

            HStack(spacing: 10) {
                Text("Server")
                Picker("Server", selection: targetBinding) {
                    ForEach(ServerTarget.allCases) { target in
                        Text(target.displayName).tag(target)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
                .pointingHandCursor()
                Spacer()
                Text(appEnvironment.preferences.serverTarget.subtitle)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 14)
        }
        .frame(width: 500)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("settings-gate-panel")
    }

    private var targetBinding: Binding<ServerTarget> {
        Binding(
            get: { appEnvironment.preferences.serverTarget },
            set: { newValue in Task { await appEnvironment.changeTarget(newValue) } }
        )
    }
}
