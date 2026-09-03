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

/// The vertical expand/collapse cursor (⌃⌄-style resize arrows) for headers
/// whose click unfolds content in place — Tara: hovering a session header
/// should signal "this expands", not just "this is clickable".
private struct VerticalExpandOnHover: ViewModifier {
    func body(content: Content) -> some View {
        content.onHover { inside in
            if inside {
                NSCursor.resizeUpDown.set()
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

    func verticalExpandCursor() -> some View {
        modifier(VerticalExpandOnHover())
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

/// Hover tints, tuned with Tara ("very slight visual feedback… even none is
/// fine"): whole cards get a barely-there 3%; SUB-ROWS inside a card (a tab in
/// a window, a tab in a session) get 6% — on the solid card fill anything
/// lighter is invisible, which read as "no hover feedback at all". Headers
/// that expand get NO extra fill of their own (the card hover + expand cursor
/// are the affordance) — a header fill stacked on the card fill was the
/// "way too dark" hover.
extension ShapeStyle where Self == AnyShapeStyle {
    /// Sub-rows inside a card.
    static var hoverFill: AnyShapeStyle { AnyShapeStyle(Color.primary.opacity(0.06)) }
    /// Whole-card hover.
    static var cardHoverFill: AnyShapeStyle { AnyShapeStyle(Color.primary.opacity(0.03)) }

    /// The one CONTENT-SURFACE fill (cards, rows, chat blocks, composer): a
    /// flat, appearance-adaptive near-solid color over the window glass.
    /// Deliberately NOT a `Material` — a per-card material is a live backdrop
    /// blur that resamples every frame, and a grid of them made scrolling
    /// visibly lag (Tara: "not feeling native"). Flat fills scroll for free.
    /// The SAME hierarchy in both appearances (Tara: "inverted and similar to
    /// light mode"): the card is SOLID and one step brighter than the
    /// sidebar-toned glass behind it — white over light glass, elevated dark
    /// gray over dark glass. Fully opaque on purpose (the CaskHub recipe Tara
    /// signed off on: "just the background should be a bit transparent…
    /// card being not transparent is fine, it looks really good").
    static var cardFill: AnyShapeStyle {
        AnyShapeStyle(Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor(white: 0.17, alpha: 1.0)
                : NSColor(white: 1.0, alpha: 1.0)
        }))
    }

    /// Accent-tinted pill chrome (the grid's Open button). The system accent
    /// blue is barely legible on dark card gray (Tara flagged it), so dark
    /// mode uses a stronger fill and a lightened accent for the label —
    /// CaskHub's trick for its Install/Open buttons.
    static var accentPillFill: AnyShapeStyle {
        AnyShapeStyle(Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? NSColor.controlAccentColor.withAlphaComponent(0.32)
                : NSColor.controlAccentColor.withAlphaComponent(0.14)
        }))
    }

    static var accentPillLabel: AnyShapeStyle {
        AnyShapeStyle(Color(nsColor: NSColor(name: nil) { appearance in
            appearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua
                ? (NSColor.controlAccentColor.blended(withFraction: 0.55, of: .white) ?? .controlAccentColor)
                : NSColor.controlAccentColor
        }))
    }
}

/// The one card/row chrome used across the app: a near-solid `cardFill`, a
/// hairline border, and a very slight shadow that deepens on hover; the
/// hover/selection tint layers on top of the fill, never replaces it.
/// Selection wins over hover.
///
/// PERF: the shadow is attached to the background SHAPE, not the modified
/// view. A trailing `.shadow()` on the whole card shadows every subview
/// individually — each glyph, favicon, and stroke gets its own blur pass, and
/// a grid of cards made scrolling visibly lag. Shadowing just the rounded
/// rect is one cheap blur per card (and text stops looking faintly fuzzy).
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
                        : isHovering ? .cardHoverFill : AnyShapeStyle(.clear)
                )
            )
            .background(
                shape.fill(.cardFill)
                    .shadow(
                        color: .black.opacity(isHovering ? 0.16 : 0.08),
                        radius: isHovering ? 7 : 3,
                        y: isHovering ? 2 : 1
                    )
            )
            .overlay(
                shape.strokeBorder(
                    isSelected ? AnyShapeStyle(.tint.opacity(0.55)) : AnyShapeStyle(.separator),
                    lineWidth: 1
                )
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
                    .fill(isHovering ? .hoverFill : AnyShapeStyle(.clear))
            )
            .onHover { isHovering = $0 }
    }
}

extension View {
    func hoverHighlight(radius: CGFloat = 7) -> some View {
        modifier(HoverHighlight(radius: radius))
    }
}
