//
//  CompanionModel.swift
//  Bookmark AI for Safari
//
//  One observable model shared by the menu-bar item and the setup window:
//  the Safari extension's enabled state, the login-item state, and the three
//  actions the app can take (open Safari's extension settings, open the web
//  app, toggle "start at login"). Everything else in the app is presentation.
//

import AppKit
import Observation
import SafariServices
import ServiceManagement

@MainActor
@Observable
final class CompanionModel {

    enum ExtensionState: String, Equatable {
        /// Safari has not answered yet, or answered with an error.
        case unknown
        case enabled
        case disabled
    }

    /// Every answer from Safari is mirrored into UserDefaults so
    /// scripts/safari-xcode.sh --install can verify "still enabled" without a
    /// GUI or a second process:
    /// `defaults read ai.bookmark.safari ai.bookmark.safari.lastExtensionState`
    /// (cfprefsd resolves the sandboxed container for `defaults`).
    static let lastExtensionStateKey = "ai.bookmark.safari.lastExtensionState"

    /// The appex bundle id. MUST equal `PRODUCT_BUNDLE_IDENTIFIER` of the
    /// `BookmarkAIExtension` target in project.yml — `safari-app.test.ts` pins
    /// the two together, because a mismatch makes every state query fail
    /// silently ("unknown") and the deep link open the wrong pane.
    static let extensionBundleIdentifier = "ai.bookmark.safari.Extension"

    /// Every URL this app opens goes to SAFARI, never the user's default browser
    /// (Chrome, on plenty of Macs). This is the Safari companion: the extension
    /// mirrors the session that exists in Safari, so a sign-in completed in
    /// another browser is useless to it.
    static let safariBundleIdentifier = "com.apple.Safari"

    static let webAppURL = URL(string: "https://www.bookmark-ai.cloud/app")!
    static let signInURL = URL(string: "https://www.bookmark-ai.cloud/sign-in")!
    static let privacyURL = URL(string: "https://www.bookmark-ai.cloud/privacy")!
    static let supportURL = URL(string: "https://www.bookmark-ai.cloud/support")!

    /// What the EXTENSION reports about its sign-in, read from the App Group suite
    /// the appex writes (Shared/AuthStateStore.swift). `.unknown` = no report
    /// has ever arrived (extension never ran / pre-channel build) — shown as
    /// today's neutral copy, never as "signed out".
    enum AuthState: Equatable {
        case unknown
        case signedOut
        case signedIn(email: String?, name: String?)

        var isSignedIn: Bool {
            if case .signedIn = self { return true }
            return false
        }
    }

    private(set) var extensionState: ExtensionState = .unknown
    private(set) var authState: AuthState = .unknown
    /// When the extension last reported (`at` in its message) — for staleness.
    private(set) var authUpdatedAt: Date?
    private(set) var launchAtLogin = false
    /// Human-readable failure from the last login-item toggle, shown inline.
    private(set) var loginItemError: String?

    init() {
        refreshLoginItem()
    }

    /// "Version 0.1.2 (10200)" — both numbers come from Version.xcconfig.
    var versionLabel: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "?"
        let build = info?["CFBundleVersion"] as? String ?? "?"
        return "Version \(short) (\(build))"
    }

    // MARK: - Extension state

    /// Ask Safari whether the extension is enabled. Cheap; the window polls it
    /// every couple of seconds while visible so flipping the switch in Safari
    /// updates the status card without a relaunch.
    func refresh() {
        Self.queryExtensionState { [weak self] state in
            self?.extensionState = state
            UserDefaults.standard.set(state.rawValue, forKey: Self.lastExtensionStateKey)
        }
        readAuthState()
        refreshLoginItem()
    }

    /// "Signed in as tara@example.com" (falls back to the name, then a generic
    /// line) — nil unless signed in. Callers truncate for one-line contexts.
    var signedInLabel: String? {
        guard case let .signedIn(email, name) = authState else { return nil }
        if let email, !email.isEmpty { return "Signed in as \(email)" }
        if let name, !name.isEmpty { return "Signed in as \(name)" }
        return "Signed in"
    }

    private func readAuthState() {
        guard let snapshot = AuthStateStore.read() else {
            authState = .unknown
            authUpdatedAt = nil
            return
        }
        authUpdatedAt = snapshot.updatedAt
        authState = snapshot.signedIn ? .signedIn(email: snapshot.email, name: snapshot.name) : .signedOut
    }

    private static func queryExtensionState(_ completion: @escaping @MainActor (ExtensionState) -> Void) {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) { state, error in
            let next: ExtensionState
            if let state, error == nil {
                next = state.isEnabled ? .enabled : .disabled
            } else {
                next = .unknown
                // Surfaced in Console.app / `log show --predicate 'process == "Bookmark AI"'`;
                // no user data, just Safari's verdict on our own appex.
                NSLog("Bookmark AI: Safari did not report the extension state: \(error?.localizedDescription ?? "no state")")
            }
            Task { @MainActor in completion(next) }
        }
    }

    // MARK: - Actions

    /// Deep link: Safari ▸ Settings ▸ Extensions with Bookmark AI selected.
    func openSafariExtensionSettings() {
        SFSafariApplication.showPreferencesForExtension(withIdentifier: Self.extensionBundleIdentifier) { error in
            if let error {
                NSLog("Bookmark AI: showPreferencesForExtension failed: \(error.localizedDescription)")
            }
        }
    }

    /// The ONE way this app opens a URL — window buttons, menu items and the
    /// footer links all funnel through here. Opens in Safari explicitly and
    /// brings it to the front. `open(_:withApplicationAt:configuration:)` is
    /// plain launch-services and works inside the sandbox; do NOT reach for
    /// AppleScript/automation entitlements to do this.
    func open(_ url: URL) {
        guard let safari = NSWorkspace.shared.urlForApplication(withBundleIdentifier: Self.safariBundleIdentifier) else {
            // Should never happen (Safari ships with macOS and cannot be removed).
            NSLog("Bookmark AI: could not locate Safari (\(Self.safariBundleIdentifier)); falling back to the default browser")
            NSWorkspace.shared.open(url)
            return
        }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = true
        NSWorkspace.shared.open([url], withApplicationAt: safari, configuration: configuration) { _, error in
            if let error {
                NSLog("Bookmark AI: opening \(url.absoluteString) in Safari failed: \(error.localizedDescription)")
            }
        }
    }

    func setLaunchAtLogin(_ enabled: Bool) {
        do {
            if enabled {
                try SMAppService.mainApp.register()
            } else {
                try SMAppService.mainApp.unregister()
            }
            loginItemError = nil
        } catch {
            loginItemError = error.localizedDescription
        }
        refreshLoginItem()
    }

    private func refreshLoginItem() {
        launchAtLogin = SMAppService.mainApp.status == .enabled
    }
}
