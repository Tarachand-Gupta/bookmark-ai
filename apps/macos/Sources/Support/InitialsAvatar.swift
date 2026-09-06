import SwiftUI

/// A round identity mark: the account's initials on a tinted disc, or a
/// symbol when there is no identity to draw (Local mode's nameless session).
/// Used at 28pt in the sidebar footer and 36pt in Settings ▸ Account.
struct InitialsAvatar: View {
    let account: AccountInfo?
    var size: CGFloat = 28
    /// Drawn when the account has no name/email.
    var fallbackSymbol = "person.fill"

    var body: some View {
        ZStack {
            if let account, account.hasIdentity {
                Circle().fill(.accentPillFill)
                Text(account.initials)
                    .font(.system(size: size * 0.4, weight: .semibold, design: .rounded))
                    .foregroundStyle(.accentPillLabel)
            } else {
                Circle().fill(Color.primary.opacity(0.08))
                Image(systemName: fallbackSymbol)
                    .font(.system(size: size * 0.46, weight: .medium))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: size, height: size)
        .accessibilityLabel(account?.displayName ?? "Account")
    }
}
