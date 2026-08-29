import SwiftUI

/// The scanning layout: a native `List` — kept a real `List` on purpose so
/// arrow keys, click-to-select, and the Delete command come from AppKit's table
/// machinery — but each row draws as its own card surface (see `SurfaceCard`):
/// slightly lighter than the window, hairline border, slight shadow, hover and
/// selection states of its own. The system row background is cleared so the two
/// treatments can't stack.
struct BookmarkListView: View {
    @Environment(AppEnvironment.self) private var appEnvironment
    @Environment(\.openURL) private var openURL

    @State private var selectedID: Bookmark.ID?

    var body: some View {
        List(selection: $selectedID) {
            ForEach(appEnvironment.library.visibleBookmarks) { bookmark in
                BookmarkRow(bookmark: bookmark, isSelected: selectedID == bookmark.id)
                    // Same content column as the grid/sessions/live/chat views.
                    .frame(maxWidth: ContentColumn.maxWidth)
                    .frame(maxWidth: .infinity)
                    .tag(bookmark.id)
                    .contextMenu { BookmarkContextMenu(bookmark: bookmark) }
                    .onTapGesture(count: 2) { open(bookmark) }
                    .listRowBackground(Color.clear)
                    .listRowSeparator(.hidden)
                    .listRowInsets(EdgeInsets(
                        top: 4, leading: ContentColumn.padding,
                        bottom: 4, trailing: ContentColumn.padding
                    ))
            }
        }
        .listStyle(.inset)
        // The List's own opaque backdrop would block the behind-window vibrancy
        // that LibraryBrowserView installs — hide it, rows stay as they are.
        .scrollContentBackground(.hidden)
        .onDeleteCommand(perform: deleteSelected)
        .focusable()
    }

    private func open(_ bookmark: Bookmark) {
        guard let url = bookmark.pageURL else { return }
        openURL(url)
    }

    private func deleteSelected() {
        guard let selectedID,
              let bookmark = appEnvironment.library.visibleBookmarks.first(where: { $0.id == selectedID })
        else { return }
        Task { await appEnvironment.library.delete(bookmark) }
    }
}
