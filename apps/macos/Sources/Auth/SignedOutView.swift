import SwiftUI

/// The WHOLE window while the cloud target has no session: no sidebar, no
/// toolbar, nothing from a previous account — the app mark, one sentence, and
/// the way back in. (The server picker in the footer is the single exception:
/// without it Local mode would be unreachable while signed out.)
struct SignedOutView: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    var body: some View {
        let auth = appEnvironment.auth

        AuthGateScaffold {
            VStack(spacing: 0) {
                AppMark(size: 88)

                Text("Sign in to Bookmark AI")
                    .font(.system(size: 26, weight: .semibold))
                    .padding(.top, 24)

                Text("Your bookmarks, sessions, live tabs and chats are in your account.")
                    .font(.system(size: 14))
                    .foregroundStyle(.secondary)
                    .padding(.top, 8)

                GateActionButton("Sign In…", isDefault: true) { auth.beginSignIn() }
                    .padding(.top, 28)
                    .accessibilityIdentifier("sign-in-button")

                if let error = auth.lastError {
                    Label(error, systemImage: "exclamationmark.triangle.fill")
                        .font(.caption)
                        .foregroundStyle(.red)
                        .padding(.top, 16)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("signed-out-screen")
    }
}
