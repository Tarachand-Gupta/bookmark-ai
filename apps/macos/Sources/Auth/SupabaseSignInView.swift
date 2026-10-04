import SwiftUI

struct SupabaseSignInView: View {
    @Bindable var auth: AuthController
    @State private var email = ""
    @State private var password = ""
    @State private var code = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text(auth.needsMFA ? "Verify your authenticator" : auth.needsPasswordUpdate ? "Complete email confirmation" : "Sign in to Bookmark AI")
                    .font(.title2.weight(.semibold))
                Spacer()
                Button("Cancel") { auth.cancelSignIn() }.keyboardShortcut(.cancelAction)
            }
            Text("Supabase QA").font(.caption).foregroundStyle(.secondary)
            if auth.needsMFA {
                TextField("Authenticator code", text: $code).textFieldStyle(.roundedBorder)
                action("Verify", operation: "mfa")
            } else if auth.needsPasswordUpdate {
                SecureField("New password", text: $password).textFieldStyle(.roundedBorder)
                action("Save New Password", operation: "password")
                Button("Continue Without Changing Password") { Task { await auth.continueNativeCallback() } }
            } else {
                TextField("Email", text: $email).textContentType(.username).textFieldStyle(.roundedBorder)
                SecureField("Password", text: $password).textContentType(.password).textFieldStyle(.roundedBorder)
                HStack {
                    action("Sign In", operation: "email")
                    action("Create Account", operation: "signup")
                }
                action("Forgot Password?", operation: "recovery")
                Divider()
                HStack {
                    action("Continue with Google", operation: "google")
                    action("Continue with Apple", operation: "apple")
                }
            }
            if auth.nativeBusy { ProgressView().controlSize(.small) }
            if let message = auth.nativeMessage { Text(message).font(.callout).foregroundStyle(.secondary) }
            if let error = auth.lastError { Text(error).font(.callout).foregroundStyle(.red) }
        }
        .padding(28)
        .frame(width: 520)
        .interactiveDismissDisabled(auth.nativeBusy)
        .accessibilityIdentifier("supabase-sign-in-sheet")
    }
    private func action(_ title: String, operation: String) -> some View {
        Button(title) { Task { await auth.nativeAction(operation, email: email.trimmingCharacters(in: .whitespacesAndNewlines), password: password, code: code) } }
            .disabled(auth.nativeBusy)
            .accessibilityIdentifier("supabase-\(operation)")
    }
}
