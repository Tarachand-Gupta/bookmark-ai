import SwiftUI

/// The scanning layout: custom card rows in a plain ScrollView — the same
/// container pattern as Sessions/Live. This was a real `List` once, but
/// NSTableView draws a blue focus halo around a row whenever its context menu
/// opens (Tara: "I don't want this outline when I right click") and offers no
/// way to turn it off, so the table machinery is reimplemented here: click to
/// select, double-click to open, ↑/↓ to move, ⏎ to open, ⌫ to delete.
struct BookmarkListView: View {
    @Environment(AppEnvironment.self) private var appEnvironment
    @Environment(\.openURL) private var openURL

    @State private var selectedID: Bookmark.ID?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(appEnvironment.library.visibleBookmarks) { bookmark in
                        BookmarkRow(bookmark: bookmark, isSelected: selectedID == bookmark.id)
                            .contentShape(Rectangle())
                            // Single click selects instantly; a double-click ALSO
                            // opens (simultaneous, so selection never lags the
                            // 250ms double-click timeout).
                            .onTapGesture { selectedID = bookmark.id }
                            .simultaneousGesture(
                                TapGesture(count: 2).onEnded { open(bookmark) }
                            )
                            .contextMenu { BookmarkContextMenu(bookmark: bookmark) }
                            .id(bookmark.id)
                    }
                }
                .padding(.horizontal, ContentColumn.padding)
                .padding(.vertical, ContentColumn.padding / 2)
                .frame(maxWidth: ContentColumn.maxWidth)
                .frame(maxWidth: .infinity)
            }
            .focusable()
            .focusEffectDisabled()
            .onKeyPress(.upArrow) { moveSelection(by: -1, proxy: proxy); return .handled }
            .onKeyPress(.downArrow) { moveSelection(by: 1, proxy: proxy); return .handled }
            .onKeyPress(.return) {
                guard let bookmark = selectedBookmark else { return .ignored }
                open(bookmark)
                return .handled
            }
            .onDeleteCommand(perform: deleteSelected)
        }
    }

    private var selectedBookmark: Bookmark? {
        appEnvironment.library.visibleBookmarks.first { $0.id == selectedID }
    }

    private func moveSelection(by delta: Int, proxy: ScrollViewProxy) {
        let bookmarks = appEnvironment.library.visibleBookmarks
        guard !bookmarks.isEmpty else { return }
        let currentIndex = bookmarks.firstIndex { $0.id == selectedID }
        let next: Int
        if let currentIndex {
            next = min(max(currentIndex + delta, 0), bookmarks.count - 1)
        } else {
            next = delta > 0 ? 0 : bookmarks.count - 1
        }
        selectedID = bookmarks[next].id
        proxy.scrollTo(bookmarks[next].id, anchor: nil)
    }

    private func open(_ bookmark: Bookmark) {
        guard let url = bookmark.pageURL else { return }
        openURL(url)
    }

    private func deleteSelected() {
        guard let bookmark = selectedBookmark else { return }
        selectedID = nil
        Task { await appEnvironment.library.delete(bookmark) }
    }
}
