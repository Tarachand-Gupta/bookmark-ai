import SwiftUI

/// What the Settings window (⌘,) shows while the gate is closed: no tabs and no
/// account data, just the sign-in (or connecting) message. Server selection is
/// available on the main login screen and in an open Account settings tab.
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
                        Text("Can't reach \(appEnvironment.preferences.serverTarget.hostLabel)")
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
                        Text("Checking your session with \(appEnvironment.preferences.serverTarget.hostLabel).")
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

        }
        .frame(width: 500)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("settings-gate-panel")
    }
}
