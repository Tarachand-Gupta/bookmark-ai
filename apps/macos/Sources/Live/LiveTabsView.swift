import AppKit
import SwiftUI

/// Live Tabs: what's open right now on every device that shares.
///
/// Layout rules (Tara's spec):
///  • Windows are collapsible. A device's FIRST window opens as a 3-tab
///    preview with a "Show all N tabs" affordance; every other window starts
///    collapsed to its header. Clicking a window header toggles it.
///  • Inactive devices (nothing pushed for 15 min) fold behind one
///    "Inactive devices" disclosure, collapsed by default — like the web.
///  • The search field filters tabs on-device (term match over title + URL);
///    while a query is active, folding/collapsing is bypassed entirely so a
///    match anywhere — a sleeping laptop included — surfaces.
struct LiveTabsView: View {
    @Environment(AppEnvironment.self) private var appEnvironment

    /// Tabs shown in a collapsed first-window preview.
    private static let previewTabCount = 3

    var body: some View {
        @Bindable var model = appEnvironment.live

        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                ForEach(model.activeDevices) { device in
                    deviceSection(device, model: model)
                }

                // Everything's asleep: say so, instead of a bare fold sitting in
                // an unexplained empty page.
                if model.loaded, model.enabled, !model.isSearching,
                   model.activeDevices.isEmpty, !model.inactiveDevices.isEmpty {
                    VStack(spacing: 6) {
                        Image(systemName: "moon.zzz")
                            .font(.system(size: 26))
                            .foregroundStyle(.tertiary)
                        Text("Nothing active right now")
                            .font(.callout)
                            .fontWeight(.medium)
                            .foregroundStyle(.secondary)
                        Text("No browser has shared tabs in the last 15 minutes. Devices appear here the moment one pushes.")
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: 380)
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 36)
                }

                if !model.inactiveDevices.isEmpty {
                    inactiveSection(model: model)
                }
            }
            .padding(ContentColumn.padding)
            .frame(maxWidth: ContentColumn.maxWidth)
            .frame(maxWidth: .infinity)
        }
        .background(VisualEffectBackground().ignoresSafeArea())
        .overlay { statusOverlay }
        .safeAreaInset(edge: .top, spacing: 0) { errorBanner }
        .navigationTitle("Live Tabs")
        .navigationSubtitle(subtitle)
        .searchable(text: $model.query, placement: .toolbar, prompt: "Search open tabs")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    Picker("Sort", selection: $model.sort) {
                        ForEach(LiveSort.allCases) { order in
                            Text(order.title).tag(order)
                        }
                    }
                    .pickerStyle(.inline)
                } label: {
                    Label("Sort", systemImage: "arrow.up.arrow.down")
                }
                .help("Sort devices")
            }

            ToolbarItem(placement: .primaryAction) {
                Button {
                    appEnvironment.live.start()
                } label: {
                    Label("Reconnect", systemImage: "arrow.clockwise")
                }
                .help("Reconnect to the live stream")
            }
        }
        // start/stop bracket exactly the time this view is on screen, so the
        // SSE connection can never outlive it.
        .onAppear { appEnvironment.live.start() }
        .onDisappear { appEnvironment.live.stop() }
    }

    // MARK: - Sections

    @ViewBuilder
    private func deviceSection(_ device: LiveDevice, model: LiveModel) -> some View {
        let windows = visibleWindows(of: device, model: model)
        if !(model.isSearching && windows.isEmpty) {
            VStack(alignment: .leading, spacing: 6) {
                LiveDeviceHeader(device: device)
                    .padding(.horizontal, 2)

                ForEach(Array(windows.enumerated()), id: \.element.windowId) { index, window in
                    LiveWindowCard(
                        device: device,
                        window: window,
                        title: window.displayName(at: indexInDevice(of: window, in: device)),
                        // First window previews; the rest collapse fully.
                        previewCount: index == 0 ? Self.previewTabCount : 0,
                        model: model
                    )
                }
            }
        }
    }

    /// Search hides windows without matches; browsing shows every window.
    private func visibleWindows(of device: LiveDevice, model: LiveModel) -> [LiveWindow] {
        guard model.isSearching else { return device.windows }
        return device.windows.filter { window in
            window.tabs.contains { model.matches($0) }
        }
    }

    /// A window's ordinal within its device (for the default "Window N" label),
    /// independent of search filtering.
    private func indexInDevice(of window: LiveWindow, in device: LiveDevice) -> Int {
        device.windows.firstIndex { $0.windowId == window.windowId } ?? 0
    }

    @ViewBuilder
    private func inactiveSection(model: LiveModel) -> some View {
        @Bindable var model = model

        if model.isSearching {
            // Query active: matches on inactive devices surface directly.
            ForEach(model.inactiveDevices) { device in
                deviceSection(device, model: model)
            }
        } else {
            VStack(alignment: .leading, spacing: 6) {
                Button {
                    withAnimation(.easeOut(duration: 0.16)) { model.showInactive.toggle() }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 10, weight: .semibold))
                            .rotationEffect(.degrees(model.showInactive ? 90 : 0))
                        Text("Inactive devices")
                        Text("\(model.inactiveDevices.count)")
                            .foregroundStyle(.tertiary)
                        Spacer(minLength: 0)
                    }
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .hoverHighlight()
                .pointingHandCursor()

                if model.showInactive {
                    ForEach(model.inactiveDevices) { device in
                        deviceSection(device, model: model)
                            .opacity(0.6)
                    }
                }
            }
        }
    }

    private var subtitle: String {
        let model = appEnvironment.live
        guard model.loaded, model.enabled else { return "" }
        let count = model.devices.count
        return "\(count) device\(count == 1 ? "" : "s") sharing"
    }

    // MARK: - Status

    /// Non-destructive: last-known tabs stay on screen while reconnecting.
    @ViewBuilder
    private var errorBanner: some View {
        if appEnvironment.live.errorMessage != nil, appEnvironment.live.loaded {
            HStack(spacing: 6) {
                Image(systemName: "wifi.exclamationmark")
                Text("Couldn't reach the live sessions server — retrying…")
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

    @ViewBuilder
    private var statusOverlay: some View {
        let model = appEnvironment.live

        if !model.loaded {
            if model.errorMessage != nil {
                ContentUnavailableView {
                    Label("Live Server Unreachable", systemImage: "wifi.exclamationmark")
                } description: {
                    Text("Couldn't reach the live sessions server. Retrying automatically…")
                } actions: {
                    Button("Try Now") { appEnvironment.live.start() }
                        .buttonStyle(.borderedProminent)
                }
            } else {
                ProgressView()
                    .controlSize(.large)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else if !model.enabled {
            ContentUnavailableView(
                "Live Tabs Are Off",
                systemImage: "dot.radiowaves.left.and.right",
                description: Text("Turn on Live Sessions sharing in the browser extension or the web app to mirror your open tabs here.")
            )
        } else if model.devices.isEmpty {
            ContentUnavailableView(
                "No Devices Sharing",
                systemImage: "laptopcomputer.slash",
                description: Text("Sharing is on, but no browser is currently mirroring its tabs.")
            )
        } else if model.isSearching,
                  model.activeDevices.allSatisfy({ device in
                      !device.windows.contains { $0.tabs.contains(where: model.matches) }
                  }),
                  model.inactiveDevices.allSatisfy({ device in
                      !device.windows.contains { $0.tabs.contains(where: model.matches) }
                  }) {
            ContentUnavailableView.search(text: model.query)
        }
    }
}

/// Device header line: symbol, label, browser, freshness dot, tab count.
private struct LiveDeviceHeader: View {
    let device: LiveDevice

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: device.symbolName)
            Text(device.label)
                .fontWeight(.semibold)
            if device.browser != "other" {
                Text(device.browser.capitalized)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 4) {
                Circle()
                    .fill(device.isActive ? Color.green : Color.secondary.opacity(0.5))
                    .frame(width: 6, height: 6)
                Text(device.freshnessText)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Text("\(device.tabCount) tab\(device.tabCount == 1 ? "" : "s")")
                .foregroundStyle(.secondary)
                .font(.caption)
        }
        .font(.callout)
    }
}

/// One window as a card: clickable header (name, tab count, chevron), then —
/// depending on state — nothing, a 3-tab preview + "Show all", or every tab.
private struct LiveWindowCard: View {
    let device: LiveDevice
    let window: LiveWindow
    let title: String
    /// >0 = this window previews that many tabs while collapsed.
    let previewCount: Int
    let model: LiveModel

    @State private var isHoveringCard = false
    @State private var isHoveringHeader = false

    private var key: String { "\(device.deviceId):\(window.windowId)" }
    private var isExpanded: Bool { model.expandedWindows.contains(key) }

    /// Search bypasses the collapse state entirely.
    private var visibleTabs: [LiveTab] {
        if model.isSearching { return window.tabs.filter(model.matches) }
        if isExpanded { return window.tabs }
        return Array(window.tabs.prefix(previewCount))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header

            let tabs = visibleTabs
            if !tabs.isEmpty {
                Divider().padding(.horizontal, 12)
                VStack(spacing: 1) {
                    ForEach(Array(tabs.enumerated()), id: \.offset) { offset, tab in
                        LiveTabRow(tab: tab, dimmed: !device.isActive)
                            .id("\(key):\(offset)")
                    }

                    if !model.isSearching, !isExpanded, window.tabs.count > tabs.count {
                        Button {
                            withAnimation(.easeOut(duration: 0.16)) {
                                _ = model.expandedWindows.insert(key)
                            }
                        } label: {
                            HStack(spacing: 5) {
                                Image(systemName: "ellipsis")
                                    .font(.system(size: 9, weight: .semibold))
                                Text("Show all \(window.tabs.count) tabs")
                                Spacer(minLength: 0)
                            }
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 5)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .hoverHighlight()
                        .pointingHandCursor()
                    }
                }
                .padding(.horizontal, 8)
                .padding(.vertical, 6)
            }
        }
        .surfaceCard(radius: 11, hovering: isHoveringCard)
        .onHover { isHoveringCard = $0 }
    }

    private var header: some View {
        let showingTabs = !visibleTabs.isEmpty

        return Button {
            guard !model.isSearching else { return }
            withAnimation(.easeOut(duration: 0.16)) {
                if isExpanded {
                    _ = model.expandedWindows.remove(key)
                } else {
                    _ = model.expandedWindows.insert(key)
                }
            }
        } label: {
            HStack(spacing: 8) {
                Image(systemName: "macwindow")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                Text(title)
                    .font(.callout)
                    .fontWeight(.medium)
                if window.focused == true {
                    Text("focused")
                        .font(.caption2)
                        .foregroundStyle(.tint)
                }
                Spacer(minLength: 8)
                Text("\(window.tabs.count) tab\(window.tabs.count == 1 ? "" : "s")")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.tertiary)
                    .rotationEffect(.degrees(isExpanded || model.isSearching ? 90 : 0))
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // Flush with the card outline — no inset gap (see SessionsView).
        .background(
            UnevenRoundedRectangle(
                topLeadingRadius: 11,
                bottomLeadingRadius: showingTabs ? 0 : 11,
                bottomTrailingRadius: showingTabs ? 0 : 11,
                topTrailingRadius: 11,
                style: .continuous
            )
            .fill(isHoveringHeader ? AnyShapeStyle(.quaternary.opacity(0.6)) : AnyShapeStyle(.clear))
        )
        .onHover { isHoveringHeader = $0 }
        .pointingHandCursor()
        .help(isExpanded ? "Collapse this window" : "Show every tab in this window")
    }
}

/// One live tab. `dimmed` mirrors a stale device — data is kept (still useful)
/// but visually de-emphasized. Redacted URLs carry a lock badge.
private struct LiveTabRow: View {
    @Environment(\.openURL) private var openURL

    let tab: LiveTab
    let dimmed: Bool

    var body: some View {
        HStack(spacing: 9) {
            RemoteImage(url: tab.faviconURL) {
                Image(systemName: "globe")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
            }
            .frame(width: 16, height: 16)
            .clipShape(RoundedRectangle(cornerRadius: 3, style: .continuous))

            Text(tab.displayTitle)
                .font(.callout)
                .fontWeight(tab.active == true ? .medium : .regular)
                .lineLimit(1)

            if tab.redacted == true {
                Image(systemName: "lock.fill")
                    .font(.system(size: 9))
                    .foregroundStyle(.tertiary)
                    .help("URL reduced to its origin because it looked sensitive")
            }

            if let host = tab.openableURL?.host() {
                Text(host)
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            if tab.active == true {
                Text("active")
                    .font(.caption2)
                    .foregroundStyle(.tint)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 5)
        .opacity(dimmed ? 0.55 : 1)
        .contentShape(Rectangle())
        .hoverHighlight()
        .pointingHandCursor()
        .onTapGesture {
            if let url = tab.openableURL { openURL(url) }
        }
        .contextMenu {
            if let url = tab.openableURL {
                Button("Open in Browser") { openURL(url) }
                Button("Copy Link") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(tab.url, forType: .string)
                }
            }
        }
        .help(tab.url)
    }
}
