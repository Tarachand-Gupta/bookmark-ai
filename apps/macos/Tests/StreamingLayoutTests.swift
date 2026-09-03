import SwiftUI
import XCTest
@testable import BookmarkAI

/// Regression guard for the "give me sample markdown" hang: streaming deltas
/// change the SHAPE of a message's markdown blocks (a fence opens and swallows
/// the tail, a table splits out, lists grow), and the transcript must relayout
/// each time without feedback loops. The original bug: a bottom-anchored
/// LazyVStack transcript spun at 99% CPU in LazySubviewPlacements. The
/// transcript is eager now; this pins that the parse+layout storm stays cheap.
final class StreamingLayoutTests: XCTestCase {

    @MainActor
    func testStreamingMarkdownRelayoutStormStaysFast() {
        let reply = """
        Here's a sample document to exercise a markdown renderer:

        # Heading one
        Some **bold** and a [link](https://example.com).

        | Feature | Status | Notes |
        |---|---|---|
        | Tables | works | header + zebra rows |
        | Code | works | fenced, with language |
        | Lists | works | ordered and nested |

        1. first item
        2. second item
          - nested bullet

        > A quote to round it out.

        ```markdown
        # Sample inside a fence
        | a | b |
        |---|---|
        | 1 | 2 |
        ```

        ---

        That covers every block type.
        """

        struct Transcript: View {
            let text: String
            var body: some View {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        MarkdownText(text: "Earlier full answer with a small table:\n\n| x | y |\n|---|---|\n| 1 | 2 |")
                        MarkdownText(text: text)
                    }
                    .padding(16)
                    .frame(maxWidth: 860, alignment: .leading)
                }
            }
        }

        let host = NSHostingView(rootView: Transcript(text: ""))
        host.frame = NSRect(x: 0, y: 0, width: 720, height: 600)

        let start = Date()
        // ~12-char deltas, the shape a real SSE text stream produces.
        var shown = ""
        var index = reply.startIndex
        while index < reply.endIndex {
            let next = reply.index(index, offsetBy: 12, limitedBy: reply.endIndex) ?? reply.endIndex
            shown += reply[index..<next]
            index = next
            host.rootView = Transcript(text: shown)
            host.layoutSubtreeIfNeeded()
        }
        let elapsed = Date().timeIntervalSince(start)

        // The whole storm (~100 delta relayouts) finished in well under a second
        // when healthy; 10s means a layout pathology is back.
        XCTAssertLessThan(elapsed, 10, "streaming relayout storm took \(elapsed)s — layout feedback loop?")
    }
}
