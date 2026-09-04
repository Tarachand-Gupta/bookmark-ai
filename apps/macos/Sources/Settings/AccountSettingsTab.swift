import SwiftUI

/// Settings ▸ Account: the plan (everyone is on Free — badge + what it
/// includes), then sign in / sign out and whatever `GET /api/me` reports.
struct AccountSettingsTab: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    var body: some View {
        let target = appEnvironment.preferences.serverTarget
        let auth = appEnvironment.auth
        let plan = appEnvironment.settings.plan

        Form {
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

            if target.requiresAuth {
                Section {
                    LabeledContent("Status") {
                        switch auth.status {
                        case .unknown:
                            Text("Checking…").foregroundStyle(.secondary)
                        case .signedOut:
                            Label("Signed out", systemImage: "person.crop.circle.badge.xmark")
                                .foregroundStyle(.secondary)
                        case .signedIn:
                            Label("Signed in", systemImage: "checkmark.seal.fill")
                                .foregroundStyle(.green)
                        }
                    }

                    if let account = auth.account {
                        LabeledContent("Name") {
                            Text(account.displayName).foregroundStyle(.secondary)
                        }
                        if let detail = account.displayDetail {
                            LabeledContent("Email") {
                                Text(detail).foregroundStyle(.secondary).textSelection(.enabled)
                            }
                        }
                    }
                } footer: {
                    Text("Sign-in opens the web app's Clerk page in a secure window. The session is kept in this app's own sandboxed website storage — no password or token is written anywhere else.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                Section {
                    if auth.status == .signedIn {
                        Button("Sign Out") {
                            Task { await appEnvironment.signOut() }
                        }
                    } else {
                        Button("Sign In…") { auth.beginSignIn() }
                            .buttonStyle(.borderedProminent)
                    }

                    if let error = auth.lastError {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(.red)
                    }
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
        .frame(height: 500)
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
