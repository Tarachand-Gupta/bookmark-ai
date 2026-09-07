import Foundation

/// One line on the plan card — mirror of `PLAN_FEATURES.free.features` in
/// `packages/types/src/plan.ts`. The web renders straight from that constant;
/// this app can't import TypeScript, so the copy is duplicated here VERBATIM.
/// If the list changes there, change it here in the same commit.
struct PlanFeature: Hashable, Identifiable, Sendable {
    let key: String
    let label: String
    var id: String { key }
}

/// `GET /api/account` → `{plan}` (`accountResponseSchema`). Every field optional
/// so the route can grow — and an older server's empty object still decodes.
struct AccountResponse: Codable, Sendable, Equatable {
    var plan: String?
}

/// Everyone is on Free today. `resolve` maps whatever `GET /api/account`
/// reports (or fails to report) onto the one plan this app knows how to draw.
struct PlanInfo: Hashable, Sendable {
    let id: String
    let name: String
    /// USD per month. Free is 0; formatted by the UI.
    let price: Int
    let features: [PlanFeature]

    static let free = PlanInfo(
        id: "free",
        name: "Free",
        price: 0,
        features: [
            PlanFeature(key: "bookmarks", label: "Unlimited bookmarks"),
            PlanFeature(key: "live-sessions", label: "Unlimited live sessions"),
            PlanFeature(key: "ai-credits", label: "2,000 AI chat credits every week"),
            PlanFeature(key: "byok", label: "Bring your own key — unmetered AI on your provider"),
        ]
    )

    /// Unknown/absent plan ids fall back to Free — the only plan that exists,
    /// and what the server reports in single-tenant/open mode.
    static func resolve(_ planId: String?) -> PlanInfo {
        switch planId {
        case "free", nil: return .free
        default: return .free
        }
    }

    /// "Free plan" — the badge text.
    var badgeTitle: String { "\(name) plan" }
}
