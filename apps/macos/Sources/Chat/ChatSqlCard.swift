import SwiftUI

/// `queryDatabase` as a card: the SQL that ran (visible even mid-stream and on
/// failure) above a real table with a row filter, chunked "Show more", and a
/// "Load next 50" that re-runs the SAME SELECT through `POST /api/query` — the
/// engine path and guards the tool used, with no model turn. The table scrolls
/// inside its OWN container: a wide SELECT must never widen the chat column.
struct ChatSqlCard: View {
    let sql: String?
    /// nil while the tool runs or when it failed — the SQL alone renders then.
    let output: SqlToolOutput?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let sql {
                SqlStatementBlock(sql: sql)
            }
            if let output, let columns = output.columns, let rows = output.rows {
                if sql != nil { Divider() }
                SqlResultTable(
                    columns: columns,
                    initialRows: rows,
                    truncated: output.truncated == true,
                    initialPage: output.page,
                    sql: output.sql ?? sql
                )
            }
        }
    }
}

/// The statement, monospaced, scrolling sideways rather than wrapping — a
/// wrapped SELECT is unreadable. Copy on hover.
private struct SqlStatementBlock: View {
    let sql: String

    @State private var isHovering = false
    @State private var didCopy = false

    var body: some View {
        ScrollView(.horizontal) {
            Text(sql)
                .font(.system(size: 11, design: .monospaced))
                .textSelection(.enabled)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(.quaternary.opacity(0.25))
        .overlay(alignment: .topTrailing) {
            if isHovering || didCopy {
                Button {
                    CardClipboard.copy(sql)
                    didCopy = true
                    Task {
                        try? await Task.sleep(for: .seconds(1.5))
                        didCopy = false
                    }
                } label: {
                    Label(didCopy ? "Copied" : "Copy", systemImage: didCopy ? "checkmark" : "doc.on.doc")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 3)
                        .background(.cardFill, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                }
                .buttonStyle(.plain)
                .pointingHandCursor()
                .help("Copy SQL")
                .padding(5)
            }
        }
        .onHover { isHovering = $0 }
    }
}

private struct SqlResultTable: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    let columns: [String]
    let truncated: Bool
    let sql: String?

    @State private var pager: ChatCardPager<[JSONValue]>
    @State private var query = ""
    @State private var shown = ChatCardFold.collapsedRows
    /// The total the FIRST page established — `/api/query` doesn't recount.
    private let knownTotal: Int?

    init(columns: [String], initialRows: [[JSONValue]], truncated: Bool, initialPage: ToolPageMeta?, sql: String?) {
        self.columns = columns
        self.truncated = truncated
        self.sql = sql
        self.knownTotal = initialPage?.total
        _pager = State(initialValue: ChatCardPager(rows: initialRows, page: sql == nil ? nil : initialPage))
    }

    private var isFiltering: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }

    private var filtered: [[JSONValue]] {
        pager.rows.filter { row in
            ChatCardText.matches(query, row.map(ChatCardText.cellText).joined(separator: " "))
        }
    }

    var body: some View {
        if pager.rows.isEmpty {
            CardNote(text: "No rows.")
        } else {
            content
        }
    }

    private var content: some View {
        let rows = filtered
        let fold = ChatCardFold.state(total: rows.count, shown: shown)
        let summary = isFiltering ? "\(rows.count) of \(pager.rows.count)" : ChatCardText.plural(pager.rows.count, "row")

        return VStack(alignment: .leading, spacing: 0) {
            if pager.rows.count > 6 {
                CardFilterField(query: $query, placeholder: "Filter rows", summary: summary)
                Divider()
            }

            if rows.isEmpty {
                CardNote(text: "No row matches “\(query)”.")
            } else {
                ScrollView(.horizontal) {
                    SqlGrid(columns: columns, rows: Array(rows.prefix(fold.visibleCount)))
                        .padding(.horizontal, 6)
                        .padding(.vertical, 4)
                }
            }

            if fold.hidden > 0 || fold.expanded || truncated {
                Divider()
                HStack(spacing: 8) {
                    ShowMoreButton(fold: fold, noun: "row") {
                        withAnimation(.easeOut(duration: 0.16)) {
                            shown = ChatCardFold.nextShown(total: rows.count, shown: shown)
                        }
                    }
                    if truncated {
                        Text("Long cell values were clipped.")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                    Spacer(minLength: 0)
                }
                .padding(4)
            }

            CardPageFooter(
                page: pager.page,
                firstOffset: pager.firstOffset,
                shown: pager.rows.count,
                noun: "rows",
                isLoading: pager.isLoading,
                error: pager.error
            ) {
                guard let sql else { return }
                let api = appEnvironment.api
                let total = knownTotal
                Task {
                    await pager.loadMore { offset, limit in
                        let response = try await api.queryPage(sql: sql, limit: limit, offset: offset)
                        var page = response.page
                        page.total = total
                        return (response.rows, page)
                    }
                }
            }
        }
    }
}

/// The table itself: header row on its own fill, hairline separators, zebra
/// striping, cells capped at ~320pt and wrapping to three lines. Lives inside
/// a horizontal ScrollView, so a wide result grows sideways, never the thread.
private struct SqlGrid: View {
    let columns: [String]
    let rows: [[JSONValue]]

    var body: some View {
        Grid(alignment: .topLeading, horizontalSpacing: 0, verticalSpacing: 0) {
            GridRow {
                ForEach(Array(columns.enumerated()), id: \.offset) { _, column in
                    Text(column)
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                        .modifier(SqlCellPadding())
                }
            }
            .background(.quaternary.opacity(0.4))

            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                Divider().gridCellUnsizedAxes(.horizontal)
                GridRow {
                    ForEach(Array(columns.indices), id: \.self) { column in
                        Text(ChatCardText.cellText(column < row.count ? row[column] : nil))
                            .font(.caption)
                            .monospacedDigit()
                            .lineLimit(3)
                            .textSelection(.enabled)
                            .modifier(SqlCellPadding())
                    }
                }
                .background(index.isMultiple(of: 2) ? AnyShapeStyle(.clear) : AnyShapeStyle(.quinary.opacity(0.5)))
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(.separator.opacity(0.7), lineWidth: 1)
        )
    }

    private struct SqlCellPadding: ViewModifier {
        func body(content: Content) -> some View {
            content
                .frame(maxWidth: 320, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .frame(maxHeight: .infinity, alignment: .top)
        }
    }
}
