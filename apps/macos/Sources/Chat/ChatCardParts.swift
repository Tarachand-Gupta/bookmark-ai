import AppKit
import Observation
import SwiftUI

// ── Chat card parts ──────────────────────────────────────────────────────────
//
// The building blocks the four list cards (live tabs, bookmarks, SQL,
// sessions) share, so they read as one component family: a filter strip,
// the per-group "Show N more" control, the page footer with "Load next 50",
// a muted note line, and the favicon tile. Every clickable surface answers
// the pointer (hover fill + pointing hand), per the polish bar.

// MARK: - Paging state

/// "Load more" for a PAGE of tool results: the card fetches the next page from
/// the same HTTP route the tool used, with NO model turn. Rows accumulate;
/// `firstOffset` is the tool's own offset (the footer counts from it).
@MainActor
@Observable
final class ChatCardPager<Row> {
    private(set) var rows: [Row]
    private(set) var page: ToolPageMeta?
    private(set) var isLoading = false
    private(set) var error: String?
    let firstOffset: Int

    init(rows: [Row], page: ToolPageMeta?) {
        self.rows = rows
        self.page = page
        self.firstOffset = page?.offset ?? 0
    }

    var canLoadMore: Bool { page?.hasMore == true && page?.nextOffset != nil }

    func loadMore(_ fetch: (_ offset: Int, _ limit: Int) async throws -> (rows: [Row], page: ToolPageMeta)) async {
        guard let page, page.hasMore, let next = page.nextOffset, !isLoading else { return }
        isLoading = true
        error = nil
        defer { isLoading = false }
        do {
            let result = try await fetch(next, page.limit)
            rows.append(contentsOf: result.rows)
            self.page = result.page
        } catch {
            self.error = (error as? ApiError)?.errorDescription ?? error.localizedDescription
        }
    }
}

// MARK: - Filter strip

/// The card's header strip: a live filter field on the left, totals on the
/// right. Rendered only when there is enough data to be worth filtering.
struct CardFilterField: View {
    @Binding var query: String
    let placeholder: String
    let summary: String

    @State private var isHovering = false
    @FocusState private var isFocused: Bool

    var body: some View {
        HStack(spacing: 8) {
            HStack(spacing: 5) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.tertiary)
                TextField(placeholder, text: $query)
                    .textFieldStyle(.plain)
                    .font(.caption)
                    .focused($isFocused)
                    .accessibilityLabel(placeholder)
                if !query.isEmpty {
                    Button {
                        query = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 10))
                            .foregroundStyle(.tertiary)
                    }
                    .buttonStyle(.plain)
                    .pointingHandCursor()
                    .help("Clear filter")
                    .accessibilityLabel("Clear filter")
                }
            }
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(.background.opacity(0.6))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .strokeBorder(
                        isFocused ? AnyShapeStyle(.tint.opacity(0.7))
                            : isHovering ? AnyShapeStyle(.separator) : AnyShapeStyle(.separator.opacity(0.6)),
                        lineWidth: 1
                    )
            )
            .onHover { isHovering = $0 }
            .contentShape(Rectangle())
            .onTapGesture { isFocused = true }

            Text(summary)
                .font(.caption2)
                .monospacedDigit()
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .fixedSize()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(.quaternary.opacity(0.35))
    }
}

// MARK: - Fold control

/// "Show 25 more (44 left)" / "Show 7 more tabs" / "Show less" — the per-group
/// truncation control. Hidden when there is nothing to fold or unfold.
struct ShowMoreButton: View {
    let fold: ChatCardFold.State
    let noun: String
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        if fold.hidden > 0 || fold.expanded {
            Button(action: action) {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 8.5, weight: .semibold))
                        .rotationEffect(.degrees(fold.hidden == 0 ? 180 : 0))
                    Text(ChatCardFold.showMoreLabel(hidden: fold.hidden, nextChunk: fold.nextChunk, noun: noun))
                }
                .font(.caption)
                .fontWeight(.medium)
                .foregroundStyle(isHovering ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
                .padding(.horizontal, 7)
                .padding(.vertical, 4)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(isHovering ? .hoverFill : AnyShapeStyle(.clear))
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .onHover { isHovering = $0 }
            .pointingHandCursor()
            .help(fold.hidden == 0 ? "Collapse this group" : "Reveal more rows")
            .accessibilityValue(fold.expanded ? "Expanded" : "Collapsed")
        }
    }
}

// MARK: - Page footer

/// Which rows this card is showing out of how many, and the control that
/// fetches the next page. Rendered only when there IS a next page, the card
/// started past the first row, or a load failed.
struct CardPageFooter: View {
    let page: ToolPageMeta?
    let firstOffset: Int
    let shown: Int
    let noun: String
    let isLoading: Bool
    let error: String?
    let onLoadMore: () -> Void

    @State private var isHovering = false

    var body: some View {
        if let page, page.footerVisible(firstOffset: firstOffset, error: error) {
            HStack(spacing: 8) {
                Text("\(noun) \(page.rangeDescription(firstOffset: firstOffset, shown: shown))")
                    .font(.caption2)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .lineLimit(1)

                if page.hasMore {
                    Button(action: onLoadMore) {
                        HStack(spacing: 5) {
                            if isLoading {
                                ProgressView().controlSize(.mini)
                            }
                            Text(isLoading ? "Loading…" : "Load next \(page.limit)")
                        }
                        .font(.caption)
                        .fontWeight(.medium)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .fill(isHovering && !isLoading ? .hoverFill : AnyShapeStyle(.clear))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .strokeBorder(.separator, lineWidth: 1)
                        )
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(isLoading)
                    .opacity(isLoading ? 0.7 : 1)
                    .onHover { isHovering = $0 }
                    .pointingHandCursor()
                    .help("Fetch the next page without asking the assistant again")
                }

                if let error {
                    Text(error)
                        .font(.caption2)
                        .foregroundStyle(.red)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 6)
            .background(.quaternary.opacity(0.35))
        }
    }
}

// MARK: - Notes & tiles

/// One muted line — "No matches", "Live sharing is off", …
struct CardNote: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .textSelection(.enabled)
    }
}

/// A tab's real favicon when the capture carried one (or the site's
/// `/favicon.ico`), else the host's initial in a muted dot.
struct CardFavicon: View {
    let pageURL: String
    var favIconUrl: String? = nil
    var size: CGFloat = 16

    private var letter: String {
        let host = ChatCardText.host(of: pageURL)
        return host.first.map { String($0).uppercased() } ?? "•"
    }

    var body: some View {
        RemoteImage(url: ChatCardText.faviconURL(favIconUrl: favIconUrl, pageURL: pageURL)) {
            Text(letter)
                .font(.system(size: size * 0.55, weight: .medium))
                .foregroundStyle(.secondary)
                .frame(width: size, height: size)
                .background(.quaternary, in: Circle())
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))
        .accessibilityHidden(true)
    }
}

/// A row's trailing icon action (copy link / open), visible on row hover.
struct CardIconButton: View {
    let systemName: String
    let help: String
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 10.5, weight: .medium))
                .foregroundStyle(isHovering ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary))
                .frame(width: 22, height: 22)
                .background(
                    RoundedRectangle(cornerRadius: 5, style: .continuous)
                        .fill(isHovering ? .hoverFill : AnyShapeStyle(.clear))
                )
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .pointingHandCursor()
        .help(help)
        .accessibilityLabel(help)
    }
}

/// A small rounded chip (category / tag). Clickable when `action` is set —
/// it then filters the library on that facet.
struct CardChip: View {
    let text: String
    var systemImage: String? = nil
    var prominent = false
    var action: (() -> Void)? = nil

    @State private var isHovering = false

    var body: some View {
        Button {
            action?()
        } label: {
            HStack(spacing: 3) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.system(size: 8, weight: .semibold))
                }
                Text(text)
                    .lineLimit(1)
            }
            .font(.system(size: 10, weight: prominent ? .medium : .regular))
            .foregroundStyle(prominent ? .accentPillLabel : (isHovering ? AnyShapeStyle(.primary) : AnyShapeStyle(.secondary)))
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(
                Capsule().fill(prominent ? .accentPillFill : (isHovering ? .hoverFill : AnyShapeStyle(.clear)))
            )
            .overlay(
                Capsule().strokeBorder(prominent ? AnyShapeStyle(.clear) : AnyShapeStyle(.separator), lineWidth: 1)
            )
            .opacity(prominent && isHovering ? 0.85 : 1)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(action == nil)
        .onHover { isHovering = $0 }
        .pointingHandCursor()
    }
}

/// Puts `url` on the pasteboard — shared by every row's "Copy Link".
enum CardClipboard {
    static func copy(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
    }
}
