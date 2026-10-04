import Foundation

/// Public build configuration only. QA never falls back to production origins.
struct SupabaseConfiguration: Equatable, Sendable {
    let url: URL
    let publishableKey: String
    let apiURL: URL
    let liveURL: URL
    let namespace: String
    let callbackURL: URL

    static var isQA: Bool { Bundle.main.object(forInfoDictionaryKey: "BOOKMARK_BUILD_VARIANT") as? String == "supabase-qa" }
    static var current: Self? { parse(Bundle.main.infoDictionary ?? [:]) }
    static let unavailableURL = URL(string: "http://127.0.0.1:1")!

    static func parse(_ info: [String: Any]) -> Self? {
        let marker = info["BOOKMARK_HOSTED_TARGET"] as? String ?? ""
        guard marker.isEmpty || marker == "production" else { return nil }
        let hosted = marker == "production"
        guard info["BOOKMARK_BUILD_VARIANT"] as? String == "supabase-qa",
              let project = info["SUPABASE_URL"] as? String,
              let url = URL(string: project), url.scheme == "https",
              url.host == "xogqaqtyacmecdbmgqqd.supabase.co", url.user == nil, url.password == nil,
              url.port == nil, url.query == nil, url.fragment == nil, ["", "/"].contains(url.path),
              let key = info["SUPABASE_PUBLISHABLE_KEY"] as? String, key.hasPrefix("sb_publishable_"),
              let api = info["BOOKMARK_API_URL"] as? String, let apiURL = safeEndpoint(api, hosted: hosted),
              let live = info["BOOKMARK_LIVE_URL"] as? String, let liveURL = safeEndpoint(live, hosted: hosted, live: true),
              let namespace = info["BOOKMARK_AUTH_STORAGE_NAMESPACE"] as? String, namespace == "bookmark-ai:supabase-qa",
              let scheme = info["BOOKMARK_AUTH_CALLBACK_SCHEME"] as? String, scheme == "bookmarkai-macos-supabase-qa",
              let callback = URL(string: "\(scheme)://auth/callback") else { return nil }
        return Self(url: url, publishableKey: key, apiURL: apiURL, liveURL: liveURL, namespace: namespace, callbackURL: callback)
    }

    static func safeEndpoint(_ value: String, hosted: Bool = false, live: Bool = false) -> URL? {
        if hosted {
            let expected = live ? "https://live.bookmark-ai.cloud" : "https://www.bookmark-ai.cloud"
            return value == expected ? URL(string: expected) : nil
        }
        guard let url = URL(string: value), let host = url.host,
              url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
              !host.hasSuffix("bookmark-ai.cloud"),
              url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1", "::1"].contains(host)) else { return nil }
        return url
    }

    func acceptsCallback(_ url: URL) -> Bool {
        url.scheme == callbackURL.scheme && url.host == "auth" && url.path == "/callback" && url.user == nil && url.password == nil
    }
}
