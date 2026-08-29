import Foundation

/// Live Sessions — the ephemeral "what's open right now" mirror served by the
/// dedicated live server (a different origin from the API; see
/// `packages/types/src/live.ts` for the canonical schemas).

/// One open tab within a live window.
struct LiveTab: Codable, Hashable, Sendable {
    var url: String
    var title: String?
    var favIconUrl: String?
    var active: Bool?
    /// URL reduced to its origin because the path looked credential-bearing.
    var redacted: Bool?
}

/// One open browser window. `windowId` is display grouping only — never a key.
struct LiveWindow: Codable, Hashable, Sendable {
    var windowId: Int
    var focused: Bool?
    var tabs: [LiveTab]
    /// User-set display name; absent/null = the default "Window N" label.
    var name: String?
}

/// One device currently mirroring tabs. `lastSeenAgeSeconds` is server-computed
/// — never derive freshness from client clocks.
struct LiveDevice: Codable, Hashable, Sendable, Identifiable {
    var deviceId: String
    var label: String
    var browser: String
    var device: String
    var os: String?
    var windows: [LiveWindow]
    var tabCount: Int
    var hiddenTabCount: Int
    var lastSeenAt: String
    var lastSeenAgeSeconds: Int
    /// This device's "new windows join live sessions by default" policy.
    /// ABSENT = true (the fail-safe default); only present-and-false means the
    /// user opted the device out.
    var newWindowsShared: Bool?

    var id: String { deviceId }
}

/// `GET {liveBase}/live` — also the payload of every SSE `state` frame.
/// `enabled` distinguishes "sharing is off" from "on, but no devices".
struct ListLiveResponse: Codable, Sendable {
    var devices: [LiveDevice]
    var enabled: Bool
    var ttlHours: Int
}

extension LiveTab {
    var openableURL: URL? {
        guard let url = URL(string: url), let scheme = url.scheme?.lowercased(),
              scheme == "http" || scheme == "https"
        else { return nil }
        return url
    }

    var displayTitle: String {
        if let title, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return title }
        return url
    }

    var faviconURL: URL? {
        if let favIconUrl, let url = URL(string: favIconUrl), url.scheme != nil { return url }
        guard let host = openableURL?.host() else { return nil }
        return URL(string: "https://\(host)/favicon.ico")
    }
}

extension LiveDevice {
    /// "Active" = pushed within the last ~75s (the extension checkpoints well
    /// inside that); anything older renders as stale-but-still-useful.
    var isActive: Bool { lastSeenAgeSeconds < 75 }

    /// Folded behind the "Inactive devices" disclosure (like web/mobile):
    /// nothing pushed for 15 minutes — the browser is probably closed.
    var isInactive: Bool { lastSeenAgeSeconds >= 900 }

    var freshnessText: String {
        if isActive { return "active now" }
        let seconds = lastSeenAgeSeconds
        if seconds < 3600 { return "\(seconds / 60)m ago" }
        if seconds < 86_400 { return "\(seconds / 3600)h ago" }
        return "\(seconds / 86_400)d ago"
    }

    var symbolName: String {
        switch device {
        case "laptop": "laptopcomputer"
        case "desktop": "desktopcomputer"
        case "mobile": "iphone"
        case "tablet": "ipad"
        default: "display"
        }
    }
}

extension LiveWindow {
    /// The user-set name, else the conventional positional label.
    func displayName(at index: Int) -> String {
        if let name, !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return name }
        return "Window \(index + 1)"
    }
}
