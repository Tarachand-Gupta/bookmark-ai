import Foundation

/// The one on-device text matcher, shared by the Sessions and Live Tabs search
/// fields (and mirrored verbatim in the web + mobile live search): lowercase
/// the query, split on whitespace, and require EVERY term to be a substring of
/// the haystack. No indexing, no server round-trip — it runs on what's already
/// on screen.
enum TermFilter {
    static func matches(_ haystack: String, query: String) -> Bool {
        let terms = query.lowercased().split(whereSeparator: \.isWhitespace)
        guard !terms.isEmpty else { return true }
        let hay = haystack.lowercased()
        return terms.allSatisfy { hay.contains($0) }
    }
}
