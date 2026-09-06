import AppKit
import SwiftUI

/// Shared chrome for the full-window auth states (signed out, connecting):
/// the window's glass, a centred column for the message, and the one piece of
/// chrome that must survive the gate — the Local/Cloud server picker. Without
/// it Local mode would be unreachable while signed out (Settings is gated too).
struct AuthGateScaffold<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        ZStack {
            VisualEffectBackground().ignoresSafeArea()
            VStack(spacing: 0) {
                Spacer(minLength: 24)
                content
                    .frame(maxWidth: 440)
                    .multilineTextAlignment(.center)
                Spacer(minLength: 24)
                ServerPickerFooter()
                    .padding(.bottom, 18)
            }
            .padding(.horizontal, 32)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        // No sidebar, no toolbar items: the window is just its title.
        .navigationTitle("Bookmark AI")
        .navigationSubtitle("")
    }
}

/// The app icon (the real asset-catalog one, via AppKit), squircle-cut for
/// in-app use — the iconset ships full-bleed for the Dock.
struct AppMark: View {
    var size: CGFloat = 88

    var body: some View {
        Image(nsImage: NSApp.applicationIconImage)
            .resizable()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.235, style: .continuous))
            .shadow(color: .black.opacity(0.18), radius: size * 0.12, y: size * 0.045)
            .accessibilityHidden(true)
    }
}

/// "Server  [Local | Cloud] · host" — the small footer on the gate screens.
struct ServerPickerFooter: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    var body: some View {
        let target = appEnvironment.preferences.serverTarget

        HStack(spacing: 10) {
            Text("Server")
                .font(.caption)
                .foregroundStyle(.secondary)
            Picker("Server", selection: targetBinding) {
                ForEach(ServerTarget.allCases) { target in
                    Text(target.displayName).tag(target)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .controlSize(.small)
            .fixedSize()
            .pointingHandCursor()
            .help("Local needs a dev server on :3000 (DEV_OPEN_API=1); Cloud needs a sign-in.")
            Text(target.hostLabel)
                .font(.caption)
                .foregroundStyle(.tertiary)
                .monospacedDigit()
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("server-picker-footer")
    }

    private var targetBinding: Binding<ServerTarget> {
        Binding(
            get: { appEnvironment.preferences.serverTarget },
            set: { newValue in Task { await appEnvironment.changeTarget(newValue) } }
        )
    }
}

/// The gate screens' one action button: large, prominent by default, with the
/// pointer + hover feedback every clickable surface in this app gives.
struct GateActionButton: View {
    let title: String
    var prominent = true
    var isDefault = false
    let action: () -> Void

    @State private var isHovering = false

    init(_ title: String, prominent: Bool = true, isDefault: Bool = false, action: @escaping () -> Void) {
        self.title = title
        self.prominent = prominent
        self.isDefault = isDefault
        self.action = action
    }

    var body: some View {
        button
            .controlSize(.large)
            .brightness(isHovering ? (prominent ? 0.07 : 0.03) : 0)
            .animation(.easeOut(duration: 0.12), value: isHovering)
            .onHover { isHovering = $0 }
            .pointingHandCursor()
    }

    @ViewBuilder
    private var button: some View {
        if prominent, isDefault {
            Button(action: action) { label }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
        } else if prominent {
            Button(action: action) { label }
                .buttonStyle(.borderedProminent)
        } else {
            Button(action: action) { label }
                .buttonStyle(.bordered)
        }
    }

    private var label: some View {
        Text(title)
            .font(.system(size: 14, weight: .medium))
            .frame(minWidth: 132)
            .padding(.vertical, 1)
    }
}

/// A sign-in started from the Settings window presents its sheet on the MAIN
/// window (that's where `SignInSheet` is attached); bring that window forward
/// so the sheet isn't hidden behind Settings. The main window is the only
/// wide, titled, non-panel window the app owns.
@MainActor
func bringMainWindowForward() {
    let candidates = NSApp.windows.filter {
        $0.isVisible && $0.styleMask.contains(.titled) && !($0 is NSPanel) && $0.frame.width >= 700
    }
    candidates.max(by: { $0.frame.width < $1.frame.width })?.makeKeyAndOrderFront(nil)
}
