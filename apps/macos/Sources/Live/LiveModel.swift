import Foundation
import Observation

/// How the device list is ordered. Client-side, most-recent-activity default.
enum LiveSort: String, CaseIterable, Identifiable, Sendable {
    case recentActivity
    case nameAZ
    case mostTabs

    var id: String { rawValue }

    var title: String {
        switch self {
        case .recentActivity: "Recent Activity"
        case .nameAZ: "Name (A–Z)"
        case .mostTabs: "Most Tabs"
        }
    }
}

/// The Live Tabs view's data story, mirroring mobile's `useLiveDevices`:
/// one `GET /live` for an instant first paint, then a long-lived SSE
/// connection to `GET /live/stream` whose `state` frames each carry a full
/// `ListLiveResponse` snapshot. The connection is held only while the Live view
/// is on screen (`start()`/`stop()` from the view's appear/disappear), and
/// reconnects with a fixed backoff for as long as it is supposed to be up.
///
/// Failure policy, same as mobile: keep the last-known devices on ANY failure —
/// a stale tab list is still useful — and surface one human line, never a raw
/// transport error.
@MainActor
@Observable
final class LiveModel {

    private(set) var devices: [LiveDevice] = []
    /// Never assumed: false until the server says otherwise.
    private(set) var enabled = false
    private(set) var ttlHours = 0
    private(set) var isLoading = false
    /// One human sentence when the live server can't be reached; nil while fine.
    private(set) var errorMessage: String?
    /// At least one successful snapshot — distinguishes "off/none" from "not asked yet".
    private(set) var loaded = false

    // ── View state (search / sort / folding) ────────────────────────────────

    /// Bound by the view's `.searchable`; on-device term filter over tab
    /// title + URL (see `TermFilter`).
    var query = ""
    var sort: LiveSort = .recentActivity
    /// The "Inactive devices (N)" disclosure — collapsed by default.
    var showInactive = false
    /// Windows the user expanded to their full tab list, keyed
    /// `deviceId:windowId`. A device's FIRST window previews 3 tabs when not
    /// in here; every other window starts fully collapsed.
    var expandedWindows: Set<String> = []

    /// Devices in sort order, split into the always-visible fresh set and the
    /// folded inactive set. While a query is active the fold is ignored — a
    /// match on a sleeping laptop must still surface.
    var activeDevices: [LiveDevice] { sortDevices(devices.filter { !$0.isInactive }) }
    var inactiveDevices: [LiveDevice] { sortDevices(devices.filter(\.isInactive)) }

    private func sortDevices(_ list: [LiveDevice]) -> [LiveDevice] {
        switch sort {
        case .recentActivity: list.sorted { $0.lastSeenAgeSeconds < $1.lastSeenAgeSeconds }
        case .nameAZ: list.sorted { $0.label.localizedCaseInsensitiveCompare($1.label) == .orderedAscending }
        case .mostTabs: list.sorted { $0.tabCount > $1.tabCount }
        }
    }

    var isSearching: Bool { !query.trimmingCharacters(in: .whitespaces).isEmpty }

    func matches(_ tab: LiveTab) -> Bool {
        TermFilter.matches("\(tab.title ?? "") \(tab.url)", query: query)
    }

    // ────────────────────────────────────────────────────────────────────────

    private let api: ApiClient
    private var streamTask: Task<Void, Never>?
    /// Resolved live base, cached ~5 min (a settings change is picked up on the
    /// next connect after the TTL, matching mobile's cache).
    private var baseCache: (url: URL, expires: Date)?

    init(api: ApiClient) {
        self.api = api
    }

    /// The Live view appeared (or asked for a manual refresh): (re)connect.
    func start() {
        stop()
        streamTask = Task { await run() }
    }

    /// The Live view left the screen: drop the connection immediately.
    func stop() {
        streamTask?.cancel()
        streamTask = nil
    }

    func reset() {
        stop()
        devices = []
        enabled = false
        ttlHours = 0
        loaded = false
        errorMessage = nil
        baseCache = nil
        query = ""
        sort = .recentActivity
        showInactive = false
        expandedWindows = []
    }

    // MARK: - Connection loop

    private func run() async {
        isLoading = !loaded
        defer { isLoading = false }

        while !Task.isCancelled {
            let base = await resolveBase()

            // Instant first paint (and the reconnect fallback): one plain GET.
            do {
                let snapshot = try await fetchSnapshot(base: base)
                guard !Task.isCancelled else { return }
                apply(snapshot)
            } catch {
                guard !Task.isCancelled else { return }
                errorMessage = "Couldn't reach the live sessions server."
            }
            isLoading = false

            // Then hold the stream until it drops; every `state` frame is a full
            // snapshot, so there is no delta bookkeeping to get wrong.
            do {
                try await consumeStream(base: base)
            } catch {
                guard !Task.isCancelled else { return }
                errorMessage = "Couldn't reach the live sessions server."
            }

            guard !Task.isCancelled else { return }
            try? await Task.sleep(for: .seconds(4))
        }
    }

    private func apply(_ snapshot: ListLiveResponse) {
        devices = snapshot.devices
        enabled = snapshot.enabled
        ttlHours = snapshot.ttlHours
        errorMessage = nil
        loaded = true
    }

    /// User-pinned `settings.liveServerUrl` wins; else the target's default.
    /// A settings failure silently uses the default — live must not break on a
    /// settings hiccup.
    private func resolveBase() async -> URL {
        if let baseCache, baseCache.expires > Date() { return baseCache.url }
        let fallback = api.target.liveBaseURL
        do {
            let response = try await api.settings()
            let url = response.settings.liveServerUrl.flatMap(URL.init(string:)) ?? fallback
            baseCache = (url, Date().addingTimeInterval(5 * 60))
            return url
        } catch {
            return fallback
        }
    }

    private func authorizedRequest(url: URL) async -> URLRequest {
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if api.target.requiresAuth, let tokenProvider = api.tokenProvider,
           let token = await tokenProvider(false) {
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        return request
    }

    private func fetchSnapshot(base: URL) async throws -> ListLiveResponse {
        let request = await authorizedRequest(url: base.appendingPathComponent("live"))
        let (data, response) = try await api.session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ApiError.network("live server unreachable")
        }
        return try ApiClient.decoder.decode(ListLiveResponse.self, from: data)
    }

    // MARK: - Admin (Settings ▸ Live — mirrors the web's Devices section)

    /// True while a settings mutation is in flight; the toggles disable on it.
    private(set) var settingsBusy = false
    private(set) var settingsError: String?

    /// One-shot snapshot for the Settings window (which must not hold the SSE
    /// stream open the way the Live view does).
    func loadForSettings() async {
        let base = await resolveBase()
        if let snapshot = try? await fetchSnapshot(base: base) {
            apply(snapshot)
        }
    }

    /// Account-wide sharing flag. Turning it OFF purges every device server-side
    /// — the confirmation lives in the UI, not here.
    func setSharing(enabled newValue: Bool) async {
        struct Body: Encodable { let enabled: Bool }
        await admin(path: "live/settings", method: "POST", body: Body(enabled: newValue))
    }

    /// Per-device "new windows join live sessions by default" policy.
    func setNewWindowsShared(deviceId: String, shared: Bool) async {
        struct Body: Encodable { let newWindowsShared: Bool }
        await admin(
            path: "live/\(deviceId)/settings", method: "PATCH",
            body: Body(newWindowsShared: shared)
        )
    }

    /// Delete one device's mirrored tabs (it re-registers on its next push).
    // MARK: - Save live tabs as a session

    /// Transient toast state after a save attempt; auto-clears.
    private(set) var saveNotice: SaveNotice?
    struct SaveNotice: Equatable {
        var text: String
        var isError: Bool
    }
    private var saveNoticeTask: Task<Void, Never>?

    /// Persist one window (or, with `window` nil, the whole device) as a saved
    /// session via `POST /api/sessions` — live tabs are ephemeral, this is the
    /// "keep these" action.
    func saveAsSession(device: LiveDevice, window: LiveWindow? = nil) async {
        let windows = window.map { [$0] } ?? device.windows
        let tabs = windows.flatMap { w in
            w.tabs.map {
                SessionTab(url: $0.url, title: $0.title, favIconUrl: $0.favIconUrl, windowId: w.windowId)
            }
        }
        guard !tabs.isEmpty else { return }

        let name: String
        if let window {
            let index = device.windows.firstIndex { $0.windowId == window.windowId } ?? 0
            name = "\(device.label) — \(window.displayName(at: index))"
        } else {
            name = "\(device.label) — all tabs"
        }

        do {
            let session = try await api.createSession(
                name: name, tabs: tabs, browser: device.browser, device: device.device
            )
            showSaveNotice("Saved “\(session.name)” to Sessions", isError: false)
        } catch {
            let message = (error as? ApiError)?.errorDescription ?? error.localizedDescription
            showSaveNotice("Couldn't save session — \(message)", isError: true)
        }
    }

    private func showSaveNotice(_ text: String, isError: Bool) {
        saveNoticeTask?.cancel()
        saveNotice = SaveNotice(text: text, isError: isError)
        saveNoticeTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(isError ? 5 : 2.5))
            guard !Task.isCancelled else { return }
            self.saveNotice = nil
        }
    }

    func forgetDevice(deviceId: String) async {
        await admin(path: "live/\(deviceId)", method: "DELETE", body: Optional<Int>.none)
    }

    /// Delete every device's mirrored tabs.
    func forgetAllDevices() async {
        await admin(path: "live", method: "DELETE", body: Optional<Int>.none)
    }

    /// Shared mutation plumbing: authorized request against the live base, then
    /// a fresh snapshot so the UI reflects what the server now holds.
    private func admin(path: String, method: String, body: (some Encodable)?) async {
        settingsBusy = true
        defer { settingsBusy = false }
        settingsError = nil

        let base = await resolveBase()
        var request = await authorizedRequest(url: base.appendingPathComponent(path))
        request.httpMethod = method
        if let body {
            request.httpBody = try? JSONEncoder().encode(body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        do {
            let (_, response) = try await api.session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                settingsError = "The live server rejected the change."
                return
            }
            await loadForSettings()
        } catch {
            settingsError = "Couldn't reach the live sessions server."
        }
    }

    /// Minimal SSE reader for the live stream: `event:`/`data:` lines, dispatch
    /// on the blank line, comments (keepalives) ignored. Only `state` events
    /// carry snapshots. Returns when the server closes the connection.
    private func consumeStream(base: URL) async throws {
        var request = await authorizedRequest(url: base.appendingPathComponent("live/stream"))
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        // Idle timeout: the server keepalives well inside this.
        request.timeoutInterval = 120

        let (bytes, response) = try await api.session.bytes(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw ApiError.network("live stream unreachable")
        }

        // The server writes exactly `event: state\ndata: {json}\n\n` per frame
        // (see apps/live-server/src/sse.ts), so each data line is a complete
        // snapshot and can be dispatched immediately. Deliberately NOT keyed to
        // blank-line boundaries: `AsyncLineSequence` drops empty lines, so an
        // SSE parser that waits for them here would never fire.
        var eventName = ""
        for try await line in bytes.lines {
            if Task.isCancelled { return }
            if line.hasPrefix(":") {
                continue // keepalive comment
            } else if line.hasPrefix("event:") {
                eventName = line.dropFirst("event:".count).trimmingCharacters(in: .whitespaces)
            } else if line.hasPrefix("data:") {
                guard eventName == "state" else { continue }
                let payload = line.dropFirst("data:".count).trimmingCharacters(in: .whitespaces)
                if let data = payload.data(using: .utf8),
                   let snapshot = try? ApiClient.decoder.decode(ListLiveResponse.self, from: data) {
                    apply(snapshot)
                }
            }
        }
    }
}
