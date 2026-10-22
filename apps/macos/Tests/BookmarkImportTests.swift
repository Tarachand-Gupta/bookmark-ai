import XCTest
@testable import BookmarkAI

@MainActor
final class BookmarkImportTests: XCTestCase {
    final class StubURLProtocol: URLProtocol {
        static var handler: ((URLRequest) -> (Int, Data))?
        static var requests: [URLRequest] = []
        override class func canInit(with request: URLRequest) -> Bool { true }
        override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
        override func startLoading() {
            Self.requests.append(request)
            let (status, data) = Self.handler?(request) ?? (500, Data())
            let response = HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: ["Content-Type": "application/json"])!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: data)
            client?.urlProtocolDidFinishLoading(self)
        }
        override func stopLoading() {}
    }

    private func token(_ subject: String) -> String {
        "header.\(Data("{\"sub\":\"\(subject)\"}".utf8).base64EncodedString()).signature"
    }
    private func client() -> ApiClient {
        StubURLProtocol.requests = []
        StubURLProtocol.handler = nil
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubURLProtocol.self]
        let api = ApiClient(target: .cloud, session: URLSession(configuration: config))
        api.tokenProvider = { _ in self.token("account-a") }
        return api
    }
    private func body(_ request: URLRequest) -> [String: Any] {
        var data = request.httpBody ?? Data()
        if let stream = request.httpBodyStream {
            stream.open(); defer { stream.close() }
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let count = stream.read(&buffer, maxLength: buffer.count)
                if count <= 0 { break }
                data.append(contentsOf: buffer.prefix(count))
            }
        }
        return (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }
    private let preview = Data(#"{"preview":{"items":[{"key":"0","url":"https://fixture.test/a","title":"A","folderPath":["Research"],"status":"ready"}],"totalCount":1,"invalidCount":0,"duplicateCount":0,"existingCount":0,"warnings":[]}}"#.utf8)

    func testAccountSubjectAndRequestBoundary() async throws {
        let api = client()
        XCTAssertEqual(ApiClient.importSubject(token("account-a")), "account-a")
        XCTAssertNil(ApiClient.importSubject("not-a-token"))
        do {
            _ = try await api.bookmarkImportRequest(body: nil, accountId: "account-b", origin: api.target.baseURL.absoluteString)
            XCTFail("must reject a different account before dispatch")
        } catch { XCTAssertTrue(StubURLProtocol.requests.isEmpty) }
    }

    func testLateResponseFromChangedAccountIsRejected() async throws {
        let api = client()
        var calls = 0
        api.tokenProvider = { _ in calls += 1; return self.token(calls == 1 ? "account-a" : "account-b") }
        StubURLProtocol.handler = { _ in (200, Data("{}".utf8)) }
        do {
            _ = try await api.bookmarkImportRequest(body: nil, accountId: "account-a", origin: api.target.baseURL.absoluteString)
            XCTFail("must reject a response after the account changes")
        } catch { XCTAssertEqual(StubURLProtocol.requests.count, 1) }
    }

    func testInterruptedBatchReusesReceiptAndRestoresProgress() async throws {
        let api = client()
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("bookmark-import-test-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let model = ImportBookmarksModel(directory: directory)
        var requestIds: [String] = []
        StubURLProtocol.handler = { request in
            if request.httpMethod == "GET" { return (200, Data("{}".utf8)) }
            let input = self.body(request)
            if input["action"] as? String == "preview" { return (200, self.preview) }
            let id = input["requestId"] as! String
            requestIds.append(id)
            if requestIds.count == 1 { return (503, Data(#"{"error":"Fixture interruption"}"#.utf8)) }
            return (200, Data("{\"result\":{\"requestId\":\"\(id)\",\"items\":[{\"key\":\"0\",\"url\":\"https://fixture.test/a\",\"status\":\"imported\",\"bookmarkId\":\"fixture-id\"}],\"imported\":1,\"existing\":0,\"failed\":0}}".utf8))
        }
        await model.prepare(api: api)
        model.paste = "https://fixture.test/a"
        await model.previewPaste(api: api)
        XCTAssertEqual(model.preview?.items.first?.folderPath, ["Research"])
        XCTAssertTrue(requestIds.isEmpty, "preview must not save")
        await model.start(api: api)
        XCTAssertEqual(model.job?.status, "paused")
        XCTAssertNotNil(model.job?.pending)
        await model.resume(api: api)
        XCTAssertEqual(requestIds.count, 2)
        XCTAssertEqual(requestIds.first, requestIds.last)
        XCTAssertEqual(model.job?.imported, 1)
        XCTAssertEqual(model.job?.status, "completed")
        let reopened = ImportBookmarksModel(directory: directory)
        await reopened.prepare(api: api)
        XCTAssertEqual(reopened.job?.imported, 1)
        reopened.invalidateAccount()
        XCTAssertNil(reopened.job)
        XCTAssertNil(reopened.preview)
        XCTAssertEqual(reopened.paste, "")
    }
}
