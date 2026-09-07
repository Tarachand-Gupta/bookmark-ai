import Foundation

// ── Chat card logic ──────────────────────────────────────────────────────────
//
// The decisions every tool card makes, as pure functions: how a long group
// folds, how the substring filter matches, how live tabs flatten for paging
// and regroup for display, and how a client-side "next page" is cut from the
// sources that hand back a whole snapshot. A hand port of
// `packages/types/src/chat-tool-cards.ts` — the web and mobile cards run that
// module, this file must agree with it, and `ChatToolCardTests` pins the same
// cases the vitest suite does.

// MARK: - Folding

enum ChatCardFold {
    /// Rows shown per group before the rest folds behind "Show N more".
    static let collapsedRows = 10
    /// How many more rows one click reveals — a 92-tab window opens in
    /// readable chunks instead of dumping everything into the thread at once.
    static let expandChunk = 25

    struct State: Equatable {
        /// Rows to render right now.
        var visibleCount: Int
        /// Rows still folded away.
        var hidden: Int
        /// The group has been opened past its collapsed size.
        var expanded: Bool
        /// How many the next click reveals — the button says so.
        var nextChunk: Int
    }

    /// What a group of `total` rows shows when `shown` rows have been requested
    /// (`shown` starts at `limit` and grows by `chunk` per click).
    static func state(total: Int, shown: Int, limit: Int = collapsedRows, chunk: Int = expandChunk) -> State {
        let visible = max(0, min(total, shown))
        let hidden = max(0, total - visible)
        return State(visibleCount: visible, hidden: hidden, expanded: visible > limit, nextChunk: min(chunk, hidden))
    }

    /// The next `shown` after a click: one more chunk, or — when everything is
    /// already showing — back to the collapsed size.
    static func nextShown(total: Int, shown: Int, limit: Int = collapsedRows, chunk: Int = expandChunk) -> Int {
        shown >= total ? limit : min(total, shown + chunk)
    }

    /// "Show 25 more (44 left)" / "Show 3 more tabs" / "Show less".
    static func showMoreLabel(hidden: Int, nextChunk: Int?, noun: String) -> String {
        if hidden <= 0 { return "Show less" }
        let step = min(nextChunk ?? hidden, hidden)
        if step < hidden { return "Show \(step) more (\(hidden) left)" }
        return "Show \(hidden) more \(hidden == 1 ? noun : noun + "s")"
    }
}

// MARK: - Text helpers

enum ChatCardText {
    /// True when `query` (trimmed, case-insensitive) appears in any field. An
    /// empty query matches everything.
    static func matches(_ query: String?, _ fields: String?...) -> Bool {
        let q = (query ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if q.isEmpty { return true }
        return fields.contains { $0?.lowercased().contains(q) == true }
    }

    /// `https://www.example.com/a` → `example.com`; unparsable input comes back as-is.
    static func host(of urlString: String) -> String {
        guard let url = URL(string: urlString), let host = url.host(percentEncoded: false), !host.isEmpty else {
            return urlString
        }
        let lower = host.lowercased()
        return lower.hasPrefix("www.") ? String(lower.dropFirst(4)) : lower
    }

    /// Only plain http(s) links may open — everything else renders as text.
    static func openableURL(_ urlString: String) -> URL? {
        guard let url = URL(string: urlString), let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https", url.host() != nil
        else { return nil }
        return url
    }

    /// The favicon to show for a tab: the captured one when it is a real
    /// http(s) image URL, else the site's conventional `/favicon.ico`.
    static func faviconURL(favIconUrl: String?, pageURL: String) -> URL? {
        if let favIconUrl, let url = URL(string: favIconUrl),
           let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" {
            return url
        }
        guard let host = openableURL(pageURL)?.host() else { return nil }
        return URL(string: "https://\(host)/favicon.ico")
    }

    /// A SQL cell as text: null → "", strings raw, numbers/bools plain,
    /// arrays/objects as compact JSON.
    static func cellText(_ value: JSONValue?) -> String {
        guard let value else { return "" }
        switch value {
        case .null: return ""
        case .string(let s): return s
        case .int(let i): return String(i)
        case .double(let d):
            if d == d.rounded(), abs(d) < 1e15 { return String(Int(d)) }
            return String(d)
        case .bool(let b): return b ? "true" : "false"
        case .array, .object:
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
            guard let data = try? encoder.encode(value), let text = String(data: data, encoding: .utf8) else {
                return String(describing: value)
            }
            return text
        }
    }

    /// "1 tab" / "12 tabs".
    static func plural(_ n: Int, _ noun: String, _ pluralForm: String? = nil) -> String {
        "\(n.formatted()) \(n == 1 ? noun : (pluralForm ?? noun + "s"))"
    }
}

// MARK: - Page meta helpers

extension ToolPageMeta {
    /// Slice `items` into a page and describe it — for in-memory sources
    /// (sessions, live tabs) where the total IS known. Mirrors `pageOf`.
    static func slice<T>(_ items: [T], offset: Int, limit: Int) -> (items: [T], page: ToolPageMeta) {
        let from = max(0, offset)
        let size = min(pageLimit, max(1, limit))
        let end = min(items.count, from + size)
        let page = from < items.count ? Array(items[from..<end]) : []
        let hasMore = items.count > from + size
        return (page, ToolPageMeta(total: items.count, offset: from, limit: size, hasMore: hasMore, nextOffset: hasMore ? from + size : nil))
    }

    /// "51–100 of 312" / "1–8 of 8" / "1–50" (total unknown) — the footer label,
    /// counted from `firstOffset` (the FIRST page the card holds) over `shown`
    /// accumulated rows. Mirrors `describePageRange`.
    func rangeDescription(firstOffset: Int, shown: Int) -> String {
        if shown == 0 { return "no rows" }
        let first = firstOffset + 1
        let last = firstOffset + shown
        let of = total.map { " of \($0.formatted())" } ?? ""
        return "\(first.formatted())–\(last.formatted())\(of)"
    }

    /// Whether the footer has anything to say: a next page, a non-first
    /// offset, or an error — a card holding the whole first, complete result
    /// stays footer-less.
    func footerVisible(firstOffset: Int, error: String?) -> Bool {
        hasMore || firstOffset != 0 || error != nil
    }
}

// MARK: - Live tabs: flatten ↔ regroup

/// One tab plus the device/window it belongs to. Paging happens over this FLAT
/// order (matching the server's), and the sections are rebuilt from whatever is
/// loaded — so "Load more" appends into the right groups instead of restarting.
struct FlatLiveTab: Hashable {
    var device: LiveDeviceHit
    var windowId: Int?
    var windowName: String?
    var windowIndex: Int
    var windowTabCount: Int
    var tab: LiveTabHit
}

/// A device section as the card draws it: the device's own counts plus how
/// many of its tabs the card currently holds (page + filter).
struct RegroupedLiveDevice: Identifiable {
    var device: LiveDeviceHit
    var windows: [LiveWindowHit]
    var loadedTabCount: Int

    var id: String { device.label }
}

enum ChatLiveCardLogic {
    static func flatten(_ devices: [LiveDeviceHit]) -> [FlatLiveTab] {
        var out: [FlatLiveTab] = []
        for device in devices {
            for window in device.windowList {
                for tab in window.tabList {
                    out.append(FlatLiveTab(
                        device: device,
                        windowId: window.windowId,
                        windowName: window.name,
                        windowIndex: window.index ?? 1,
                        windowTabCount: window.windowTabCount ?? window.tabList.count,
                        tab: tab
                    ))
                }
            }
        }
        return out
    }

    /// Flat tabs → device sections → window groups, preserving first-seen
    /// order. Devices are keyed by label, windows by `windowId` (else index).
    static func regroup(_ flat: [FlatLiveTab]) -> [RegroupedLiveDevice] {
        var order: [String] = []
        var devices: [String: RegroupedLiveDevice] = [:]
        var windowKeys: [String: [String]] = [:]

        for item in flat {
            let deviceKey = item.device.label
            if devices[deviceKey] == nil {
                var stripped = item.device
                stripped.windows = nil
                devices[deviceKey] = RegroupedLiveDevice(device: stripped, windows: [], loadedTabCount: 0)
                order.append(deviceKey)
                windowKeys[deviceKey] = []
            }
            devices[deviceKey]!.loadedTabCount += 1

            let windowKey = item.windowId.map(String.init) ?? "index-\(item.windowIndex)"
            if let position = windowKeys[deviceKey]!.firstIndex(of: windowKey) {
                devices[deviceKey]!.windows[position].tabs?.append(item.tab)
            } else {
                windowKeys[deviceKey]!.append(windowKey)
                devices[deviceKey]!.windows.append(LiveWindowHit(
                    windowId: item.windowId,
                    name: item.windowName,
                    index: item.windowIndex,
                    windowTabCount: item.windowTabCount,
                    tabs: [item.tab]
                ))
            }
        }
        return order.compactMap { devices[$0] }
    }

    /// The card's "Load next 50": the live server hands back the whole current
    /// snapshot in one call, so a later page is the same flatten → filter →
    /// slice the tool did, done here. Mirrors `pageLiveSnapshot`.
    static func page(snapshot: ListLiveResponse, query: String?, offset: Int, limit: Int) -> (rows: [FlatLiveTab], page: ToolPageMeta) {
        var flat: [FlatLiveTab] = []
        for device in snapshot.devices {
            for (windowIndex, window) in device.windows.enumerated() {
                for tab in window.tabs where ChatCardText.matches(query, tab.title ?? "", tab.url) {
                    flat.append(FlatLiveTab(
                        device: LiveDeviceHit(
                            label: device.label,
                            browser: device.browser,
                            lastSeenAgeSeconds: device.lastSeenAgeSeconds,
                            tabCount: device.tabCount,
                            matchingTabCount: nil,
                            hiddenTabCount: device.hiddenTabCount,
                            windows: nil
                        ),
                        windowId: window.windowId,
                        windowName: window.name,
                        windowIndex: windowIndex + 1,
                        windowTabCount: window.tabs.count,
                        tab: LiveTabHit(title: tab.title ?? "", url: tab.url, favIconUrl: tab.favIconUrl)
                    ))
                }
            }
        }
        let sliced = ToolPageMeta.slice(flat, offset: offset, limit: limit)
        return (sliced.items, sliced.page)
    }
}

// MARK: - Sessions: a client-side page over the whole list

enum ChatSessionsCardLogic {
    /// The tool ships at most this many tabs per session.
    static let tabLimit = 15

    /// The same filter the `listSessions` tool applies: name, description,
    /// tab titles/URLs.
    static func filter(_ all: [Session], query: String?) -> [Session] {
        let q = (query ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if q.isEmpty { return all }
        return all.filter { session in
            var fields = [session.name, session.description ?? ""]
            for tab in session.tabs { fields.append(tab.title ?? ""); fields.append(tab.url) }
            return fields.contains { $0.lowercased().contains(q) }
        }
    }

    /// `/api/sessions` returns the whole (small) list in one call, so a later
    /// page is sliced from it: the tool's filter, then the tool's offset.
    static func page(_ all: [Session], query: String?, offset: Int, limit: Int) -> (rows: [SessionHit], page: ToolPageMeta) {
        let sliced = ToolPageMeta.slice(filter(all, query: query), offset: offset, limit: limit)
        let rows = sliced.items.map { session in
            SessionHit(
                id: session.id,
                name: session.name,
                description: session.description,
                tabCount: session.tabCount,
                browser: session.browser,
                savedAt: session.savedAt,
                tabs: session.tabs.prefix(tabLimit).map { SessionTabHit(title: $0.title ?? "", url: $0.url) }
            )
        }
        return (rows, sliced.page)
    }
}

// MARK: - Bookmarks: a search page → hits

enum ChatBookmarksCardLogic {
    /// `GET /api/search?offset=` → the card's next page of hits. Ranked
    /// retrieval never knows a total, so `total` is nil and `hasMore` drives
    /// the button. Mirrors `pageSearchResponse`.
    static func page(_ response: SearchResponse, offset: Int, limit: Int) -> (rows: [BookmarkHit], page: ToolPageMeta) {
        let rows = response.results.map { result in
            BookmarkHit(
                id: result.bookmark.id,
                title: result.bookmark.title,
                url: result.bookmark.url,
                category: result.bookmark.category,
                tags: result.bookmark.tags,
                day: String(result.bookmark.source.savedAt.prefix(10)),
                score: result.score
            )
        }
        let more = response.hasMore == true
        return (rows, ToolPageMeta(total: nil, offset: offset, limit: limit, hasMore: more, nextOffset: more ? offset + limit : nil))
    }
}
