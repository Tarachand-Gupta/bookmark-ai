import AppKit
import XCTest
@testable import BookmarkAI

@MainActor
final class ChatWorkspaceTests: XCTestCase {
    private var directory: URL!
    override func setUp() { super.setUp(); directory = FileManager.default.temporaryDirectory.appendingPathComponent("chat-workspace-\(UUID().uuidString)") }
    override func tearDown() { try? FileManager.default.removeItem(at: directory); super.tearDown() }
    private func model() -> ChatModel {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [ReleaseOrganizationTests.Stub.self]
        let model = ChatModel(api: ApiClient(target: .local, session: URLSession(configuration: configuration)), draftDirectory: directory)
        model.bind(scope: OrganizationScope(origin: "https://fixture.test", accountId: "account-a"))
        return model
    }
    func testDraftContextAndFilesStayWithConversationAndCloseDoesNotClear() throws {
        let chat = model()
        chat.draft = "Compare these"
        chat.context = .bookmarks(["a", "b"])
        chat.addAttachment(data: Data("Fixture document".utf8), filename: "fixture.txt", reportedMediaType: "text/plain")
        let prior = try XCTUnwrap(chat.localDrafts.first)
        chat.newConversation()
        XCTAssertEqual(chat.draft, "")
        XCTAssertTrue(chat.attachments.isEmpty)
        chat.draft = "Second question"
        chat.selectDraft(prior)
        XCTAssertEqual(chat.draft, "Compare these")
        XCTAssertEqual(chat.attachments.first?.filename, "fixture.txt")
        XCTAssertEqual(chat.context.bookmarkIds, ["a", "b"])
        chat.isPresented = false
        XCTAssertEqual(chat.draft, "Compare these")
        chat.show(context: .bookmarks(["c"]))
        XCTAssertEqual(chat.context.bookmarkIds, ["a", "b"])
        XCTAssertEqual(chat.proposedContext?.bookmarkIds, ["c"])
        chat.acceptProposedContext()
        XCTAssertEqual(chat.context.bookmarkIds, ["c"])
    }
    func testPersistedDraftRequiresReattachmentAndDoesNotCrossAccount() {
        let chat = model(); chat.draft = "Keep my draft"
        chat.addAttachment(data: Data("Fixture".utf8), filename: "notes.txt", reportedMediaType: "text/plain")
        let restored = model()
        XCTAssertEqual(restored.draft, "Keep my draft")
        XCTAssertTrue(restored.attachments.isEmpty)
        XCTAssertEqual(restored.missingAttachments, ["notes.txt"])
        XCTAssertFalse(restored.canSend)
        restored.addAttachment(data: Data("Fixture".utf8), filename: "notes.txt", reportedMediaType: "text/plain")
        XCTAssertTrue(restored.missingAttachments.isEmpty)
        XCTAssertTrue(restored.canSend)
        restored.bind(scope: OrganizationScope(origin: "https://fixture.test", accountId: "account-b"))
        XCTAssertEqual(restored.draft, "")
        XCTAssertTrue(restored.attachments.isEmpty)
        restored.bind(scope: OrganizationScope(origin: "https://other.test", accountId: "account-a"))
        XCTAssertEqual(restored.draft, "")
    }
    func testNewChatAndCloseDoNotCancelBackgroundStream() async throws {
        let chat = model()
        var continuation: AsyncThrowingStream<ChatStreamChunk, Error>.Continuation!
        let chunks = AsyncThrowingStream<ChatStreamChunk, Error> { continuation = $0 }
        chat.turnStarter = { _, _ in ChatStreamHandle(conversationId: nil, aiSource: nil, aiNote: nil, chunks: chunks) }
        chat.draft = "First"
        chat.send()
        let first = try XCTUnwrap(chat.localDrafts.first)
        await Task.yield()
        chat.isPresented = false
        chat.newConversation()
        chat.draft = "Second draft"
        continuation.yield(.start(messageId: "answer")); continuation.yield(.textStart(id: "text")); continuation.yield(.textDelta(id: "text", delta: "A real streamed answer")); continuation.finish()
        for _ in 0..<100 where first.isStreaming { try await Task.sleep(for: .milliseconds(5)) }
        XCTAssertFalse(first.isStreaming)
        XCTAssertEqual(chat.draft, "Second draft")
        XCTAssertTrue(chat.messages.isEmpty)
        chat.selectDraft(first)
        XCTAssertEqual(chat.messages.last?.parts.first?["text"]?.stringValue, "A real streamed answer")
    }
    func testOversizedExplicitContextCannotBeSent() {
        let chat = model(); chat.draft = "Compare"
        chat.context = .bookmarks((0...1000).map(String.init))
        XCTAssertFalse(chat.canSend)
    }
}
