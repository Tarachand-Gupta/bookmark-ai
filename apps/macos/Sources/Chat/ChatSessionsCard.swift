import SwiftUI

/// `listSessions` as a card: one section per saved snapshot (name, tab count,
/// browser, the AI description) with its tabs listed underneath and folded
/// past 10. The filter matches names, descriptions and tab titles/URLs — the
/// same targets the tool's server-side filter uses. "Load next 50" reads the
/// whole `/api/sessions` list once and slices the next page from it.
struct ChatSessionsCard: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    let output: SessionsToolOutput

    @State private var pager: ChatCardPager<SessionHit>
    @State private var query = ""

    init(output: SessionsToolOutput) {
        self.output = output
        _pager = State(initialValue: ChatCardPager(rows: output.hits, page: output.page))
    }

    private var isFiltering: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }

    private var filtered: [SessionHit] {
        pager.rows.filter { session in
            ChatCardText.matches(
                query, session.name, session.description,
                session.tabList.map { "\($0.title ?? "") \($0.url)" }.joined(separator: " ")
            )
        }
    }

    var body: some View {
        if pager.rows.isEmpty {
            CardNote(text: "No saved sessions found.")
        } else {
            content
        }
    }

    private var content: some View {
        let rows = filtered
        let total = pager.page?.total ?? pager.rows.count
        let summary = isFiltering ? "\(rows.count) of \(pager.rows.count)" : ChatCardText.plural(total, "session")

        return VStack(alignment: .leading, spacing: 0) {
            if pager.rows.count > 4 {
                CardFilterField(query: $query, placeholder: "Filter sessions by name, summary or tab", summary: summary)
                Divider()
            }

            if rows.isEmpty {
                CardNote(text: "No session matches “\(query)”.")
            } else {
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, session in
                    if index > 0 { Divider() }
                    SessionHitRow(session: session)
                }
            }

            CardPageFooter(
                page: pager.page,
                firstOffset: pager.firstOffset,
                shown: pager.rows.count,
                noun: "sessions",
                isLoading: pager.isLoading,
                error: pager.error
            ) {
                let api = appEnvironment.api
                let toolQuery = output.query
                Task {
                    await pager.loadMore { offset, limit in
                        ChatSessionsCardLogic.page(
                            try await api.listSessions().sessions, query: toolQuery, offset: offset, limit: limit
                        )
                    }
                }
            }
        }
    }
}

/// One session: name, "browser · N tabs", description, then its tabs folded
/// past 10, with "+K more in the session" when the tool clipped the list.
private struct SessionHitRow: View {
    let session: SessionHit

    @State private var shown = ChatCardFold.collapsedRows

    var body: some View {
        let tabs = session.tabList
        let fold = ChatCardFold.state(total: tabs.count, shown: shown)
        // The tool ships at most 15 tabs per session; anything beyond that
        // lives only in the session itself, so the count is spelled out
        // rather than promised.
        let beyondPayload = max(0, (session.tabCount ?? 0) - tabs.count)

        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                Image(systemName: "rectangle.stack")
                    .font(.system(size: 10.5))
                    .foregroundStyle(.secondary)
                Text(session.name)
                    .font(.callout)
                    .fontWeight(.medium)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(meta)
                    .font(.caption2)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }

            if let description = session.description, !description.isEmpty {
                Text(description)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .padding(.leading, 20)
            }

            VStack(spacing: 1) {
                ForEach(Array(tabs.prefix(fold.visibleCount).enumerated()), id: \.offset) { _, tab in
                    SessionTabCardRow(tab: tab)
                }
            }
            .padding(.leading, 14)
            .padding(.top, 2)

            if fold.hidden > 0 || fold.expanded || beyondPayload > 0 {
                HStack(spacing: 8) {
                    ShowMoreButton(fold: fold, noun: "tab") {
                        withAnimation(.easeOut(duration: 0.16)) {
                            shown = ChatCardFold.nextShown(total: tabs.count, shown: shown)
                        }
                    }
                    if beyondPayload > 0 {
                        Text("+\(beyondPayload) more in the session")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                .padding(.leading, 14)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
    }

    private var meta: String {
        var parts: [String] = []
        if let browser = session.browser, !browser.isEmpty { parts.append(browser.capitalized) }
        if let count = session.tabCount { parts.append(ChatCardText.plural(count, "tab")) }
        return parts.joined(separator: " · ")
    }
}

private struct SessionTabCardRow: View {
    @Environment(\.openURL) private var openURL

    let tab: SessionTabHit

    private var openable: URL? { ChatCardText.openableURL(tab.url) }

    var body: some View {
        HStack(spacing: 8) {
            CardFavicon(pageURL: tab.url, size: 14)
            Text(tab.displayTitle)
                .font(.caption)
                .lineLimit(1)
            Text(ChatCardText.host(of: tab.url))
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .contentShape(Rectangle())
        .modifier(OpenableRow(url: openable))
        .contextMenu {
            if let openable {
                Button("Open in Browser") { openURL(openable) }
            }
            Button("Copy Link") { CardClipboard.copy(tab.url) }
        }
        .help(tab.url)
    }
}
