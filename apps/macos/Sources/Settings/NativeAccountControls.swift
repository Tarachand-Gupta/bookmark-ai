import SwiftUI
import AppKit

/// Device controls act on Supabase's native sessions; names are display metadata.
struct NativeAccountControls: View {
    @Environment(AppEnvironment.self) private var environment
    @State private var sessions: [NativeDeviceSession] = []
    @State private var name = ""
    @State private var email = ""
    @State private var profileMessage: String?
    @State private var renamed: NativeDeviceSession?
    @State private var deviceName = ""
    @State private var busy = false
    @State private var error: String?
    @State private var confirmDelete = false
    @State private var confirmGlobal = false
    @State private var confirmRevoke: NativeDeviceSession?

    var body: some View {
        Section("Profile") {
            TextField("Display name", text: $name)
            Button("Save Name") { run { try await environment.api.updateNativeProfile(name: name); await environment.auth.loadAccount(using: environment.api) } }
            TextField("Email", text: $email)
            Button("Change Email") {
                run {
                    guard let native = environment.auth.native else { throw NativeAuthError.unavailable }
                    try await native.updateEmail(email.trimmingCharacters(in: .whitespacesAndNewlines))
                    profileMessage = "Check your email to confirm this change."
                }
            }
            if let profileMessage { Text(profileMessage).font(.caption).foregroundStyle(.secondary) }
            Button("Change Password…") { NSWorkspace.shared.open(environment.preferences.serverTarget.accountSettingsSignInURL) }
        }
        Section("Your Devices") {
            ForEach(sessions) { session in
                HStack {
                    VStack(alignment: .leading) {
                        Text(session.displayName + (session.isCurrent ? " · This Mac" : ""))
                        Text([session.clientType, session.os, session.browser].compactMap { $0 }.joined(separator: " · "))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button("Rename") { deviceName = session.displayName; renamed = session }
                    Button("Sign Out", role: .destructive) { confirmRevoke = session }
                }
            }
            Button("Refresh Devices") { run { try await load() } }
            Button("Sign Out Other Devices") { run { try await environment.auth.nativeSessionScope("others"); try await load() } }
            Button("Sign Out All Devices", role: .destructive) { confirmGlobal = true }
            if busy { ProgressView().controlSize(.small) }
            if let error { Text(error).foregroundStyle(.red).font(.caption) }
        }
        .task(id: environment.auth.account?.email) {
            sessions = []; name = environment.auth.account?.name ?? ""; email = environment.auth.account?.email ?? ""; profileMessage = nil
            do { try await load() } catch { self.error = error.localizedDescription }
        }
        .alert("Rename Device", isPresented: Binding(get: { renamed != nil }, set: { if !$0 { renamed = nil } })) {
            TextField("Device name", text: $deviceName)
            Button("Cancel", role: .cancel) { renamed = nil }
            Button("Save") { if let session = renamed { run { try await environment.api.renameNativeSession(session.id, name: deviceName); try await load() } }; renamed = nil }
        }
        .alert("Sign out this device?", isPresented: Binding(get: { confirmRevoke != nil }, set: { if !$0 { confirmRevoke = nil } })) {
            Button("Cancel", role: .cancel) { confirmRevoke = nil }
            Button("Sign Out", role: .destructive) {
                if let session = confirmRevoke {
                    run {
                        try await environment.api.revokeNativeSession(session.id)
                        if session.isCurrent { await environment.auth.nativeAccountDeleted() }
                        else { try await load() }
                    }
                }
                confirmRevoke = nil
            }
        }
        .alert("Sign out all devices?", isPresented: $confirmGlobal) {
            Button("Cancel", role: .cancel) { }
            Button("Sign Out All", role: .destructive) { run { try await environment.auth.nativeSessionScope("global") } }
        }
        Section {
            Button("Delete Account…", role: .destructive) { confirmDelete = true }
        } footer: {
            Text("Deletion removes this account and its database. Sign in again first if asked to confirm your identity.")
        }
        .alert("Delete your account and bookmarks?", isPresented: $confirmDelete) {
            Button("Cancel", role: .cancel) { }
            Button("Delete Account", role: .destructive) { run { try await environment.api.deleteNativeAccount(); await environment.auth.nativeAccountDeleted() } }
        }
        .disabled(busy)
    }
    @MainActor private func load() async throws { sessions = try await environment.api.nativeSessions() }
    private func run(_ operation: @escaping @MainActor () async throws -> Void) {
        guard !busy else { return }
        busy = true; error = nil
        Task { @MainActor in
            defer { busy = false }
            do { try await operation() } catch { self.error = error.localizedDescription }
        }
    }
}
