import Foundation

/// Which backend the app talks to. Switchable at runtime from Settings (⌘,).
///
/// Parity note with `apps/mobile/src/api.ts`: the cloud base MUST be the `www`
/// host. The apex 308-redirects every path (including `/api/*`) to `www`, and
/// URLSession — like every other HTTP stack — STRIPS the `Authorization` header
/// when following a redirect to a different origin. The retried request arrives
/// bare and the server correctly answers 401 while the app looks signed in.
enum ServerTarget: String, CaseIterable, Identifiable, Codable, Sendable {
    /// The Next dev server on :3000. Serves the same route handlers as prod.
    case local
    /// The deployed API at bookmark-ai.cloud.
    case cloud

    var id: String { rawValue }

    var baseURL: URL {
        switch self {
        case .local: URL(string: "http://localhost:3000")!
        case .cloud: URL(string: "https://www.bookmark-ai.cloud")!
        }
    }

    /// The dedicated Live Sessions server (a DIFFERENT origin — no `/api`
    /// prefix). Default only: a user-pinned `settings.liveServerUrl` overrides
    /// it (see `LiveModel.resolveBase`). Parity with `apps/mobile/src/api.ts`.
    var liveBaseURL: URL {
        switch self {
        case .local: URL(string: "http://localhost:8091")!
        case .cloud: URL(string: "https://live.bookmark-ai.cloud")!
        }
    }

    /// Cloud requires a Clerk session JWT as `Authorization: Bearer`.
    ///
    /// Local deliberately sends NO auth header: the dev server is expected to run
    /// with `DEV_OPEN_API=1`, which short-circuits before Clerk entirely. Sending
    /// a PROD-instance token to a DEV-instance server would be meaningless anyway
    /// — the two Clerk instances don't share signing keys. The one exception is
    /// `localSignIn`: a dev server WITHOUT the bypass, signed into through its
    /// own (dev-instance) Clerk — the sign-in sheet then renders
    /// `localhost:3000/sign-in` and the token it mints is sent to :3000.
    var requiresAuth: Bool {
        switch self {
        case .cloud: true
        case .local: Self.localSignIn
        }
    }

    /// `BOOKMARKAI_LOCAL_AUTH=1` in the app's environment (Xcode scheme or
    /// `env … open`): the Local target signs in like Cloud, against the dev
    /// server's own Clerk. For exercising per-user features — the tenant DB, the
    /// chat's live-tabs tool — that the open-mode bypass can't reach. Off by
    /// default, so a normal Local run is unchanged.
    static var localSignIn: Bool {
        ProcessInfo.processInfo.environment["BOOKMARKAI_LOCAL_AUTH"] == "1"
    }

    /// The origin whose `/sign-in` page the auth sheet renders and whose
    /// `window.Clerk` mints tokens: Cloud, unless this is a signed-in Local run.
    var authOrigin: URL {
        requiresAuth ? baseURL : ServerTarget.cloud.baseURL
    }

    var displayName: String {
        switch self {
        case .local: "Local"
        case .cloud: "Cloud"
        }
    }

    var subtitle: String {
        switch self {
        case .local: "localhost:3000 · dev server (DEV_OPEN_API)"
        case .cloud: "www.bookmark-ai.cloud · sign-in required"
        }
    }

    /// The host, as a short caption (sidebar footer, sign-in screen footer).
    var hostLabel: String {
        switch self {
        case .local: "localhost:3000"
        case .cloud: "bookmark-ai.cloud"
        }
    }

    var symbolName: String {
        switch self {
        case .local: "laptopcomputer"
        case .cloud: "cloud"
        }
    }
}
