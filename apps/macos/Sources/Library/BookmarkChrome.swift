import AppKit
import SwiftUI

/// The favicon presented the way a Mac shows an app icon: centered on a soft
/// rounded tile. Favicons are tiny (16–32 px) and arbitrary-shaped, so drawing
/// them small on a tile reads crisp and uniform where a bare stretched favicon
/// would read blurry and ragged.
struct FaviconTile: View {
    let url: URL?
    var side: CGFloat = 36

    var body: some View {
        RoundedRectangle(cornerRadius: side * 0.26, style: .continuous)
            .fill(.quinary)
            .frame(width: side, height: side)
            .overlay {
                RemoteImage(url: url) {
                    Image(systemName: "globe")
                        .font(.system(size: side * 0.4, weight: .regular))
                        .foregroundStyle(.tertiary)
                }
                .frame(width: side * 0.56, height: side * 0.56)
                .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
            }
    }
}

/// The AI-assigned category, styled as a tinted capsule.
struct CategoryBadge: View {
    let name: String

    var body: some View {
        Text(name)
            .font(.caption2)
            .padding(.horizontal, 6)
            .padding(.vertical, 1)
            .background(.tint.opacity(0.14), in: Capsule())
            .foregroundStyle(.tint)
    }
}

/// The one set of row/card actions, shared by the list and the grid so the two
/// layouts can never drift apart. Open is the primary action; everything else
/// lives here.
struct BookmarkContextMenu: View {
    @Environment(AppEnvironment.self) private var appEnvironment
    @Environment(\.openURL) private var openURL

    let bookmark: Bookmark

    var body: some View {
        Button("Open in Browser") {
            if let url = bookmark.pageURL { openURL(url) }
        }
        Button("Copy Link") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(bookmark.url, forType: .string)
        }
        Divider()
        Button("Delete", role: .destructive) {
            Task { await appEnvironment.library.delete(bookmark) }
        }
    }
}
