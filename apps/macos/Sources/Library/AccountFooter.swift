import SwiftUI

/// Sidebar footer: who you are and which backend you're pointed at, with the
/// sign-in affordance right where the identity lives.
struct AccountFooter: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    var body: some View {
        let target = appEnvironment.preferences.serverTarget
        let auth = appEnvironment.auth

        HStack(spacing: 10) {
            Image(systemName: avatarSymbol)
                .font(.system(size: 20))
                .foregroundStyle(.secondary)
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 1) {
                Text(primaryLine)
                    .font(.callout)
                    .lineLimit(1)
                    .truncationMode(.middle)

                HStack(spacing: 4) {
                    Image(systemName: target.symbolName)
                        .imageScale(.small)
                    Text(target.displayName)
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }

            Spacer(minLength: 0)

            if target.requiresAuth {
                Menu {
                    if auth.status == .signedIn {
                        Button("Sign Out") {
                            Task { await appEnvironment.signOut() }
                        }
                    } else {
                        Button("Sign In…") { auth.beginSignIn() }
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
            }

        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var primaryLine: String {
        let target = appEnvironment.preferences.serverTarget
        guard target.requiresAuth else { return "Local dev server" }
        switch appEnvironment.auth.status {
        case .unknown: return "Checking session…"
        case .signedOut: return "Not signed in"
        case .signedIn: return appEnvironment.auth.account?.displayName ?? "Signed in"
        }
    }

    private var avatarSymbol: String {
        let target = appEnvironment.preferences.serverTarget
        guard target.requiresAuth else { return "laptopcomputer" }
        return appEnvironment.auth.status == .signedIn
            ? "person.crop.circle.fill"
            : "person.crop.circle.badge.questionmark"
    }
}
