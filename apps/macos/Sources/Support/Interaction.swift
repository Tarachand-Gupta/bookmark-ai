import AppKit
import SwiftUI

// ── Cursor ───────────────────────────────────────────────────────────────────

/// Shows the pointing-hand cursor while hovering — the "this is clickable"
/// signal Mac users expect on link-like surfaces. SwiftUI has no cursor API
/// before macOS 15's `pointerStyle`, so this sets `NSCursor` directly.
private struct PointingHandOnHover: ViewModifier {
    func body(content: Content) -> some View {
        content.onHover { inside in
            if inside {
                NSCursor.pointingHand.set()
            } else {
                NSCursor.arrow.set()
            }
        }
    }
}

extension View {
    func pointingHandCursor() -> some View {
        modifier(PointingHandOnHover())
    }
}

// ── Content column ───────────────────────────────────────────────────────────

/// The ONE content-column geometry every detail view uses (Tara: "the container
/// size that opens on the right side should be the same" across bookmarks,
/// sessions, live tabs, and chat). Change it here or nowhere.
enum ContentColumn {
    static let maxWidth: CGFloat = 860
    static let padding: CGFloat = 16
}

// ── Surfaces ─────────────────────────────────────────────────────────────────

/// The one card/row chrome used across the app: a surface slightly lighter than
/// the window, a hairline border, and a very slight shadow that deepens on
/// hover. Semantic, translucent fills keep the behind-window vibrancy alive
/// underneath. Selection wins over hover.
struct SurfaceCard: ViewModifier {
    var radius: CGFloat = 12
    var isHovering = false
    var isSelected = false

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        content
            .background(
                shape.fill(
                    isSelected
                        ? AnyShapeStyle(.tint.opacity(0.16))
                        : isHovering ? AnyShapeStyle(.quaternary) : AnyShapeStyle(.quinary)
                )
            )
            .overlay(
                shape.strokeBorder(
                    isSelected ? AnyShapeStyle(.tint.opacity(0.55)) : AnyShapeStyle(.separator),
                    lineWidth: 1
                )
            )
            .shadow(
                color: .black.opacity(isHovering ? 0.16 : 0.08),
                radius: isHovering ? 7 : 3,
                y: isHovering ? 2 : 1
            )
            .contentShape(shape)
    }
}

extension View {
    func surfaceCard(radius: CGFloat = 12, hovering: Bool = false, selected: Bool = false) -> some View {
        modifier(SurfaceCard(radius: radius, isHovering: hovering, isSelected: selected))
    }
}

/// The lighter treatment for SUB-rows that live inside a card (a tab inside a
/// session, a live tab): no border or shadow, just a soft fill on hover so the
/// row answers the pointer.
struct HoverHighlight: ViewModifier {
    @State private var isHovering = false
    var radius: CGFloat = 7

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(isHovering ? AnyShapeStyle(.quaternary) : AnyShapeStyle(.clear))
            )
            .onHover { isHovering = $0 }
    }
}

extension View {
    func hoverHighlight(radius: CGFloat = 7) -> some View {
        modifier(HoverHighlight(radius: radius))
    }
}
