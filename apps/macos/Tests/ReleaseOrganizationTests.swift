import XCTest
@testable import BookmarkAI

@MainActor
final class ReleaseOrganizationTests: XCTestCase {
    private func snapshot(_ count: Int) -> OrganizationSelection {
        let ids = (0..<count).map { "bookmark-\($0)" }
        return OrganizationSelection(id: "frozen", bookmarkIds: ids, fieldVersions: Dictionary(uniqueKeysWithValues: ids.map { ($0, ["title": "v-\($0)", "categoryId": "0"]) }), count: count, createdAt: "2026-10-16T00:00:00Z", expiresAt: "2026-10-17T00:00:00Z", scope: "query", limited: false)
    }
    func testFrozenSelectionBatchesNeverTruncateAndKeepEveryVersion() throws {
        let snapshot = snapshot(1201)
        let batches = OrganizationModel.batches(selection: snapshot, changes: ["categoryId": .string("research")], size: 900)
        XCTAssertEqual(batches.map { $0.body["bookmarkIds"]?.arrayValue?.count }, [500, 500, 201])
        let all = batches.flatMap { $0.body["bookmarkIds"]?.arrayValue?.compactMap(\.stringValue) ?? [] }
        XCTAssertEqual(all, snapshot.bookmarkIds)
        XCTAssertEqual(Set(batches.map(\.id)).count, 3)
        for batch in batches {
            XCTAssertEqual(batch.body["operationId"], .string(batch.id))
            for id in batch.body["bookmarkIds"]!.arrayValue!.compactMap(\.stringValue) {
                XCTAssertEqual(batch.body["expected"]?[id]?["title"]?.stringValue, "v-\(id)")
            }
        }
    }
    func testPartialUndoNamesRestoredFieldsAndDoesNotExposeIdentity() {
        let item = OrganizationItemResult(id: "opaque-private-id", status: "conflict", changedFields: ["categoryId"], error: OrganizationItemError(code: "conflict", message: "The title was edited later.", fields: ["title"]), entityType: "bookmark", label: "A useful link")
        XCTAssertEqual(item.displayLabel, "A useful link")
        XCTAssertEqual(item.detail, "Updated category. The title was edited later.")
        XCTAssertFalse(item.detail.contains(item.id))
    }
    func testNewContextWireHasOnlySupportedFields() throws {
        let context = ChatContext.bookmarks(["b1", "b2"])
        let body = try JSONSerialization.jsonObject(with: JSONEncoder().encode(context)) as! [String: Any]
        XCTAssertNil(body["title"])
        XCTAssertEqual(body["bookmarkIds"] as? [String], ["b1", "b2"])
        let turn = ChatTurnBody.make(message: .user(text: "Compare"), conversationId: nil, timezone: "UTC", context: .bookmarks(["b1", "b2"]))
        XCTAssertEqual(turn.context?.bookmarkIds, ["b1", "b2"])
    }
    func testUncertainRequestPersistsAndRetriesSameBodyAfterRestart() async throws {
        let api = client()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        defer { try? FileManager.default.removeItem(at: directory) }
        let model = OrganizationModel(api: api, directory: directory)
        model.bind(accountId: "account-a")
        var bodies: [Data] = []
        Stub.handler = { request in
            if request.httpMethod == "GET" { return (200, Self.capabilities) }
            bodies.append(Self.body(request))
            return (503, Data(#"{"error":"Fixture interrupted"}"#.utf8))
        }
        await model.refresh()
        XCTAssertTrue(model.available)
        let result = await model.perform(action: "tag.create", fields: ["name": .string("Research")], title: "Create tag")
        XCTAssertNil(result)
        let pending = try XCTUnwrap(model.pending.first)
        let restored = OrganizationModel(api: api, directory: directory)
        restored.bind(accountId: "account-a")
        XCTAssertEqual(restored.pending.first?.id, pending.id)
        await restored.resume(pending)
        XCTAssertEqual(bodies.count, 2)
        XCTAssertEqual(try JSONDecoder().decode(JSONValue.self, from: bodies[0]), try JSONDecoder().decode(JSONValue.self, from: bodies[1]))
        restored.bind(accountId: "account-b")
        XCTAssertTrue(restored.pending.isEmpty)
        restored.bind(accountId: "account-a")
        XCTAssertEqual(restored.pending.first?.id, pending.id)
    }
    func testWrongAccountIsRejectedBeforeMutationDispatch() async throws {
        let api = client()
        let scope = OrganizationScope(origin: api.target.baseURL.absoluteString, accountId: "account-b")
        do { let _: OrganizationResponse = try await api.organizationRequest("/api/organization", scope: scope); XCTFail("different account must fail") }
        catch { XCTAssertEqual(error as? ApiError, .noToken) }
        XCTAssertTrue(Stub.requests.isEmpty)
    }
    private static let capabilities = Data(#"{"capabilities":{"organization":1,"undoDays":7,"context":1,"maxOperationItems":500,"maxSelectionItems":10000},"categories":[],"tags":[]}"#.utf8)
    private func client() -> ApiClient {
        Stub.requests = []; Stub.handler = nil
        let config = URLSessionConfiguration.ephemeral; config.protocolClasses = [Stub.self]
        let api = ApiClient(target: .cloud, session: URLSession(configuration: config))
        api.tokenProvider = { _ in "header.\(Data(#"{"sub":"account-a"}"#.utf8).base64EncodedString()).signature" }
        return api
    }
    private static func body(_ request: URLRequest) -> Data {
        if let data = request.httpBody { return data }
        guard let stream = request.httpBodyStream else { return Data() }
        stream.open(); defer { stream.close() }
        var data = Data(), buffer = [UInt8](repeating: 0, count: 4096)
        while stream.hasBytesAvailable { let count = stream.read(&buffer, maxLength: buffer.count); if count <= 0 { break }; data.append(contentsOf: buffer.prefix(count)) }
        return data
    }
    final class Stub: URLProtocol {
        static var requests: [URLRequest] = []
        static var handler: ((URLRequest) -> (Int, Data))?
        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
        override func startLoading() {
            Self.requests.append(request)
            let (status, data) = Self.handler?(request) ?? (500, Data())
            client?.urlProtocol(self, didReceive: HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data); client?.urlProtocolDidFinishLoading(self)
        }
        override func stopLoading() {}
    }
}
