import AppKit
import SwiftUI

/// Behind-window vibrancy — the frosted "you can faintly see the desktop
/// through the app" look. SwiftUI's `Material` only blurs content *within* the
/// window, so the real thing still requires AppKit's `NSVisualEffectView` with
/// `.behindWindow` blending. `.sidebar` is the SAME material the split view's
/// sidebar carries, so both columns read as one continuous sheet of glass —
/// `.hudWindow` was more transparent but is dark-tinted even in light mode,
/// which made the content area visibly darker than the sidebar (Tara flagged
/// it). `.active` keeps the glass alive even while the window isn't key —
/// with `.followsWindowActiveState` the whole app went opaque the moment focus
/// moved, which read as "no transparency at all".
struct VisualEffectBackground: NSViewRepresentable {
    var material: NSVisualEffectView.Material = .sidebar

    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = material
        view.blendingMode = .behindWindow
        view.state = .active
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {
        view.material = material
    }
}
