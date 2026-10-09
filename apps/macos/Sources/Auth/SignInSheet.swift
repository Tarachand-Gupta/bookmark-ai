import SwiftUI

/// Native progress for the default-browser handoff. OAuth and account choice
/// stay in the user's browser; this sheet shows only the matching code and the
/// state of the one-time handoff.
struct SignInSheet: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    var body: some View {
        let auth = appEnvironment.auth
        VStack(spacing: 0) {
            header(auth)
            Divider()
            content(auth)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .padding(32)
        }
        .frame(width: 500, height: 460)
        .interactiveDismissDisabled()
        .accessibilityIdentifier("browser-sign-in-sheet")
    }

    private func header(_ auth: AuthController) -> some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Sign in to Bookmark AI")
                    .font(.headline)
                Text("Continue in your default browser")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Cancel") { auth.cancelSignIn() }
                .keyboardShortcut(.cancelAction)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    @ViewBuilder
    private func content(_ auth: AuthController) -> some View {
        switch auth.browserSignInState {
        case .idle, .starting:
            VStack(spacing: 18) {
                ProgressView()
                    .controlSize(.large)
                Text("Preparing secure sign-in…")
                    .font(.headline)
                Text("Bookmark AI will open your browser so you can reuse an existing Google, Apple, or Bookmark AI session.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: 390)
            }

        case .waiting(let code, _, _, let openError):
            ScrollView {
                VStack(spacing: 18) {
                    Image(systemName: "globe")
                        .font(.system(size: 38, weight: .medium))
                        .foregroundStyle(.secondary)

                    Text(SupabaseConfiguration.isSupabase ? "Finish signing in in your browser" : "Confirm this code in your browser")
                        .font(.title3.weight(.semibold))

                    if !SupabaseConfiguration.isSupabase { Text(code)
                        .font(.system(size: 30, weight: .bold, design: .monospaced))
                        .textSelection(.enabled) }
                        // Keep the selectable text's native accessibility label.
                        // On macOS 27, overriding it recursively asks AppKit for
                        // the same label when an AX client copies the hierarchy.

                    Text(SupabaseConfiguration.isSupabase ? "Sign in on the Bookmark AI website. You will return to the app automatically." : "Choose the account in your browser, make sure the same code appears there, then approve the sign-in.")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: 390)

                    ProgressView("Waiting for browser confirmation…")
                        .controlSize(.small)

                    Button("Open Browser Again") { auth.openBrowserAgain() }
                        .accessibilityIdentifier("reopen-sign-in-browser")

                    if let openError {
                        Label(openError, systemImage: "exclamationmark.triangle.fill")
                            .font(.caption)
                            .foregroundStyle(.red)
                            .multilineTextAlignment(.center)
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 4)
            }
            .scrollIndicators(.hidden)

        case .redeeming(let code):
            VStack(spacing: 18) {
                ProgressView()
                    .controlSize(.large)
                Text("Finishing sign-in…")
                    .font(.title3.weight(.semibold))
                Text(code)
                    .font(.system(.body, design: .monospaced, weight: .semibold))
                    .foregroundStyle(.secondary)
                Text("Keep this window open while Bookmark AI creates the app session.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }

        case .failed(let message):
            VStack(spacing: 18) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 34))
                    .foregroundStyle(.orange)
                Text("Sign-in didn't finish")
                    .font(.title3.weight(.semibold))
                Text(message)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: 390)
                Button("Try Again") { auth.retrySignIn() }
                    .keyboardShortcut(.defaultAction)
                    .accessibilityIdentifier("retry-browser-sign-in")
            }
        }
    }
}
