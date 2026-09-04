import XCTest
@testable import BookmarkAI

/// The history popover's model side: day buckets, the relative-time copy,
/// title filtering, and the seed hook previews rely on.
final class ChatHistoryTests: XCTestCase {

    private var calendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        calendar.locale = Locale(identifier: "en_GB")
        return calendar
    }

    private let locale = Locale(identifier: "en_GB")
    private let now = ISO8601.date(from: "2026-09-04T10:00:00.000Z")!

    private func conversation(_ id: String, _ title: String, _ updatedAt: String) -> ChatConversation {
        ChatConversation(id: id, title: title, createdAt: updatedAt, updatedAt: updatedAt)
    }

    func testSectionsGroupByDayNewestFirst() {
        let sections = ChatHistoryGrouping.sections([
            conversation("old", "Old", "2026-08-24T14:03:00.000Z"),
            conversation("y", "Yesterday one", "2026-09-03T14:03:00.000Z"),
            conversation("t2", "Today earlier", "2026-09-04T07:00:00.000Z"),
            conversation("t1", "Today latest", "2026-09-04T09:58:30.000Z"),
            conversation("bad", "Unparsable", "n/a"),
        ], now: now, calendar: calendar)

        XCTAssertEqual(sections.map(\.title), ["Today", "Yesterday", "Earlier"])
        XCTAssertEqual(sections[0].conversations.map(\.id), ["t1", "t2"])
        XCTAssertEqual(sections[1].conversations.map(\.id), ["y"])
        XCTAssertEqual(sections[2].conversations.map(\.id), ["old", "bad"])
        XCTAssertTrue(ChatHistoryGrouping.sections([], now: now, calendar: calendar).isEmpty)
    }

    func testRelativeTimeCopy() {
        func rel(_ iso: String) -> String {
            ChatHistoryGrouping.relativeTime(ISO8601.date(from: iso), now: now, calendar: calendar, locale: locale)
        }
        XCTAssertEqual(rel("2026-09-04T09:59:40.000Z"), "Just now")
        XCTAssertEqual(rel("2026-09-04T09:58:00.000Z"), "2 min ago")
        XCTAssertEqual(rel("2026-09-04T07:00:00.000Z"), "07:00")
        XCTAssertEqual(rel("2026-09-03T14:03:00.000Z"), "Yesterday 14:03")
        XCTAssertEqual(rel("2026-08-24T14:03:00.000Z"), "24 Aug, 14:03")
        XCTAssertEqual(rel("2025-08-24T14:03:00.000Z"), "24 Aug 2025")
        XCTAssertEqual(ChatHistoryGrouping.relativeTime(nil, now: now, calendar: calendar, locale: locale), "")
    }

    func testHistoryFilterMatchesEveryTermInTheTitle() {
        let all = [
            conversation("a", "Find my bookmarks about design", "2026-09-04T09:58:00.000Z"),
            conversation("b", "What did I save this week?", "2026-09-04T09:00:00.000Z"),
        ]
        XCTAssertEqual(ChatModel.filterConversations(all, query: "").map(\.id), ["a", "b"])
        XCTAssertEqual(ChatModel.filterConversations(all, query: "design book").map(\.id), ["a"])
        XCTAssertEqual(ChatModel.filterConversations(all, query: "  WEEK ").map(\.id), ["b"])
        XCTAssertTrue(ChatModel.filterConversations(all, query: "zebra").isEmpty)
    }

    @MainActor
    func testSeededHistoryAppliesTheQueryAndCurrentConversation() {
        let env = AppEnvironment()
        let all = [
            conversation("a", "Find my bookmarks about design", "2026-09-04T09:58:00.000Z"),
            conversation("b", "What did I save this week?", "2026-09-04T09:00:00.000Z"),
        ]
        env.chat.seedHistory(all, current: "b", query: "week")
        XCTAssertEqual(env.chat.visibleConversations.map(\.id), ["b"])
        XCTAssertEqual(env.chat.conversationId, "b")
        XCTAssertTrue(env.chat.hasLoadedConversations)
        XCTAssertNil(env.chat.conversationsError)

        env.chat.seedHistory(all, current: nil, query: "")
        XCTAssertEqual(env.chat.visibleConversations.count, 2)
        XCTAssertNil(env.chat.conversationId)
    }
}
