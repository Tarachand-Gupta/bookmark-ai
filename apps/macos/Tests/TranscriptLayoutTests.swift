import XCTest
@testable import BookmarkAI

/// The empty-reply guard (S2): a stream that carries nothing renderable
/// (`start` → `finish`) flags the turn under its prompt instead of leaving a
/// silent gap; Retry sends the same parts again as a fresh message.
final class TranscriptLayoutTests: XCTestCase {

    @MainActor
    func testEmptyStreamMarksTheTurnFailedAndRetrySendsAgain() async {
        let env = AppEnvironment()
        let chat = env.chat
        chat.turnStarter = { _, _ in
            ChatStreamHandle(conversationId: nil, aiSource: nil, aiNote: nil, chunks: AsyncThrowingStream { continuation in
                continuation.yield(.start(messageId: "a1"))
                continuation.yield(.finish)
                continuation.finish()
            })
        }
        let user = ChatMessage.user(text: "Hello?", files: [])
        chat.seed(messages: [user])
        await chat.runTurnForTesting(user)

        XCTAssertEqual(chat.failedTurn, ChatModel.FailedTurn(userMessageId: user.id, message: "The AI returned no reply."))
        XCTAssertEqual(chat.messages.map(\.role), ["user"], "no hollow assistant bubble may remain")
        XCTAssertNil(chat.errorMessage)

        // A reply with text is never flagged — and Retry clears the row.
        chat.turnStarter = { _, _ in
            ChatStreamHandle(conversationId: nil, aiSource: nil, aiNote: nil, chunks: AsyncThrowingStream { continuation in
                continuation.yield(.start(messageId: "a2"))
                continuation.yield(.textStart(id: "x"))
                continuation.yield(.textDelta(id: "x", delta: "Hi!"))
                continuation.yield(.textEnd(id: "x"))
                continuation.yield(.finish)
                continuation.finish()
            })
        }
        chat.retryFailedTurn()
        for _ in 0..<500 where chat.isStreaming {
            try? await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertFalse(chat.isStreaming)
        XCTAssertNil(chat.failedTurn)
        XCTAssertEqual(chat.messages.map(\.role), ["user", "user", "assistant"])
        XCTAssertEqual(chat.messages.last?.plainText, "Hi!")
        XCTAssertEqual(chat.messages[1].parts, user.parts, "the retry re-sends the same parts under a new id")
        XCTAssertNotEqual(chat.messages[1].id, user.id)
    }

    /// The server's own `error` chunk on an otherwise empty turn lands in the
    /// failure row (with Retry), not in the error bar as well.
    @MainActor
    func testServerErrorOnAnEmptyTurnBecomesTheFailureRow() async {
        let env = AppEnvironment()
        let chat = env.chat
        chat.turnStarter = { _, _ in
            ChatStreamHandle(conversationId: nil, aiSource: nil, aiNote: nil, chunks: AsyncThrowingStream { continuation in
                continuation.yield(.start(messageId: "a1"))
                continuation.yield(.error("The model returned an empty reply. Try again, or start a new conversation."))
                continuation.yield(.finish)
                continuation.finish()
            })
        }
        let user = ChatMessage.user(text: "Hello?", files: [])
        chat.seed(messages: [user])
        await chat.runTurnForTesting(user)

        XCTAssertEqual(chat.failedTurn?.userMessageId, user.id)
        XCTAssertEqual(chat.failedTurn?.message, "The model returned an empty reply. Try again, or start a new conversation.")
        XCTAssertNil(chat.errorMessage, "not reported twice")
        XCTAssertEqual(chat.messages.map(\.role), ["user"])

        // An error chunk AFTER real content keeps the bar and no failure row.
        chat.turnStarter = { _, _ in
            ChatStreamHandle(conversationId: nil, aiSource: nil, aiNote: nil, chunks: AsyncThrowingStream { continuation in
                continuation.yield(.start(messageId: "a2"))
                continuation.yield(.textStart(id: "x"))
                continuation.yield(.textDelta(id: "x", delta: "Partial…"))
                continuation.yield(.error("rate limited"))
                continuation.finish()
            })
        }
        chat.retryFailedTurn()
        for _ in 0..<500 where chat.isStreaming {
            try? await Task.sleep(for: .milliseconds(10))
        }
        XCTAssertNil(chat.failedTurn)
        XCTAssertEqual(chat.errorMessage, "rate limited")
        XCTAssertEqual(chat.messages.last?.plainText, "Partial…")
    }
}
