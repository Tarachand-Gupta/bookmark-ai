import Foundation

struct OrganizationLabel: Codable, Identifiable, Hashable, Sendable {
    var id: String; var name: String; var count: Int
}
struct OrganizationCapabilities: Codable, Sendable {
    var organization: Int; var undoDays: Int; var context: Int
    var maxOperationItems: Int; var maxSelectionItems: Int
}
struct OrganizationResponse: Codable, Sendable {
    var capabilities: OrganizationCapabilities
    var categories: [OrganizationLabel]; var tags: [OrganizationLabel]
}
struct OrganizationItemError: Codable, Sendable {
    var code: String; var message: String; var fields: [String]?
}
struct OrganizationItemResult: Codable, Identifiable, Sendable {
    var id: String; var status: String; var changedFields: [String]?
    var error: OrganizationItemError?; var entityType: String?; var label: String?
    var displayLabel: String { label ?? (entityType == "bookmark" ? "Saved bookmark" : "Organization item") }
    var detail: String {
        let fields = (changedFields ?? []).map(OrganizationOperation.fieldTitle).joined(separator: ", ")
        if let error { return fields.isEmpty ? error.message : "Updated \(fields). \(error.message)" }
        return status == "unchanged" ? "Already up to date" : fields.isEmpty ? "Completed" : "Updated \(fields)"
    }
}
struct OrganizationOperation: Codable, Identifiable, Sendable {
    var id: String; var action: String; var description: String; var createdAt: String
    var undoExpiresAt: String; var status: String; var requestedCount: Int
    var succeededCount: Int; var failedCount: Int; var results: [OrganizationItemResult]
    var undoStatus: String?; var entityId: String?; var undoOf: String?
    var succeededFieldCount: Int?; var failedFieldCount: Int?
    var canUndo: Bool { undoOf == nil && undoStatus != "undone" && (ISO8601.date(from: undoExpiresAt) ?? .distantPast) > Date() && succeededCount > 0 }
    var summary: String {
        if let fields = succeededFieldCount { return "\(fields) fields restored · \(failedFieldCount ?? 0) fields need review" }
        return "\(succeededCount) completed · \(failedCount) need review"
    }
    static func fieldTitle(_ value: String) -> String {
        switch value { case "categoryId": "category"; default: value }
    }
}
struct OrganizationSelection: Codable, Sendable {
    var id: String; var bookmarkIds: [String]; var fieldVersions: [String: [String: String]]
    var count: Int; var createdAt: String; var expiresAt: String; var scope: String
    var limited: Bool; var limit: Int?
}

/// One explicit source scope. The encoded union exactly matches the shared API.
struct ChatContext: Codable, Hashable, Sendable {
    var type: String
    var bookmarkIds: [String]?
    var selectionId: String?
    static let library = ChatContext(type: "library")
    static func bookmarks(_ ids: [String]) -> ChatContext { ChatContext(type: "bookmarks", bookmarkIds: ids) }
    var displayTitle: String {
        switch type {
        case "bookmarks": "\(bookmarkIds?.count ?? 0) selected bookmarks"
        case "selection": "Selected bookmarks"
        case "library": "Your library"
        default: "Choose bookmark context"
        }
    }
    var isSupported: Bool { ["library", "bookmarks", "selection"].contains(type) }
    func encode(to encoder: Encoder) throws {
        var box = encoder.container(keyedBy: CodingKeys.self)
        try box.encode(type, forKey: .type)
        try box.encodeIfPresent(bookmarkIds, forKey: .bookmarkIds)
        try box.encodeIfPresent(selectionId, forKey: .selectionId)
    }

}

struct OrganizationScope: Codable, Equatable, Sendable {
    var origin: String; var accountId: String
    var storageKey: String { Data("\(origin)|\(accountId)".utf8).base64EncodedString() }
}
struct OrganizationRequest: Codable, Identifiable, Sendable {
    var id: String; var path: String; var method: String; var body: [String: JSONValue]
    var title: String
    var isSupported: Bool {
        if let raw = body["changes"], case .object(let changes) = raw {
            let fields: Set<String> = ["title", "category", "categoryId", "tags", "tagIds", "addTags", "removeTags", "addTagIds", "removeTagIds"]
            guard Set(changes.keys).isSubset(of: fields) else { return false }
        }
        if path == "/api/organization/operations" {
            return ["bookmarks.update", "bookmarks.delete", "category.create", "category.rename", "category.remove", "tag.create", "tag.rename", "tag.remove", "tag.merge"].contains(body["action"]?.stringValue ?? "")
        }
        return path == "/api/bookmarks" || path.hasPrefix("/api/bookmarks/") || (path.hasPrefix("/api/organization/operations/") && (path.hasSuffix("/undo") || path.hasSuffix("/retry")))
    }
}
struct OrganizationEnvelope: Decodable { var operation: OrganizationOperation; var bookmark: Bookmark? }
struct SavedBookmarkEnvelope: Decodable { var bookmark: Bookmark; var existing: Bool?; var operation: OrganizationOperation? }
struct ContextEnvelope: Decodable {
    struct Unavailable: Decodable { var id: String; var reason: String }
    struct Resolved: Decodable { var context: ChatContext; var bookmarkIds: [String]?; var unavailable: [Unavailable]? }
    var resolved: Resolved
}
