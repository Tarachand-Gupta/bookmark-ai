import SwiftUI

/// The browsing layout: an adaptive grid of uniform cards, favicon-led the way
/// a Mac app grid is icon-led. Pointer-first by design — click opens, right-click
/// for everything else; the list layout remains the keyboard-first surface.
struct BookmarkGridView: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    private static let columns = [
        GridItem(.adaptive(minimum: 270, maximum: 390), spacing: 12)
    ]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: Self.columns, spacing: 12) {
                ForEach(appEnvironment.library.visibleBookmarks) { bookmark in
                    BookmarkCard(bookmark: bookmark)
                        .contextMenu { BookmarkContextMenu(bookmark: bookmark) }
                }
            }
            .padding(ContentColumn.padding)
            .frame(maxWidth: ContentColumn.maxWidth)
            .frame(maxWidth: .infinity)
        }
    }
}

/// One bookmark as a fixed-height card: identity row (favicon tile, title,
/// domain · age), summary, and a footer of category + tags pinned to the
/// bottom edge so every card's baseline lines up across the grid.
struct BookmarkCard: View {
    @Environment(\.openURL) private var openURL

    let bookmark: Bookmark

    @State private var isHovering = false

    /// Uniform card height keeps grid rows even regardless of how much text a
    /// bookmark carries; `Spacer` absorbs the slack between summary and footer.
    private static let height: CGFloat = 148

    var body: some View {
        Button(action: open) {
            content
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .frame(height: Self.height)
                .surfaceCard(radius: 12, hovering: isHovering)
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .pointingHandCursor()
        .animation(.easeOut(duration: 0.12), value: isHovering)
        .help(bookmark.url)
    }

    private var content: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 10) {
                FaviconTile(url: bookmark.faviconURL, side: 34)

                VStack(alignment: .leading, spacing: 2) {
                    Text(bookmark.displayTitle)
                        .font(.headline)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)

                    HStack(spacing: 4) {
                        Text(bookmark.domain)
                        if let savedAt = bookmark.savedAtDate {
                            Text("·")
                            Text(savedAt, format: .relative(presentation: .named))
                        }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                }

                Spacer(minLength: 0)
            }

            // Up to 3 lines: a short title leaves slack the summary can use;
            // the fixed card height truncates it earlier when the title took 2.
            if let description = bookmark.displayDescription {
                Text(description)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
                    .multilineTextAlignment(.leading)
            }

            Spacer(minLength: 0)

            HStack(spacing: 6) {
                if !bookmark.category.isEmpty {
                    CategoryBadge(name: bookmark.category)
                }
                ForEach(bookmark.tags.prefix(2), id: \.self) { tag in
                    Text("#\(tag)")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                Spacer(minLength: 0)
            }
            .lineLimit(1)
        }
    }

    private func open() {
        guard let url = bookmark.pageURL else { return }
        openURL(url)
    }
}
