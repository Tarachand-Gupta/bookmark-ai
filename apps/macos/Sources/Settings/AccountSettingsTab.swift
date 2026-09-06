import SwiftUI

/// Settings ▸ Account: the plan (badge + what it includes) on top, then the
/// account itself — status, WHO is signed in (initials, name, email), and the
/// Sign Out button directly beneath. Only rendered behind an open gate, so on
/// Cloud there is a session; everything here belongs to that account and is
/// cleared with it.
struct AccountSettingsTab: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    var body: some View {
        let target = appEnvironment.preferences.serverTarget
        let auth = appEnvironment.auth

        Form {
            planSection

            if target.requiresAuth {
                Section {
                    LabeledContent("Status") {
                        switch auth.status {
                        case .unknown, .unreachable:
                            Label("Connecting…", systemImage: "person.crop.circle.badge.clock")
                                .foregroundStyle(.secondary)
                        case .signedOut:
                            Label("Signed out", systemImage: "person.crop.circle.badge.xmark")
                                .foregroundStyle(.secondary)
                        case .signedIn:
                            Label("Signed in", systemImage: "checkmark.seal.fill")
                                .foregroundStyle(.green)
                        }
                    }

                    if auth.status == .signedIn {
                        identityRow(auth.account)
                    }

                    if auth.status == .signedIn {
                        Button("Sign Out") {
                            Task { await appEnvironment.signOut() }
                        }
                        .pointingHandCursor()
                        .accessibilityIdentifier("sign-out-button")
                    } else {
                        Button("Sign In…") { auth.beginSignIn() }
                            .buttonStyle(.borderedProminent)
                            .pointingHandCursor()
                    }

                    if let error = auth.lastError {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
                } header: {
                    Text("Account")
                } footer: {
                    Text("Sign-in opens the web app's Clerk page in a secure window. The session is kept in this app's own sandboxed website storage — no password or token is written anywhere else.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } else {
                Section {
                    Label("Local mode needs no sign-in", systemImage: "laptopcomputer")
                } footer: {
                    Text("The local dev server is expected to run with DEV_OPEN_API=1, which bypasses Clerk entirely. Switch to Cloud in General to sign in.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .formStyle(.grouped)
        .frame(height: 540)
    }

    /// The plan card — drawn only once `GET /api/account` has answered for
    /// THIS session (nil after every sign-out).
    @ViewBuilder
    private var planSection: some View {
        if let plan = appEnvironment.settings.plan {
            Section {
                HStack(alignment: .firstTextBaseline) {
                    PlanBadge(title: plan.badgeTitle)
                    Spacer()
                    Text(plan.price == 0 ? "$0 / month" : "$\(plan.price) / month")
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                .padding(.vertical, 2)

                ForEach(plan.features) { feature in
                    Label {
                        Text(feature.label)
                    } icon: {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                    }
                }
            } header: {
                Text("Plan")
            } footer: {
                Text("Fair-use limits apply. Your data lives in your own database.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        } else {
            Section("Plan") {
                HStack(spacing: 8) {
                    ProgressView().controlSize(.small)
                    Text("Loading your plan…")
                        .foregroundStyle(.secondary)
                }
                .padding(.vertical, 2)
            }
        }
    }

    /// Who is signed in: initials avatar, name (or email), email. A session
    /// whose `/api/me` hasn't answered yet shows a quiet placeholder.
    @ViewBuilder
    private func identityRow(_ account: AccountInfo?) -> some View {
        HStack(spacing: 12) {
            InitialsAvatar(account: account, size: 36)
            VStack(alignment: .leading, spacing: 2) {
                if let account, account.hasIdentity {
                    Text(account.displayName)
                        .font(.body.weight(.medium))
                        .lineLimit(1)
                        .truncationMode(.middle)
                    if let email = account.displayDetail {
                        Text(email)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                } else {
                    Text("Loading your account…")
                        .foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("account-identity-row")
    }
}

/// "Free plan" — a tinted capsule, the same mark the web/mobile settings use.
struct PlanBadge: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.caption)
            .fontWeight(.semibold)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(.tint.opacity(0.14), in: Capsule())
            .foregroundStyle(.tint)
            .accessibilityLabel("Plan: \(title)")
    }
}
