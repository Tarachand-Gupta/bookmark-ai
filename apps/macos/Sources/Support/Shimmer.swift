import SwiftUI

/// A soft highlight sweeping across the content — the "still working" signal
/// for the chat's Thinking placeholder and the reasoning label. Driven by a
/// `TimelineView` rather than `repeatForever`, so it keeps moving through view
/// identity changes (streaming re-renders the row on every delta) and stops
/// costing anything the moment the view leaves the hierarchy.
struct Shimmer: ViewModifier {
    var period: Double = 1.5

    func body(content: Content) -> some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { timeline in
            let elapsed = timeline.date.timeIntervalSinceReferenceDate
            let phase = elapsed.truncatingRemainder(dividingBy: period) / period
            content
                .overlay {
                    GeometryReader { geometry in
                        let width = geometry.size.width
                        let band = max(40, width * 0.7)
                        LinearGradient(
                            stops: [
                                .init(color: .clear, location: 0),
                                .init(color: Color.primary.opacity(0.6), location: 0.5),
                                .init(color: .clear, location: 1),
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                        .frame(width: band)
                        .offset(x: -band + phase * (width + band))
                    }
                    .mask(content)
                    .allowsHitTesting(false)
                }
        }
    }
}

extension View {
    func shimmer(period: Double = 1.5) -> some View {
        modifier(Shimmer(period: period))
    }
}

/// The instant placeholder for a turn that has produced nothing yet: a
/// shimmering "Thinking" label with three softly pulsing dots. Shown the moment
/// the user sends, before the first chunk — the same treatment on web/mobile.
struct ThinkingIndicator: View {
    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30)) { timeline in
            let elapsed = timeline.date.timeIntervalSinceReferenceDate
            HStack(spacing: 7) {
                Text("Thinking")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .shimmer()
                HStack(spacing: 3) {
                    ForEach(0..<3, id: \.self) { index in
                        Circle()
                            .fill(.secondary)
                            .frame(width: 4, height: 4)
                            .opacity(0.25 + 0.75 * Self.pulse(elapsed, offset: Double(index) * 0.2))
                    }
                }
                .padding(.top, 2)
            }
        }
        .accessibilityLabel("Thinking")
    }

    /// 0…1 sine pulse with a per-dot phase offset.
    private static func pulse(_ time: TimeInterval, offset: Double) -> Double {
        (sin((time - offset) * 2 * .pi / 1.2) + 1) / 2
    }
}
