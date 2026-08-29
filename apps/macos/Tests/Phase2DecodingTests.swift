import XCTest
@testable import BookmarkAI

/// Phase 2 contracts, pinned with REAL payloads captured from the running API —
/// not hand-idealized JSON. If the server shape drifts, these fail first.
final class Phase2DecodingTests: XCTestCase {

    // MARK: - Sessions

    func testSessionDecodesRealShape() throws {
        let json = """
        {"sessions":[{"id":"e01b5358","name":"Japan trip planning","tabs":[
          {"url":"https://www.japan-guide.com/e/e2025.html","title":"Tokyo Travel Guide"},
          {"url":"chrome://settings","title":"Settings"}],
          "tabCount":2,"description":"Planning a trip.","browser":"chrome","device":"laptop",
          "os":null,"savedAt":"2026-08-20T08:30:00.000Z","createdAt":"2026-08-20T08:30:01.000Z"}]}
        """.data(using: .utf8)!
        let response = try ApiClient.decoder.decode(ListSessionsResponse.self, from: json)
        let session = try XCTUnwrap(response.sessions.first)
        XCTAssertEqual(session.tabCount, 2)
        XCTAssertEqual(session.openableTabs.count, 1, "chrome:// must not be openable")
        XCTAssertNotNil(session.savedAtDate)
        XCTAssertEqual(session.tabs[0].faviconURL?.host(), "www.japan-guide.com")
    }

    // MARK: - Live

    func testListLiveResponseDecodes() throws {
        let json = """
        {"devices":[{"deviceId":"d1","label":"MacBook Pro","browser":"chrome","device":"laptop",
          "os":"macOS","windows":[{"windowId":7,"focused":true,"name":null,
          "tabs":[{"url":"https://github.com","title":"GitHub","active":true},
                  {"url":"https://mail.example.com","redacted":true,"title":""}]}],
          "tabCount":2,"hiddenTabCount":1,"lastSeenAt":"2026-08-29T00:00:00.000Z",
          "lastSeenAgeSeconds":12,"newWindowsShared":false}],
         "enabled":true,"ttlHours":12}
        """.data(using: .utf8)!
        let response = try ApiClient.decoder.decode(ListLiveResponse.self, from: json)
        let device = try XCTUnwrap(response.devices.first)
        XCTAssertTrue(device.isActive)
        XCTAssertEqual(device.freshnessText, "active now")
        XCTAssertEqual(device.windows[0].displayName(at: 0), "Window 1")
        XCTAssertEqual(device.windows[0].tabs[1].redacted, true)
        XCTAssertTrue(response.enabled)
    }

    func testStaleDeviceFreshness() throws {
        var device = LiveDevice(
            deviceId: "d", label: "l", browser: "chrome", device: "laptop", os: nil,
            windows: [], tabCount: 0, hiddenTabCount: 0,
            lastSeenAt: "2026-08-29T00:00:00.000Z", lastSeenAgeSeconds: 4000
        )
        XCTAssertFalse(device.isActive)
        XCTAssertEqual(device.freshnessText, "1h ago")
        device.lastSeenAgeSeconds = 300
        XCTAssertEqual(device.freshnessText, "5m ago")
    }

    // MARK: - Chat storage

    /// The exact stored-message shape the conversations API returns (captured):
    /// text parts, step-start separators, `tool-<name>` parts with provider
    /// metadata — all must round-trip losslessly through `JSONValue`.
    func testStoredConversationRoundTripsAndProjects() throws {
        let json = """
        {"conversation":{"id":"c1","title":"How many?","createdAt":"2026-08-28T20:32:33.719Z",
          "updatedAt":"2026-08-28T20:32:36.156Z"},
         "messages":[
          {"id":"m1","role":"user","parts":[{"type":"text","text":"How many?"}]},
          {"id":"m2","role":"assistant","parts":[
            {"type":"step-start"},
            {"type":"tool-queryDatabase","toolCallId":"call1","state":"output-available",
             "input":{"sql":"SELECT COUNT(*) FROM bookmarks"},
             "output":{"columns":["COUNT(*)"],"rows":[[4]],"rowCount":1,"truncated":false},
             "callProviderMetadata":{"google":{"thoughtSignature":"abc123"}}},
            {"type":"step-start"},
            {"type":"text","text":"You have 4 bookmarks."}]}]}
        """.data(using: .utf8)!

        let detail = try ApiClient.decoder.decode(ChatConversationDetailResponse.self, from: json)
        XCTAssertEqual(detail.messages.count, 2)

        let assistant = detail.messages[1]
        XCTAssertEqual(assistant.partViews, [
            .tool(name: "queryDatabase", running: false),
            .text("You have 4 bookmarks."),
        ])

        // Lossless re-encode: the provider metadata and integer rows survive,
        // because the next turn re-sends these parts verbatim.
        let reencoded = try JSONEncoder().encode(assistant)
        let decoded = try JSONDecoder().decode(ChatMessage.self, from: reencoded)
        XCTAssertEqual(decoded, assistant)
        let tool = decoded.parts[1]
        XCTAssertEqual(tool["callProviderMetadata"]?["google"]?["thoughtSignature"]?.stringValue, "abc123")
        XCTAssertEqual(tool["output"]?["rows"], .array([.array([.int(4)])]))
    }

    // MARK: - Chat stream parsing (fixtures captured from the live endpoint)

    func testChatStreamChunkParsesCapturedLines() {
        XCTAssertEqual(
            ChatStreamChunk.parse(line: #"data: {"type":"start","messageId":"48f2"}"#),
            .start(messageId: "48f2")
        )
        XCTAssertEqual(
            ChatStreamChunk.parse(line: #"data: {"type":"text-start","id":"0"}"#),
            .textStart(id: "0")
        )
        XCTAssertEqual(
            ChatStreamChunk.parse(line: #"data: {"type":"text-delta","id":"0","delta":"You have 4"}"#),
            .textDelta(id: "0", delta: "You have 4")
        )
        XCTAssertEqual(
            ChatStreamChunk.parse(
                line: #"data: {"type":"tool-input-start","toolCallId":"c1","toolName":"queryDatabase","providerMetadata":{"google":{"thoughtSignature":"x"}}}"#
            ),
            .toolInputStart(toolCallId: "c1", toolName: "queryDatabase")
        )
        XCTAssertEqual(
            ChatStreamChunk.parse(
                line: #"data: {"type":"tool-output-available","toolCallId":"c1","output":{"rowCount":1}}"#
            ),
            .toolOutputAvailable(toolCallId: "c1", output: .object(["rowCount": .int(1)]))
        )
        XCTAssertEqual(
            ChatStreamChunk.parse(line: #"data: {"type":"finish","finishReason":"stop"}"#),
            .finish
        )
        XCTAssertEqual(ChatStreamChunk.parse(line: "data: [DONE]"), .done)
        // Non-data and unknown-type lines must be ignored/absorbed, not fail.
        XCTAssertNil(ChatStreamChunk.parse(line: ""))
        XCTAssertNil(ChatStreamChunk.parse(line: ": keepalive"))
        XCTAssertEqual(
            ChatStreamChunk.parse(line: #"data: {"type":"reasoning-delta","id":"1","delta":"…"}"#),
            .other(type: "reasoning-delta")
        )
    }

    func testChatStreamErrorChunk() {
        XCTAssertEqual(
            ChatStreamChunk.parse(line: #"data: {"type":"error","errorText":"boom"}"#),
            .error("boom")
        )
    }
}
