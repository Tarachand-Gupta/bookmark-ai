import SwiftUI

/// One bookmark as a spacious card row: favicon tile on the leading edge, the
/// text block in the middle, the OG preview image trailing when the scrape
/// found one — on its own surface, with hover and selection states.
///
/// Every color here is semantic (`.secondary`, `.tint`, `.quinary`), so the row
/// is correct in light and dark without a single hardcoded value.
struct BookmarkRow: View {
    let bookmark: Bookmark
    var isSelected = false

    @State private var isHovering = false

    var body: some View {
        content
            .surfaceCard(radius: 11, hovering: isHovering, selected: isSelected)
            .onHover { isHovering = $0 }
            .pointingHandCursor()
    }

    private var content: some View {
        HStack(alignment: .center, spacing: 12) {
            FaviconTile(url: bookmark.faviconURL, side: 36)

            VStack(alignment: .leading, spacing: 3) {
                Text(bookmark.displayTitle)
                    .font(.body)
                    .fontWeight(.semibold)
                    .lineLimit(1)

                if let description = bookmark.displayDescription {
                    Text(description)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }

                metadata
            }

            Spacer(minLength: 12)

            if let thumbnailURL = bookmark.thumbnailURL {
                RemoteImage(url: thumbnailURL) {
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(.quinary)
                }
                .frame(width: 96, height: 58)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
    }

    private var metadata: some View {
        HStack(spacing: 6) {
            Text(bookmark.domain)
                .foregroundStyle(.secondary)

            if !bookmark.category.isEmpty {
                CategoryBadge(name: bookmark.category)
            }

            ForEach(bookmark.tags.prefix(3), id: \.self) { tag in
                Text("#\(tag)")
                    .foregroundStyle(.tertiary)
            }

            if let savedAt = bookmark.savedAtDate {
                Text("·")
                    .foregroundStyle(.tertiary)
                Text(savedAt, format: .relative(presentation: .named))
                    .foregroundStyle(.tertiary)
            }
        }
        .font(.caption)
        .lineLimit(1)
    }
}
