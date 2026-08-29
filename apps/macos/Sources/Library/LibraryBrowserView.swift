import SwiftUI

/// The detail column: hosts whichever layout the user chose (grid or list) and
/// owns everything the layouts share — the empty/error/loading overlay and the
/// search-fallback banner — so switching layouts never changes app behavior.
struct LibraryBrowserView: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    var body: some View {
        Group {
            switch appEnvironment.preferences.libraryLayout {
            case .grid: BookmarkGridView()
            case .list: BookmarkListView()
            }
        }
        .overlay { statusOverlay }
        .safeAreaInset(edge: .top, spacing: 0) { fallbackBanner }
        .background(VisualEffectBackground().ignoresSafeArea())
    }

    // MARK: - Status

    /// A banner, not an error: the server answered, it just couldn't use the
    /// semantic index and served full-text instead.
    @ViewBuilder
    private var fallbackBanner: some View {
        if appEnvironment.library.searchFellBack {
            HStack(spacing: 6) {
                Image(systemName: "info.circle")
                Text("Semantic search is unavailable — showing full-text matches.")
                Spacer()
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding(.horizontal, 14)
            .padding(.vertical, 7)
            .background(.bar)
            .overlay(alignment: .bottom) { Divider() }
        }
    }

    /// Overlaid rather than swapped in, so the toolbar's search field and the
    /// window chrome stay put while the library is empty.
    @ViewBuilder
    private var statusOverlay: some View {
        let library = appEnvironment.library

        if let message = library.errorMessage {
            ContentUnavailableView {
                Label("Couldn't Load Your Library", systemImage: "exclamationmark.triangle")
            } description: {
                VStack(spacing: 6) {
                    Text(message)
                    if let hint = library.errorHint {
                        Text(hint).foregroundStyle(.secondary)
                    }
                }
            } actions: {
                Button("Try Again") {
                    Task { await appEnvironment.loadEverything() }
                }
                .buttonStyle(.borderedProminent)
            }
        } else if library.visibleBookmarks.isEmpty {
            // No backdrop on any of these: they only appear when the layout is
            // empty, and painting `.background` here would punch an opaque hole
            // in the window's vibrancy.
            if library.isLoading || library.isSearching {
                ProgressView()
                    .controlSize(.large)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if library.isShowingSearchResults {
                ContentUnavailableView.search(text: library.searchText)
            } else {
                ContentUnavailableView(
                    "No Bookmarks",
                    systemImage: "bookmark",
                    description: Text("Save a page from the browser extension and it will show up here.")
                )
            }
        }
    }
}
