import Foundation
import Observation

@MainActor @Observable
final class OrganizationModel {
    private(set) var data: OrganizationResponse?
    private(set) var scope: OrganizationScope?
    private(set) var history: [OrganizationOperation] = []
    private(set) var pending: [OrganizationRequest] = []
    private(set) var isBusy = false
    var error: String?
    var notice: String?
    var pauseRequested = false
    var showHistory = false
    var showManager = false
    var showAdd = false
    var showImport = false
    var showBulk = false
    private var editorBookmark: Bookmark?
    var editorDirty = false
    var showDiscardEditor = false
    private var nextEditorBookmark: Bookmark?
    var editing: Bookmark? {
        get { editorBookmark }
        set {
            if editorDirty && newValue?.id != editorBookmark?.id {
                nextEditorBookmark = newValue; showDiscardEditor = true
            } else { editorBookmark = newValue }
        }
    }
    func discardEditor() { editorDirty = false; editorBookmark = nextEditorBookmark; nextEditorBookmark = nil; showDiscardEditor = false }
    func keepEditor() { nextEditorBookmark = nil; showDiscardEditor = false }
    func closeEditor() { editorDirty = false; editorBookmark = nil; nextEditorBookmark = nil; showDiscardEditor = false }
    var frozenSelection: OrganizationSelection?
    var onChange: (() async -> Void)?
    var available: Bool { data?.capabilities.organization == 1 && scope != nil }
    var latestUndo: OrganizationOperation? { history.first(where: \.canUndo) }
    private let api: ApiClient
    private let directory: URL
    private var generation = UUID()

    init(api: ApiClient, directory: URL? = nil) {
        self.api = api
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(Bundle.main.bundleIdentifier ?? "ai.bookmarkai.macos").appendingPathComponent("Organization")
    }

    func restoreMetadata(_ value: OrganizationResponse?) { data = value }
    func clearPrivateRecovery(scope cachedScope: OrganizationScope? = nil) {
        let url = (cachedScope ?? scope).map { directory.appendingPathComponent($0.storageKey.replacingOccurrences(of: "/", with: "_") + ".json") }
        if let url { try? FileManager.default.removeItem(at: url) }; pending = []; scope = nil
    }
    func bind(accountId: String?) {
        let next = accountId.map { OrganizationScope(origin: api.target.baseURL.absoluteString, accountId: $0) }
        guard next != scope else { return }
        reset()
        scope = next
        if let url = ledgerURL, let bytes = try? Data(contentsOf: url) {
            pending = (try? JSONDecoder().decode([OrganizationRequest].self, from: bytes)) ?? []
        }
    }
    private var ledgerURL: URL? { scope.map { directory.appendingPathComponent($0.storageKey.replacingOccurrences(of: "/", with: "_") + ".json") } }
    private func persist() throws {
        guard let url = ledgerURL else { throw ApiError.noToken }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(pending).write(to: url, options: .atomic)
    }
    func refresh() async {
        guard let scope else { return }
        let ticket = generation
        do {
            let response: OrganizationResponse = try await api.organizationRequest("/api/organization", scope: scope)
            guard ticket == generation else { return }
            data = response
        } catch {
            guard ticket == generation else { return }
            if case ApiError.server(status: 404, _) = error { data = nil; self.error = nil }
            else { self.error = error.localizedDescription }
        }
    }
    func loadHistory() async {
        guard let scope else { return }
        let ticket = generation
        struct Envelope: Decodable { var operations: [OrganizationOperation] }
        do {
            let result: Envelope = try await api.organizationRequest("/api/organization/operations", scope: scope)
            guard ticket == generation else { return }
            history = result.operations
        } catch { if ticket == generation { self.error = error.localizedDescription } }
    }
    func save(url: String, requestId: String) async -> SavedBookmarkEnvelope? {
        guard let scope, !isBusy else { return nil }
        let ticket = generation
        let body: [String: JSONValue] = ["url": .string(url), "operationId": .string(requestId), "source": .object(["browser": .string("other"), "device": .string("desktop"), "os": .string("macOS"), "savedAt": .string(ISO8601DateFormatter().string(from: Date()))])]
        let request: OrganizationRequest
        if let existing = pending.first(where: { $0.id == requestId }) { request = existing }
        else {
            request = OrganizationRequest(id: requestId, path: "/api/bookmarks", method: "POST", body: body, title: "Save link")
            pending.append(request)
            do { try persist() } catch { pending.removeAll { $0.id == requestId }; self.error = "Couldn't save recovery information. No link was sent."; return nil }
        }
        isBusy = true; defer { if ticket == generation { isBusy = false } }
        do {
            let response: SavedBookmarkEnvelope = try await api.organizationRequest(request.path, method: request.method, body: request.body, scope: scope)
            guard ticket == generation else { return nil }
            pending.removeAll { $0.id == requestId }; try persist()
            if let operation = response.operation { history.insert(operation, at: 0) }
            error = nil; await refresh(); await onChange?(); return response
        } catch { if ticket == generation { self.error = "\(error.localizedDescription) Retry uses the same saved request; your link will not be duplicated." }; return nil }
    }
    @discardableResult
    func perform(action: String, fields: [String: JSONValue], title: String) async -> OrganizationOperation? {
        var body = fields
        let id = UUID().uuidString
        body["operationId"] = .string(id); body["action"] = .string(action)
        let request = OrganizationRequest(id: id, path: "/api/organization/operations", method: "POST", body: body, title: title)
        return await submit(request)
    }
    @discardableResult
    func edit(_ bookmark: Bookmark, changes: [String: JSONValue]) async -> OrganizationOperation? {
        let id = UUID().uuidString
        let versions = (bookmark.fieldVersions ?? [:]).filter { changes[$0.key] != nil }.mapValues(JSONValue.string)
        let request = OrganizationRequest(id: id, path: "/api/bookmarks/\(ApiClient.pathComponent(bookmark.id))", method: "PATCH", body: ["operationId": .string(id), "changes": .object(changes), "expected": .object(versions)], title: "Edit \(bookmark.displayTitle)")
        return await submit(request)
    }
    private func submit(_ request: OrganizationRequest) async -> OrganizationOperation? {
        guard available, !isBusy else { return nil }
        pending.append(request)
        do { try persist() } catch { pending.removeAll { $0.id == request.id }; self.error = "Couldn't save recovery information. No changes were sent."; return nil }
        isBusy = true; defer { isBusy = false }
        return await transmit(request)
    }
    private func transmit(_ request: OrganizationRequest) async -> OrganizationOperation? {
        guard let scope else { return nil }
        let ticket = generation
        do {
            let result: OrganizationEnvelope = try await api.organizationRequest(request.path, method: request.method, body: request.body, scope: scope)
            guard ticket == generation else { return nil }
            pending.removeAll { $0.id == request.id }
            try persist()
            history.removeAll { $0.id == result.operation.id }; history.insert(result.operation, at: 0)
            notice = result.operation.summary
            error = nil
            await refresh()
            await onChange?()
            return result.operation
        } catch {
            guard ticket == generation else { return nil }
            self.error = "\(error.localizedDescription) The result may be pending. Use Recent changes to reconcile or retry this exact action."
            return nil
        }
    }
    func resume(_ request: OrganizationRequest) async {
        guard !isBusy, pending.contains(where: { $0.id == request.id }) else { return }
        isBusy = true; defer { isBusy = false }
        if request.path == "/api/bookmarks" {
            isBusy = false
            _ = await save(url: request.body["url"]?.stringValue ?? "", requestId: request.id)
        } else { _ = await transmit(request) }
    }
    func reconcile(_ request: OrganizationRequest) async {
        guard let scope, !isBusy else { return }
        let ticket = generation
        isBusy = true; defer { isBusy = false }
        do {
            let result: OrganizationEnvelope = try await api.organizationRequest("/api/organization/operations/\(ApiClient.pathComponent(request.id))", scope: scope)
            guard ticket == generation else { return }
            history.removeAll { $0.id == result.operation.id }; history.insert(result.operation, at: 0)
            pending.removeAll { $0.id == request.id }; try persist()
            error = nil; notice = result.operation.summary
            await refresh(); await onChange?()
        } catch { if ticket == generation { self.error = "No confirmed receipt yet. Retry this action with its saved request identity." } }
    }
    func undo(_ operation: OrganizationOperation) async {
        guard operation.canUndo else { return }
        await operationAction(operation, kind: "undo", title: "Undo \(operation.description)")
    }
    func retry(_ operation: OrganizationOperation) async {
        guard operation.failedCount > 0 else { return }
        await operationAction(operation, kind: "retry", title: "Retry failed items")
    }
    private func operationAction(_ operation: OrganizationOperation, kind: String, title: String) async {
        let id = UUID().uuidString
        _ = await submit(OrganizationRequest(id: id, path: "/api/organization/operations/\(ApiClient.pathComponent(operation.id))/\(kind)", method: "POST", body: ["operationId": .string(id)], title: title))
        await loadHistory()
    }
    func freeze(_ body: [String: JSONValue]) async -> OrganizationSelection? {
        guard let scope else { return nil }
        let ticket = generation
        struct Envelope: Decodable { var selection: OrganizationSelection }
        do {
            let response: Envelope = try await api.organizationRequest("/api/organization/selections", method: "POST", body: body, scope: scope)
            guard ticket == generation else { return nil }
            frozenSelection = response.selection
            return response.selection
        } catch { if ticket == generation { self.error = error.localizedDescription }; return nil }
    }
    static func batches(selection: OrganizationSelection, changes: [String: JSONValue], size: Int) -> [OrganizationRequest] {
        let size = min(500, max(1, size))
        return stride(from: 0, to: selection.bookmarkIds.count, by: size).map { offset in
            let ids = Array(selection.bookmarkIds[offset..<min(offset + size, selection.bookmarkIds.count)])
            let id = UUID().uuidString
            let expected = Dictionary(uniqueKeysWithValues: ids.map { ($0, JSONValue.object((selection.fieldVersions[$0] ?? [:]).mapValues(JSONValue.string))) })
            return OrganizationRequest(id: id, path: "/api/organization/operations", method: "POST", body: ["operationId": .string(id), "action": .string("bookmarks.update"), "bookmarkIds": .array(ids.map(JSONValue.string)), "changes": .object(changes), "expected": .object(expected)], title: "Update items \(offset + 1)–\(offset + ids.count) of \(selection.count)")
        }
    }
    func apply(selection: OrganizationSelection, changes: [String: JSONValue]) async {
        guard available, !isBusy else { return }
        let batches = Self.batches(selection: selection, changes: changes, size: data?.capabilities.maxOperationItems ?? 500)
        let ticket = generation
        pending.append(contentsOf: batches)
        do { try persist() } catch { let ids = Set(batches.map(\.id)); pending.removeAll { ids.contains($0.id) }; self.error = "Couldn't save recovery information. No changes were sent."; return }
        isBusy = true; pauseRequested = false
        defer { if ticket == generation { isBusy = false } }
        for (index, request) in batches.enumerated() {
            guard ticket == generation, !pauseRequested else { break }
            notice = "Applying batch \(index + 1) of \(batches.count)…"
            guard await transmit(request) != nil else { break }
        }
        if ticket == generation, pending.contains(where: { item in batches.contains(where: { $0.id == item.id }) }) {
            notice = "Paused. Completed batches stay saved and can each be undone. Resume remaining actions in Recent changes."
        }
    }
    func reset() {
        generation = UUID(); scope = nil; data = nil; history = []; pending = []; isBusy = false
        error = nil; notice = nil; frozenSelection = nil; closeEditor()
        showHistory = false; showManager = false; showAdd = false; showImport = false; showBulk = false
    }
}
