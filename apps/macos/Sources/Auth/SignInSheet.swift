import SwiftUI
import WebKit

/// Clerk sign-in, hosted in a sheet-presented `WKWebView` pointed at the web
/// app's own `/sign-in` page.
///
/// Completion is detected by POLLING for a token rather than by watching for a
/// navigation to `/app`: Clerk finishes some flows entirely client-side, so a
/// URL change is not a reliable signal, whereas `window.Clerk.session` becoming
/// non-null is exactly the condition we care about.
struct SignInSheet: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    @State private var webView: WKWebView?

    var body: some View {
        VStack(spacing: 0) {
            header
            Divider()

            if let webView {
                WebViewHost(webView: webView)
            } else {
                ProgressView()
                    .controlSize(.large)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .frame(width: 540, height: 660)
        .task { await runSignInFlow() }
    }

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Sign in to Bookmark AI")
                    .font(.headline)
                Text(appEnvironment.auth.signInURL.host() ?? "bookmark-ai.cloud")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer()
            Button("Cancel") { appEnvironment.auth.cancelSignIn() }
                .keyboardShortcut(.cancelAction)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private func runSignInFlow() async {
        let view = appEnvironment.auth.makeSignInWebView()
        webView = view

        // Poll until the sheet is dismissed (which cancels this task).
        while !Task.isCancelled {
            try? await Task.sleep(for: .milliseconds(1200))
            guard !Task.isCancelled else { return }

            if let token = await appEnvironment.auth.probeSignInWebView(view), !token.isEmpty {
                await appEnvironment.finishSignIn()
                return
            }
        }
    }
}

/// Hosts an already-configured `WKWebView`. The view is created and owned by
/// `ClerkWebAuth` so its data store — and therefore the session it establishes —
/// outlives this sheet.
struct WebViewHost: NSViewRepresentable {
    let webView: WKWebView

    func makeNSView(context: Context) -> WKWebView { webView }
    func updateNSView(_ nsView: WKWebView, context: Context) {}
}
