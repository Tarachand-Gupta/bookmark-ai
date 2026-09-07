import SwiftUI

/// Sidebar footer — who you are: initials avatar, the account's NAME on the
/// first line (the email only when there is no name; middle-truncated when the
/// sidebar is narrow, with the EMAIL as the tooltip so the address stays
/// discoverable), the server host on the second, a small badge for the
/// Local/Cloud target, and the ⋯ menu (Account Settings…, Sign Out). It only
/// renders behind an open gate, so on Cloud there is always a session; the
/// email is also spelled out in Settings ▸ Account, under the name.
struct AccountFooter: View {
    @Environment(AppEnvironment.self) private var appEnvironment
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        let target = appEnvironment.preferences.serverTarget
        let auth = appEnvironment.auth
        let lines = Self.lines(target: target, status: auth.status, account: auth.account)

        HStack(spacing: 10) {
            InitialsAvatar(
                account: target.requiresAuth ? auth.account : nil,
                size: 28,
                fallbackSymbol: target.requiresAuth ? "person.fill" : "laptopcomputer"
            )

            VStack(alignment: .leading, spacing: 1) {
                Text(lines.primary)
                    .font(.callout)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .help(lines.tooltip ?? "")
                Text(lines.secondary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            // The column takes exactly what the trailing controls leave, so the
            // badge and the menu never move: a long name or address truncates in the
            // middle, a short one (or the loading placeholder) changes nothing.
            .frame(minWidth: 40, maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)

            TargetBadge(target: target)

            if target.requiresAuth {
                Menu {
                    // The full target line lives here; the badge is the glance.
                    Text("\(target.displayName) · \(target.baseURL.host() ?? target.hostLabel)")
                    Divider()
                    Button("Account Settings…") {
                        appEnvironment.requestedSettingsTab = .account
                        openSettings()
                    }
                    Button("Sign Out") {
                        Task { await appEnvironment.signOut() }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .pointingHandCursor()
                .help("Account")
                .accessibilityIdentifier("account-menu")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("account-footer")
    }

    /// The footer's two lines.
    struct Lines: Equatable {
        var primary: String
        var secondary: String
        /// Hover text for the primary line, `nil` when the line isn't an
        /// identity (placeholder, Connecting…, Not signed in, Local account).
        /// It's the account's EMAIL whenever there is one — the visible line
        /// is the name now, so this is where the address stays discoverable —
        /// and otherwise the identity itself, untruncated.
        var tooltip: String? = nil
    }

    /// Placeholder while a confirmed session's `/api/me` is still in flight.
    /// Short on purpose — it lives a second at most: every confirmed session
    /// requests the identity (`AppEnvironment.gateOpened`).
    static let loadingPlaceholder = "Loading…"

    /// Pure derivation, unit-tested. Cloud, signed in: the name (the email
    /// only when the account has no name; "Signed in" for a nameless
    /// open-mode session) over the server host, with the email as the
    /// tooltip; identity not loaded yet: `loadingPlaceholder`. Connecting /
    /// signed out (not normally rendered — the gate replaces the sidebar) say
    /// so. Local: the local account over its host.
    static func lines(target: ServerTarget, status: AuthController.Status, account: AccountInfo?) -> Lines {
        let host = target.hostLabel
        guard target.requiresAuth else { return Lines(primary: "Local account", secondary: host) }

        switch status {
        case .signedIn:
            guard let account else { return Lines(primary: loadingPlaceholder, secondary: host) }
            let email = account.email?.trimmingCharacters(in: .whitespaces) ?? ""
            let name = account.name?.trimmingCharacters(in: .whitespaces) ?? ""
            if !name.isEmpty { return Lines(primary: name, secondary: host, tooltip: email.isEmpty ? name : email) }
            if !email.isEmpty { return Lines(primary: email, secondary: host, tooltip: email) }
            return Lines(primary: "Signed in", secondary: host)
        case .unknown, .unreachable:
            return Lines(primary: "Connecting…", secondary: host)
        case .signedOut:
            return Lines(primary: "Not signed in", secondary: host)
        }
    }
}

/// The Local/Cloud glyph, as a small round badge with the full target on hover.
private struct TargetBadge: View {
    let target: ServerTarget

    var body: some View {
        Image(systemName: target.symbolName)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(.secondary)
            .frame(width: 20, height: 20)
            .background(Circle().fill(Color.primary.opacity(0.07)))
            .help(target.subtitle)
            .accessibilityLabel("Server: \(target.displayName)")
    }
}
