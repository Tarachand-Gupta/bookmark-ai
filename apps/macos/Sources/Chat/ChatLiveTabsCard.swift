import SwiftUI

/// `listLiveTabs` as an INTERACTIVE CARD: device sections → window groups →
/// tab rows (favicon, title, host; click opens in the browser). The tool
/// returns ONE PAGE of tabs (flat order, re-nested into its device/window
/// scaffolding), so the card shows exactly what the model read and offers
/// "Load next 50" to fetch more — one `GET /live` snapshot, sliced here — with
/// no model turn. A filter field narrows what's loaded, and each window folds
/// past 10 rows, opening 25 at a time.
struct ChatLiveTabsCard: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    let output: LiveTabsToolOutput

    @State private var pager: ChatCardPager<FlatLiveTab>
    @State private var query = ""

    /// `initialFilter` pre-fills the card's own filter box (the render
    /// harness shows the filtered state with it; the app always starts empty).
    init(output: LiveTabsToolOutput, initialFilter: String = "") {
        self.output = output
        _pager = State(initialValue: ChatCardPager(rows: ChatLiveCardLogic.flatten(output.deviceList), page: output.page))
        _query = State(initialValue: initialFilter)
    }

    private var filtered: [FlatLiveTab] {
        pager.rows.filter { ChatCardText.matches(query, $0.tab.title, $0.tab.url) }
    }

    private var isFiltering: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        if output.error != nil {
            CardNote(text: "Live tabs are unavailable right now.")
        } else if output.enabled == false {
            CardNote(text: "Live sharing is off — turn on Live Sessions sharing in the browser extension to let the assistant see your current tabs.")
        } else if pager.rows.isEmpty {
            CardNote(text: output.query.map { "No open tab matches “\($0)”." } ?? "No devices are sharing live tabs right now.")
        } else {
            content
        }
    }

    private var content: some View {
        let rows = filtered
        let devices = ChatLiveCardLogic.regroup(rows)
        let deviceCount = Set(pager.rows.map(\.device.label)).count
        let total = pager.page?.total ?? pager.rows.count
        let summary = isFiltering
            ? "\(rows.count) of \(pager.rows.count)"
            : "\(ChatCardText.plural(total, "tab")) · \(ChatCardText.plural(deviceCount, "device"))"

        return VStack(alignment: .leading, spacing: 0) {
            if pager.rows.count > 6 {
                CardFilterField(query: $query, placeholder: "Filter tabs by title or site", summary: summary)
                Divider()
            }

            ForEach(Array(devices.enumerated()), id: \.element.id) { index, device in
                if index > 0 { Divider() }
                LiveDeviceSection(device: device)
            }

            if isFiltering, rows.isEmpty {
                CardNote(text: "No loaded tab matches “\(query)”.")
            }

            CardPageFooter(
                page: pager.page,
                firstOffset: pager.firstOffset,
                shown: pager.rows.count,
                noun: "tabs",
                isLoading: pager.isLoading,
                error: pager.error
            ) {
                let toolQuery = output.query
                let live = appEnvironment.live
                Task {
                    await pager.loadMore { offset, limit in
                        ChatLiveCardLogic.page(snapshot: try await live.snapshot(), query: toolQuery, offset: offset, limit: limit)
                    }
                }
            }
        }
    }
}

/// One device: presence dot, name, browser, "N of M tabs · freshness" — then
/// its windows. Window groups are shown even for a single window: the header
/// carries the window's name and its own count, which is how the Live view
/// identifies "the window I was working in".
private struct LiveDeviceSection: View {
    let device: RegroupedLiveDevice

    private var age: Int { device.device.lastSeenAgeSeconds ?? 0 }
    private var isActive: Bool { age < 75 }
    private var tabCount: Int { device.device.tabCount ?? device.loadedTabCount }
    private var hidden: Int { device.device.hiddenTabCount ?? 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 7) {
                Circle()
                    .fill(isActive ? Color.green : Color.secondary.opacity(0.5))
                    .frame(width: 7, height: 7)
                Text(device.device.label.isEmpty ? "Unnamed device" : device.device.label)
                    .font(.callout)
                    .fontWeight(.semibold)
                    .lineLimit(1)
                if let browser = device.device.browser, browser != "other" {
                    Text(browser.capitalized)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Text(countText + " · " + LiveDevice.freshnessText(ageSeconds: age))
                    .font(.caption2)
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 12)
            .padding(.top, 9)

            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(device.windows.enumerated()), id: \.offset) { index, window in
                    LiveWindowGroup(window: window, fallbackIndex: index + 1)
                }
            }
            .padding(.horizontal, 10)

            if hidden > 0 {
                Text("\(ChatCardText.plural(hidden, "tab")) on this device \(hidden == 1 ? "is" : "are") in windows that aren’t shared to live sessions")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                    .padding(.horizontal, 12)
            }
        }
        .padding(.bottom, 9)
        .opacity(isActive ? 1 : 0.85)
    }

    private var countText: String {
        device.loadedTabCount < tabCount
            ? "\(device.loadedTabCount) of \(tabCount) tabs"
            : ChatCardText.plural(tabCount, "tab")
    }
}

/// One browser window: its label + tab count, then the tabs, folded past 10.
private struct LiveWindowGroup: View {
    let window: LiveWindowHit
    let fallbackIndex: Int

    @State private var shown = ChatCardFold.collapsedRows

    var body: some View {
        let tabs = window.tabList
        let total = window.windowTabCount ?? tabs.count
        let fold = ChatCardFold.state(total: tabs.count, shown: shown)

        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: "macwindow")
                    .font(.system(size: 10))
                    .foregroundStyle(.secondary)
                Text(window.displayName(fallbackIndex: fallbackIndex))
                    .font(.caption)
                    .fontWeight(.medium)
                    .lineLimit(1)
                Spacer(minLength: 8)
                Text(tabs.count < total ? "\(tabs.count) of \(total) tabs" : ChatCardText.plural(total, "tab"))
                    .font(.caption2)
                    .monospacedDigit()
                    .foregroundStyle(.tertiary)
            }
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .background(.quaternary.opacity(0.3))

            Divider()

            VStack(spacing: 1) {
                ForEach(Array(tabs.prefix(fold.visibleCount).enumerated()), id: \.offset) { _, tab in
                    LiveTabCardRow(tab: tab)
                }
            }
            .padding(.horizontal, 4)
            .padding(.vertical, 4)

            if fold.hidden > 0 || fold.expanded {
                ShowMoreButton(fold: fold, noun: "tab") {
                    withAnimation(.easeOut(duration: 0.16)) {
                        shown = ChatCardFold.nextShown(total: tabs.count, shown: shown)
                    }
                }
                .padding(.horizontal, 4)
                .padding(.bottom, 4)
            }
        }
        .background(.background.opacity(0.35), in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .strokeBorder(.separator.opacity(0.7), lineWidth: 1)
        )
    }
}

/// One live tab: favicon, title, host. Click opens it in the browser; the
/// context menu copies the link.
private struct LiveTabCardRow: View {
    @Environment(\.openURL) private var openURL

    let tab: LiveTabHit

    private var openable: URL? { ChatCardText.openableURL(tab.url) }

    var body: some View {
        HStack(spacing: 8) {
            CardFavicon(pageURL: tab.url, favIconUrl: tab.favIconUrl, size: 14)
            Text(tab.displayTitle)
                .font(.caption)
                .fontWeight(.medium)
                .lineLimit(1)
                .truncationMode(.tail)
            Text(ChatCardText.host(of: tab.url))
                .font(.caption2)
                .foregroundStyle(.tertiary)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 4)
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

/// Hover fill + pointing hand + click-to-open for a row whose URL may open.
/// Rows without an openable URL stay inert (no cursor change, no fill).
struct OpenableRow: ViewModifier {
    @Environment(\.openURL) private var openURL
    let url: URL?

    func body(content: Content) -> some View {
        if let url {
            content
                .hoverHighlight(radius: 5)
                .pointingHandCursor()
                .onTapGesture { openURL(url) }
                .accessibilityAddTraits(.isLink)
        } else {
            content
        }
    }
}
