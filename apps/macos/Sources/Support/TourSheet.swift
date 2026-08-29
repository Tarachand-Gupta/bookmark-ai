import SwiftUI

/// The feature tour (sidebar ▸ Tour) — the Mac twin of the web's first-run
/// tour: one card per surface, Back/Continue, dots. Deliberately a plain paged
/// sheet, not a coach-mark overlay: it replays on demand, so it must not
/// depend on any particular window state.
struct TourSheet: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    @State private var page = 0

    private struct TourPage {
        let symbol: String
        let title: String
        let body: String
    }

    private static let pages: [TourPage] = [
        TourPage(
            symbol: "bookmark.fill",
            title: "Your library, everywhere",
            body: "Everything you save — from the extension, your phone, or this Mac — lands in one searchable library. Browse it as a grid (⌘1) or a spacious list (⌘2), and filter by category or tag from the sidebar."
        ),
        TourPage(
            symbol: "magnifyingglass",
            title: "Search that understands",
            body: "The search field blends full-text and semantic results, so \"that css dark article\" finds the Tailwind page even when the words don't match exactly."
        ),
        TourPage(
            symbol: "sparkles",
            title: "Ask AI",
            body: "A full agent over your library: it searches, counts, reads saved sessions and live tabs, and can bring in the web — with 1,000 free credits every week, or your own API key."
        ),
        TourPage(
            symbol: "rectangle.stack.fill",
            title: "Sessions",
            body: "Snapshots of browser windows you deliberately kept. Each gets an AI summary; open all tabs again with one click, rename, or re-summarize any time."
        ),
        TourPage(
            symbol: "dot.radiowaves.left.and.right",
            title: "Live Tabs",
            body: "A live mirror of what's open right now on every device that shares — streamed, searchable, and read-only. Turn sharing on from the browser extension."
        ),
        TourPage(
            symbol: "powerplug.fill",
            title: "Plug agents in over MCP",
            body: "Claude Code and other agents can search and save to your library through the MCP endpoint. Pick which tools are exposed in Settings → MCP."
        ),
    ]

    var body: some View {
        VStack(spacing: 0) {
            let current = Self.pages[page]

            Spacer(minLength: 28)

            Image(systemName: current.symbol)
                .font(.system(size: 42, weight: .medium))
                .foregroundStyle(.tint)
                .frame(height: 64)
                .symbolRenderingMode(.hierarchical)

            Text(current.title)
                .font(.title2)
                .fontWeight(.semibold)
                .padding(.top, 14)

            Text(current.body)
                .font(.callout)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 380)
                .frame(minHeight: 84, alignment: .top)
                .padding(.top, 8)

            Spacer(minLength: 8)

            HStack(spacing: 7) {
                ForEach(Self.pages.indices, id: \.self) { index in
                    Circle()
                        .fill(index == page ? AnyShapeStyle(.tint) : AnyShapeStyle(.quaternary))
                        .frame(width: 7, height: 7)
                }
            }
            .padding(.bottom, 18)

            Divider()

            HStack {
                Button("Skip") { close() }
                    .buttonStyle(.plain)
                    .foregroundStyle(.secondary)
                    .pointingHandCursor()

                Spacer()

                if page > 0 {
                    Button("Back") { withAnimation(.easeOut(duration: 0.15)) { page -= 1 } }
                }
                Button(page == Self.pages.count - 1 ? "Done" : "Continue") {
                    if page == Self.pages.count - 1 {
                        close()
                    } else {
                        withAnimation(.easeOut(duration: 0.15)) { page += 1 }
                    }
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
            }
            .padding(14)
        }
        .frame(width: 480, height: 400)
    }

    private func close() {
        appEnvironment.isPresentingTour = false
        page = 0
    }
}
