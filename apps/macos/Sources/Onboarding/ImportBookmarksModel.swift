import AppKit
import CryptoKit
import Foundation
import Observation

struct ImportedLinkCandidate: Codable, Identifiable {
    var key: String
    var url: String
    var title: String
    var folderPath: [String]
    var savedAt: String?
    var status: String?
    var id: String { key }
}

struct ImportedLinkOutcome: Codable, Identifiable {
    var key: String
    var url: String
    var status: String
    var bookmarkId: String?
    var error: String?
    var id: String { key }
}

struct BookmarkImportPreview: Codable {
    var items: [ImportedLinkCandidate]
    var totalCount: Int
    var invalidCount: Int
    var duplicateCount: Int
    var existingCount: Int
    var warnings: [String]
}

struct BookmarkImportBatch: Codable {
    var action = "apply"
    var requestId: String
    var items: [ImportedLinkCandidate]
    var browser = "other"
    var device = "desktop"
    var preserveFolders: Bool
}

struct BookmarkImportReceipt: Codable {
    var requestId: String
    var items: [ImportedLinkOutcome]
    var imported: Int
    var existing: Int
    var failed: Int
}

struct BookmarkImportJob: Codable {
    var version = 1
    var accountId: String
    var origin: String
    var items: [ImportedLinkCandidate]
    var outcomes: [ImportedLinkOutcome]
    var preserveFolders: Bool
    var pending: BookmarkImportBatch?
    var status: String
    var error: String?

    var imported: Int { outcomes.filter { $0.status == "imported" }.count }
    var existing: Int { outcomes.filter { $0.status == "existing" }.count }
    var failed: Int { outcomes.filter { $0.status == "failed" }.count }
    var remaining: Int { items.count - outcomes.count }
}

@MainActor
@Observable
final class ImportBookmarksModel {
    var paste = ""
    var preserveFolders = true
    private(set) var preview: BookmarkImportPreview?
    private(set) var sourceName = ""
    private(set) var job: BookmarkImportJob?
    private(set) var busy = false
    private(set) var error: String?
    private(set) var connected = false
    private var accountId: String?
    private var origin: String?
    private var pauseRequested = false
    private var generation = 0
    private let directory: URL

    init(directory: URL? = nil) {
        self.directory = directory ?? FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("BookmarkAI/Imports", isDirectory: true)
    }

    private func storageURL(accountId: String, origin: String) -> URL {
        let digest = SHA256.hash(data: Data("\(origin)\n\(accountId)".utf8))
            .map { String(format: "%02x", $0) }.joined()
        return directory.appendingPathComponent("\(digest).json")
    }

    private func persist(_ next: BookmarkImportJob) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true,
                                               attributes: [.posixPermissions: 0o700])
        let url = storageURL(accountId: next.accountId, origin: next.origin)
        try JSONEncoder().encode(next).write(to: url, options: .atomic)
        try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        job = next
    }

    func prepare(api: ApiClient) async {
        guard !busy else { return }
        generation += 1
        let current = generation
        connected = false
        error = nil
        do {
            let account = try await api.importAccountIdentifier()
            let endpoint = api.target.baseURL.absoluteString
            _ = try await api.bookmarkImportRequest(body: nil, accountId: account, origin: endpoint)
            guard generation == current, !Task.isCancelled else { return }
            accountId = account
            origin = endpoint
            connected = true
            let url = storageURL(accountId: account, origin: endpoint)
            guard FileManager.default.fileExists(atPath: url.path) else { return }
            let attributes = try FileManager.default.attributesOfItem(atPath: url.path)
            guard ((attributes[.size] as? NSNumber)?.intValue ?? 0) <= 12 * 1024 * 1024 else {
                throw ApiError.decoding("Saved import progress is too large.")
            }
            let restored = try JSONDecoder().decode(BookmarkImportJob.self, from: Data(contentsOf: url))
            guard Self.valid(restored), restored.accountId == account, restored.origin == endpoint else {
                throw ApiError.decoding("Saved import progress is not valid for this account.")
            }
            job = restored
            if job?.status == "running" { job?.status = "paused" }
        } catch { self.error = error.localizedDescription }
    }

    static func valid(_ job: BookmarkImportJob) -> Bool {
        let keys = Set(job.items.map(\.key))
        guard job.version == 1, job.items.count <= 5_000, keys.count == job.items.count,
              job.outcomes.count <= job.items.count, Set(job.outcomes.map(\.key)).count == job.outcomes.count,
              job.outcomes.allSatisfy({ keys.contains($0.key) && ["imported", "existing", "failed"].contains($0.status) }) else { return false }
        if let pending = job.pending {
            guard UUID(uuidString: pending.requestId) != nil, pending.items.count <= 100,
                  pending.items.allSatisfy({ item in job.items.contains { $0.key == item.key && $0.url == item.url } }) else { return false }
        }
        return true
    }

    func invalidateAccount() {
        pauseRequested = true
        generation += 1
        accountId = nil
        origin = nil
        job = nil
        preview = nil
        paste = ""
        sourceName = ""
        connected = false
        error = nil
    }

    func pause() {
        pauseRequested = true
        generation += 1
    }

    func chooseFile(api: ApiClient) async {
        guard !busy else { return }
        let current = generation
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = false
        panel.canChooseDirectories = false
        panel.message = "Choose a bookmarks HTML export, Markdown or plain text file."
        guard panel.runModal() == .OK, let url = panel.url, generation == current else { return }
        let access = url.startAccessingSecurityScopedResource()
        defer { if access { url.stopAccessingSecurityScopedResource() } }
        do {
            let ext = url.pathExtension.lowercased()
            if ext == "zip" { throw ApiError.decoding("Extract the ZIP in Finder, then choose its bookmarks HTML file. In Safari, export Bookmarks only.") }
            if ext == "json" { throw ApiError.decoding("For a Bookmark AI JSON backup, use Settings → Data → Restore backup.") }
            guard ["html", "htm", "md", "markdown", "txt"].contains(ext) else {
                throw ApiError.decoding("Choose an HTML, Markdown or plain text file.")
            }
            let size = try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            guard size <= 5 * 1024 * 1024 else { throw ApiError.decoding("Import files must be 5 MB or smaller.") }
            let data = try Data(contentsOf: url)
            guard data.count <= 5 * 1024 * 1024,
                  let content = String(data: data, encoding: .utf8) ?? String(data: data, encoding: .utf16) else {
                throw ApiError.decoding("Choose a UTF-8 or UTF-16 text export up to 5 MB.")
            }
            let source = ["html", "htm"].contains(ext) ? "html" : ["md", "markdown"].contains(ext) ? "markdown" : "text"
            await loadPreview(api: api, content: content, source: source, name: url.lastPathComponent)
        } catch { self.error = error.localizedDescription }
    }

    func previewPaste(api: ApiClient) async {
        await loadPreview(api: api, content: paste, source: "markdown", name: "Pasted links")
    }

    private func loadPreview(api: ApiClient, content: String, source: String, name: String) async {
        guard !busy, let accountId, let origin else { return }
        busy = true
        error = nil
        let current = generation
        defer { busy = false }
        do {
            let body = try JSONSerialization.data(withJSONObject: ["action": "preview", "source": source, "content": content])
            let data = try await api.bookmarkImportRequest(body: body, accountId: accountId, origin: origin)
            struct Response: Decodable { var preview: BookmarkImportPreview }
            let next = try JSONDecoder().decode(Response.self, from: data).preview
            guard generation == current, self.accountId == accountId else { return }
            preview = next
            sourceName = name
        } catch { if generation == current { self.error = error.localizedDescription } }
    }

    func start(api: ApiClient) async {
        guard let preview, let accountId, let origin else { return }
        job = BookmarkImportJob(accountId: accountId, origin: origin, items: preview.items,
                                outcomes: preview.items.filter { $0.status == "existing" }.map { .init(key: $0.key, url: $0.url, status: "existing") },
                                preserveFolders: preserveFolders, status: "reviewed")
        await resume(api: api)
    }

    func retryFailed(api: ApiClient) async {
        guard !busy, job?.pending == nil else { return }
        job?.outcomes.removeAll { $0.status == "failed" }
        await resume(api: api)
    }

    func resume(api: ApiClient) async {
        guard !busy, var current = job else { return }
        busy = true
        pauseRequested = false
        error = nil
        defer { busy = false }
        do {
            while !pauseRequested {
                let confirmedAccount = try await api.importAccountIdentifier()
                guard confirmedAccount == current.accountId, api.target.baseURL.absoluteString == current.origin else {
                    throw ApiError.network("Your account or server changed. Reopen Import to continue.")
                }
                let known = Set(current.outcomes.map(\.key))
                let remaining = current.items.filter { !known.contains($0.key) }
                if current.pending == nil && remaining.isEmpty {
                    current.status = "completed"
                    current.error = nil
                    try persist(current)
                    return
                }
                if current.pending == nil {
                    current.pending = BookmarkImportBatch(requestId: UUID().uuidString.lowercased(), items: Array(remaining.prefix(100)), preserveFolders: current.preserveFolders)
                }
                current.status = "running"
                current.error = nil
                try persist(current)
                guard let pending = current.pending else { return }
                let data = try await api.bookmarkImportRequest(body: JSONEncoder().encode(pending), accountId: current.accountId, origin: current.origin)
                guard accountId == current.accountId, origin == current.origin else { return }
                struct Response: Decodable { var result: BookmarkImportReceipt }
                let result = try JSONDecoder().decode(Response.self, from: data).result
                let pendingKeys = Set(pending.items.map(\.key))
                guard result.requestId.lowercased() == pending.requestId.lowercased(),
                      result.items.count == pendingKeys.count,
                      Set(result.items.map(\.key)).count == pendingKeys.count,
                      result.items.allSatisfy({ outcome in pending.items.contains { $0.key == outcome.key && $0.url == outcome.url } && ["imported", "existing", "failed"].contains(outcome.status) }) else {
                    throw ApiError.decoding("Incomplete import receipt. Retry to reconcile this batch safely.")
                }
                current.outcomes.removeAll { pendingKeys.contains($0.key) }
                current.outcomes.append(contentsOf: result.items)
                current.pending = nil
                try persist(current)
            }
            current.status = "paused"
            try persist(current)
        } catch {
            guard accountId == current.accountId, origin == current.origin else { return }
            current.status = "paused"
            current.error = error.localizedDescription
            // Keep the last durable pending request if the result write failed.
            if let durable = job, durable.pending != nil, current.pending == nil { current = durable; current.status = "paused"; current.error = error.localizedDescription }
            try? persist(current)
            self.error = error.localizedDescription
        }
    }

    func chooseAnotherSource() { guard !busy else { return }; preview = nil; error = nil }

    func clearCompleted() {
        guard !busy, let current = job, current.status == "completed" else { return }
        do {
            try FileManager.default.removeItem(at: storageURL(accountId: current.accountId, origin: current.origin))
            job = nil
            preview = nil
            paste = ""
            error = nil
        } catch { self.error = error.localizedDescription }
    }
}
