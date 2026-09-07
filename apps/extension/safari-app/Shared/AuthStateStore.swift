//
//  AuthStateStore.swift
//  Bookmark AI for Safari — compiled into BOTH the appex and the companion app
//
//  The one channel between the web extension and the Mac app. The extension's
//  background worker sends `{type:"authState", signedIn, email?, name?, at}`
//  over `browser.runtime.sendNativeMessage` (Safari target only, see
//  apps/extension/lib/native-auth-report.ts); `SafariWebExtensionHandler`
//  writes it here, into UserDefaults shared through the App Group, and
//  `CompanionModel.refresh()` reads it so the setup window and the menu-bar
//  item can say "Signed in as …" instead of guessing. Never a token — the
//  extension never sends one, and nothing here would store it.
//
//  App Store sandbox-compatible: both bundles carry
//  `com.apple.security.application-groups = [appGroupID]`; on macOS a
//  team-id-prefixed group needs no portal registration. The suite is a plain
//  plist at ~/Library/Group Containers/<group>/Library/Preferences/<group>.plist,
//  which `defaults read <group>` / `defaults write <group> …` reach from a shell
//  (how the pipeline script and QA verify it).
//

import Foundation

enum AuthStateStore {

    /// Team-id-prefixed App Group (the macOS form). Must equal the value in
    /// App/BookmarkAI.entitlements, Extension/BookmarkAIExtension.entitlements
    /// and project.yml (`BOOKMARK_APP_GROUP`) — safari-app.test.ts pins all four.
    static let appGroupID = "L3PP7DQZWS.ai.bookmark.safari"

    enum Key {
        static let signedIn = "signedIn"
        static let email = "email"
        static let name = "name"
        static let updatedAt = "updatedAt"
    }

    struct Snapshot: Equatable {
        let signedIn: Bool
        let email: String?
        let name: String?
        let updatedAt: Date?
    }

    static var defaults: UserDefaults? {
        UserDefaults(suiteName: appGroupID)
    }

    /// `nil` until the extension has reported once (key absent) — "unknown", not
    /// "signed out".
    static func read() -> Snapshot? {
        guard let d = defaults, d.object(forKey: Key.signedIn) != nil else { return nil }
        return Snapshot(
            signedIn: d.bool(forKey: Key.signedIn),
            email: nonEmpty(d.string(forKey: Key.email)),
            name: nonEmpty(d.string(forKey: Key.name)),
            updatedAt: d.object(forKey: Key.updatedAt) as? Date
        )
    }

    static func write(signedIn: Bool, email: String?, name: String?, at: Date) {
        guard let d = defaults else { return }
        d.set(signedIn, forKey: Key.signedIn)
        // A signed-out report clears the identity; a signed-in one without an
        // e-mail (mint-success path before identity resolved) keeps the last known.
        if !signedIn {
            d.removeObject(forKey: Key.email)
            d.removeObject(forKey: Key.name)
        } else {
            if let email = nonEmpty(email) { d.set(email, forKey: Key.email) }
            if let name = nonEmpty(name) { d.set(name, forKey: Key.name) } else if name != nil { d.removeObject(forKey: Key.name) }
        }
        d.set(at, forKey: Key.updatedAt)
    }

    /// Parse the extension's `authState` message. Returns nil when the shape is
    /// not ours (the handler then falls back to echoing, as Apple's template does).
    static func parse(_ message: Any?) -> (signedIn: Bool, email: String?, name: String?, at: Date)? {
        guard let dict = message as? [String: Any],
              dict["type"] as? String == "authState",
              let signedIn = dict["signedIn"] as? Bool
        else { return nil }
        let at = (dict["at"] as? String).flatMap(parseISO8601) ?? Date()
        return (signedIn, dict["email"] as? String, dict["name"] as? String, at)
    }

    /// Logging-safe form of an address: the local part is never written to the
    /// log — `*@example.com`.
    static func redactedEmail(_ email: String?) -> String {
        guard let email = nonEmpty(email), let at = email.lastIndex(of: "@") else { return "none" }
        return "*" + String(email[at...])
    }

    /// Head…tail truncation for one-line UI (menu items) — keeps the domain readable.
    static func middleTruncated(_ text: String, max: Int = 34) -> String {
        guard text.count > max, max >= 5 else { return text }
        let keep = max - 1
        let head = keep / 2 + keep % 2
        let tail = keep / 2
        return String(text.prefix(head)) + "…" + String(text.suffix(tail))
    }

    // MARK: - Helpers

    private static func nonEmpty(_ s: String?) -> String? {
        guard let s, !s.trimmingCharacters(in: .whitespaces).isEmpty else { return nil }
        return s
    }

    private static func parseISO8601(_ s: String) -> Date? {
        // JS `Date.toISOString()` carries milliseconds; accept both forms.
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = withFraction.date(from: s) { return d }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: s)
    }
}
