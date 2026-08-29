import Foundation

/// Open Graph metadata the server scraped from the page.
/// Every field is optional — a scrape can fail or a page can carry no OG tags.
struct OpenGraph: Codable, Hashable, Sendable {
    var title: String?
    var description: String?
    var image: String?
    var siteName: String?
    var type: String?
    var url: String?
    var favicon: String?
}

/// Where/when the bookmark was captured.
///
/// `browser` and `device` are server-side Zod enums, but they decode as plain
/// `String` here ON PURPOSE: a new enum member shipped by the API must never
/// make an entire bookmark list fail to decode in an already-shipped Mac build.
/// `symbolName` degrades to a generic glyph for anything unrecognized.
struct BookmarkSource: Codable, Hashable, Sendable {
    var browser: String
    var device: String
    var deviceName: String?
    var os: String?
    /// ISO 8601 — when the user saved it (client clock).
    var savedAt: String
}

/// A fully persisted bookmark, mirroring `bookmarkSchema` in `packages/types`.
struct Bookmark: Codable, Hashable, Sendable, Identifiable {
    var id: String
    var url: String
    var domain: String
    var title: String
    var description: String?
    var og: OpenGraph
    var source: BookmarkSource
    var category: String
    var tags: [String]
    /// ISO 8601 — server-side persistence time.
    var createdAt: String
    /// True once an embedding vector has been stored for this bookmark.
    var embedded: Bool
}

extension Bookmark {
    /// The page URL as a real `URL`, or nil when the string is unusable.
    var pageURL: URL? { URL(string: url) }

    /// Best available favicon: the scraped one, else the domain's conventional
    /// `/favicon.ico`. Never a third-party favicon proxy — this app talks only
    /// to the API and the sites it already knows about.
    var faviconURL: URL? {
        if let favicon = og.favicon, let url = URL(string: favicon), url.scheme != nil {
            return url
        }
        return URL(string: "https://\(domain)/favicon.ico")
    }

    /// The OG preview image, when the scrape found one.
    var thumbnailURL: URL? {
        guard let image = og.image, let url = URL(string: image), url.scheme != nil else { return nil }
        return url
    }

    /// Prefer the user-visible title; fall back to the OG title, then the domain,
    /// so a row is never blank.
    var displayTitle: String {
        if !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return title }
        if let ogTitle = og.title, !ogTitle.isEmpty { return ogTitle }
        return domain
    }

    /// One-line summary under the title: the bookmark's own description, else OG's.
    var displayDescription: String? {
        let candidate = description ?? og.description
        guard let candidate, !candidate.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return candidate
    }

    var savedAtDate: Date? { ISO8601.date(from: source.savedAt) }
    var createdAtDate: Date? { ISO8601.date(from: createdAt) }
}

/// The API emits ISO 8601 both with and without fractional seconds (SQLite
/// timestamps vs. client clocks), so a single `ISO8601DateFormatter` is not
/// enough. Dates are decoded as `String` and parsed here for DISPLAY only —
/// a parse failure degrades to "no date shown" instead of failing the decode.
enum ISO8601 {
    private static let withFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static let plain: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static func date(from string: String) -> Date? {
        withFractional.date(from: string) ?? plain.date(from: string)
    }
}
