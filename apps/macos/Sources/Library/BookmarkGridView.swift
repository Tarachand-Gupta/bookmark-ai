import SwiftUI

/// The browsing layout: a CaskHub-style wall of app-like cards. Unlike the
/// reading views (list, sessions, chat), the grid uses the full window width —
/// same 16pt margins, but columns keep adapting instead of capping at the
/// reading column, so a wide window shows 4 across like a real app store.
struct BookmarkGridView: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    private static let columns = [
        GridItem(.adaptive(minimum: 250, maximum: 330), spacing: 14)
    ]

    var body: some View {
        ScrollView {
            LazyVGrid(columns: Self.columns, spacing: 14) {
                ForEach(appEnvironment.library.visibleBookmarks) { bookmark in
                    BookmarkCard(bookmark: bookmark)
                        .contextMenu { BookmarkContextMenu(bookmark: bookmark) }
                }
            }
            .padding(ContentColumn.padding)
        }
    }
}

/// One bookmark as a fixed-height card, anatomy borrowed from CaskHub:
/// icon tile + name with a tinted category label, description, a stats line,
/// and a full-width tinted Open pill pinned to the bottom edge.
struct BookmarkCard: View {
    @Environment(\.openURL) private var openURL

    let bookmark: Bookmark

    @State private var isHovering = false

    /// Uniform height keeps grid rows even regardless of text; the `Spacer`
    /// between description and stats absorbs the slack. Sized snug to a
    /// 2-line title + 2-line description (Tara: no dead space under the text).
    private static let height: CGFloat = 190

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            identityRow

            if let description = bookmark.displayDescription {
                Text(description)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    // Tooltips are scoped to what's UNDER the pointer (Tara):
                    // the description shows its own full text, not the URL.
                    .help(description)
            }

            Spacer(minLength: 0)

            statsRow
            openPill
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .frame(height: Self.height)
        .surfaceCard(radius: 13, hovering: isHovering)
        .onHover { isHovering = $0 }
        .animation(.easeOut(duration: 0.12), value: isHovering)
        .contentShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
        .onTapGesture(perform: open)
        .pointingHandCursor()
    }

    private var identityRow: some View {
        HStack(alignment: .top, spacing: 11) {
            FaviconTile(url: bookmark.faviconURL, side: 44)

            VStack(alignment: .leading, spacing: 2) {
                Text(bookmark.displayTitle)
                    .font(.headline)
                    .lineLimit(2)
                    .multilineTextAlignment(.leading)
                    .help(bookmark.displayTitle)

                // CaskHub puts the category under the name in the accent color;
                // uncategorized bookmarks show their domain there instead.
                Text(bookmark.category.isEmpty ? bookmark.domain : bookmark.category)
                    .font(.caption)
                    .foregroundStyle(.accentPillLabel)
                    .lineLimit(1)
            }

            Spacer(minLength: 4)

            Menu {
                BookmarkContextMenu(bookmark: bookmark)
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.system(size: 13))
                    .foregroundStyle(.tertiary)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .pointingHandCursor()
            .help("More actions")
        }
    }

    private var statsRow: some View {
        HStack(spacing: 4) {
            Text(bookmark.domain)
            if let savedAt = bookmark.savedAtDate {
                Text("·")
                Text(savedAt, format: .relative(presentation: .named))
            }
            Spacer(minLength: 0)
            if let tag = bookmark.tags.first {
                Text("#\(tag)")
            }
        }
        .font(.caption)
        .foregroundStyle(.tertiary)
        .lineLimit(1)
        .help(bookmark.url)
    }

    /// The CaskHub-style action: a full-width tinted pill. Same result as
    /// clicking the card — but the card reads as an *app* with an action, not
    /// as a dead tile.
    private var openPill: some View {
        Button(action: open) {
            HStack(spacing: 5) {
                Image(systemName: "arrow.up.forward")
                    .font(.system(size: 10, weight: .semibold))
                Text("Open")
            }
            .font(.callout.weight(.medium))
            .foregroundStyle(.accentPillLabel)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(.accentPillFill, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(.white.opacity(isHovering ? 0.05 : 0))
            )
            .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .pointingHandCursor()
        .help("Open in the browser")
    }

    private func open() {
        guard let url = bookmark.pageURL else { return }
        openURL(url)
    }
}
