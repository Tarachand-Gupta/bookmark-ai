import SwiftUI

/// The WHOLE window while the cloud session is neither confirmed nor denied:
/// the silent restore is still talking to Clerk (launch, or a retry after it
/// couldn't be reached). Deliberately neutral — this is NOT "not signed in".
/// After `AuthController.stallAfter` without an answer it says so and offers
/// Retry; the backoff keeps going underneath either way.
struct ConnectingView: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    var body: some View {
        let auth = appEnvironment.auth

        AuthGateScaffold {
            VStack(spacing: 0) {
                if auth.restoreStalled {
                    Image(systemName: "wifi.exclamationmark")
                        .font(.system(size: 40, weight: .regular))
                        .symbolRenderingMode(.hierarchical)
                        .foregroundStyle(.secondary)

                    Text("Can't reach bookmark-ai.cloud")
                        .font(.title2.weight(.semibold))
                        .padding(.top, 18)

                    Text("Check your connection. The app keeps trying in the background.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .padding(.top, 8)

                    GateActionButton("Retry", prominent: false) { auth.retryRestoreNow() }
                        .padding(.top, 24)
                        .accessibilityIdentifier("retry-button")
                } else {
                    ProgressView()
                        .controlSize(.large)

                    Text("Connecting to your account…")
                        .font(.title3.weight(.semibold))
                        .padding(.top, 18)

                    Text("Checking your session with bookmark-ai.cloud.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .padding(.top, 6)
                }
            }
            .frame(minHeight: 220)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(auth.restoreStalled ? "connecting-stalled-screen" : "connecting-screen")
    }
}
