import AppKit
import SwiftUI

/// Behind-window vibrancy — the frosted "you can faintly see the desktop
/// through the app" look. SwiftUI's `Material` only blurs content *within* the
/// window, so the real thing still requires AppKit's `NSVisualEffectView` with
/// `.behindWindow` blending. `.underWindowBackground` is the material AppKit
/// itself uses for window content backgrounds; the split view's sidebar already
/// carries its own, so applying this to the detail column frosts the whole window.
struct VisualEffectBackground: NSViewRepresentable {
    var material: NSVisualEffectView.Material = .underWindowBackground

    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = .behindWindow
        view.state = .followsWindowActiveState
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {
        view.material = material
    }
}
