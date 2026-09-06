import SwiftUI

/// Sidebar footer — who you are: initials avatar, name (else email) on the
/// first line, email (else the server host) on the second, a small badge for
/// the Local/Cloud target, and the ⋯ menu (Account Settings…, Sign Out). It
/// only renders behind an open gate, so on Cloud there is always a session.
struct AccountFooter: View {
    @Environment(AppEnvironment.self) private var appEnvironment
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        let target = appEnvironment.preferences.serverTarget
        let auth = appEnvironment.auth

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
                Text(lines.secondary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .accessibilityElement(children: .combine)

            Spacer(minLength: 4)

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

    /// Primary = name, else email, else a status; secondary = email when the
    /// primary is the name, else the server host.
    private var lines: (primary: String, secondary: String) {
        let target = appEnvironment.preferences.serverTarget
        let auth = appEnvironment.auth
        guard target.requiresAuth else { return ("Local account", target.hostLabel) }

        switch auth.status {
        case .signedIn:
            let name = auth.account?.name?.trimmingCharacters(in: .whitespaces) ?? ""
            let email = auth.account?.email?.trimmingCharacters(in: .whitespaces) ?? ""
            if !name.isEmpty { return (name, email.isEmpty ? target.hostLabel : email) }
            if !email.isEmpty { return (email, target.hostLabel) }
            return ("Signed in", target.hostLabel)
        case .unknown, .unreachable:
            return ("Connecting…", target.hostLabel)
        case .signedOut:
            return ("Not signed in", target.hostLabel)
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
