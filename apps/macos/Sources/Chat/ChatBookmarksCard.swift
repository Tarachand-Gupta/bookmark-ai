import SwiftUI

/// `searchBookmarks` as a card: ONE PAGE of hits with their category/tag chips
/// (click → the library filters on that facet), a substring filter over what's
/// loaded, and a "Load next 50" that re-runs the same search against
/// `/api/search` — no model turn. The model reads the same page verbatim, so
/// the card and the answer can never disagree about what was found.
struct ChatBookmarksCard: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    let output: SearchToolOutput

    @State private var pager: ChatCardPager<BookmarkHit>
    @State private var query = ""
    @State private var shown = ChatCardFold.collapsedRows

    init(output: SearchToolOutput) {
        self.output = output
        // Without an echoed query there is nothing to re-run (a turn stored
        // before paging shipped) — the card stays a plain list.
        let canPage = !(output.query ?? "").isEmpty
        _pager = State(initialValue: ChatCardPager(rows: output.hits, page: canPage ? output.page : nil))
    }

    private var isFiltering: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }

    private var filtered: [BookmarkHit] {
        pager.rows.filter {
            ChatCardText.matches(query, $0.title, $0.url, $0.category, $0.tagList.joined(separator: " "))
        }
    }

    var body: some View {
        if pager.rows.isEmpty {
            CardNote(text: "No matches in the library.")
        } else {
            content
        }
    }

    private var content: some View {
        let rows = filtered
        let fold = ChatCardFold.state(total: rows.count, shown: shown)
        let summary = isFiltering ? "\(rows.count) of \(pager.rows.count)" : ChatCardText.plural(pager.rows.count, "result")

        return VStack(alignment: .leading, spacing: 0) {
            if pager.rows.count > 6 {
                CardFilterField(query: $query, placeholder: "Filter results by title, site or tag", summary: summary)
                Divider()
            }

            if rows.isEmpty {
                CardNote(text: "No result matches “\(query)”.")
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(rows.prefix(fold.visibleCount).enumerated()), id: \.element.id) { index, hit in
                        if index > 0 { Divider().padding(.horizontal, 10) }
                        BookmarkHitRow(hit: hit, showScore: output.mode == "ai") { item in
                            Task { await appEnvironment.library.select(item) }
                        }
                    }
                }
                .padding(.vertical, 2)
            }

            if fold.hidden > 0 || fold.expanded {
                Divider()
                ShowMoreButton(fold: fold, noun: "result") {
                    withAnimation(.easeOut(duration: 0.16)) {
                        shown = ChatCardFold.nextShown(total: rows.count, shown: shown)
                    }
                }
                .padding(4)
            }

            CardPageFooter(
                page: pager.page,
                firstOffset: pager.firstOffset,
                shown: pager.rows.count,
                noun: "results",
                isLoading: pager.isLoading,
                error: pager.error
            ) {
                let api = appEnvironment.api
                let q = output.query ?? ""
                let mode = SearchMode(rawValue: output.mode ?? "hybrid") ?? .hybrid
                Task {
                    await pager.loadMore { offset, limit in
                        ChatBookmarksCardLogic.page(
                            try await api.search(query: q, mode: mode, limit: limit, offset: offset),
                            offset: offset, limit: limit
                        )
                    }
                }
            }
        }
    }
}

/// One hit: globe, title (click opens), host · day, category + tag chips, and
/// hover-revealed Copy/Open actions.
private struct BookmarkHitRow: View {
    @Environment(\.openURL) private var openURL

    let hit: BookmarkHit
    let showScore: Bool
    let onFilter: (SidebarItem) -> Void

    @State private var isHovering = false

    private var openable: URL? { ChatCardText.openableURL(hit.url) }

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            CardFavicon(pageURL: hit.url, size: 16)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(hit.displayTitle)
                        .font(.callout)
                        .fontWeight(.medium)
                        .lineLimit(1)
                        .modifier(OpenableText(url: openable))
                    if showScore, let score = hit.score {
                        Text("\(Int((score * 100).rounded()))% match")
                            .font(.caption2)
                            .monospacedDigit()
                            .foregroundStyle(.tertiary)
                    }
                }
                Text([ChatCardText.host(of: hit.url), hit.day].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                HStack(spacing: 4) {
                    if let category = hit.category, !category.isEmpty {
                        CardChip(text: category, systemImage: "folder", prominent: true) {
                            onFilter(.category(category))
                        }
                        .help("Category: \(category) — click to filter the library")
                    }
                    ForEach(hit.tagList.prefix(4), id: \.self) { tag in
                        CardChip(text: "#\(tag)") { onFilter(.tag(tag)) }
                            .help("Show #\(tag) bookmarks")
                    }
                }
                .padding(.top, 1)
            }

            Spacer(minLength: 4)

            HStack(spacing: 2) {
                CardIconButton(systemName: "doc.on.doc", help: "Copy link") { CardClipboard.copy(hit.url) }
                if let openable {
                    CardIconButton(systemName: "arrow.up.right", help: "Open in browser") { openURL(openable) }
                }
            }
            .opacity(isHovering ? 1 : 0)
            .animation(.easeOut(duration: 0.12), value: isHovering)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(isHovering ? .hoverFill : AnyShapeStyle(.clear))
                .padding(.horizontal, 4)
        )
        .contentShape(Rectangle())
        .onHover { isHovering = $0 }
        .contextMenu {
            if let openable {
                Button("Open in Browser") { openURL(openable) }
            }
            Button("Copy Link") { CardClipboard.copy(hit.url) }
        }
    }
}

/// A title that opens its URL on click (underlined on hover, pointing hand);
/// plain text when the URL can't open.
private struct OpenableText: ViewModifier {
    @Environment(\.openURL) private var openURL
    let url: URL?

    @State private var isHovering = false

    func body(content: Content) -> some View {
        if let url {
            content
                .underline(isHovering)
                .onHover { isHovering = $0 }
                .pointingHandCursor()
                .onTapGesture { openURL(url) }
                .help(url.absoluteString)
                .accessibilityAddTraits(.isLink)
        } else {
            content
        }
    }
}
