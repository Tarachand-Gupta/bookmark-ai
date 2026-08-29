import AppKit
import WebKit

/// Clerk sign-in and session-token minting, driven through WKWebView.
///
/// ── Why a webview and not Clerk's native Apple SDK ──────────────────────────
/// `clerk-ios` (ClerkKit) *does* declare `.macOS(.v14)`, so the native route is
/// technically open. It is not taken here because it requires **Clerk dashboard
/// configuration this app is not allowed to make**: the instance's Native API
/// toggle must be ON and a native application/redirect scheme must be registered
/// for OAuth. It would also add four SPM dependencies. The webview route reuses
/// the web app's own `/sign-in` page verbatim, needs ZERO dashboard changes, and
/// works against the dev and prod Clerk instances interchangeably because it
/// simply renders whatever that origin serves.
///
/// ── How it works ────────────────────────────────────────────────────────────
/// Two webviews share `WKWebsiteDataStore.default()`, so the Clerk cookies one
/// obtains are immediately visible to the other AND persist across launches
/// (silent re-auth, no re-typing):
///
///   1. A **sign-in webview**, presented in a sheet, loads `<base>/sign-in`.
///      It is polled for a token; the first non-nil one means sign-in finished.
///   2. A **token webview**, parked off-screen for the app's lifetime, is what
///      later re-mints from. Unlike the Zig desktop SDK, WKWebView can evaluate
///      JavaScript, so `window.Clerk.session.getToken()` is reachable directly —
///      no web-app change is needed to expose one.
///
/// Nothing durable is stored by this app: session JWTs (~60s TTL) live in memory
/// only, and the Clerk cookies live in the WKWebsiteDataStore inside the app's
/// sandbox container, managed by the OS. That is why there is no Keychain use
/// here — there is no long-lived secret to protect.
/// What a mint attempt actually established. The distinction matters: only
/// `.noSession` may sign the app out — `.unavailable` (page not loaded, network
/// down, renderer recycled mid-eval) says nothing about the session, and the
/// Clerk cookies almost certainly still carry it.
enum MintOutcome: Equatable {
    case token(String)
    /// Clerk loaded and definitively reports no session on this origin.
    case noSession
    /// Couldn't reach a state where Clerk could answer. Transient.
    case unavailable
}

@MainActor
final class ClerkWebAuth: NSObject {

    /// The origin that hosts the web app + its Clerk provider. Always the `www`
    /// host for cloud (see `ServerTarget`).
    private var origin: URL

    private var tokenWebView: WKWebView?
    private var offscreenWindow: NSWindow?

    /// Continuations waiting on the CURRENT navigation of a webview. Keyed by the
    /// webview so the sign-in and token webviews don't resume each other.
    private var loadWaiters: [ObjectIdentifier: [CheckedContinuation<Void, Never>]] = [:]
    private var isLoading: [ObjectIdentifier: Bool] = [:]

    init(origin: URL) {
        self.origin = origin
        super.init()
    }

    /// Point at a different origin (the user flipped Local/Cloud in Settings).
    /// Tears the token webview down so the next mint starts clean.
    func updateOrigin(_ newOrigin: URL) {
        guard newOrigin != origin else { return }
        origin = newOrigin
        teardownTokenWebView()
    }

    var signInURL: URL { origin.appendingPathComponent("sign-in") }

    // MARK: - Token minting

    /// Mint a Clerk session JWT, reporting WHY when one can't be minted.
    ///
    /// `fresh` bypasses clerk-js's own ~60s token cache (`skipCache`) — required
    /// on the 401-recovery path, where re-reading the cache would just hand back
    /// the very token the server rejected.
    ///
    /// `allowReload` gives exactly one recovery attempt: if the parked page has
    /// gone stale (Clerk unloaded, navigated away, renderer recycled), reload it
    /// and ask once more. The flag is the recursion guard.
    func mintToken(fresh: Bool = false, allowReload: Bool = true) async -> MintOutcome {
        let webView = ensureTokenWebView()
        await waitForLoad(webView)

        let first = await evaluateOutcome(on: webView, fresh: fresh)
        if case .token = first { return first }
        guard allowReload else { return first }

        load(signInURL, in: webView)
        await waitForLoad(webView)
        return await evaluateOutcome(on: webView, fresh: fresh)
    }

    /// Ask a specific webview (used for the sign-in sheet's own view) for a token.
    /// Returns nil while the user is still on Clerk's own domain — `window.Clerk`
    /// only exists on the app's origin, which is exactly the signal we want.
    func evaluateToken(on webView: WKWebView) async -> String? {
        if case .token(let token) = await evaluateOutcome(on: webView, fresh: false) {
            return token
        }
        return nil
    }

    /// The sentinel keeps the script's return a plain string-or-null while still
    /// separating "no session" (definitive) from "couldn't answer" (transient).
    private static let noSessionSentinel = "__NO_SESSION__"

    private func evaluateOutcome(on webView: WKWebView, fresh: Bool) async -> MintOutcome {
        let script = """
        try {
          const clerk = window.Clerk;
          if (!clerk) { return null; }
          if (!clerk.loaded && typeof clerk.load === 'function') { await clerk.load(); }
          const session = clerk.session;
          if (!session) { return '\(Self.noSessionSentinel)'; }
          const token = await session.getToken({ skipCache: \(fresh ? "true" : "false") });
          return token || null;
        } catch (e) {
          return null;
        }
        """

        let result: Any? = await withCheckedContinuation { continuation in
            // The async/await import of callAsyncJavaScript is not guaranteed when
            // the completion handler carries a default value, so the continuation
            // is bridged explicitly. `.page` content world is REQUIRED: window.Clerk
            // is page JavaScript and is invisible from an isolated world.
            webView.callAsyncJavaScript(script, arguments: [:], in: nil, in: .page) { outcome in
                switch outcome {
                case .success(let value): continuation.resume(returning: value)
                case .failure: continuation.resume(returning: nil)
                }
            }
        }

        guard let value = result as? String, !value.isEmpty else { return .unavailable }
        return value == Self.noSessionSentinel ? .noSession : .token(value)
    }

    // MARK: - Sign-in sheet

    /// A fresh webview for the sign-in sheet. It shares the default data store,
    /// so whatever session it establishes is instantly usable by the token webview.
    func makeSignInWebView() -> WKWebView {
        let webView = makeWebView()
        load(signInURL, in: webView)
        return webView
    }

    /// Re-park the token webview so it picks up the session the sheet just made.
    func refreshAfterSignIn() async {
        let webView = ensureTokenWebView()
        load(signInURL, in: webView)
        await waitForLoad(webView)
    }

    // MARK: - Sign-out

    /// End the Clerk session and erase every trace of it from this app's webviews.
    /// The data store is per-app inside the sandbox, so this clears only our copy.
    func signOut() async {
        if let webView = tokenWebView {
            _ = await withCheckedContinuation { (continuation: CheckedContinuation<Any?, Never>) in
                webView.callAsyncJavaScript(
                    "try { if (window.Clerk && window.Clerk.signOut) { await window.Clerk.signOut(); } } catch (e) {} return null;",
                    arguments: [:], in: nil, in: .page
                ) { outcome in
                    continuation.resume(returning: try? outcome.get())
                }
            }
        }

        let store = WKWebsiteDataStore.default()
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        await store.removeData(ofTypes: types, modifiedSince: .distantPast)
        teardownTokenWebView()
    }

    // MARK: - Webview plumbing

    private func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        // The DEFAULT (persistent) store is the whole point: Clerk's cookies
        // survive relaunch, so returning users are signed in silently.
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true

        let webView = WKWebView(frame: NSRect(x: 0, y: 0, width: 480, height: 640), configuration: configuration)
        webView.navigationDelegate = self
        return webView
    }

    private func ensureTokenWebView() -> WKWebView {
        if let tokenWebView { return tokenWebView }

        let webView = makeWebView()
        tokenWebView = webView

        // A WKWebView needs a live window to keep its renderer scheduled reliably.
        // This one is borderless, fully transparent, click-through, and parked far
        // off-screen — invisible even if the system clamps its origin onto a display.
        let window = NSWindow(
            contentRect: NSRect(x: -30_000, y: -30_000, width: 480, height: 640),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false
        )
        window.isReleasedWhenClosed = false
        window.alphaValue = 0
        window.ignoresMouseEvents = true
        window.level = .normal
        window.collectionBehavior = [.stationary, .ignoresCycle, .transient]
        window.contentView = webView
        window.orderFrontRegardless()
        offscreenWindow = window

        load(signInURL, in: webView)
        return webView
    }

    private func teardownTokenWebView() {
        offscreenWindow?.orderOut(nil)
        offscreenWindow?.contentView = nil
        offscreenWindow = nil
        if let tokenWebView {
            resumeWaiters(for: tokenWebView)
            tokenWebView.navigationDelegate = nil
        }
        tokenWebView = nil
    }

    private func load(_ url: URL, in webView: WKWebView) {
        isLoading[ObjectIdentifier(webView)] = true
        webView.load(URLRequest(url: url))
    }

    /// Suspend until the webview's current navigation settles. Bounded by a
    /// timeout so a hung network can never wedge a token mint (and with it the
    /// whole library refresh) forever.
    private func waitForLoad(_ webView: WKWebView, timeout: Duration = .seconds(12)) async {
        guard isLoading[ObjectIdentifier(webView)] == true else { return }

        let waited: Void? = try? await withThrowingTaskGroup(of: Void.self) { group in
            group.addTask { @MainActor in
                await withCheckedContinuation { continuation in
                    self.loadWaiters[ObjectIdentifier(webView), default: []].append(continuation)
                }
            }
            group.addTask {
                try await Task.sleep(for: timeout)
                throw CancellationError()
            }
            defer { group.cancelAll() }
            return try await group.next()
        }

        if waited == nil {
            // Timed out — release anyone still parked so they don't leak.
            resumeWaiters(for: webView)
        }
    }

    private func resumeWaiters(for webView: WKWebView) {
        let key = ObjectIdentifier(webView)
        isLoading[key] = false
        let waiters = loadWaiters.removeValue(forKey: key) ?? []
        for waiter in waiters { waiter.resume() }
    }
}

// MARK: - WKNavigationDelegate

extension ClerkWebAuth: WKNavigationDelegate {
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        resumeWaiters(for: webView)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        resumeWaiters(for: webView)
    }

    func webView(
        _ webView: WKWebView,
        didFailProvisionalNavigation navigation: WKNavigation!,
        withError error: Error
    ) {
        resumeWaiters(for: webView)
    }

    func webView(
        _ webView: WKWebView,
        didStartProvisionalNavigation navigation: WKNavigation!
    ) {
        isLoading[ObjectIdentifier(webView)] = true
    }
}
