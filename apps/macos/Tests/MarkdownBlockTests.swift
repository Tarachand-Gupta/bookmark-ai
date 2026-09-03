import XCTest
@testable import BookmarkAI

/// The chat markdown block parser — pinned with the exact shapes the agent
/// emits (the table below is a real /api/chat answer that used to render as
/// literal pipes).
final class MarkdownBlockTests: XCTestCase {

    func testRealChatTableParses() {
        let text = """
        Here are the top 5 most recently added bookmarks:

        | Title | URL | Saved At |
        |---|---|---|
        | - YouTube | https://www.youtube.com/watch?v=o0gkdZBtwEg | 2026-08-25T07:28:26.562Z |
        | LLM Visualization | https://bbycroft.net/llm | 2026-08-25T07:27:23.651Z |
        | 3Blue1Brown | https://www.3blue1brown.com/?topic=neural-networks | 2026-08-25T07:27:11.400Z |
        """

        let blocks = MarkdownBlock.parse(text)
        XCTAssertEqual(blocks.count, 2)
        XCTAssertEqual(blocks[0], .paragraph("Here are the top 5 most recently added bookmarks:"))
        guard case .table(let header, let rows) = blocks[1] else {
            return XCTFail("expected a table, got \(blocks[1])")
        }
        XCTAssertEqual(header, ["Title", "URL", "Saved At"])
        XCTAssertEqual(rows.count, 3)
        XCTAssertEqual(rows[1], ["LLM Visualization", "https://bbycroft.net/llm", "2026-08-25T07:27:23.651Z"])
    }

    func testSeparatorVariantsAndRaggedRows() {
        let text = """
        | A | B |
        | :--- | ---: |
        | 1 |
        | 1 | 2 | 3 |
        """
        guard case .table(let header, let rows) = MarkdownBlock.parse(text).first else {
            return XCTFail("expected a table")
        }
        XCTAssertEqual(header, ["A", "B"])
        // Short rows pad to the header width; long rows truncate to it.
        XCTAssertEqual(rows, [["1", ""], ["1", "2"]])
    }

    func testFencedCodeWithLanguageAndUnclosedFence() {
        let closed = MarkdownBlock.parse("```swift\nlet x = 1\nlet y = 2\n```\nafter")
        XCTAssertEqual(closed[0], .code(language: "swift", code: "let x = 1\nlet y = 2"))
        XCTAssertEqual(closed[1], .paragraph("after"))

        // Streaming: the fence hasn't closed yet — still code, never literal ```.
        let open = MarkdownBlock.parse("```\nconsole.log(1)")
        XCTAssertEqual(open, [.code(language: nil, code: "console.log(1)")])
    }

    func testHeadingsListsQuoteAndRule() {
        let text = """
        ## Results

        1. first
        2. second
          - nested detail

        ---

        > worth noting
        > across two lines
        """
        let blocks = MarkdownBlock.parse(text)
        XCTAssertEqual(blocks[0], .heading(level: 2, text: "Results"))
        XCTAssertEqual(blocks[1], .list(items: [
            .init(depth: 0, ordinal: 1, text: "first"),
            .init(depth: 0, ordinal: 2, text: "second"),
            .init(depth: 1, ordinal: nil, text: "nested detail"),
        ]))
        XCTAssertEqual(blocks[2], .rule)
        XCTAssertEqual(blocks[3], .quote("worth noting\nacross two lines"))
    }

    func testPlainProseStaysOneParagraphAndDashedProseIsNotARule() {
        let blocks = MarkdownBlock.parse("line one\nline two\n\nsecond para with a - dash")
        XCTAssertEqual(blocks, [
            .paragraph("line one\nline two"),
            .paragraph("second para with a - dash"),
        ])
    }

    func testNumberedProseIsNotAListWithoutSeparator() {
        // "2026. was a year" — digits + ". " IS a list per markdown; but a bare
        // number with no dot-space stays prose.
        XCTAssertEqual(MarkdownBlock.parse("call 911 now"), [.paragraph("call 911 now")])
    }
}
